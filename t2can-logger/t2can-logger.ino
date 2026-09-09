/*
 * T-2CAN FD listen-only logger
 *
 * Vehicle CAN (A) + Chassis CAN (B) 을 듣기만 하고
 * 보드 플래시(FFat)에 CSV 로 저장합니다. 송신하지 않습니다.
 * CAN 채널 구현은 https://github.com/chlsw88/T-CAN2 를 참고했습니다.
 *
 * 나중에 PC/폰에서 꺼내는 방법:
 *   1) USB 시리얼 — 아래 명령 또는 pull_log.py
 *   2) 차 Wi-Fi(STA) 또는 보드 AP — 브라우저에서 /log.csv
 *   3) 시놀로지 /api/canlog 로 PUSH (원격). Tailscale 은 보드가 아니라 NAS/공유기.
 *
 * 시리얼 115200, 명령:
 *   HELP  STAT  DUMP  CLEAR  ECHO ON|OFF
 *   WIFI ON|OFF  WIFI AP  WIFI JOIN <ssid> <pass>  WIFI LIST
 *   WIFI FORGET <ssid>  WIFI SCAN
 *   PUSH URL  PUSH KEY  PUSH NOW  PUSH AUTO ON|OFF
 */

#include <SPI.h>
#include <FFat.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <time.h>
#include <stdarg.h>
#include <esp_system.h>
#include "esp_core_dump.h"
#include "freertos/FreeRTOS.h"
#include "freertos/message_buffer.h"
#include "freertos/task.h"
#include "pin_config.h"
#include "TwaiChannel.h"
#include "Mcp2518fdChannel.h"

// 차 안 Wi-Fi. ESP32-S3 는 2.4GHz 만 됩니다. 이름이 5G 여도 2.4GHz 가
// 같은 SSID 로 나와야 붙습니다. 암호를 여기에 넣거나, 시리얼에서
// WIFI JOIN 으로 저장하세요. 공개 저장소에는 암호를 올리지 마세요.
#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#endif
#ifndef WIFI_SSID_DEFAULT
#define WIFI_SSID_DEFAULT "Raven_5G"
#define WIFI_PASS_DEFAULT ""
#endif
#ifndef WIFI_SSID_DEFAULT_2
#define WIFI_SSID_DEFAULT_2 "Kana_Home"
#define WIFI_PASS_DEFAULT_2 ""
#endif

static const uint8_t kMaxStaNets = 4;

struct StaNet {
  String ssid;
  String pass;
};

static const char *kLog0 = "/canlog0.csv";
static const char *kLog1 = "/canlog1.csv";
static const size_t kRotateBytes = 3UL * 1024UL * 1024UL;
static const size_t kBufBytes = 4096;

// 기기 동작 로그(부팅·재시작 원인·Wi-Fi·PUSH 결과·CAN 상태). CAN 프레임과
// 별도 파일. 시리얼 LOG, 웹 /events.log, NAS ?kind=events 로 꺼낸다.
static const char *kEvtPath = "/events.log";
static const char *kEvtOld = "/events.old";
static const size_t kEvtMax = 256UL * 1024UL;
static const uint32_t kHbEveryMs = 60UL * 1000UL;

static const char *kApSsid = "T2CAN-LOG";
static const char *kApPass = "teslalog1";

Mcp2518fdChannel canA(MCP2518_CS_PIN, SPI_SCLK_PIN, SPI_MISO_PIN, SPI_MOSI_PIN,
                      MCP2518_INT_PIN);
TwaiChannel canB(CAN0_TX_PIN, CAN0_RX_PIN);
WebServer http(80);
Preferences prefs;

enum WifiKind { WIFI_KIND_AP, WIFI_KIND_STA };

File logFile;
uint8_t logSlot = 0;
char lineBuf[kBufBytes];
size_t lineUsed = 0;

// CAN 수신은 별도 태스크(core 1, 높은 우선순위)가 한다. Wi-Fi 스캔이나
// HTTPS PUSH 로 loop() 가 몇 초 멈춰도 프레임을 잃지 않게 하기 위함.
// 태스크 → 메시지 버퍼(한 줄 = 한 메시지) → loop() 가 플래시에 쓴다.
volatile uint32_t framesA = 0;
volatile uint32_t framesB = 0;
volatile uint32_t dropped = 0;
uint32_t rateA = 0;
uint32_t rateB = 0;
uint32_t rateMarkA = 0;
uint32_t rateMarkB = 0;
uint32_t lastRateMs = 0;
uint32_t twaiMissed = 0;
uint32_t twaiOverrun = 0;
uint32_t twaiRecovered = 0;
MessageBufferHandle_t canQueue = nullptr;
size_t canQueueBytes = 0;
TaskHandle_t canTaskHandle = nullptr;
uint32_t lastStatMs = 0;
uint32_t lastWifiCheck = 0;
uint32_t staGotLinkMs = 0;
uint32_t staNoLinkMs = 0;
uint32_t lastPushMs = 0;
uint32_t sentOff = 0;
uint8_t sentSlot = 0;
uint32_t evtSentOff = 0;
uint32_t evtWriteFail = 0;
bool ffatFormatted = false;
// NAS 가 ?kind=events 를 아는지 부팅마다 한 번 빈 본문으로 확인한다. 구버전
// 서버는 events 줄을 CSV 에 섞어 넣으므로, 확인 전에는 올리지 않는다.
bool eventsPushVerified = false;
uint32_t eventsPushRetryMs = 0;
static const uint32_t kEventsPushRetryEveryMs = 6UL * 60UL * 60UL * 1000UL;
uint32_t lastHbMs = 0;
uint32_t hbCount = 0;
uint32_t hbMarkA = 0;
uint32_t hbMarkB = 0;
uint32_t pushOkCount = 0;
uint32_t pushFailCount = 0;
int pushLastCode = 0;
bool echoSerial = false;
bool wifiOn = true;
bool httpBound = false;
bool canAOk = false;
bool canBOk = false;
bool pushAuto = false;
bool wantSta = false;
bool staAnnounced = false;
bool staSearching = false;
bool ntpStarted = false;
bool ntpOk = false;
WifiKind wifiKind = WIFI_KIND_AP;
StaNet staNets[kMaxStaNets];
uint8_t staNetCount = 0;
uint8_t staTryIdx = 0;
bool staOrderDirty = false;
// 낮은 우선순위 망에 붙어 있을 때, 최우선 망이 나타났는지 주기적으로 본다.
uint32_t lastPrefCheckMs = 0;
bool prefScanPending = false;
static const uint32_t kPrefCheckEveryMs = 5UL * 60UL * 1000UL;
String staSsid;
String staPass;
String pushUrl;
String pushKey;

static const uint32_t kStaSearchEveryMs = 10UL * 1000UL;
static const uint32_t kStaHoldMs = 8UL * 1000UL;
static const uint32_t kStaLostConfirmMs = 4UL * 1000UL;
static const uint32_t kPushEveryMs = 60UL * 1000UL;
static const size_t kPushChunk = 48UL * 1024UL;
static const int kPushChunks = 4;

void handleRoot();
void handleStat();
void handleLog();
void handleEvents();
void fillKst(char *out, size_t outLen);
void savePushPrefs();

static const char *activePath() { return logSlot ? kLog1 : kLog0; }

