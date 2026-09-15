#!/usr/bin/env python3
"""DEV102 到货后的 Sense 插件骨架。中控不内置这块板。

现在能做的：读 jsonl（每行一个对象）并 POST /ingest。
透传 IQ 解析要等开发工具文档；不要在工厂固件上猜分期。

jsonl 示例:
  {"kind":"motion","value":true}
  {"kind":"stage","value":"light","confidence":0.6}

用法:
  python plugins/dev102_ingest.py --file out/features.jsonl
  python plugins/dev102_ingest.py --file out/features.jsonl --hub http://127.0.0.1:8792
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def post(hub: str, payload: dict) -> None:
    req = urllib.request.Request(
        hub.rstrip("/") + "/ingest",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=3) as resp:
        resp.read()


def main() -> int:
    ap = argparse.ArgumentParser(description="DEV102 / 特征文件 → sleep-hub")
    ap.add_argument("--file", required=True, help="jsonl，每行一个 JSON 对象")
    ap.add_argument("--hub", default="http://127.0.0.1:8792")
    ap.add_argument("--source", default="dev102")
    ap.add_argument("--sleep", type=float, default=0.2, help="行间隔秒")
    args = ap.parse_args()

    path = args.file
    print("DEV102 插件：读", path, "→", args.hub)
    print("IQ 透传解析尚未接线。当前只转发 kind/value。")
    n = 0
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as e:
                print("跳过坏行:", e, file=sys.stderr)
                continue
            payload = {
                "source": args.source,
                "kind": str(row.get("kind") or "note"),
                "value": row.get("value"),
            }
            if "confidence" in row:
                payload["confidence"] = row["confidence"]
            try:
                post(args.hub, payload)
                n += 1
                print(time.strftime("%H:%M:%S"), payload["kind"], payload["value"])
            except urllib.error.URLError as e:
                print("ingest 失败:", e, file=sys.stderr)
                return 1
            if args.sleep > 0:
                time.sleep(args.sleep)
    print("发出", n, "条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
