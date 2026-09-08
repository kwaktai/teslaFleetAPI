#include "TwaiChannel.h"
#include "driver/twai.h"

bool TwaiChannel::begin(uint32_t bitrate) {
  twai_general_config_t g =
      TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)_tx, (gpio_num_t)_rx,
                                  TWAI_MODE_LISTEN_ONLY);
  g.tx_queue_len = 16;
  g.rx_queue_len = 32;

  twai_timing_config_t t;
  switch (bitrate) {
    case 125000UL:
      t = TWAI_TIMING_CONFIG_125KBITS();
      break;
    case 250000UL:
      t = TWAI_TIMING_CONFIG_250KBITS();
      break;
    case 1000000UL:
      t = TWAI_TIMING_CONFIG_1MBITS();
      break;
    default:
      t = TWAI_TIMING_CONFIG_500KBITS();
      break;
  }

  twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&g, &t, &f) != ESP_OK) {
    return false;
  }
  return twai_start() == ESP_OK;
}

bool TwaiChannel::receive(CanFrame &out) {
  twai_message_t m;
  if (twai_receive(&m, 0) != ESP_OK) {
    return false;
  }
  out.id = m.identifier;
  out.extended = m.extd;
  out.rtr = m.rtr;
  out.fd = false;
  out.len = m.data_length_code > 8 ? 8 : m.data_length_code;
  for (uint8_t i = 0; i < out.len; i++) {
    out.data[i] = m.data[i];
  }
  return true;
}
