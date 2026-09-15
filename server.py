from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import io
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import uuid
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
PORT = 8792
HOST = "0.0.0.0"
LOCK = threading.Lock()
INBOX = []
NEXT_ID = 1
MAX_KEEP = 200
DAWN = {"progress": 0.0, "t": 0}
JOBS = {}
JOB_LOCK = threading.Lock()

sys.path.insert(0, str(ROOT / "plugins"))
try:
    import nl_compile
except ImportError:
    nl_compile = None

RADAR_LOCK = threading.Lock()
RADAR = {"proc": None, "port": "", "lines": []}


def radar_ports():
    try:
        from serial.tools import list_ports
    except ImportError:
        return []
    out = []
    for p in list_ports.comports():
        out.append({"device": p.device, "name": p.description or p.device})
    return out


def pick_radar_port(wanted=""):
    ports = radar_ports()
    want = str(wanted or "").strip().upper()
    if want and any(p["device"].upper() == want for p in ports):
        return str(wanted).strip()
    for p in ports:
        name = (p["name"] or "").upper()
        if "CH340" in name or "CH341" in name or "CP210" in name:
            return p["device"]
    if ports:
        return ports[0]["device"]
    return str(wanted or "COM4").strip()


def radar_alive():
    proc = RADAR["proc"]
    return bool(proc and proc.poll() is None)


def radar_status():
    alive = radar_alive()
    if not alive:
        RADAR["proc"] = None
    return {
        "ok": True,
        "local": True,
        "running": alive,
        "port": RADAR["port"] if alive else "",
        "ports": radar_ports(),
        "log": list(RADAR["lines"][-8:]),
    }