// ---------- 기기 동작 로그 ----------
// loop()/setup() 에서만 부른다 (CAN 수신 태스크에서는 금지: FFat 은 한 태스크만).
void evt(const char *fmt, ...) {
  char msg[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof(msg), fmt, ap);
  va_end(ap);
  char when[24];
  fillKst(when, sizeof(when));
  char line[256];
  snprintf(line, sizeof(line), "%s up=%lu %s\n", when,
           static_cast<unsigned long>(millis() / 1000), msg);
  Serial.print(line);
  if (!FFat.totalBytes()) {
    return;
  }
  File f = FFat.open(kEvtPath, FILE_APPEND);
  if (!f) {
    evtWriteFail++;
    return;
  }
  if (f.print(line) == 0) {
    evtWriteFail++;
  }
  const size_t sz = f.size();
  f.close();
  if (sz > kEvtMax) {
    FFat.remove(kEvtOld);
    FFat.rename(kEvtPath, kEvtOld);
    evtSentOff = 0;
    savePushPrefs();
  }
}

const char *resetReasonText(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_EXT: return "ext-pin";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "PANIC(crash)";
    case ESP_RST_INT_WDT: return "INT-WDT";
    case ESP_RST_TASK_WDT: return "TASK-WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT: return "BROWNOUT(power dip)";
    case ESP_RST_SDIO: return "sdio";
    case ESP_RST_USB: return "usb(PC opened serial)";
    case ESP_RST_JTAG: return "jtag";
    case ESP_RST_EFUSE: return "efuse";
    case ESP_RST_PWR_GLITCH: return "PWR-GLITCH";
    case ESP_RST_CPU_LOCKUP: return "CPU-LOCKUP";
    default: return "unknown";
  }
}

// 직전 부팅이 PANIC 이었으면 코어덤프 파티션에 요약이 남아 있다. 어느 태스크가
// 어디서 죽었는지 기기 로그에 적고 지운다. 주소는 같은 코드로 빌드한 .elf 에
// addr2line 을 돌려 함수명으로 바꿀 수 있다.
void reportCoreDump() {
  if (esp_core_dump_image_check() != ESP_OK) {
    return;
  }
  esp_core_dump_summary_t *s = static_cast<esp_core_dump_summary_t *>(
      calloc(1, sizeof(esp_core_dump_summary_t)));
  if (s && esp_core_dump_get_summary(s) == ESP_OK) {
    char reason[160];
    reason[0] = 0;
    esp_core_dump_get_panic_reason(reason, sizeof(reason));
    evt("CRASH task=%s pc=0x%08lx cause=%lu vaddr=0x%08lx %s", s->exc_task,
        static_cast<unsigned long>(s->exc_pc),
        static_cast<unsigned long>(s->ex_info.exc_cause),
        static_cast<unsigned long>(s->ex_info.exc_vaddr), reason);
    char bt[16 * 11 + 8];
    int pos = 0;
    const uint32_t depth = s->exc_bt_info.depth > 16 ? 16 : s->exc_bt_info.depth;
    for (uint32_t i = 0; i < depth && pos < static_cast<int>(sizeof(bt)) - 12; i++) {
      pos += snprintf(bt + pos, sizeof(bt) - pos, "0x%08lx ",
                      static_cast<unsigned long>(s->exc_bt_info.bt[i]));
    }
    evt("CRASH bt%s: %s", s->exc_bt_info.corrupted ? "(corrupt)" : "", bt);
  } else {
    evt("CRASH coredump present but summary unreadable");
  }
  free(s);
  esp_core_dump_image_erase();
}

// CAN A(MCP2518FD) 가 왜 조용한지 레지스터로 가른다.
// 결과 한 줄 + 판정을 out 에 쓴다.
void describeCanA(char *out, size_t outLen, uint32_t framesSince) {
  McpDiag d;
  if (!canA.diag(d, true)) {
    snprintf(out, outLen, "A diag: SPI busy");
    return;
  }
  const bool anyErr = d.stuffErr || d.formErr || d.crcErr || d.bit0Err ||
                      d.bit1Err || d.ackErr || d.nrerr > 0;
  const char *verdict;
  if (!d.alive) {
    verdict = "칩 응답 없음(SPI) → 보드 불량/전원";
  } else if (!d.oscReady) {
    verdict = "오실레이터 미준비";
  } else if (d.opmod != 3) {
    verdict = "리슨온리 아님(모드 이상)";
  } else if (d.busOff) {
    verdict = "버스오프";
  } else if (framesSince > 0) {
    verdict = "정상 수신";
  } else if (d.efmsg > 0) {
    verdict = "칩은 프레임을 받는데 FIFO 못 읽음 → 드라이버/필터";
  } else if (anyErr) {
    verdict = "신호는 있는데 프레임 오류 → 속도 불일치 또는 H/L 바뀜";
  } else {
    verdict = "버스 신호 없음 → 9/10 배선·커넥터 또는 그 버스가 잠듦";
  }
  snprintf(out, outLen,
           "A chip=%s osc=%s mode=%u rec=%u tec=%u efmsg=%u rxerr=%u "
           "stuff=%u form=%u crc=%u bit0=%u bit1=%u ack=%u rxov=%u int=%s "
           "frames=%lu → %s",
           d.alive ? "ok" : "NONE", d.oscReady ? "ok" : "no", d.opmod, d.rec,
           d.tec, d.efmsg, d.nrerr, d.stuffErr, d.formErr, d.crcErr, d.bit0Err,
           d.bit1Err, d.ackErr, d.rxOverflow, d.intLow ? "low" : "high",
           static_cast<unsigned long>(framesSince), verdict);
}

String currentWifiIp() {
  if (!wifiOn) {
    return "-";
  }
  if (wifiKind == WIFI_KIND_STA && WiFi.status() == WL_CONNECTED) {
    return WiFi.localIP().toString();
  }
  if (wifiKind == WIFI_KIND_AP) {
    return WiFi.softAPIP().toString();
  }
  return "-";
}

int findStaNet(const String &ssid) {
  for (uint8_t i = 0; i < staNetCount; i++) {
    if (staNets[i].ssid == ssid) {
      return i;
    }
  }
  return -1;
}

void applyStaNet(int idx) {
  if (idx < 0 || idx >= staNetCount) {
    staSsid = "";
    staPass = "";
    return;
  }
  staTryIdx = static_cast<uint8_t>(idx);
  staSsid = staNets[idx].ssid;
  staPass = staNets[idx].pass;
}

bool addOrUpdateStaNet(const String &ssid, const String &pass) {
  if (!ssid.length()) {
    return false;
  }
  const int found = findStaNet(ssid);
  if (found >= 0) {
    staNets[found].pass = pass;
    applyStaNet(found);
    return true;
  }
  if (staNetCount >= kMaxStaNets) {
    Serial.println("WIFI full (4). WIFI FORGET <ssid> first");
    return false;
  }
  staNets[staNetCount].ssid = ssid;
  staNets[staNetCount].pass = pass;
  applyStaNet(staNetCount);
  staNetCount++;
  return true;
}

void mergeDefaultSta(const char *ssid, const char *pass) {
  if (!ssid || !ssid[0] || !pass || !pass[0]) {
    return;
  }
  if (findStaNet(ssid) >= 0) {
    return;
  }
  addOrUpdateStaNet(ssid, pass);
}

void saveWifiPrefs(const char *mode) {
  prefs.begin("t2can", false);
  prefs.putString("mode", mode);
  prefs.putUChar("nssid", staNetCount);
  for (uint8_t i = 0; i < kMaxStaNets; i++) {
    const String sk = "ssid" + String(i);
    const String pk = "pass" + String(i);
    if (i < staNetCount) {
      prefs.putString(sk.c_str(), staNets[i].ssid);
      prefs.putString(pk.c_str(), staNets[i].pass);
    } else {
      prefs.remove(sk.c_str());
      prefs.remove(pk.c_str());
    }
  }
  if (staNetCount) {
    prefs.putString("ssid", staNets[0].ssid);
    prefs.putString("pass", staNets[0].pass);
  }
  prefs.putBool("ordered", true);
  prefs.end();
}

