#pragma once
#include "CanChannel.h"
#include "mcp2518fd_can.h"

class Mcp2518fdChannel : public CanChannel {
 public:
  Mcp2518fdChannel(int cs, int sclk, int miso, int mosi, int intPin)
      : _cs(cs), _sclk(sclk), _miso(miso), _mosi(mosi), _int(intPin), _can(cs) {}

  bool begin(uint32_t speed) override;
  bool receive(CanFrame &out) override;
  const char *name() const override { return "MCP2518FD(A)"; }

 private:
  int _cs, _sclk, _miso, _mosi, _int;
  mcp2518fd _can;
};
