#include "Mcp2518fdChannel.h"
#include <SPI.h>

// MCP2518FD 레지스터 주소 (데이터시트 표 4-1)
static const uint16_t kRegCiCON = 0x000;
static const uint16_t kRegCiTREC = 0x034;
static const uint16_t kRegCiBDIAG0 = 0x038;
static const uint16_t kRegCiBDIAG1 = 0x03C;
static const uint16_t kRegCiFIFOSTA1 = 0x060; // 라이브러리 RX FIFO = CH1
static const uint16_t kRegOSC = 0xE00;

bool Mcp2518fdChannel::begin(uint32_t speed) {
  if (!_mux) {
    _mux = xSemaphoreCreateMutex();
  }
  pinMode(_int, INPUT_PULLUP);
  // T-CAN2 / LilyGo 공식과 같은 순서. 로거는 송신하지 않음.
  _can.setMode(CAN_LISTEN_ONLY_MODE);
  SPI.begin(_sclk, _miso, _mosi, _cs);
  if (_can.begin(speed) != CAN_OK) {
    return false;
  }
  // 라이브러리 begin() 은 칩이 없어도 OK 를 돌려준다. 실제로 리슨온리로
  // 들어갔는지 레지스터로 확인한다.
  McpDiag d;
  if (!diag(d, true)) {
    return false;
  }
  return d.alive && d.opmod == 3;
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
  if (_mux) {
    xSemaphoreGive(_mux);
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
  return true;
}
