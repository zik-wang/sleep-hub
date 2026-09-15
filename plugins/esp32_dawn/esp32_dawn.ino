/*
 * 睡眠中控 http_out 的灯带网关。烧到已有的 ESP32-C3 SuperMini。
 * Arduino：USB CDC On Boot = Enabled。
 * 中控步骤: HTTP 发出 → http://<esp-ip>/dawn  body {"progress":0.0~1.0}
 *
 * 接线（SK6812 暖白，独立 5V 2A，与 ESP 共地）:
 *   DIN → GPIO 10（也可用 0 / 1 / 3，改 LED_PIN）
 */
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_NeoPixel.h>

const char *WIFI_SSID = "YOUR_SSID";
const char *WIFI_PASS = "YOUR_PASS";
const uint16_t LED_COUNT = 30;
const int8_t LED_PIN = 10;

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
WebServer server(80);
float progress = 0;

void cors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void paint() {
  float p = progress;
  if (p < 0) p = 0;
  if (p > 1) p = 1;
  uint8_t r = (uint8_t)(40 + p * 180);
  uint8_t g = (uint8_t)(18 + p * 90);
  uint8_t b = (uint8_t)(6 + p * 20);
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
}

void handleDawn() {
  cors();
  String body = server.arg("plain");
  if (body.length() == 0) body = server.arg("progress");
  body.trim();
  if (body.startsWith("{")) {
    int idx = body.indexOf("progress");
    if (idx >= 0) {
      int colon = body.indexOf(':', idx);
      progress = body.substring(colon + 1).toFloat();
    }
  } else if (body.length()) {
    progress = body.toFloat();
  }
  paint();
  server.send(200, "application/json", "{\"ok\":true}");
}

void setup() {
  strip.begin();
  strip.clear();
  strip.show();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
  }
  server.on("/dawn", HTTP_OPTIONS, []() {
    cors();
    server.send(204);
  });
  server.on("/dawn", HTTP_POST, handleDawn);
  server.on("/dawn", HTTP_GET, handleDawn);
  server.on("/", []() {
    cors();
    server.send(200, "text/plain", WiFi.localIP().toString());
  });
  server.begin();
}

void loop() {
  server.handleClient();
}
