/*
 * T-2CAN FD listen-only logger
 *
 * Vehicle CAN (A) + Chassis CAN (B) 을 듣기만 하고
 * 보드 플래시(FFat)에 CSV 로 저장합니다. 송신하지 않습니다.
 *
 * 나중에 PC/폰에서 꺼내는 방법:
 *   1) USB 시리얼 — 아래 명령 또는 pull_log.py
 *   2) 폰/노트북을 Wi-Fi AP 에 연결 — http://192.168.4.1/log.csv
 *
 * 시리얼 115200, 명령: HELP  STAT  DUMP  CLEAR  ECHO ON|OFF  WIFI ON|OFF
 */

#include <SPI.h>
#include <FFat.h>
#include <WiFi.h>
#include <WebServer.h>
#include "driver/twai.h"
#include "mcp2518fd_can.h"

#define MCP2518_CS 10
#define MCP2518_SCLK 12
#define MCP2518_MOSI 11
#define MCP2518_MISO 13
#define CAN2_TX GPIO_NUM_7
#define CAN2_RX GPIO_NUM_6

static const char *kLog0 = "/canlog0.csv";
static const char *kLog1 = "/canlog1.csv";
static const size_t kRotateBytes = 3UL * 1024UL * 1024UL;
static const size_t kBufBytes = 4096;

static const char *kApSsid = "T2CAN-LOG";
static const char *kApPass = "teslalog1";

mcp2518fd CanA(MCP2518_CS);
WebServer http(80);

File logFile;
uint8_t logSlot = 0;
char lineBuf[kBufBytes];
size_t lineUsed = 0;

uint32_t framesA = 0;
uint32_t framesB = 0;
uint32_t dropped = 0;
uint32_t lastStatMs = 0;
bool echoSerial = false;
bool wifiOn = true;
bool canAOk = false;
bool canBOk = false;

static const char *activePath() { return logSlot ? kLog1 : kLog0; }

void flushLog() {
  if (!logFile || lineUsed == 0) {
    return;
  }
  logFile.write(reinterpret_cast<const uint8_t *>(lineBuf), lineUsed);
  logFile.flush();
  lineUsed = 0;
}

void rotateIfNeeded() {
  if (!logFile || logFile.size() < kRotateBytes) {
    return;
  }
  flushLog();
  logFile.close();
  logSlot = logSlot ? 0 : 1;
  FFat.remove(activePath());
  logFile = FFat.open(activePath(), FILE_APPEND);
}

bool appendLine(const char *line) {
  const size_t n = strlen(line);
  if (n + 1 > kBufBytes) {
    dropped++;
    return false;
  }
  if (lineUsed + n > kBufBytes) {
    flushLog();
    rotateIfNeeded();
    if (!logFile) {
      dropped++;
      return false;
    }
  }
  memcpy(lineBuf + lineUsed, line, n);
  lineUsed += n;
  return true;
}

void logFrame(char bus, uint32_t id, uint8_t len, const uint8_t *data) {
  char line[96];
  int pos = snprintf(line, sizeof(line), "%lu,%c,%03lX,%u,",
                     static_cast<unsigned long>(millis()), bus,
                     static_cast<unsigned long>(id), len);
  if (pos < 0 || pos >= static_cast<int>(sizeof(line))) {
    dropped++;
    return;
  }
  for (uint8_t i = 0; i < len && pos < static_cast<int>(sizeof(line)) - 4; i++) {
    pos += snprintf(line + pos, sizeof(line) - pos, "%02X%s", data[i],
                    (i + 1 < len) ? " " : "");
  }
  if (pos < static_cast<int>(sizeof(line)) - 2) {
    line[pos++] = '\n';
    line[pos] = 0;
  } else {
    dropped++;
    return;
  }

  appendLine(line);
  if (echoSerial) {
    Serial.print(line);
  }
}

