#pragma once
#include <Arduino.h>

struct CanFrame {
  uint32_t id = 0;
  uint8_t len = 0;
  uint8_t data[64] = {0};
  bool extended = false;
  bool rtr = false;
  bool fd = false;
  uint32_t ms = 0;  // 수신 시각(millis 기준). 0 이면 모름 → 처리 시각 사용
};
