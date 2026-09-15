# 手头三件怎么接

不是一条串起来的线。USB-TTL 只服务雷达；灯带另走 MCU。

## 1. HiLink LD2410C ↔ USB-TTL ↔ 电脑

只做采集。脚本：`python plugins/ld2410c_presence.py --port COM5`

```
LD2410C        USB-TTL（CH340 / CP2102）
------         -------------------------
5V    ------->  5V     （模块要 5V 供电）
GND   ------->  GND
TX    ------->  RXD    （交叉）
RX    ------->  TXD    （交叉）
OUT            空接    （UART 已经够用，不必接 OUT）
```

- 信号交叉：板子 TX 对工具 RX，接反了就是没数据。
- 若 USB-TTL 有 3.3V / 5V 跳帽：**TX/RX 电平选 3.3V**，电源仍用 5V。5V 逻辑直灌 RX 可能打模块。
- 电脑设备管理器里看 COM 口。波特率 **256000**。
- 不要把灯带的 5V/DIN 接到这块 USB-TTL 上。

雷达朝床、离人约 0.3–3 m，别对着金属柜门。

STEP 三维图量出来的板：

- 外形 **22.00 × 16.00 mm**，厚 **1.00 mm**，四角 **R2**
- 排针 **5 针、2.54 mm 间距、孔径 Ø0.90**，在 22 mm 长边（靠近板缘 1.5 mm）
- 针序（元件面，LED 在左、RF 在右，从左到右）：**1 5V · 2 GND · 3 RX · 4 TX · 5 OUT**
- 看板上丝印为准；STEP 里没有丝印字，针序按 LED/电源端 = 5V

## 2. 灯带：不要接 USB-TTL，要一块 MCU

SK6812 / WS2812 是「一根 DIN 咬时序」的灯，USB-TTL 只会串口，咬不了时序，接上也亮不成，还可能倒灌。

仓库默认：**ESP32-C3 SuperMini + Arduino IDE** 烧 `esp32_dawn/esp32_dawn.ino`。

```
独立 5V 2A 电源  -->  灯带 5V
独立电源 GND     -->  灯带 GND  -->  ESP GND（必须共地）
灯带 DIN         -->  ESP GPIO10
```

灯带电流别从电脑 USB 或 USB-TTL 抽。30 灯珠大约要 1–2 A。

方案里 HTTP 发出：`http://<板子IP>/dawn`，body `{"progress":1}`。

**没有 ESP / Arduino 板：这一小时用笔记本「屏幕黎明」当灯。** 雷达照样接电脑证明「动了」。不要临时拿 USB-TTL 驱动灯带。

| 你有什么 | 灯怎么亮 | 要不要 Arduino |
| --- | --- | --- |
| 只有灯带 + USB-TTL | 亮不了物理灯 | 不要把灯接到 TTL |
| ESP32-C3 SuperMini | 烧现成 `.ino`，Wi‑Fi 收 `/dawn` | 要，用 Arduino IDE 烧 ESP32，不是把灯接到 Uno 的 USB |
| 普通 Arduino Uno（无 Wi‑Fi） | 也能 NeoPixel，但中控发不出去，还得再写串口桥 | 这一小时别走这条 |

## 3. 唤醒窗口（中控契约，不改产品）

1. 雷达脚本把 `motion` 写成有体动  
2. 方案：等到墙上时钟 → 等体动 → 屏幕黎明（或灯板 `/dawn`）

模板名：**唤醒窗口：动了才亮**。压缩试跑时人在雷达前挥一下即可。
