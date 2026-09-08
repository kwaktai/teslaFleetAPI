#include "Mcp2518fdChannel.h"
#include <SPI.h>

bool Mcp2518fdChannel::begin(uint32_t speed) {
  pinMode(_int, INPUT_PULLUP);
  // T-CAN2 / LilyGo 공식과 같은 순서. 로거는 송신하지 않음.
  _can.setMode(CAN_LISTEN_ONLY_MODE);
  SPI.begin(_sclk, _miso, _mosi, _cs);
  return _can.begin(speed) == CAN_OK;
}

bool Mcp2518fdChannel::receive(CanFrame &out) {
  if (_can.checkReceive() != CAN_MSGAVAIL) {
    return false;
  }
  uint8_t len = 0;
  _can.readMsgBuf(&len, out.data);
  out.id = _can.getCanId();
  out.extended = _can.isExtendedFrame();
  out.rtr = _can.isRemoteRequest();
  out.len = len;
  out.fd = (len > 8);
  return true;
}
