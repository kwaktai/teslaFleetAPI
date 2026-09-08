#pragma once
#include "CanChannel.h"

class TwaiChannel : public CanChannel {
 public:
  TwaiChannel(int txPin, int rxPin) : _tx(txPin), _rx(rxPin) {}

  bool begin(uint32_t bitrate) override;
  bool receive(CanFrame &out) override;
  const char *name() const override { return "TWAI(B)"; }

  // 드라이버가 세는 수신 누락. 큐가 넘치면 rxMissed 가 늘어난다.
  bool stats(uint32_t &rxMissed, uint32_t &rxOverrun, uint32_t &queued);
  // 버스오프/정지 상태면 되살린다. 되살렸으면 true.
  bool recover();

 private:
  int _tx;
  int _rx;
};
