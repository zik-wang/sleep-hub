# 睡眠中控

产品是中控，不是雷达。没有硬件也能指定怎么采集、怎么叫醒。设备按同一契约接入。

## 30 秒冷启动

1. 双击 `启动中控.bat`
2. 打开 http://127.0.0.1:8792/
3. 手机装 [ntfy](https://ntfy.sh/)，订阅「今夜」里的主题
4. 点 **一键三幕**

空桌约 20 秒：示例回放写成浅睡 → 屏幕黎明 → 电脑响铃 → 手机收到推送。口播三句在「今夜」栏。

雷达已接上（采集栏启动，或本机 COM4 空闲）时，第三幕改成等翻身/体动再亮灯：挥手或翻身让探测距离掉到 0。

没有手机时，一键三幕仍然会黎明和响铃；日志里应出现 `HTTP 已发出`。

采集栏、叫醒栏可以各写一段话，点 **编译进中控**。编译成源和步骤后夜里仍只跑契约，不把模型留在守夜里。灯地址说不清就标缺项，不会瞎填 URL。

## 90 秒口播（三幕）

评委带走一句话：**只有中控也能指定采集和叫醒；设备按同一契约接入。**

1. **0–25 秒 空桌**  
   不要先讲雷达。点「由我指定」：有人、浅睡。压缩试跑。屏幕黎明 + 响铃。  
   「采集是我指定的，叫醒也是我指定的。」

2. **25–60 秒 换源**  
   同一方案，不要改步骤。点示例回放，或把 curl 发给另一台电脑。事实跳了，方案照样亮。  
   「换的是谁来写事实，不是换产品。」

3. **60–90 秒 发出去 / 雷达介入**  
   空桌：方案最后一步 HTTP 发出，ntfy 推手机。雷达在场：等体动再黎明，灯到了走 ESP 的 `/dawn`。  
   「执行器也是契约，不是焊死的灯。」

不要把 LD2410C、DEV102、手环做成首页目录。它们是插件。

## 契约

事实只有三条：`presence` / `motion` / `stage`。

```text
POST /ingest
Content-Type: application/json

{"source":"my-band","kind":"stage","value":"light"}
```

`kind` 为 `presence` 或 `motion` 时，`value` 用 true/false。  
`stage` 用 `wake` / `light` / `deep` / `rem`。

局域网地址看页面底部，或 `GET /api/health`。防火墙若拦了 8792，给 Python 放行一次。

## 货到了再接线（不改方案）

图见 `plugins/WIRING.md`。USB-TTL 只接雷达，灯带不要接到 TTL 上。中控先开着，再双击 `雷达接入.bat`，填设备管理器里的 COM 口。挥手应出现 `motion true`。

| 盒子 | 角色 | 脚本 |
| --- | --- | --- |
| LD2410C + USB-TTL | 写 `presence` 和 `motion`（挥手=体动） | `python plugins/ld2410c_presence.py --port COM5` |
| 矽典微 DEV102 + 开发工具 | Sense 插件：透传后算体动/节律，写 `motion`/`stage` | 先 `plugins/dev102_ingest.py` 转发 jsonl；IQ 解析等透传文档 |
| ESP32 SuperMini + SK6812 | `http_out` 灯 | 烧 `plugins/esp32_dawn/esp32_dawn.ino`（默认 GPIO10），方案 URL 改成 `http://<esp-ip>/dawn`。没有这块板就用屏幕黎明 |

已有笔记本。LD2410C 不要拿来分期。DEV102 不要拿来当存在雷达，也不要当灯。

开发工具那 ¥97 不能跳：出厂板没有完整透传固件。

## 本仓库

- `index.html`：第二版中控（两框口述编译）
- `v3.html` / `chat.js`：第三版。DeepSeek 编译改成对话窗，可阅读附件
- `hub.js` / `bus.js` / `runner.js` / `app.js` / `styles.css`：中控
- `server.py`：静态页 + `POST /ingest`，绑 `0.0.0.0:8792`
- `plugins/`：到货后的源和执行器，不是产品目录
