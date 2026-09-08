#pragma once
#include "CanChannel.h"
#include "mcp2518fd_can.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

// MCP2518FD 레지스터를 직접 읽어 "왜 프레임이 없는지" 를 가르는 진단값.
// 라이브러리 begin() 은 항상 0(OK) 을 돌려주므로 칩이 살아 있는지도 여기서 본다.
struct McpDiag {
  bool alive = false;      // SPI 로 CiCON 이 정상 값으로 읽힘
  uint8_t opmod = 0xFF;    // 3 = listen-only
  uint8_t rec = 0;         // 수신 에러 카운터
  uint8_t tec = 0;         // 송신 에러 카운터 (리슨온리면 0)
  uint16_t efmsg = 0;      // 에러 없이 받은 프레임 수 (마지막 clear 이후)
  uint8_t nrerr = 0;       // nominal 수신 에러 수 (마지막 clear 이후)
  bool stuffErr = false;
  bool formErr = false;
  bool crcErr = false;
  bool bit0Err = false;
  bool bit1Err = false;
  bool ackErr = false;
  bool busOff = false;
  bool rxPassive = false;
  bool rxOverflow = false; // RX FIFO 넘침
  bool oscReady = false;
  bool intLow = false;     // INT 핀 LOW = 인터럽트 대기 중
  uint32_t cicon = 0;
  uint32_t bdiag1 = 0;
};

class Mcp2518fdChannel : public CanChannel {
 public:
  Mcp2518fdChannel(int cs, int sclk, int miso, int mosi, int intPin)
      : _cs(cs), _sclk(sclk), _miso(miso), _mosi(mosi), _int(intPin), _can(cs) {}

  bool begin(uint32_t speed) override;
  bool receive(CanFrame &out) override;
  const char *name() const override { return "MCP2518FD(A)"; }

  // 진단 레지스터를 읽는다. clearCounters 면 읽은 뒤 BDIAG0/1 을 0 으로 비워
  // 다음 호출까지의 증가분만 보게 한다. 수신 태스크와 SPI 를 나눠 쓰므로 뮤텍스.
  bool diag(McpDiag &d, bool clearCounters);

 private:
  uint32_t rawRead(uint16_t addr);
  void rawWrite(uint16_t addr, uint32_t v);

  int _cs, _sclk, _miso, _mosi, _int;
  mcp2518fd _can;
  SemaphoreHandle_t _mux = nullptr;
};
