/**
 * LILYGO T-2CAN-FD 핀맵.
 * 참고: https://github.com/chlsw88/T-CAN2  (LilyGo T_2Can_Fd pin_config.h)
 *
 *   A / CAN1 = MCP2518FD (SPI)  → X437 9/10 Vehicle
 *   B / CAN2 = 내장 TWAI        → X437 13/14 Chassis
 */
#pragma once

#define CAN0_TX_PIN 7
#define CAN0_RX_PIN 6

#define SPI_SCLK_PIN 12
#define SPI_MOSI_PIN 11
#define SPI_MISO_PIN 13

#define MCP2518_CS_PIN 10
#define MCP2518_INT_PIN 8

// Tesla X437 Vehicle/Chassis 는 클래식 CAN 500k.
#define CAN0_BITRATE 500000UL
