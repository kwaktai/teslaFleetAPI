/*
 * T-2CAN FD listen-only logger
 *
 * Vehicle CAN (A) + Chassis CAN (B) 을 듣기만 하고
 * 보드 플래시(FFat)에 CSV 로 저장합니다. 송신하지 않습니다.
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
#include "driver/twai.h"
#include "mcp2518fd_can.h"

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
Preferences prefs;

enum WifiKind { WIFI_KIND_AP, WIFI_KIND_STA };

File logFile;
uint8_t logSlot = 0;
char lineBuf[kBufBytes];
size_t lineUsed = 0;

uint32_t framesA = 0;
uint32_t framesB = 0;
uint32_t dropped = 0;
uint32_t lastStatMs = 0;
uint32_t lastWifiCheck = 0;
uint32_t lastPushMs = 0;
uint32_t sentOff = 0;
uint8_t sentSlot = 0;
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
String staSsid;
String staPass;
String pushUrl;
String pushKey;

static const uint32_t kStaSearchEveryMs = 10UL * 1000UL;
static const uint32_t kPushEveryMs = 60UL * 1000UL;
static const size_t kPushChunk = 48UL * 1024UL;
static const int kPushChunks = 4;

void handleRoot();
void handleStat();
void handleLog();

static const char *activePath() { return logSlot ? kLog1 : kLog0; }

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
  prefs.end();
}

void printWifiList() {
  Serial.printf("saved STA %u / %u\n",
                static_cast<unsigned>(staNetCount),
                static_cast<unsigned>(kMaxStaNets));
  if (!staNetCount) {
    Serial.println("  (none)  WIFI JOIN <ssid> <password>");
  }
  for (uint8_t i = 0; i < staNetCount; i++) {
    Serial.printf("  %s  %s\n", staNets[i].ssid.c_str(),
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
  if (nssid == 255 || staNetCount != afterLoad) {
    saveWifiPrefs(wantSta ? "sta" : "ap");
  }
}

void savePushPrefs() {
  prefs.begin("t2can", false);
  prefs.putString("pushUrl", pushUrl);
  prefs.putString("pushKey", pushKey);
  prefs.putBool("pushAuto", pushAuto);
  prefs.putUInt("sentOff", sentOff);
  prefs.putUChar("sentSlot", sentSlot);
  prefs.end();
}

void bindHttp() {
  if (!httpBound) {
    http.on("/", handleRoot);
    http.on("/stat", handleStat);
    http.on("/log.csv", handleLog);
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
    Serial.printf("NTP KST %04d-%02d-%02d %02d:%02d:%02d\n", ti.tm_year + 1900,
                  ti.tm_mon + 1, ti.tm_mday, ti.tm_hour, ti.tm_min, ti.tm_sec);
  }
}

void logFrame(char bus, uint32_t id, uint8_t len, const uint8_t *data) {
  char when[24];
  fillKst(when, sizeof(when));
  char line[128];
  int pos = snprintf(line, sizeof(line), "%s,%lu,%c,%03lX,%u,", when,
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
    logFile.print("time,ms,bus,id,dlc,data\n");
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
  html += F("</p><p>wifi ");
  html += (wifiKind == WIFI_KIND_STA) ? F("STA ") : F("AP ");
  html += currentWifiIp();
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
  const int n = WiFi.scanNetworks(false, false);
  int best = -1;
  int bestRssi = -200;
  if (n > 0) {
    for (int i = 0; i < n; i++) {
      const int idx = findStaNet(WiFi.SSID(i));
      if (idx >= 0 && staNets[idx].pass.length() &&
          WiFi.RSSI(i) > bestRssi) {
        bestRssi = WiFi.RSSI(i);
        best = idx;
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

void beginStaJoin() {
  if (!staSearching || !staNetCount) {
    return;
  }
  if (WiFi.status() == WL_CONNECTED) {
    staSearching = false;
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
  Serial.printf("STA joining %s\n", staSsid.c_str());
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
  Serial.printf("STA OK  %s  http://%s/log.csv\n", staSsid.c_str(),
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
  Serial.printf("WIFI saved %s  (%u nets)\n", ssid.c_str(),
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
  Serial.printf("WIFI forgot %s\n", ssid.c_str());
  printWifiList();
  if (wifiOn) {
    startWifi();
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

int httpsPost(const String &body) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(20);
  HTTPClient http;
  http.setTimeout(20000);
  http.setReuse(false);
  if (!http.begin(client, pushUrl)) {
    Serial.println("PUSH begin fail");
    return -1;
  }
  http.addHeader("X-API-Key", pushKey);
  http.addHeader("Content-Type", "text/csv; charset=utf-8");
  const int code = http.POST(body);
  printHttpCode(code);
  http.end();
  return code;
}

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

bool pushMore() {
  flushLog();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("PUSH needs STA Wi-Fi");
    return false;
  }
  if (!pushUrl.length() || !pushKey.length()) {
    Serial.println("PUSH URL and PUSH KEY first");
    return false;
  }

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
  Serial.printf("PUSH caught up to %s @%u\n", activePath(),
                static_cast<unsigned>(sentOff));
  return true;
}

void pushLogs() { pushMore(); }

void printHelp() {
  Serial.println("HELP  STAT  DUMP  CLEAR  ECHO ON|OFF");
  Serial.println("WIFI ON|OFF  WIFI AP  WIFI JOIN <ssid> <pass>  WIFI LIST");
  Serial.println("WIFI FORGET <ssid>  WIFI SCAN");
  Serial.println("PUSH URL <https://.../api/canlog>  PUSH KEY <api-key>");
  Serial.println("PUSH NOW  PUSH AUTO ON|OFF  PUSH TEST");
}

void printStat() {
  Serial.printf("A=%s framesA=%lu  B=%s framesB=%lu  drop=%lu  %s bytes=%u\n",
                canAOk ? "ok" : "fail", static_cast<unsigned long>(framesA),
                canBOk ? "ok" : "fail", static_cast<unsigned long>(framesB),
                static_cast<unsigned long>(dropped), activePath(),
                static_cast<unsigned>(logFile ? logFile.size() + lineUsed : 0));
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
  Serial.printf("push=%s  auto=%s  url=%s\n",
                (pushUrl.length() && pushKey.length()) ? "set" : "off",
                pushAuto ? "on" : "off",
                pushUrl.length() ? pushUrl.c_str() : "-");
  char when[24];
  fillKst(when, sizeof(when));
  Serial.printf("time=%s  ntp=%s\n", when, ntpOk ? "ok" : "wait");
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
  loadWifiPrefs();
  printWifiList();
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
  if (wifiOn && wantSta && staNetCount) {
    if (WiFi.status() == WL_CONNECTED) {
      if (staSearching) {
        staSearching = false;
      }
      announceSta();
      maybeNtp();
    } else {
      if (staAnnounced) {
        staAnnounced = false;
        staSearching = true;
        wifiKind = WIFI_KIND_AP;
        MDNS.end();
        lastWifiCheck = 0;
        ntpStarted = false;
        ntpOk = false;
        Serial.println("STA lost — AP stays up, searching all saved Wi-Fi");
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
  if (pushAuto && wifiKind == WIFI_KIND_STA &&
      WiFi.status() == WL_CONNECTED && now - lastPushMs >= kPushEveryMs) {
    lastPushMs = now;
    pushLogs();
  }
}
