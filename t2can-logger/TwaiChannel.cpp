#include "TwaiChannel.h"
#include "driver/twai.h"

bool TwaiChannel::begin(uint32_t bitrate) {
  twai_general_config_t g =
      TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)_tx, (gpio_num_t)_rx,
                                  TWAI_MODE_LISTEN_ONLY);
  g.tx_queue_len = 0;
  // Tesla Chassis 는 초당 400프레임 이상. 플래시 쓰기/Wi-Fi 로 잠깐 멈춰도
  // 잃지 않도록 크게 잡는다.
  g.rx_queue_len = 512;

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

bool TwaiChannel::stats(uint32_t &rxMissed, uint32_t &rxOverrun,
                        uint32_t &queued) {
  twai_status_info_t st;
  if (twai_get_status_info(&st) != ESP_OK) {
    return false;
  }
  rxMissed = st.rx_missed_count;
  rxOverrun = st.rx_overrun_count;
  queued = st.msgs_to_rx;
  return true;
}

bool TwaiChannel::recover() {
  twai_status_info_t st;
  if (twai_get_status_info(&st) != ESP_OK) {
    return false;
  }
  if (st.state == TWAI_STATE_BUS_OFF) {
    twai_initiate_recovery();
    return true;
  }
  if (st.state == TWAI_STATE_STOPPED) {
    return twai_start() == ESP_OK;
  }
  return false;
}