// idx 망을 목록 맨 앞(최우선)으로 옮긴다.
bool moveStaNetFirst(int idx) {
  if (idx <= 0 || idx >= staNetCount) {
    return idx == 0;
  }
  StaNet keep = staNets[idx];
  for (int i = idx; i > 0; i--) {
    staNets[i] = staNets[i - 1];
  }
  staNets[0] = keep;
  return true;
}

void printWifiList() {
  Serial.printf("saved STA %u / %u  (위가 우선, WIFI FIRST <ssid> 로 변경)\n",
                static_cast<unsigned>(staNetCount),
                static_cast<unsigned>(kMaxStaNets));
  if (!staNetCount) {
    Serial.println("  (none)  WIFI JOIN <ssid> <password>");
  }
  for (uint8_t i = 0; i < staNetCount; i++) {
    Serial.printf("  %u. %s  %s\n", static_cast<unsigned>(i + 1),
                  staNets[i].ssid.c_str(),
                  staNets[i].pass.length() ? "pass-set" : "no-pass");
  }
  if (strlen(WIFI_SSID_DEFAULT_2) && findStaNet(WIFI_SSID_DEFAULT_2) < 0) {
    Serial.printf("  add home: WIFI JOIN %s <password>\n", WIFI_SSID_DEFAULT_2);
  }
}

void loadWifiPrefs() {
  prefs.begin("t2can", true);
  const String mode = prefs.getString("mode", "");
  const uint8_t nssid = prefs.getUChar("nssid", 255);
  pushUrl = prefs.getString("pushUrl", "");
  pushKey = prefs.getString("pushKey", "");
  pushAuto = prefs.getBool("pushAuto", false);
  sentOff = prefs.getUInt("sentOff", 0);
  sentSlot = static_cast<uint8_t>(prefs.getUChar("sentSlot", 0));
  evtSentOff = prefs.getUInt("evtOff", 0);
  staNetCount = 0;
  if (nssid != 255) {
    const uint8_t n = nssid > kMaxStaNets ? kMaxStaNets : nssid;
    for (uint8_t i = 0; i < n; i++) {
      const String ssid = prefs.getString(("ssid" + String(i)).c_str(), "");
      const String pass = prefs.getString(("pass" + String(i)).c_str(), "");
      if (ssid.length()) {
        staNets[staNetCount].ssid = ssid;
        staNets[staNetCount].pass = pass;
        staNetCount++;
      }
    }
  } else {
    const String legacySsid = prefs.getString("ssid", "");
    const String legacyPass = prefs.getString("pass", "");
    if (legacySsid.length()) {
      staNets[0].ssid = legacySsid;
      staNets[0].pass = legacyPass;
      staNetCount = 1;
    }
  }
  prefs.end();

  const uint8_t afterLoad = staNetCount;
  mergeDefaultSta(WIFI_SSID_DEFAULT, WIFI_PASS_DEFAULT);
  mergeDefaultSta(WIFI_SSID_DEFAULT_2, WIFI_PASS_DEFAULT_2);
  // 순서를 한 번도 정하지 않았으면 차 공유기(WIFI_SSID_DEFAULT)를 맨 앞에.
  prefs.begin("t2can", true);
  const bool ordered = prefs.getBool("ordered", false);
  prefs.end();
  if (!ordered && strlen(WIFI_SSID_DEFAULT)) {
    const int d = findStaNet(WIFI_SSID_DEFAULT);
    if (d > 0) {
      moveStaNetFirst(d);
      staOrderDirty = true;
    }
  }
  applyStaNet(staNetCount ? 0 : -1);

  if (mode == "ap") {
    wantSta = false;
  } else if (mode == "sta" && staNetCount) {
    wantSta = true;
  } else if (staNetCount && staPass.length()) {
    wantSta = true;
  } else {
    wantSta = false;
  }
  wifiKind = WIFI_KIND_AP;
  if (nssid == 255 || staNetCount != afterLoad || staOrderDirty) {
    saveWifiPrefs(wantSta ? "sta" : "ap");
    staOrderDirty = false;
  }
}

void savePushPrefs() {
  prefs.begin("t2can", false);
  prefs.putString("pushUrl", pushUrl);
  prefs.putString("pushKey", pushKey);
  prefs.putBool("pushAuto", pushAuto);
  prefs.putUInt("sentOff", sentOff);
  prefs.putUChar("sentSlot", sentSlot);
  prefs.putUInt("evtOff", evtSentOff);
  prefs.end();
}

void bindHttp() {
  if (!httpBound) {
    http.on("/", handleRoot);
    http.on("/stat", handleStat);
    http.on("/log.csv", handleLog);
    http.on("/events.log", handleEvents);
    httpBound = true;
  }
  http.begin();
}

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
  evt("can log rotate -> %s", activePath());
}

bool appendLine(const char *line) {
  const size_t n = strlen(line);
  if (n + 1 > kBufBytes) {
    dropped = dropped + 1;
    return false;
  }
  if (lineUsed + n > kBufBytes) {
    flushLog();
    rotateIfNeeded();
    if (!logFile) {
      dropped = dropped + 1;
      return false;
    }
  }
  memcpy(lineBuf + lineUsed, line, n);
  lineUsed += n;
  return true;
}

void fillKst(char *out, size_t outLen) {
  out[0] = '-';
  out[1] = 0;
  if (!ntpOk) {
    return;
  }
  struct tm ti;
  if (!getLocalTime(&ti, 0)) {
    return;
  }
  snprintf(out, outLen, "%04d-%02d-%02d %02d:%02d:%02d", ti.tm_year + 1900,
           ti.tm_mon + 1, ti.tm_mday, ti.tm_hour, ti.tm_min, ti.tm_sec);
}

void maybeNtp() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  if (!ntpStarted) {
    configTzTime("KST-9", "kr.pool.ntp.org", "time.google.com", "pool.ntp.org");
    ntpStarted = true;
    Serial.println("NTP KST starting");
    return;
  }
  if (ntpOk) {
    return;
  }
  struct tm ti;
  if (getLocalTime(&ti, 0) && ti.tm_year + 1900 >= 2024) {
    ntpOk = true;
    evt("ntp ok %04d-%02d-%02d %02d:%02d:%02d KST", ti.tm_year + 1900,
        ti.tm_mon + 1, ti.tm_mday, ti.tm_hour, ti.tm_min, ti.tm_sec);
  }
}

void logFrame(char bus, uint32_t id, uint8_t len, const uint8_t *data) {
  char when[24];
  fillKst(when, sizeof(when));
  char line[256];
  int pos = snprintf(line, sizeof(line), "%s,%lu,%c,%03lX,%u,", when,
                     static_cast<unsigned long>(millis()), bus,
                     static_cast<unsigned long>(id), len);
  if (pos < 0 || pos >= static_cast<int>(sizeof(line))) {
    dropped = dropped + 1;
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
    dropped = dropped + 1;
    return;
  }

  if (!canQueue) {
    appendLine(line);
    if (echoSerial) {
      Serial.print(line);
    }
    return;
  }
  const size_t n = static_cast<size_t>(pos);
  // 부분 쓰기는 줄을 깨뜨리므로 자리가 있을 때만 넣는다.
  if (xMessageBufferSpacesAvailable(canQueue) < n + 4 ||
      xMessageBufferSend(canQueue, line, n, 0) != n) {
    dropped = dropped + 1;
  }
}

