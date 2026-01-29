#!/usr/bin/env python3
import argparse
import json
import os
import socket
import stat
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn, UnixStreamServer
from urllib.parse import urlparse, parse_qs

# ------------- Single-flight state -------------
_state_lock = threading.Lock()
_busy_lock = threading.Lock()
_busy = {
  "busy": False,
  "job_id": None,
  "action": None,
  "started_at": None
}

def _set_busy(job_id, action):
  with _busy_lock:
    _busy["busy"] = True
    _busy["job_id"] = job_id
    _busy["action"] = action
    _busy["started_at"] = time.time()

def _clear_busy():
  with _busy_lock:
    _busy["busy"] = False
    _busy["job_id"] = None
    _busy["action"] = None
    _busy["started_at"] = None

def _get_busy():
  with _busy_lock:
    d = dict(_busy)
  if d["busy"] and d["started_at"]:
    d["running_for_s"] = round(time.time() - d["started_at"], 3)
  return d

# ------------- Action registry -------------
GPU_SHED_SCRIPT = "/opt/scripts/main/gpu-shed.sh"

def _run_gpu_shed_shed(args):
  # Allowed args (all optional):
  # protect: str
  # all: bool
  # auto: bool
  # high_only: bool
  # quiet: bool (default True)
  # gpu_index: int -> env GPU_INDEX
  # target_free_mib: int -> env TARGET_FREE_MIB
  # stop_timeout: int -> env STOP_TIMEOUT
  protect = args.get("protect")
  stop_all = bool(args.get("all", False))
  auto = bool(args.get("auto", False))
  high_only = bool(args.get("high_only", False))
  quiet = bool(args.get("quiet", True))

  argv = [GPU_SHED_SCRIPT, "shed"]
  if stop_all:
    argv.append("--all")
  if auto:
    argv.append("--auto")
  if protect and not stop_all:
    argv += ["--protect", str(protect)]
  if high_only:
    argv.append("--high-only")
  if quiet:
    argv.append("--quiet")

  env = os.environ.copy()
  if "gpu_index" in args:
    env["GPU_INDEX"] = str(int(args["gpu_index"]))
  if "target_free_mib" in args:
    env["TARGET_FREE_MIB"] = str(int(args["target_free_mib"]))
  if "stop_timeout" in args:
    env["STOP_TIMEOUT"] = str(int(args["stop_timeout"]))

  return argv, env

def _run_gpu_shed_restore(args):
  quiet = bool(args.get("quiet", True))
  argv = [GPU_SHED_SCRIPT, "restore"]
  if quiet:
    argv.append("--quiet")
  env = os.environ.copy()
  return argv, env

ACTIONS = {
  "gpu_shed.shed": _run_gpu_shed_shed,
  "gpu_shed.restore": _run_gpu_shed_restore
}

# ------------- HTTP server over Unix socket -------------
class ThreadingUnixHTTPServer(ThreadingMixIn, UnixStreamServer):
  daemon_threads = True
  allow_reuse_address = True

class Handler(BaseHTTPRequestHandler):
  server_version = "spirit-hostd/1.0"

  def _json(self, code, payload):
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    self.send_response(code)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def _read_json_body(self):
    length = int(self.headers.get("Content-Length", "0"))
    if length <= 0:
      return {}
    raw = self.rfile.read(length)
    if not raw:
      return {}
    return json.loads(raw.decode("utf-8"))

  def log_message(self, fmt, *args):
    # Keep systemd logs tidy; comment out if you want per-request logs.
    return

  def do_GET(self):
    p = urlparse(self.path)
    if p.path == "/v1/health":
      return self._json(200, {"ok": True})
    if p.path == "/v1/busy":
      return self._json(200, _get_busy())
    return self._json(404, {"ok": False, "error": "not_found"})

  def do_POST(self):
    p = urlparse(self.path)
    qs = parse_qs(p.query)

    # wait=1 (default) means: block until daemon is free.
    # wait=0 means: return 409 if busy.
    wait = True
    if "wait" in qs:
      v = (qs["wait"][0] or "").strip()
      wait = (v != "0")

    if p.path == "/v1/run":
      try:
        req = self._read_json_body()
      except Exception as e:
        return self._json(400, {"ok": False, "error": "bad_json", "detail": repr(e)})

      action = req.get("action")
      args = req.get("args", {})
      if not isinstance(args, dict):
        return self._json(400, {"ok": False, "error": "args_must_be_object"})

      if action not in ACTIONS:
        return self._json(400, {"ok": False, "error": "unknown_action", "action": action})

      job_id = str(uuid.uuid4())

      # Busy protection (single-flight)
      if wait:
        _state_lock.acquire()
      else:
        if not _state_lock.acquire(blocking=False):
          b = _get_busy()
          return self._json(409, {"ok": False, "error": "busy", **b})

      _set_busy(job_id, action)
      started = time.time()

      try:
        argv, env = ACTIONS[action](args)
        # Hard requirement: script must exist.
        if not os.path.exists(argv[0]):
          raise FileNotFoundError(argv[0])

        cp = subprocess.run(
          argv,
          env=env,
          capture_output=True,
          text=True
        )
        duration_ms = int((time.time() - started) * 1000)

        return self._json(200, {
          "ok": (cp.returncode == 0),
          "job_id": job_id,
          "action": action,
          "rc": cp.returncode,
          "duration_ms": duration_ms,
          "stdout": cp.stdout,
          "stderr": cp.stderr
        })
      except Exception as e:
        duration_ms = int((time.time() - started) * 1000)
        return self._json(500, {
          "ok": False,
          "job_id": job_id,
          "action": action,
          "error": "exception",
          "detail": repr(e),
          "duration_ms": duration_ms
        })
      finally:
        _clear_busy()
        try:
          _state_lock.release()
        except Exception:
          pass

    return self._json(404, {"ok": False, "error": "not_found"})

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--socket", default="/data/ai/hostd/run/hostd.sock")
  ap.add_argument("--chmod", default="666", help="octal perms for the socket file")
  args = ap.parse_args()

  sock_path = args.socket
  sock_dir = os.path.dirname(sock_path)
  os.makedirs(sock_dir, exist_ok=True)

  # Remove stale socket if present
  if os.path.exists(sock_path):
    try:
      os.unlink(sock_path)
    except Exception:
      pass

  server = ThreadingUnixHTTPServer(sock_path, Handler)

  # Make socket widely accessible (you said you don't care about access control)
  try:
    os.chmod(sock_path, int(args.chmod, 8))
  except Exception:
    pass

  print(f"spirit-hostd listening on unix socket: {sock_path}", flush=True)
  server.serve_forever()

if __name__ == "__main__":
  main()