void openLog() {
  if (FFat.exists(kLog1) && !FFat.exists(kLog0)) {
    logSlot = 1;
  }
  logFile = FFat.open(activePath(), FILE_APPEND);
  if (!logFile) {
    Serial.println("log open FAIL");
    return;
  }
  if (logFile.size() == 0) {
    logFile.print("ms,bus,id,dlc,data\n");
    logFile.flush();
  }
  Serial.printf("log file %s  size=%u\n", activePath(),
                static_cast<unsigned>(logFile.size()));
}

void handleRoot() {
  String html;
  html += F("<!doctype html><meta charset=utf-8><title>T2CAN LOG</title>");
  html += F("<p>A frames ");
  html += framesA;
  html += F(" / B frames ");
  html += framesB;
  html += F(" / dropped ");
  html += dropped;
  html += F("</p><p><a href='/log.csv'>log.csv 다운로드</a></p>");
  html += F("<p><a href='/stat'>stat</a></p>");
  http.send(200, "text/html; charset=utf-8", html);
}

void handleStat() {
  String s;
  s += "canA=";
  s += canAOk ? "ok" : "fail";
  s += " canB=";
  s += canBOk ? "ok" : "fail";
  s += " framesA=";
  s += framesA;
  s += " framesB=";
  s += framesB;
  s += " dropped=";
  s += dropped;
  s += " file=";
  s += activePath();
  s += " bytes=";
  s += logFile ? logFile.size() + lineUsed : 0;
  s += "\n";
  http.send(200, "text/plain; charset=utf-8", s);
}

void sendFileToHttp(const char *path) {
  File f = FFat.open(path, FILE_READ);
  if (!f) {
    return;
  }
  char buf[513];
  while (f.available()) {
    const int n = f.read(reinterpret_cast<uint8_t *>(buf), 512);
    if (n <= 0) {
      break;
    }
    buf[n] = 0;
    http.sendContent(buf);
  }
  f.close();
}

void handleLog() {
  flushLog();
  http.setContentLength(CONTENT_LENGTH_UNKNOWN);
  http.send(200, "text/csv; charset=utf-8", "");
  if (logSlot == 1) {
    sendFileToHttp(kLog0);
    sendFileToHttp(kLog1);
  } else {
    sendFileToHttp(kLog1);
    sendFileToHttp(kLog0);
  }
}

void startWifi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(kApSsid, kApPass);
  http.on("/", handleRoot);
  http.on("/stat", handleStat);
  http.on("/log.csv", handleLog);
  http.begin();
  Serial.printf("Wi-Fi AP %s  /  %s\n", kApSsid, kApPass);
  Serial.printf("download  http://%s/log.csv\n",
                WiFi.softAPIP().toString().c_str());
}

void stopWifi() {
  http.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  Serial.println("Wi-Fi OFF");
}

void printHelp() {
  Serial.println("HELP  STAT  DUMP  CLEAR  ECHO ON|OFF  WIFI ON|OFF");
}

void printStat() {
  Serial.printf("A=%s framesA=%lu  B=%s framesB=%lu  drop=%lu  %s bytes=%u\n",
                canAOk ? "ok" : "fail", static_cast<unsigned long>(framesA),
                canBOk ? "ok" : "fail", static_cast<unsigned long>(framesB),
                static_cast<unsigned long>(dropped), activePath(),
                static_cast<unsigned>(logFile ? logFile.size() + lineUsed : 0));
}

void streamFileToSerial(const char *path) {
  File f = FFat.open(path, FILE_READ);
  if (!f) {
    return;
  }
  uint8_t buf[256];
  while (f.available()) {
    const int n = f.read(buf, sizeof(buf));
    if (n > 0) {
      Serial.write(buf, n);
    }
  }
  f.close();
}

void dumpFiles() {
  flushLog();
  Serial.println("---LOG-BEGIN---");
  if (logSlot == 1) {
    streamFileToSerial(kLog0);
    streamFileToSerial(kLog1);
  } else {
    streamFileToSerial(kLog1);
    streamFileToSerial(kLog0);
  }
  Serial.println("---LOG-END---");
}