// loop() 쪽. 태스크가 쌓은 줄을 플래시 버퍼로 옮긴다.
void drainCanQueue() {
  if (!canQueue) {
    return;
  }
  char line[256];
  for (int k = 0; k < 512; k++) {
    const size_t n = xMessageBufferReceive(canQueue, line, sizeof(line) - 1, 0);
    if (!n) {
      break;
    }
    line[n] = 0;
    appendLine(line);
    if (echoSerial) {
      Serial.print(line);
    }
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
    const size_t n = logFile.print("time,ms,bus,id,dlc,data\n");
    logFile.flush();
    if (n == 0 || logFile.size() == 0) {
      Serial.println("!! log header write FAIL — flash not writable (FS / FORMAT)");
    }
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
  html += F("</p><p>wifi ");
  html += (wifiKind == WIFI_KIND_STA) ? F("STA ") : F("AP ");
  html += currentWifiIp();
  html += F("</p><p><a href='/log.csv'>log.csv 다운로드</a></p>");
  html += F("<p><a href='/events.log'>기기 동작 로그 (events.log)</a></p>");
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
  s += " wifi=";
  s += wifiOn ? ((wifiKind == WIFI_KIND_STA) ? "sta" : "ap") : "off";
  s += " ip=";
  s += currentWifiIp();
  s += " ssid=";
  s += (wifiKind == WIFI_KIND_STA) ? staSsid : kApSsid;
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

void handleEvents() {
  http.setContentLength(CONTENT_LENGTH_UNKNOWN);
  http.send(200, "text/plain; charset=utf-8", "");
  sendFileToHttp(kEvtOld);
  sendFileToHttp(kEvtPath);
}

void startWifiAp() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(kApSsid, kApPass);
  wifiKind = WIFI_KIND_AP;
  staAnnounced = false;
  bindHttp();
  Serial.printf("Wi-Fi AP %s  /  %s\n", kApSsid, kApPass);
  Serial.printf("download  http://%s/log.csv\n",
                WiFi.softAPIP().toString().c_str());
}

void selectStaTarget() {
  if (!staNetCount) {
    applyStaNet(-1);
    return;
  }
  // 우선순위 = 저장 목록 순서 (WIFI LIST 의 순서, WIFI FIRST 로 바꿈).
  // 보이는 망 중 가장 앞의 것을 고른다. 신호세기는 같은 망의 AP 여럿일 때만.
  const int n = WiFi.scanNetworks(false, false);
  int best = -1;
  int bestRssi = -200;
  if (n > 0) {
    for (int i = 0; i < n; i++) {
      const int idx = findStaNet(WiFi.SSID(i));
      if (idx < 0 || !staNets[idx].pass.length()) {
        continue;
      }
      if (best < 0 || idx < best || (idx == best && WiFi.RSSI(i) > bestRssi)) {
        best = idx;
        bestRssi = WiFi.RSSI(i);
      }
    }
  }
  WiFi.scanDelete();
  if (best >= 0) {
    applyStaNet(best);
    return;
  }
  for (uint8_t k = 0; k < staNetCount; k++) {
    staTryIdx = static_cast<uint8_t>((staTryIdx + 1) % staNetCount);
    if (staNets[staTryIdx].pass.length()) {
      applyStaNet(staTryIdx);
      return;
    }
  }
  applyStaNet(0);
}

void printStaSearchTargets() {
  Serial.print("STA search ");
  if (!staNetCount) {
    Serial.println("(none)");
    return;
  }
  for (uint8_t i = 0; i < staNetCount; i++) {
    if (i) {
      Serial.print(", ");
    }
    Serial.print(staNets[i].ssid);
  }
  Serial.println(" — connect to stop");
}

bool staLinked() { return WiFi.status() == WL_CONNECTED; }

void beginStaJoin() {
  if (!staSearching || !staNetCount) {
    return;
  }
  if (staLinked()) {
    staSearching = false;
    return;
  }
  const int st = WiFi.status();
  if (st == WL_IDLE_STATUS) {
    return;
  }
  selectStaTarget();
  if (!staSsid.length() || !staPass.length()) {
    Serial.println("STA saved SSID has no password. WIFI JOIN <ssid> <password>");
    return;
  }
  WiFi.disconnect(false);
  delay(50);
  WiFi.begin(staSsid.c_str(), staPass.c_str());
  evt("sta join %s", staSsid.c_str());
}

void announceSta() {
  if (staAnnounced) {
    return;
  }
  staAnnounced = true;
  staSearching = false;
  wifiKind = WIFI_KIND_STA;
  if (WiFi.SSID().length()) {
    staSsid = WiFi.SSID();
  }
  if (MDNS.begin("t2can")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("mDNS  http://t2can.local/log.csv");
  }
  evt("sta ok %s ip=%s rssi=%d gw=%s dns=%s", staSsid.c_str(),
      WiFi.localIP().toString().c_str(), WiFi.RSSI(),
      WiFi.gatewayIP().toString().c_str(), WiFi.dnsIP().toString().c_str());
  Serial.printf("download  http://%s/log.csv\n",
                WiFi.localIP().toString().c_str());
  Serial.println("STA search stopped");
  maybeNtp();
}

void startWifi() {
  http.stop();
  MDNS.end();
  WiFi.softAPdisconnect(true);
  WiFi.disconnect(true);
  WiFi.persistent(false);
  staAnnounced = false;
  staGotLinkMs = 0;
  staNoLinkMs = 0;
  staSearching = wantSta && staNetCount;
  if (staSearching) {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(kApSsid, kApPass);
    wifiKind = WIFI_KIND_AP;
    bindHttp();
    Serial.printf("Wi-Fi AP %s  /  %s\n", kApSsid, kApPass);
    Serial.printf("download  http://%s/log.csv\n",
                  WiFi.softAPIP().toString().c_str());
    printStaSearchTargets();
    beginStaJoin();
    lastWifiCheck = millis();
    return;
  }
  startWifiAp();
}

void stopWifi() {
  http.stop();
  MDNS.end();
  WiFi.softAPdisconnect(true);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  staSearching = false;
  staAnnounced = false;
  staGotLinkMs = 0;
  staNoLinkMs = 0;
  Serial.println("Wi-Fi OFF");
}

void wifiScan() {
  Serial.println("scanning 2.4GHz ...");
  const bool wasOn = wifiOn;
  if (wasOn) {
    http.stop();
    MDNS.end();
  }
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(100);
  const int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println("no 2.4GHz networks. If the car SSID is 5GHz-only, the board cannot join it.");
  } else {
    for (int i = 0; i < n; i++) {
      Serial.printf("  %s  %ddBm\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i));
    }
  }
  WiFi.scanDelete();
  if (wasOn) {
    startWifi();
  } else {
    WiFi.mode(WIFI_OFF);
  }
}

void wifiJoin(const String &ssid, const String &pass) {
  if (!ssid.length()) {
    Serial.println("WIFI JOIN <ssid> <password>");
    return;
  }
  if (!addOrUpdateStaNet(ssid, pass)) {
    return;
  }
  wantSta = true;
  wifiKind = WIFI_KIND_AP;
  wifiOn = true;
  saveWifiPrefs("sta");
  evt("wifi saved %s (%u nets)", ssid.c_str(),
      static_cast<unsigned>(staNetCount));
  printWifiList();
  startWifi();
}

void wifiForget(const String &ssid) {
  const int found = findStaNet(ssid);
  if (found < 0) {
    Serial.printf("WIFI FORGET: %s not saved\n", ssid.c_str());
    printWifiList();
    return;
  }
  for (uint8_t i = static_cast<uint8_t>(found); i + 1 < staNetCount; i++) {
    staNets[i] = staNets[i + 1];
  }
  staNetCount--;
  staNets[staNetCount].ssid = "";
  staNets[staNetCount].pass = "";
  applyStaNet(staNetCount ? 0 : -1);
  if (!staNetCount) {
    wantSta = false;
  }
  saveWifiPrefs(wantSta ? "sta" : "ap");
  evt("wifi forgot %s", ssid.c_str());
  printWifiList();
  if (wifiOn) {
    startWifi();
  }
}

void wifiFirst(const String &ssid) {
  const int found = findStaNet(ssid);
  if (found < 0) {
    Serial.printf("WIFI FIRST: %s not saved\n", ssid.c_str());
    printWifiList();
    return;
  }
  moveStaNetFirst(found);
  saveWifiPrefs(wantSta ? "sta" : "ap");
  evt("wifi first %s", ssid.c_str());
  printWifiList();
  if (wifiOn && wantSta && staSsid != staNets[0].ssid) {
    startWifi();
  }
}

// 최우선 망이 아닌 곳에 붙어 있으면 5분마다 비동기 스캔으로 최우선 망을 찾고,
// 보이면 갈아탄다. 예: 집 Wi-Fi 에 붙어 있다가 차 공유기가 켜질 때.
void tickPreferredNet(uint32_t now) {
  if (!wifiOn || !wantSta || staNetCount < 2 || wifiKind != WIFI_KIND_STA ||
      WiFi.status() != WL_CONNECTED) {
    prefScanPending = false;
    return;
  }
  if (staSsid == staNets[0].ssid || !staNets[0].pass.length()) {
    return;
  }
  if (prefScanPending) {
    const int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_RUNNING) {
      return;
    }
    prefScanPending = false;
    int rssi = -200;
    for (int i = 0; i < n; i++) {
      if (WiFi.SSID(i) == staNets[0].ssid && WiFi.RSSI(i) > rssi) {
        rssi = WiFi.RSSI(i);
      }
    }
    WiFi.scanDelete();
    if (rssi > -80) {
      evt("preferred %s visible rssi=%d — leaving %s", staNets[0].ssid.c_str(),
          rssi, staSsid.c_str());
      applyStaNet(0);
      staAnnounced = false;
      staSearching = true;
      staGotLinkMs = 0;
      staNoLinkMs = 0;
      wifiKind = WIFI_KIND_AP;
      MDNS.end();
      ntpStarted = false;
      ntpOk = false;
      lastWifiCheck = now;
      WiFi.disconnect(false);
      delay(50);
      WiFi.begin(staSsid.c_str(), staPass.c_str());
      evt("sta join %s", staSsid.c_str());
    }
    return;
  }
  if (now - lastPrefCheckMs >= kPrefCheckEveryMs) {
    lastPrefCheckMs = now;
    if (WiFi.scanNetworks(true, false) == WIFI_SCAN_RUNNING) {
      prefScanPending = true;
    }
  }
}

