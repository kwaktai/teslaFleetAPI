#pragma once
#include "CanChannel.h"

// ESP32-S3 내장 TWAI(CAN B) 를 레지스터 직접 제어 + IRAM 인터럽트로 받는다.
//
// 왜 IDF twai 드라이버를 안 쓰나: Arduino 빌드는 CONFIG_TWAI_ISR_IN_IRAM 이
// 꺼져 있어 드라이버 ISR 이 플래시에 있다. 플래시에 쓰는 동안(캐시 꺼짐,
// 섹터당 20~45ms) 그 ISR 은 멈추고, 컨트롤러의 64바이트 RX FIFO(5프레임)는
// 2ms 만에 넘친다. 초당 2400프레임인 Chassis 버스에서는 30% 를 그렇게 잃었다
// (hb 의 Bover). 여기 ISR 은 IRAM 에 있고 내부 RAM 링에만 쓰므로 플래시
// 쓰기 중에도 계속 받는다. 송신 경로는 없다(리슨온리).
class TwaiChannel : public CanChannel {
 public:
  TwaiChannel(int txPin, int rxPin) : _tx(txPin), _rx(rxPin) {}

  bool begin(uint32_t bitrate) override;
  bool receive(CanFrame &out) override;
  const char *name() const override { return "TWAI(B)"; }

  // rxMissed = 링이 꽉 차서 버린 수, rxOverrun = 컨트롤러 FIFO 가 넘쳐 잃은 수,
  // queued = 링에 대기 중인 프레임 수.
  bool stats(uint32_t &rxMissed, uint32_t &rxOverrun, uint32_t &queued);
  // 버스오프/리셋 모드에 빠져 있으면 되살린다. 되살렸으면 true.
  bool recover();
  // ISR 이 본 에러 인터럽트 누계 (bit/stuff/form 등, 진단용)
  uint32_t errorInterrupts() const;

 private:
  int _tx;
  int _rx;
};
