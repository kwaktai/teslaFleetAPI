#pragma once
#include "CanTypes.h"

class CanChannel {
 public:
  virtual ~CanChannel() {}
  virtual bool begin(uint32_t bitrate) = 0;
  virtual bool receive(CanFrame &out) = 0;
  virtual const char *name() const = 0;
};
