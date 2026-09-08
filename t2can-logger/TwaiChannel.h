#pragma once
#include "CanChannel.h"

class TwaiChannel : public CanChannel {
 public:
  TwaiChannel(int txPin, int rxPin) : _tx(txPin), _rx(rxPin) {}
  bool begin(uint32_t bitrate) override;
  bool receive(CanFrame &out) override;
  const char *name() const override { return "TWAI(B)"; }

 private:
  int _tx;
  int _rx;
};