static String urlHost(const String &url) {
  int start = url.indexOf("://");
  start = (start < 0) ? 0 : start + 3;
  int end = url.indexOf('/', start);
  if (end < 0) {
    end = url.length();
  }
  return url.substring(start, end);
}

void printHttpCode(int code) {
  Serial.printf("http %d", code);
  if (code < 0) {
    Serial.printf(" (%s)", HTTPClient::errorToString(code).c_str());
  }
  Serial.println();
}

int httpsPostTo(const String &url, const String &body, String *respOut) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(20);
  HTTPClient http;
  http.setTimeout(20000);
  http.setReuse(false);
  if (!http.begin(client, url)) {
    evt("push begin fail (bad url?)");
    return -1;
  }
  http.addHeader("X-API-Key", pushKey);
  http.addHeader("Content-Type", "text/csv; charset=utf-8");
  const int code = http.POST(body);
  printHttpCode(code);
  if (respOut) {
    *respOut = (code > 0) ? http.getString() : String();
  }
  http.end();
  pushLastCode = code;
  if (code >= 200 && code < 300) {
    pushOkCount++;
  } else {
    pushFailCount++;
    if (code < 0) {
      evt("push FAIL %s rssi=%d body=%uB", HTTPClient::errorToString(code).c_str(),
          WiFi.RSSI(), static_cast<unsigned>(body.length()));
    } else {
      evt("push FAIL http %d body=%uB", code,
          static_cast<unsigned>(body.length()));
    }
  }
  return code;
}

int httpsPost(const String &body) { return httpsPostTo(pushUrl, body, nullptr); }

bool uploadRange(const char *path, uint32_t offset, size_t nbytes) {
  File f = FFat.open(path, FILE_READ);
  if (!f) {
    return false;
  }
  if (offset > f.size()) {
    f.close();
    return false;
  }
  if (!f.seek(offset)) {
    f.close();
    return false;
  }
  String chunk;
  chunk.reserve(nbytes + 8);
  while (chunk.length() < nbytes && f.available()) {
    chunk += static_cast<char>(f.read());
  }
  f.close();
  Serial.printf("PUSH %s +%u %uB ...\n", path,
                static_cast<unsigned>(offset),
                static_cast<unsigned>(chunk.length()));
  const int code = httpsPost(chunk);
  return code >= 200 && code < 300;
}

void pushTest() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("PUSH TEST needs STA Wi-Fi");
    return;
  }
  if (!pushUrl.length() || !pushKey.length()) {
    Serial.println("PUSH URL and PUSH KEY first");
    return;
  }
  Serial.printf("ip=%s gw=%s dns=%s\n", WiFi.localIP().toString().c_str(),
                WiFi.gatewayIP().toString().c_str(),
                WiFi.dnsIP().toString().c_str());
  const String host = urlHost(pushUrl);
  IPAddress resolved;
  if (WiFi.hostByName(host.c_str(), resolved) != 1) {
    Serial.printf("DNS fail for %s — car Wi-Fi may have no internet\n",
                  host.c_str());
    return;
  }
  Serial.printf("DNS %s -> %s\n", host.c_str(), resolved.toString().c_str());
  Serial.println("PUSH TEST small POST ...");
  const int code =
      httpsPost("time,ms,bus,id,dlc,data\n-,0,A,000,1,00\n");
  Serial.println((code >= 200 && code < 300) ? "PUSH TEST ok"
                                             : "PUSH TEST fail");
}

static String eventsPushUrl() {
  String url = pushUrl;
  url += (url.indexOf('?') >= 0) ? "&kind=events" : "?kind=events";
  return url;
}

// 빈 본문 POST. 새 서버는 200 + {"kind":"events"}, 구버전은 400 (기록 안 함).
bool verifyEventsPush() {
  if (eventsPushVerified) {
    return true;
  }
  if (eventsPushRetryMs && millis() - eventsPushRetryMs < kEventsPushRetryEveryMs) {
    return false;
  }
  Serial.println("PUSH events: NAS 지원 확인 중 ...");
  String resp;
  const int code = httpsPostTo(eventsPushUrl(), "\n", &resp);
  if (code >= 200 && code < 300 && resp.indexOf("\"kind\":\"events\"") >= 0) {
    eventsPushVerified = true;
    evt("nas accepts kind=events — device log upload on");
    return true;
  }
  eventsPushRetryMs = millis();
  evt("nas ignores kind=events (http %d) — NAS 컨테이너를 새 코드로 재배포하세요. "
      "기기 로그 업로드는 6시간 뒤 재시도", code);
  return false;
}

// 기기 동작 로그도 NAS 로 올린다 (?kind=events). 한 번에 한 조각.
bool pushEvents() {
  File f = FFat.open(kEvtPath, FILE_READ);
  if (!f) {
    Serial.printf("PUSH events: %s 없음 (write_fail=%lu)\n", kEvtPath,
                  static_cast<unsigned long>(evtWriteFail));
    return true;
  }
  const uint32_t sz = f.size();
  f.close();
  if (evtSentOff > sz) {
    evtSentOff = 0;
  }
  if (evtSentOff >= sz) {
    Serial.printf("PUSH events caught up @%u\n", static_cast<unsigned>(sz));
    return true;
  }
  if (!verifyEventsPush()) {
    return false;
  }
  const size_t n = (sz - evtSentOff) > kPushChunk ? kPushChunk : (sz - evtSentOff);
  File src = FFat.open(kEvtPath, FILE_READ);
  if (!src || !src.seek(evtSentOff)) {
    Serial.println("PUSH events: open/seek fail");
    return false;
  }
  String chunk;
  chunk.reserve(n + 8);
  while (chunk.length() < n && src.available()) {
    chunk += static_cast<char>(src.read());
  }
  src.close();
  Serial.printf("PUSH events +%u %uB ...\n", static_cast<unsigned>(evtSentOff),
                static_cast<unsigned>(chunk.length()));
  const int code = httpsPostTo(eventsPushUrl(), chunk, nullptr);
  if (code < 200 || code >= 300) {
    return false;
  }
  evtSentOff += chunk.length();
  savePushPrefs();
  return true;
}

