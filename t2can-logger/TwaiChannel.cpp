#include "TwaiChannel.h"

#include "esp_attr.h"
#include "esp_intr_alloc.h"
#include "esp_rom_gpio.h"
#include "esp_timer.h"
#include "esp_private/periph_ctrl.h"
#include "soc/gpio_sig_map.h"
#include "soc/interrupts.h"
#include "soc/periph_defs.h"
#include "soc/twai_struct.h"

namespace {

// 레지스터 비트 (SJA1000 호환 레이아웃, IDF hal/twai_ll.h 와 같음)
constexpr uint32_t kStatusRbs = 1u << 0;  // 수신 버퍼에 프레임 있음
constexpr uint32_t kStatusDos = 1u << 1;  // 데이터 오버런 발생
constexpr uint32_t kStatusBs = 1u << 7;   // 버스오프
constexpr uint32_t kStatusMs = 1u << 8;   // 이 슬롯의 프레임은 넘쳐서 잃음 (S3)
constexpr uint32_t kCmdReleaseRx = 1u << 2;
constexpr uint32_t kCmdClearOverrun = 1u << 3;
constexpr uint32_t kIntrRx = 1u << 0;
constexpr uint32_t kIntrErr = 1u << 2;
constexpr uint32_t kIntrOverrun = 1u << 3;
constexpr uint32_t kIntrErrPassive = 1u << 5;
constexpr uint32_t kIntrArbLost = 1u << 6;
constexpr uint32_t kIntrBusErr = 1u << 7;

// ISR → 태스크 링. 정적 배열은 .bss = 내부 DRAM 이라 캐시가 꺼져도 접근 가능.
// 플래시 섹터 한 번(≤45ms) 동안 2500fps 면 ~110 프레임. 여유 있게.
struct RxRec {
  int64_t us;   // esp_timer_get_time() — ms 변환(64비트 나눗셈)은 태스크에서
  uint32_t id;  // bit31 = extended, bit30 = rtr
  uint8_t len;
  uint8_t data[8];
};
constexpr uint32_t kRingSize = 1024;  // 2^n
RxRec s_ring[kRingSize];
volatile uint32_t s_head = 0;  // ISR 이 씀
volatile uint32_t s_tail = 0;  // 태스크가 씀
volatile uint32_t s_ringFull = 0;
volatile uint32_t s_hwOverrun = 0;
volatile uint32_t s_errIntr = 0;
volatile uint32_t s_frames = 0;
intr_handle_t s_intr = nullptr;
bool s_started = false;

// IRAM 에 있고, IRAM/DRAM 만 건드린다: 레지스터, s_ring, esp_timer_get_time
// (IRAM). 플래시 쓰기 중에도 실행된다.
void IRAM_ATTR twaiIsr(void *) {
  // 읽으면 RI 를 제외한 인터럽트 플래그가 지워진다.
  const uint32_t intr = TWAI.interrupt_reg.val;
  if (intr & (kIntrErr | kIntrErrPassive | kIntrArbLost | kIntrBusErr)) {
    s_errIntr = s_errIntr + 1;
  }
  uint32_t n = TWAI.rx_message_counter_reg.val & 0x7F;
  while (n--) {
    const uint32_t st = TWAI.status_reg.val;
    if (!(st & kStatusRbs)) {
      break;
    }
    if (st & kStatusMs) {
      // 넘쳐서 내용이 없는 슬롯. 비우고 센다.
      TWAI.command_reg.val = kCmdReleaseRx;
      s_hwOverrun = s_hwOverrun + 1;
      continue;
    }
    uint8_t b[13];
    for (int i = 0; i < 13; i++) {
      b[i] = static_cast<uint8_t>(TWAI.tx_rx_buffer[i].val & 0xFF);
    }
    TWAI.command_reg.val = kCmdReleaseRx;

    const uint32_t next = (s_head + 1) & (kRingSize - 1);
    if (next == s_tail) {
      s_ringFull = s_ringFull + 1;
      continue;
    }
    RxRec &r = s_ring[s_head];
    const bool ext = b[0] & 0x80;
    const bool rtr = b[0] & 0x40;
    uint8_t len = b[0] & 0x0F;
    if (len > 8) {
      len = 8;
    }
    const uint8_t *d;
    uint32_t id;
    if (ext) {
      id = (static_cast<uint32_t>(b[1]) << 21) | (static_cast<uint32_t>(b[2]) << 13) |
           (static_cast<uint32_t>(b[3]) << 5) | (b[4] >> 3);
      d = b + 5;
    } else {
      id = (static_cast<uint32_t>(b[1]) << 3) | (b[2] >> 5);
      d = b + 3;
    }
    r.us = esp_timer_get_time();
    r.id = id | (ext ? 0x80000000u : 0) | (rtr ? 0x40000000u : 0);
    r.len = rtr ? 0 : len;
    for (uint8_t i = 0; i < r.len; i++) {
      r.data[i] = d[i];
    }
    s_head = next;
    s_frames = s_frames + 1;
  }
  if ((intr & kIntrOverrun) || (TWAI.status_reg.val & kStatusDos)) {
    TWAI.command_reg.val = kCmdClearOverrun;
  }
}

bool timingFor(uint32_t bitrate, uint32_t &brp, uint32_t &tseg1, uint32_t &tseg2,
               uint32_t &sjw) {
  // APB 80MHz. IDF TWAI_TIMING_CONFIG_xxx 와 같은 값: 1+15+4 = 20 TQ.
  tseg1 = 15;
  tseg2 = 4;
  sjw = 3;
  switch (bitrate) {
    case 125000UL: brp = 32; return true;
    case 250000UL: brp = 16; return true;
    case 500000UL: brp = 8; return true;
    case 1000000UL: brp = 4; return true;
    default: return false;
  }
}

void enterReset() {
  TWAI.mode_reg.rm = 1;
  while (!TWAI.mode_reg.rm) {
  }
}

void exitReset() {
  // 시작 전에 FIFO 를 비운다
  while (TWAI.status_reg.val & kStatusRbs) {
    TWAI.command_reg.val = kCmdReleaseRx;
  }
  TWAI.command_reg.val = kCmdClearOverrun;
  (void)TWAI.interrupt_reg.val;
  TWAI.mode_reg.rm = 0;
  while (TWAI.mode_reg.rm) {
  }
}

}  // namespace

