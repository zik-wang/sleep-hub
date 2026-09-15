#!/usr/bin/env python3
"""LD2410C → presence + motion。

motion 用「移动目标能量」连续超阈值，不用探测距离掉到 0。
人坐着不动时雷达仍常把距离报成 0，那会误亮灯。

接线见 plugins/WIRING.md。USB-TTL 只接 5V/GND/TX/RX，OUT 空着。

用法:
  python plugins/ld2410c_presence.py --port COM4
  python plugins/ld2410c_presence.py --port COM4 --hub http://127.0.0.1:8792
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

HEAD = bytes((0xF4, 0xF3, 0xF2, 0xF1))
TAIL = bytes((0xF8, 0xF7, 0xF6, 0xF5))


def post(hub: str, payload: dict) -> None:
    req = urllib.request.Request(
        hub.rstrip("/") + "/ingest",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=3) as resp:
        resp.read()


def u16(body: bytes, i: int) -> int:
    return body[i] | (body[i + 1] << 8)


def parse_frames(buf: bytearray):
    while True:
        i = buf.find(HEAD)
        if i < 0:
            buf.clear()
            return
        if i:
            del buf[:i]
        if len(buf) < 8:
            return
        length = buf[4] | (buf[5] << 8)
        total = 6 + length + 4
        if len(buf) < total:
            return
        frame = bytes(buf[:total])
        del buf[:total]
        if frame[-4:] != TAIL:
            continue
        body = frame[6:-4]
        if len(body) < 11 or body[0] != 0x02 or body[1] != 0xAA:
            continue
        state = body[2]
        yield {
            "presence": state != 0,
            "state": state,
            "move_energy": body[5],
            "still_energy": body[8],
            "dist": u16(body, 9),
            "move_dist": u16(body, 3),
        }


def main() -> int:
    ap = argparse.ArgumentParser(description="LD2410C 体动 → sleep-hub motion")
    ap.add_argument("--port", required=True, help="例如 COM4")
    ap.add_argument("--baud", type=int, default=256000)
    ap.add_argument("--hub", default="http://127.0.0.1:8792")
    ap.add_argument("--source", default="ld2410c")
    ap.add_argument("--energy", type=int, default=40, help="移动能量阈值 0-100，默认 40")
    ap.add_argument("--frames", type=int, default=5, help="连续几帧才算体动，默认 5")
    args = ap.parse_args()
    try:
        import serial  # type: ignore
    except ImportError:
        print("需要 pyserial：pip install pyserial", file=sys.stderr)
        return 2

    try:
        ser = serial.Serial(args.port, args.baud, timeout=0.2)
    except serial.SerialException as e:
        print("打不开 %s：口被占了。先关掉海凌科 Tool 再启动。%s" % (args.port, e), flush=True)
        return 1

    buf = bytearray()
    last_presence = None
    last_motion = None
    motion_until = 0.0
    move_streak = 0
    energy_min = max(10, min(90, args.energy))
    need_frames = max(2, args.frames)
    print(
        "LD2410C 移动能量≥%s 连续%s帧 →" % (energy_min, need_frames),
        args.hub,
        "source=",
        args.source,
        flush=True,
    )
    while True:
        now = time.time()
        chunk = ser.read(256)
        if chunk:
            buf.extend(chunk)
            if len(buf) > 4096:
                del buf[:-512]
            for facts in parse_frames(buf):
                present = facts["presence"]
                if present is not last_presence:
                    last_presence = present
                    try:
                        post(args.hub, {"source": args.source, "kind": "presence", "value": present})
                        print(time.strftime("%H:%M:%S"), "presence", present, flush=True)
                    except urllib.error.URLError as e:
                        print("ingest 失败:", e, flush=True)
                moving = present and facts["move_energy"] >= energy_min and facts["state"] in (1, 3)
                if moving:
                    move_streak += 1
                else:
                    move_streak = 0
                if move_streak >= need_frames:
                    motion_until = now + 1.5
                    print(
                        time.strftime("%H:%M:%S"),
                        "体动 energy=%s state=%s dist=%s" % (
                            facts["move_energy"],
                            facts["state"],
                            facts["dist"],
                        ),
                        flush=True,
                    )
                    move_streak = 0
        want_motion = now < motion_until
        if want_motion is not last_motion:
            last_motion = want_motion
            try:
                post(args.hub, {"source": args.source, "kind": "motion", "value": want_motion})
                print(time.strftime("%H:%M:%S"), "motion", want_motion, flush=True)
            except urllib.error.URLError as e:
                print("ingest 失败:", e, flush=True)
        if not chunk:
            time.sleep(0.02)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