bool pushMore() {
  flushLog();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("PUSH needs STA Wi-Fi");
    return false;
  }
  if (!pushUrl.length() || !pushKey.length()) {
    evt("push skipped: PUSH URL / PUSH KEY not set");
    return false;
  }

  pushEvents();
  int chunks = 0;
  while (chunks < kPushChunks) {
    if (sentSlot != logSlot) {
      const char *oldPath = sentSlot ? kLog1 : kLog0;
      File oldf = FFat.open(oldPath, FILE_READ);
      if (!oldf) {
        sentSlot = logSlot;
        sentOff = 0;
        savePushPrefs();
        continue;
      }
      const uint32_t sz = oldf.size();
      oldf.close();
      if (sentOff >= sz) {
        sentSlot = logSlot;
        sentOff = 0;
        savePushPrefs();
        continue;
      }
      const size_t n = (sz - sentOff) > kPushChunk ? kPushChunk : (sz - sentOff);
      if (!uploadRange(oldPath, sentOff, n)) {
        return false;
      }
      sentOff += n;
      savePushPrefs();
      chunks++;
      continue;
    }

    if (!logFile) {
      break;
    }
    const uint32_t sz = logFile.size();
    if (sentOff > sz) {
      sentOff = 0;
    }
    if (sentOff >= sz) {
      break;
    }
    const size_t n = (sz - sentOff) > kPushChunk ? kPushChunk : (sz - sentOff);
    if (!uploadRange(activePath(), sentOff, n)) {
      return false;
    }
    sentOff += n;
    savePushPrefs();
    chunks++;
  }
  if (chunks) {
    evt("push ok %d chunk(s) -> %s @%u", chunks, activePath(),
        static_cast<unsigned>(sentOff));
  } else {
    Serial.printf("PUSH caught up to %s @%u\n", activePath(),
                  static_cast<unsigned>(sentOff));
  }
  return true;
}

void pushLogs() { pushMore(); }

void printHelp() {
  Serial.println("HELP  STAT  DUMP  CLEAR  ECHO ON|OFF");
  Serial.println("WIFI ON|OFF  WIFI AP  WIFI JOIN <ssid> <pass>  WIFI LIST");
  Serial.println("WIFI FORGET <ssid>  WIFI FIRST <ssid> (최우선)  WIFI SCAN");
  Serial.println("PUSH URL <https://.../api/canlog>  PUSH KEY <api-key>");
  Serial.println("PUSH NOW  PUSH AUTO ON|OFF  PUSH TEST");
  Serial.println("LOG (기기 동작 로그 최근)  LOG ALL  LOG CLEAR  CANA (A 진단)");
  Serial.println("FS (플래시 파일·쓰기 테스트)  FORMAT (플래시 초기화)");
}

void printCanADiag() {
  char buf[320];
  describeCanA(buf, sizeof(buf), rateA);
  Serial.println(buf);
}

void printStat() {
  Serial.printf("A=%s framesA=%lu  B=%s framesB=%lu  drop=%lu  %s bytes=%u\n",
                canAOk ? "ok" : "fail", static_cast<unsigned long>(framesA),
                canBOk ? "ok" : "fail", static_cast<unsigned long>(framesB),
                static_cast<unsigned long>(dropped), activePath(),
                static_cast<unsigned>(logFile ? logFile.size() + lineUsed : 0));
  Serial.printf("rateA=%lu/5s %s  rateB=%lu/5s %s\n",
                static_cast<unsigned long>(rateA),
                rateA ? "통신중" : "응답없음",
                static_cast<unsigned long>(rateB),
                rateB ? "통신중" : "응답없음");
  Serial.printf("rx task=%s  queue=%uKB  B missed=%lu overrun=%lu recovered=%lu\n",
                canTaskHandle ? "on" : "off",
                static_cast<unsigned>(canQueueBytes / 1024),
                static_cast<unsigned long>(twaiMissed),
                static_cast<unsigned long>(twaiOverrun),
                static_cast<unsigned long>(twaiRecovered));
  Serial.printf("wifi=%s  ip=%s  ssid=%s  saved=%u  search=%s\n",
                wifiOn ? ((wifiKind == WIFI_KIND_STA) ? "sta" : "ap") : "off",
                currentWifiIp().c_str(),
                wifiOn ? ((wifiKind == WIFI_KIND_STA) ? staSsid.c_str()
                                                     : kApSsid)
                       : "-",
                static_cast<unsigned>(staNetCount),
                staSearching ? "on" : "off");
  if (staNetCount) {
    Serial.print("nets=");
    for (uint8_t i = 0; i < staNetCount; i++) {
      if (i) {
        Serial.print(",");
      }
      Serial.print(staNets[i].ssid);
    }
    Serial.println();
  }
  Serial.printf("push=%s  auto=%s  ok=%lu fail=%lu last=%d  url=%s\n",
                (pushUrl.length() && pushKey.length()) ? "set" : "off",
                pushAuto ? "on" : "off",
                static_cast<unsigned long>(pushOkCount),
                static_cast<unsigned long>(pushFailCount), pushLastCode,
                pushUrl.length() ? pushUrl.c_str() : "-");
  char when[24];
  fillKst(when, sizeof(when));
  Serial.printf("time=%s  ntp=%s  reset=%s  heap=%u\n", when,
                ntpOk ? "ok" : "wait", resetReasonText(esp_reset_reason()),
                static_cast<unsigned>(ESP.getFreeHeap()));
  {
    File ef = FFat.open(kEvtPath, FILE_READ);
    const unsigned esz = ef ? static_cast<unsigned>(ef.size()) : 0;
    if (ef) {
      ef.close();
    }
    Serial.printf("ffat free=%u/%u%s  events=%uB sent=%u write_fail=%lu nas_events=%s\n",
                  static_cast<unsigned>(FFat.freeBytes()),
                  static_cast<unsigned>(FFat.totalBytes()),
                  ffatFormatted ? " (formatted this boot)" : "", esz,
                  static_cast<unsigned>(evtSentOff),
                  static_cast<unsigned long>(evtWriteFail),
                  eventsPushVerified ? "ok"
                                     : (eventsPushRetryMs ? "unsupported"
                                                          : "unchecked"));
  }
  if (canAOk) {
    printCanADiag();
  } else {
    Serial.println("A: init FAIL — CANA 로 진단");
  }
}

// 1분마다 기기 상태 한 줄. 차에서 무슨 일이 있었는지 나중에 LOG 로 본다.
void heartbeat() {
  const uint32_t a = framesA;
  const uint32_t b = framesB;
  const uint32_t dA = a - hbMarkA;
  const uint32_t dB = b - hbMarkB;
  hbMarkA = a;
  hbMarkB = b;
  const bool sta = wifiKind == WIFI_KIND_STA && WiFi.status() == WL_CONNECTED;
  evt("hb A+%lu B+%lu drop=%lu Bmiss=%lu log=%s:%u wifi=%s ssid=%s rssi=%d "
      "push=%s ok=%lu fail=%lu last=%d heap=%u",
      static_cast<unsigned long>(dA), static_cast<unsigned long>(dB),
      static_cast<unsigned long>(dropped), static_cast<unsigned long>(twaiMissed),
      activePath(),
      static_cast<unsigned>(logFile ? logFile.size() + lineUsed : 0),
      wifiOn ? (sta ? "sta" : (staSearching ? "search" : "ap")) : "off",
      sta ? staSsid.c_str() : "-", sta ? WiFi.RSSI() : 0,
      pushAuto ? "auto" : "off", static_cast<unsigned long>(pushOkCount),
      static_cast<unsigned long>(pushFailCount), pushLastCode,
      static_cast<unsigned>(ESP.getFreeHeap()));
  char buf[320];
  describeCanA(buf, sizeof(buf), dA);
  evt("%s", buf);
}

