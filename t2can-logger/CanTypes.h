#pragma once
#include <Arduino.h>

struct CanFrame {
  uint32_t id = 0;
  uint8_t len = 0;
  uint8_t data[64] = {0};
  bool extended = false;
  bool rtr = false;
  bool fd = false;
};