bool TwaiChannel::begin(uint32_t bitrate) {
  uint32_t brp, tseg1, tseg2, sjw;
  if (!timingFor(bitrate, brp, tseg1, tseg2, sjw)) {
    return false;
  }

  periph_module_reset(PERIPH_TWAI_MODULE);
  periph_module_enable(PERIPH_TWAI_MODULE);

  enterReset();
  // 리슨온리: ACK 도 에러 프레임도 내지 않는다. stm(self test)=0.
  TWAI.mode_reg.lom = 1;
  TWAI.mode_reg.stm = 0;
  TWAI.bus_timing_0_reg.brp = (brp / 2) - 1;
  TWAI.bus_timing_0_reg.sjw = sjw - 1;
  TWAI.bus_timing_1_reg.tseg1 = tseg1 - 1;
  TWAI.bus_timing_1_reg.tseg2 = tseg2 - 1;
  TWAI.bus_timing_1_reg.sam = 0;
  TWAI.error_warning_limit_reg.val = 96;
  TWAI.rx_error_counter_reg.val = 0;
  TWAI.tx_error_counter_reg.val = 0;
  // 전부 수신 (single filter, mask 전부 1)
  for (int i = 0; i < 4; i++) {
    TWAI.acceptance_filter.acr[i].val = 0;
    TWAI.acceptance_filter.amr[i].val = 0xFF;
  }
  TWAI.mode_reg.afm = 1;
  TWAI.clock_divider_reg.val = 0;  // CLKOUT 끔 (S3 기본 레이아웃)
  (void)TWAI.interrupt_reg.val;
  // DOI 는 IDF 도 켜지 않는다 ("HW peculiarities"). 오버런은 RI 경로에서
  // 상태 레지스터(DOS/MS)로 처리한다.
  TWAI.interrupt_enable_reg.val =
      kIntrRx | kIntrErr | kIntrErrPassive | kIntrArbLost | kIntrBusErr;

  // 핀. TX 도 IDF 와 같이 연결한다 — 트랜시버 TXD 를 띄워 두면 dominant 로
  // 읽힐 수 있어서, 컨트롤러가 항상 recessive(high) 를 내도록 한다.
  // 리슨온리 모드에서는 컨트롤러가 dominant 를 내지 않는다.
  pinMode(_rx, INPUT);
  esp_rom_gpio_connect_in_signal(_rx, TWAI_RX_IDX, false);
  pinMode(_tx, OUTPUT);
  esp_rom_gpio_connect_out_signal(_tx, TWAI_TX_IDX, false, false);

  s_head = 0;
  s_tail = 0;
  if (!s_intr) {
    const esp_err_t e = esp_intr_alloc(ETS_TWAI_INTR_SOURCE,
                                       ESP_INTR_FLAG_LEVEL1 | ESP_INTR_FLAG_IRAM, twaiIsr,
                                       nullptr, &s_intr);
    if (e != ESP_OK) {
      return false;
    }
  }
  exitReset();
  s_started = true;
  return true;
}

bool TwaiChannel::receive(CanFrame &out) {
  if (s_tail == s_head) {
    return false;
  }
  const RxRec &r = s_ring[s_tail];
  out.id = r.id & 0x1FFFFFFFu;
  out.extended = r.id & 0x80000000u;
  out.rtr = r.id & 0x40000000u;
  out.fd = false;
  out.len = r.len;
  out.ms = static_cast<uint32_t>(r.us / 1000);
  for (uint8_t i = 0; i < r.len; i++) {
    out.data[i] = r.data[i];
  }
  s_tail = (s_tail + 1) & (kRingSize - 1);
  return true;
}

bool TwaiChannel::stats(uint32_t &rxMissed, uint32_t &rxOverrun, uint32_t &queued) {
  rxMissed = s_ringFull;
  rxOverrun = s_hwOverrun;
  queued = (s_head - s_tail) & (kRingSize - 1);
  return s_started;
}

uint32_t TwaiChannel::errorInterrupts() const { return s_errIntr; }

bool TwaiChannel::recover() {
  if (!s_started) {
    return false;
  }
  // 버스오프가 되면 컨트롤러가 스스로 리셋 모드로 들어간다 (리슨온리에서는
  // 거의 없음). 리셋 모드에서 나오면 다시 듣는다.
  if (TWAI.mode_reg.rm || (TWAI.status_reg.val & kStatusBs)) {
    exitReset();
    return true;
  }
  return false;
}