def start_radar(port=""):
    with RADAR_LOCK:
        if radar_alive():
            return radar_status()
        port = pick_radar_port(port)
        script = ROOT / "plugins" / "ld2410c_presence.py"
        hub = "http://127.0.0.1:%s" % PORT
        flags = 0
        if sys.platform == "win32":
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proc = subprocess.Popen(
            [sys.executable, "-u", str(script), "--port", port, "--hub", hub],
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=flags,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        RADAR["proc"] = proc
        RADAR["port"] = port
        RADAR["lines"] = ["启动 " + port]
        threading.Thread(target=_radar_pump, args=(proc,), daemon=True).start()
    time.sleep(0.4)
    if proc.poll() is not None:
        err = next((ln for ln in reversed(RADAR["lines"] or []) if ln and not ln.startswith("File ") and "Traceback" not in ln and "^^^^^^" not in ln), "启动失败")
        return {**radar_status(), "ok": False, "error": err, "running": False}
    return radar_status()


def _radar_pump(proc):
    try:
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", "ignore").strip()
            if not line:
                continue
            with RADAR_LOCK:
                RADAR["lines"].append(line)
                del RADAR["lines"][:-40]
            print("radar " + line, flush=True)
    except Exception:
        pass


def stop_radar():
    with RADAR_LOCK:
        proc = RADAR["proc"]
        RADAR["proc"] = None
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
    with RADAR_LOCK:
        RADAR["lines"].append("已停止")
    return radar_status()


def lan_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return "127.0.0.1"


def qr_svg(text):
    try:
        import segno
    except ImportError:
        return None
    text = (text or "").strip()[:512]
    if not text:
        return None
    qr = segno.make(text, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=6, border=2, dark="#1a140c", light="#f2eadf")
    return buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] " % self.log_date_time_string() + (fmt % args), flush=True)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _json(self, code, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self, max_len=16384):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > max_len:
            return None
        body = self.rfile.read(length)
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/inbox":
            after = 0
            if "after=" in self.path:
                try:
                    after = int(self.path.split("after=", 1)[1].split("&", 1)[0])
                except ValueError:
                    after = 0
            with LOCK:
                events = [e for e in INBOX if e["id"] > after]
            self._json(200, {"events": events})
            return
        if path == "/api/nl":
            job = ""
            if "job=" in self.path:
                job = self.path.split("job=", 1)[1].split("&", 1)[0]
            with JOB_LOCK:
                data = JOBS.get(job)
            if not data:
                self._json(404, {"ok": False, "error": "没有这个任务"})
                return
            self._json(200, {"ok": True, **data})
            return
        if path == "/api/radar":
            self._json(200, radar_status())
            return
        if path == "/dawn":
            self._json(200, {"ok": True, "progress": DAWN["progress"], "standin": True})
            return
        if path == "/api/health":
            ip = lan_ip()
            self._json(
                200,
                {
                    "ok": True,
                    "inbox": len(INBOX),
                    "port": PORT,
                    "lan": "http://%s:%s/" % (ip, PORT),
                    "ingest": "http://%s:%s/ingest" % (ip, PORT),
                    "nl": bool(nl_compile and nl_compile.available()),
                    "radar": radar_alive(),
                },
            )
            return
        if path == "/api/qr.svg":
            qs = parse_qs(urlparse(self.path).query)
            text = (qs.get("text") or [""])[0]
            raw = qr_svg(text)
            if not raw:
                self._json(404, {"ok": False, "error": "无法生成二维码"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/out":
            self._proxy_out()
            return
        if path == "/api/nl":
            self._start_nl()
            return
        if path == "/api/chat":
            self._handle_chat()
            return
        if path == "/api/radar":
            self._handle_radar()
            return
        if path == "/dawn":
            self._handle_dawn()
            return
        if path not in ("/ingest", "/api/ingest"):
            self.send_error(404)
            return
        data = self._read_json()
        if data is None:
            self._json(400, {"ok": False, "error": "需要 JSON 对象"})
            return
        global NEXT_ID
        evt = {
            "id": 0,
            "t": int(time.time() * 1000),
            "source": str(data.get("source") or "unknown")[:64],
            "kind": str(data.get("kind") or "note")[:32],
            "value": data.get("value"),
            "confidence": data.get("confidence", 1),
        }
        with LOCK:
            evt["id"] = NEXT_ID
            NEXT_ID += 1
            INBOX.append(evt)
            del INBOX[:-MAX_KEEP]
        self._json(200, {"ok": True, "id": evt["id"]})

    def _proxy_out(self):
        data = self._read_json()
        if data is None:
            self._json(400, {"ok": False, "error": "需要 JSON 对象"})
            return
        url = str(data.get("url") or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            self._json(400, {"ok": False, "error": "只转发 http(s)"})
            return
        body = str(data.get("body") or "")
        ctype = (
            "application/json"
            if body.lstrip().startswith("{")
            else "text/plain;charset=utf-8"
        )
        headers = {"Content-Type": ctype}
        if "ntfy.sh" in url:
            headers["Title"] = "sleep-hub"
        print("out → %s" % url, flush=True)
        req = urllib.request.Request(
            url,
            data=body.encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp.read()
                self._json(200, {"ok": True, "status": getattr(resp, "status", 200)})
        except Exception as e:
            print("out fail %s" % e, flush=True)
            self._json(502, {"ok": False, "error": str(e)})

    def _start_nl(self):
        if not (nl_compile and nl_compile.available()):
            self._json(503, {"ok": False, "error": "未配置 DeepSeek"})
            return
        data = self._read_json()
        if data is None:
            self._json(400, {"ok": False, "error": "需要 JSON 对象"})
            return
        jid = uuid.uuid4().hex[:12]
        sense = str(data.get("sense") or "")[:1500]
        apply = str(data.get("apply") or "")[:1500]
        origin = str(data.get("origin") or ("http://127.0.0.1:%s" % PORT))[:120]
        topic = re.sub(r"[^a-zA-Z0-9_-]", "", str(data.get("topic") or ""))[:64]
        with JOB_LOCK:
            JOBS[jid] = {"status": "running"}
            extra = [k for k, v in JOBS.items() if v.get("status") != "running"]
            for k in extra[:-20]:
                JOBS.pop(k, None)
        print("nl job %s" % jid, flush=True)
        threading.Thread(
            target=self._run_nl_job,
            args=(jid, sense, apply, origin, topic),
            daemon=True,
        ).start()
        self._json(200, {"ok": True, "id": jid, "status": "running"})

    def _run_nl_job(self, jid, sense, apply, origin, topic=""):
        try:
            result = nl_compile.compile_nl(sense, apply, origin, topic)
            with JOB_LOCK:
                JOBS[jid] = {"status": "done", "result": result}
            print("nl done %s" % jid, flush=True)
        except Exception as e:
            with JOB_LOCK:
                JOBS[jid] = {"status": "error", "error": str(e)[:240]}
            print("nl fail %s %s" % (jid, e), flush=True)

    def _handle_chat(self):
        if not (nl_compile and nl_compile.available()):
            self._json(503, {"ok": False, "error": "未配置 DeepSeek"})
            return
        data = self._read_json(400000)
        if data is None:
            self._json(400, {"ok": False, "error": "需要 JSON 对象"})
            return
        origin = str(data.get("origin") or ("http://127.0.0.1:%s" % PORT))[:120]
        topic = re.sub(r"[^a-zA-Z0-9_-]", "", str(data.get("topic") or ""))[:64]
        try:
            out = nl_compile.chat_turn(
                data.get("messages") or [],
                data.get("files") or [],
                origin,
                topic,
            )
            self._json(200, {"ok": True, **out})
        except Exception as e:
            print("chat fail %s" % e, flush=True)
            self._json(502, {"ok": False, "error": str(e)[:240]})

    def _handle_radar(self):
        data = self._read_json() or {}
        action = str(data.get("action") or "").strip().lower()
        if action == "start":
            out = start_radar(str(data.get("port") or ""))
            self._json(200 if out.get("ok") else 502, out)
            return
        if action == "stop":
            self._json(200, stop_radar())
            return
        self._json(400, {"ok": False, "error": "action 用 start 或 stop"})

    def _handle_dawn(self):
        progress = DAWN["progress"]
        data = self._read_json()
        if isinstance(data, dict) and data.get("progress") is not None:
            try:
                progress = float(data.get("progress"))
            except (TypeError, ValueError):
                progress = DAWN["progress"]
        progress = max(0.0, min(1.0, progress))
        DAWN["progress"] = progress
        DAWN["t"] = int(time.time() * 1000)
        print("LED stand-in progress=%.3f" % progress, flush=True)
        self._json(200, {"ok": True, "progress": progress, "standin": True})


class HubServer(ThreadingHTTPServer):
    allow_reuse_address = False


if __name__ == "__main__":
    ip = lan_ip()
    try:
        httpd = HubServer((HOST, PORT), Handler)
    except OSError as e:
        print("无法绑定 %s:%s（多半已有中控在跑）：%s" % (HOST, PORT, e), flush=True)
        raise SystemExit(1)
    print("睡眠中控", flush=True)
    print("  本机  http://127.0.0.1:%s/" % PORT, flush=True)
    print("  局域网 http://%s:%s/" % (ip, PORT), flush=True)
    print("  接入  POST http://%s:%s/ingest" % (ip, PORT), flush=True)
    print(
        "  口述  DeepSeek %s" % ("已接" if (nl_compile and nl_compile.available()) else "未配置"),
        flush=True,
    )
    httpd.serve_forever()