void streamEventsToSerial(bool all) {
  File f = FFat.open(kEvtPath, FILE_READ);
  if (!f) {
    Serial.println("(기기 동작 로그 없음)");
    return;
  }
  if (!all && f.size() > 6000) {
    f.seek(f.size() - 6000);
    // 잘린 첫 줄은 버림
    while (f.available() && f.read() != '\n') {
    }
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

void dumpEvents(bool all) {
  Serial.println("---EVT-BEGIN---");
  if (all) {
    File old = FFat.open(kEvtOld, FILE_READ);
    if (old) {
      uint8_t buf[256];
      while (old.available()) {
        const int n = old.read(buf, sizeof(buf));
        if (n > 0) {
          Serial.write(buf, n);
        }
      }
      old.close();
    }
  }
  streamEventsToSerial(all);
  Serial.println("---EVT-END---");
}

void clearEvents() {
  FFat.remove(kEvtOld);
  FFat.remove(kEvtPath);
  evtSentOff = 0;
  savePushPrefs();
  evt("event log cleared");
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
  framesA = 0;
  framesB = 0;
  dropped = 0;
  openLog();
  evt("can logs cleared");
}

static String skipWord(const String &s) {
  int i = 0;
  while (i < s.length() && s[i] == ' ') {
    i++;
  }
  while (i < s.length() && s[i] != ' ') {
    i++;
  }
  while (i < s.length() && s[i] == ' ') {
    i++;
  }
  return s.substring(i);
}

void handleSerial() {
  if (!Serial.available()) {
    return;
  }
  String raw = Serial.readStringUntil('\n');
  raw.trim();
  if (!raw.length()) {
    return;
  }
  String cmd = raw;
  cmd.toUpperCase();
  if (cmd == "HELP" || cmd == "?") {
    printHelp();
  } else if (cmd == "STAT") {
    printStat();
  } else if (cmd == "DUMP") {
    dumpFiles();
  } else if (cmd == "CLEAR") {
    clearLogs();
  } else if (cmd == "LOG") {
    dumpEvents(false);
  } else if (cmd == "LOG ALL") {
    dumpEvents(true);
  } else if (cmd == "LOG CLEAR") {
    clearEvents();
  } else if (cmd == "CANA") {
    printCanADiag();
  } else if (cmd == "FS") {
    flushLog();
    listFs();
    Serial.printf("write test: %s\n", ffatWriteTest() ? "ok" : "FAIL");
  } else if (cmd == "FORMAT") {
    formatFfat("serial FORMAT");
  } else if (cmd == "ECHO ON") {
    echoSerial = true;
    Serial.println("echo ON");
  } else if (cmd == "ECHO OFF") {
    echoSerial = false;
    Serial.println("echo OFF");
  } else if (cmd == "WIFI ON") {
    wifiOn = true;
    startWifi();
  } else if (cmd == "WIFI OFF") {
    wifiOn = false;
    stopWifi();
  } else if (cmd == "WIFI AP") {
    wifiOn = true;
    wantSta = false;
    wifiKind = WIFI_KIND_AP;
    saveWifiPrefs("ap");
    startWifi();
  } else if (cmd == "WIFI SCAN") {
    wifiScan();
  } else if (cmd == "WIFI LIST") {
    printWifiList();
  } else if (cmd.startsWith("WIFI FIRST ")) {
    String rest = skipWord(skipWord(raw));
    rest.trim();
    if (!rest.length()) {
      Serial.println("WIFI FIRST <ssid>");
    } else {
      wifiFirst(rest);
    }
  } else if (cmd.startsWith("WIFI FORGET ")) {
    String rest = skipWord(skipWord(raw));
    rest.trim();
    if (!rest.length()) {
      Serial.println("WIFI FORGET <ssid>");
    } else {
      wifiForget(rest);
    }
  } else if (cmd.startsWith("WIFI JOIN ")) {
    String rest = skipWord(skipWord(raw));
    const int sp = rest.indexOf(' ');
    if (sp < 0) {
      Serial.println("WIFI JOIN <ssid> <password>");
    } else {
      wifiJoin(rest.substring(0, sp), rest.substring(sp + 1));
    }
  } else if (cmd.startsWith("PUSH URL ")) {
    pushUrl = skipWord(skipWord(raw));
    pushUrl.trim();
    savePushPrefs();
    Serial.printf("push url %s\n", pushUrl.c_str());
  } else if (cmd.startsWith("PUSH KEY ")) {
    pushKey = skipWord(skipWord(raw));
    pushKey.trim();
    savePushPrefs();
    Serial.println("push key saved");
  } else if (cmd == "PUSH NOW") {
    pushLogs();
  } else if (cmd == "PUSH TEST") {
    pushTest();
  } else if (cmd == "PUSH AUTO ON") {
    pushAuto = true;
    savePushPrefs();
    Serial.println("push auto ON (1 min, incremental)");
  } else if (cmd == "PUSH AUTO OFF") {
    pushAuto = false;
    savePushPrefs();
    Serial.println("push auto OFF");
  } else {
    printHelp();
  }
}

bool startCanA() {
  // 크래시 직후엔 MCP2518FD 가 SPI 명령 중간에 멈춰 있을 수 있어 한 번 더 시도.
  bool ok = canA.begin(CANFD::BITRATE(500000, 1));
  if (!ok) {
    delay(100);
    ok = canA.begin(CANFD::BITRATE(500000, 1));
  }
  if (!ok) {
    evt("CAN A init FAIL (MCP2518FD not in listen-only / no SPI reply)");
    printCanADiag();
    return false;
  }
  evt("CAN A MCP2518FD listen-only 500k OK (X437 9/10)");
  return true;
}

bool startCanB() {
  if (!canB.begin(CAN0_BITRATE)) {
    evt("CAN B init FAIL (TWAI)");
    return false;
  }
  evt("CAN B TWAI listen-only 500k OK (X437 13/14)");
  return true;
}

bool pollOne(CanChannel &ch, bool ok, char bus, volatile uint32_t &total) {
  if (!ok) {
    return false;
  }
  CanFrame f;
  bool got = false;
  for (uint8_t safety = 0; safety < 64 && ch.receive(f); safety++) {
    got = true;
    if (f.rtr) {
      continue;
    }
    logFrame(bus, f.id, f.len, f.data);
    total = total + 1;
  }
  return got;
}

// 한 번에 최대 64+64 프레임을 처리한 뒤 반드시 한 틱(1ms) 쉰다. 버스가 바쁠 때
// (초당 3000 프레임) 이 태스크가 쉬지 않으면 같은 코어의 loop() 가 굶어
// 플래시 쓰기·Wi-Fi 가 멈추고 큐가 넘친다. 1ms 에 3~4 프레임이라 여유는 충분.
void canTask(void *) {
  for (;;) {
    pollOne(canB, canBOk, 'B', framesB);
    pollOne(canA, canAOk, 'A', framesA);
    vTaskDelay(1);
  }
}

void startCanTask() {
  size_t want = 512UL * 1024UL;
  uint8_t *store = nullptr;
  if (psramFound()) {
    store = static_cast<uint8_t *>(ps_malloc(want));
  }
  if (!store) {
    want = 64UL * 1024UL;
    store = static_cast<uint8_t *>(malloc(want));
  }
  if (store) {
    static StaticMessageBuffer_t ctl;
    canQueue = xMessageBufferCreateStatic(want, store, &ctl);
    canQueueBytes = want;
  }
  if (!canQueue) {
    Serial.println("CAN queue alloc FAIL — polling in loop()");
    return;
  }
  xTaskCreatePinnedToCore(canTask, "can-rx", 8192, nullptr, 3, &canTaskHandle,
                          1);
  Serial.printf("CAN rx task on core 1, queue %u KB\n",
                static_cast<unsigned>(canQueueBytes / 1024));
}

void tickCanRate(uint32_t now) {
  if (now - lastRateMs < 5000) {
    return;
  }
  lastRateMs = now;
  const uint32_t a = framesA;
  const uint32_t b = framesB;
  rateA = a - rateMarkA;
  rateB = b - rateMarkB;
  rateMarkA = a;
  rateMarkB = b;
  if (canBOk) {
    uint32_t q = 0;
    canB.stats(twaiMissed, twaiOverrun, q);
    if (canB.recover()) {
      twaiRecovered++;
      evt("CAN B bus-off -> recovered (%lu)",
          static_cast<unsigned long>(twaiRecovered));
    }
  }
}

// 실제로 파일을 만들고 써 본다. 마운트는 됐는데 쓰기가 전부 실패하는
// (깨진/꽉 찬) 파일시스템을 잡기 위함.
bool ffatWriteTest() {
  const char *p = "/selftest.tmp";
  FFat.remove(p);
  File t = FFat.open(p, FILE_WRITE);
  if (!t) {
    return false;
  }
  const size_t n = t.print("ok\n");
  t.close();
  File r = FFat.open(p, FILE_READ);
  const size_t sz = r ? r.size() : 0;
  if (r) {
    r.close();
  }
  FFat.remove(p);
  return n == 3 && sz == 3;
}

void listFs() {
  Serial.printf("FFat free=%u total=%u\n", static_cast<unsigned>(FFat.freeBytes()),
                static_cast<unsigned>(FFat.totalBytes()));
  File root = FFat.open("/");
  if (!root) {
    Serial.println("  (root open fail)");
    return;
  }
  File f = root.openNextFile();
  while (f) {
    Serial.printf("  %s  %u\n", f.name(), static_cast<unsigned>(f.size()));
    f = root.openNextFile();
  }
  root.close();
}

void formatFfat(const char *why) {
  Serial.printf("FFat FORMAT: %s (모든 로그 삭제)\n", why);
  flushLog();
  if (logFile) {
    logFile.close();
  }
  FFat.end();
  FFat.format();
  FFat.begin(false);
  logSlot = 0;
  sentOff = 0;
  sentSlot = 0;
  evtSentOff = 0;
  savePushPrefs();
  ffatFormatted = true;
  openLog();
  evt("ffat formatted: %s", why);
}

void mountFfat() {
  if (!FFat.begin(false)) {
    Serial.println("FFat mount fail, formatting...");
    if (!FFat.begin(true)) {
      Serial.println("FFat format FAIL — USB serial ECHO only");
      return;
    }
    ffatFormatted = true;
  }
  listFs();
  if (ffatWriteTest()) {
    return;
  }
  Serial.println("FFat write test FAIL — remount");
  FFat.end();
  if (FFat.begin(false) && ffatWriteTest()) {
    Serial.println("FFat ok after remount");
    return;
  }
  // 쓰기가 안 되는 파일시스템은 아무것도 남기지 못하므로 새로 만든다.
  Serial.println("FFat still broken — FORMAT");
  FFat.end();
  FFat.format();
  FFat.begin(false);
  ffatFormatted = true;
  Serial.printf("FFat after format: write=%s free=%u\n",
                ffatWriteTest() ? "ok" : "FAIL",
                static_cast<unsigned>(FFat.freeBytes()));
}

void setup() {
  // 부팅 직후 여러 줄이 한꺼번에 나가므로 USB CDC 버퍼를 키우고, 꽉 차면
  // 잠깐 기다린다 (0 이면 그 줄들이 그냥 버려져 부팅 메시지가 사라진다).
  Serial.setTxBufferSize(8192);
  Serial.begin(115200);
  Serial.setTxTimeoutMs(20);
  delay(1500);
  Serial.println();
  Serial.println("T-2CAN FD logger  listen-only");
  Serial.println("CAN A = MCP2518FD (9/10)  CAN B = TWAI (13/14)");
  Serial.println("CAN stack from chlsw88/T-CAN2  — no TX");
  printHelp();

  mountFfat();
  if (FFat.totalBytes()) {
    openLog();
  }
  loadWifiPrefs();
  evt("boot reset=%s fw=%s %s ffat_free=%u/%u%s psram=%u",
      resetReasonText(esp_reset_reason()), __DATE__, __TIME__,
      static_cast<unsigned>(FFat.freeBytes()),
      static_cast<unsigned>(FFat.totalBytes()),
      ffatFormatted ? " (FORMATTED this boot)" : "",
      static_cast<unsigned>(ESP.getPsramSize()));
  if (evtWriteFail) {
    Serial.printf("!! events.log write still failing (%lu)\n",
                  static_cast<unsigned long>(evtWriteFail));
  }
  reportCoreDump();

  canAOk = startCanA();
  canBOk = startCanB();
  startCanTask();
  printWifiList();
  if (wifiOn) {
    startWifi();
  }
}

void loop() {
  if (canTaskHandle) {
    drainCanQueue();
  } else {
    pollOne(canB, canBOk, 'B', framesB);
    pollOne(canA, canAOk, 'A', framesA);
  }
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
  tickCanRate(now);
  // 첫 상태 줄은 20초에 — 차에서 1분을 못 버티고 죽을 때도 A/B 수신량과
  // A 판정을 남기기 위함. 그 뒤는 1분마다.
  if (now - lastHbMs >= (hbCount == 0 ? 20000UL : kHbEveryMs)) {
    lastHbMs = now;
    hbCount++;
    heartbeat();
  }
  if (wifiOn && wantSta && staNetCount) {
    if (staLinked()) {
      staNoLinkMs = 0;
      if (!staGotLinkMs) {
        staGotLinkMs = now;
      }
      if (staSearching) {
        staSearching = false;
      }
      announceSta();
      maybeNtp();
    } else if (staGotLinkMs && now - staGotLinkMs < kStaHoldMs) {
      // DHCP/mDNS 직후 status 가 잠깐 흔들려도 검색하지 않음
    } else {
      if (!staNoLinkMs) {
        staNoLinkMs = now;
      }
      if (now - staNoLinkMs < kStaLostConfirmMs) {
        // 몇 초 더 끊긴 뒤에만 재검색
      } else {
        if (staAnnounced) {
          staAnnounced = false;
          staSearching = true;
          staGotLinkMs = 0;
          wifiKind = WIFI_KIND_AP;
          MDNS.end();
          lastWifiCheck = now;
          ntpStarted = false;
          ntpOk = false;
          evt("sta lost %s (status=%d) — AP stays up, searching", staSsid.c_str(),
              static_cast<int>(WiFi.status()));
          printStaSearchTargets();
        } else if (!staSearching) {
          staSearching = true;
        }
        if (staSearching &&
            (lastWifiCheck == 0 || now - lastWifiCheck >= kStaSearchEveryMs)) {
          lastWifiCheck = now;
          beginStaJoin();
        }
      }
    }
  }
  tickPreferredNet(now);
  if (pushAuto && wifiKind == WIFI_KIND_STA &&
      WiFi.status() == WL_CONNECTED && now - lastPushMs >= kPushEveryMs) {
    lastPushMs = now;
    pushLogs();
  }
}