void clearLogs() {
  flushLog();
  if (logFile) {
    logFile.close();
  }
  FFat.remove(kLog0);
  FFat.remove(kLog1);
  logSlot = 0;
  framesA = framesB = dropped = 0;
  openLog();
  Serial.println("logs cleared");
}

void handleSerial() {
  if (!Serial.available()) {
    return;
  }
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toUpperCase();
  if (cmd == "HELP" || cmd == "?") {
    printHelp();
  } else if (cmd == "STAT") {
    printStat();
  } else if (cmd == "DUMP") {
    dumpFiles();
  } else if (cmd == "CLEAR") {
    clearLogs();
  } else if (cmd == "ECHO ON") {
    echoSerial = true;
    Serial.println("echo ON");
  } else if (cmd == "ECHO OFF") {
    echoSerial = false;
    Serial.println("echo OFF");
  } else if (cmd == "WIFI ON") {
    if (!wifiOn) {
      wifiOn = true;
      startWifi();
    }
  } else if (cmd == "WIFI OFF") {
    if (wifiOn) {
      wifiOn = false;
      stopWifi();
    }
  } else if (cmd.length()) {
    printHelp();
  }
}

bool startCanA() {
  SPI.begin(MCP2518_SCLK, MCP2518_MISO, MCP2518_MOSI, MCP2518_CS);
  CanA.setMode(CAN_LISTEN_ONLY_MODE);
  if (CanA.begin(CANFD::BITRATE(500000, 1)) != CAN_OK) {
    Serial.println("CAN A init FAIL");
    return false;
  }
  Serial.println("CAN A listen-only 500k OK");
  return true;
}

bool startCanB() {
  twai_general_config_t g =
      TWAI_GENERAL_CONFIG_DEFAULT(CAN2_TX, CAN2_RX, TWAI_MODE_LISTEN_ONLY);
  twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&g, &t, &f) != ESP_OK) {
    Serial.println("CAN B install FAIL");
    return false;
  }
  if (twai_start() != ESP_OK) {
    Serial.println("CAN B start FAIL");
    return false;
  }
  Serial.println("CAN B listen-only 500k OK");
  return true;
}

void pollCanA() {
  if (!canAOk) {
    return;
  }
  uint8_t safety = 0;
  while (CanA.checkReceive() == CAN_MSGAVAIL && safety < 32) {
    uint8_t len = 0;
    uint8_t buf[64];
    CanA.readMsgBuf(&len, buf);
    logFrame('A', CanA.getCanId(), len, buf);
    framesA++;
    safety++;
  }
}

void pollCanB() {
  if (!canBOk) {
    return;
  }
  twai_message_t msg;
  uint8_t safety = 0;
  while (twai_receive(&msg, 0) == ESP_OK && safety < 32) {
    logFrame('B', msg.identifier, msg.data_length_code, msg.data);
    framesB++;
    safety++;
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);
  delay(1500);
  Serial.println();
  Serial.println("T-2CAN FD logger  listen-only");
  printHelp();

  if (!FFat.begin(false)) {
    Serial.println("FFat mount fail, formatting...");
    if (!FFat.begin(true)) {
      Serial.println("FFat format FAIL — USB serial ECHO only");
    }
  }
  if (FFat.totalBytes()) {
    Serial.printf("FFat %u / %u bytes free\n",
                  static_cast<unsigned>(FFat.freeBytes()),
                  static_cast<unsigned>(FFat.totalBytes()));
    openLog();
  }

  canAOk = startCanA();
  canBOk = startCanB();
  if (wifiOn) {
    startWifi();
  }
}

void loop() {
  pollCanA();
  pollCanB();
  handleSerial();
  if (wifiOn) {
    http.handleClient();
  }

  const uint32_t now = millis();
  if (now - lastStatMs >= 2000) {
    lastStatMs = now;
    flushLog();
    rotateIfNeeded();
  }
}
