#include "Mcp2518fdChannel.h"
#include <SPI.h>
#include "esp_timer.h"
#include "freertos/task.h"

// MCP2518FD 레지스터 주소 (데이터시트 표 4-1)
static const uint16_t kRegCiCON = 0x000;
static const uint16_t kRegCiTREC = 0x034;
static const uint16_t kRegCiBDIAG0 = 0x038;
static const uint16_t kRegCiBDIAG1 = 0x03C;
static const uint16_t kRegCiFIFOSTA1 = 0x060; // 라이브러리 RX FIFO = CH1
static const uint16_t kRegCiTBC = 0x010;
static const uint16_t kRegCiTSCON = 0x014;
static const uint16_t kRegOSC = 0xE00;

// TBC 프리스케일러: SYSCLK/1000 으로 세면 40MHz 에서 40kHz. 32비트 읽기가
// 바이트 단위라 하위 바이트가 넘어가는 순간 읽으면 값이 깨질 수 있는데,
// 6.4ms 에 한 번이라 3회 읽어 중간값을 쓰면 충분하다.
static const uint32_t kTbcPrescale = 1000;
static const uint32_t kTbcMeasureMs = 200;

static uint32_t median3(uint32_t a, uint32_t b, uint32_t c) {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

bool Mcp2518fdChannel::begin(uint32_t speed) {
  if (!_mux) {
    _mux = xSemaphoreCreateMutex();
  }
  if (_mux && xSemaphoreTake(_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
    return false;
  }
  pinMode(_int, INPUT_PULLUP);
  pinMode(_cs, OUTPUT);
  digitalWrite(_cs, HIGH);
  // T-CAN2 / LilyGo 공식과 같은 순서. 로거는 송신하지 않음.
  _can.setMode(CAN_LISTEN_ONLY_MODE);
  SPI.begin(_sclk, _miso, _mosi, _cs);

  // 라이브러리는 클럭을 말해주지 않으면 20MHz 로 계산한다. T-2CAN FD 회로도의
  // 크리스털은 40MHz(X1 40MHZ 10ppm) 이므로 그대로 두면 "500k" 가 실제로는
  // 1Mbps 가 되어 모든 프레임이 stuff/form 에러로 버려진다. 칩 카운터로
  // 실측해서 라이브러리 상수를 고른다.
  _sysClkHz = measureSysClockHz();
  byte clockset = MCP2518FD_40MHz;
  _clockMhz = 40;
  if (_sysClkHz) {
    const uint32_t mhz = (_sysClkHz + 500000UL) / 1000000UL;
    if (mhz >= 8 && mhz <= 12) {
      clockset = MCP2518FD_10MHz;
      _clockMhz = 10;
    } else if (mhz >= 17 && mhz <= 23) {
      clockset = MCP2518FD_20MHz;
      _clockMhz = 20;
    }
  }

  bool ok = _can.begin(speed, clockset) == CAN_OK;
  if (ok) {
    // 라이브러리 begin() 은 칩이 없어도 OK 를 돌려준다. 실제로 리슨온리로
    // 들어갔는지 레지스터로 확인한다.
    McpDiag d;
    readDiagLocked(d, true);
    ok = d.alive && d.opmod == 3;
  }
  if (_mux) {
    xSemaphoreGive(_mux);
  }
  return ok;
}

void Mcp2518fdChannel::rawReset() {
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
  digitalWrite(_cs, LOW);
  SPI.transfer(0x00); // RESET 명령
  SPI.transfer(0x00);
  digitalWrite(_cs, HIGH);
  SPI.endTransaction();
  delay(10);
}

// 리셋 직후(설정 모드, PLL 꺼짐, SCLKDIV=÷1) TBC 를 켜고 200ms 동안 몇 번
// 세는지로 SYSCLK 을 구한다. 이때 SYSCLK = 크리스털 주파수.
uint32_t Mcp2518fdChannel::measureSysClockHz() {
  rawReset();
  const uint32_t osc = rawRead(kRegOSC);
  if (osc == 0 || osc == 0xFFFFFFFFUL || !(osc & (1UL << 10))) {
    return 0; // SPI 응답 없음 또는 오실레이터 미준비
  }
  rawWrite(kRegCiTSCON, (1UL << 16) | (kTbcPrescale - 1));
  rawWrite(kRegCiTBC, 0);
  const int64_t t0 = esp_timer_get_time();
  vTaskDelay(pdMS_TO_TICKS(kTbcMeasureMs));
  const uint32_t a = rawRead(kRegCiTBC);
  const uint32_t b = rawRead(kRegCiTBC);
  const uint32_t c = rawRead(kRegCiTBC);
  const int64_t t1 = esp_timer_get_time();
  rawWrite(kRegCiTSCON, 0);
  const uint32_t ticks = median3(a, b, c);
  const int64_t us = t1 - t0;
  if (ticks == 0 || us <= 0) {
    return 0;
  }
  const uint64_t hz = (static_cast<uint64_t>(ticks) * kTbcPrescale * 1000000ULL) /
                      static_cast<uint64_t>(us);
  return static_cast<uint32_t>(hz);
}

bool Mcp2518fdChannel::receive(CanFrame &out) {
  if (_mux && xSemaphoreTake(_mux, 0) != pdTRUE) {
    return false;
  }
  bool got = false;
  if (_can.checkReceive() == CAN_MSGAVAIL) {
    uint8_t len = 0;
    _can.readMsgBuf(&len, out.data);
    out.id = _can.getCanId();
    out.extended = _can.isExtendedFrame();
    out.rtr = _can.isRemoteRequest();
    out.len = len;
    out.fd = (len > 8);
    got = true;
  }
  if (_mux) {
    xSemaphoreGive(_mux);
  }
  return got;
}

uint32_t Mcp2518fdChannel::rawRead(uint16_t addr) {
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
  digitalWrite(_cs, LOW);
  SPI.transfer(static_cast<uint8_t>((0x3 << 4) | ((addr >> 8) & 0xF)));
  SPI.transfer(static_cast<uint8_t>(addr & 0xFF));
  uint32_t v = 0;
  for (int i = 0; i < 4; i++) {
    v |= static_cast<uint32_t>(SPI.transfer(0)) << (8 * i);
  }
  digitalWrite(_cs, HIGH);
  SPI.endTransaction();
  return v;
}

void Mcp2518fdChannel::rawWrite(uint16_t addr, uint32_t v) {
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
  digitalWrite(_cs, LOW);
  SPI.transfer(static_cast<uint8_t>((0x2 << 4) | ((addr >> 8) & 0xF)));
  SPI.transfer(static_cast<uint8_t>(addr & 0xFF));
  for (int i = 0; i < 4; i++) {
    SPI.transfer(static_cast<uint8_t>((v >> (8 * i)) & 0xFF));
  }
  digitalWrite(_cs, HIGH);
  SPI.endTransaction();
}

bool Mcp2518fdChannel::diag(McpDiag &d, bool clearCounters) {
  if (_mux && xSemaphoreTake(_mux, pdMS_TO_TICKS(200)) != pdTRUE) {
    return false;
  }
  readDiagLocked(d, clearCounters);
  if (_mux) {
    xSemaphoreGive(_mux);
  }
  return true;
}

void Mcp2518fdChannel::readDiagLocked(McpDiag &d, bool clearCounters) {
  const uint32_t con = rawRead(kRegCiCON);
  const uint32_t trec = rawRead(kRegCiTREC);
  const uint32_t bd0 = rawRead(kRegCiBDIAG0);
  const uint32_t bd1 = rawRead(kRegCiBDIAG1);
  const uint32_t fsta = rawRead(kRegCiFIFOSTA1);
  const uint32_t osc = rawRead(kRegOSC);
  if (clearCounters) {
    rawWrite(kRegCiBDIAG0, 0);
    rawWrite(kRegCiBDIAG1, 0);
    if (fsta & (1UL << 3)) {
      // RXOVIF 는 쓰기로 지운다
      rawWrite(kRegCiFIFOSTA1, fsta & ~(1UL << 3));
    }
  }

  d.cicon = con;
  d.bdiag1 = bd1;
  // 리셋값의 상위 바이트에는 항상 1 인 비트가 있고, 전부 0/1 이면 SPI 응답 없음
  d.alive = (con != 0 && con != 0xFFFFFFFFUL);
  d.opmod = static_cast<uint8_t>((con >> 21) & 0x7);
  d.rec = static_cast<uint8_t>(trec & 0xFF);
  d.tec = static_cast<uint8_t>((trec >> 8) & 0xFF);
  d.rxPassive = trec & (1UL << 19);
  d.busOff = trec & (1UL << 21);
  d.nrerr = static_cast<uint8_t>(bd0 & 0xFF);
  d.efmsg = static_cast<uint16_t>(bd1 & 0xFFFF);
  d.bit0Err = bd1 & (1UL << 16);
  d.bit1Err = bd1 & (1UL << 17);
  d.ackErr = bd1 & (1UL << 18);
  d.formErr = bd1 & (1UL << 19);
  d.stuffErr = bd1 & (1UL << 20);
  d.crcErr = bd1 & (1UL << 21);
  d.rxOverflow = fsta & (1UL << 3);
  d.oscReady = osc & (1UL << 10);
  d.intLow = digitalRead(_int) == LOW;
}
