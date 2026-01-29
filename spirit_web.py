import json
import os
import socket

from aiohttp import web
from server import PromptServer

WEB_DIRECTORY = "./js"
__all__ = ["WEB_DIRECTORY"]

def _unix_http_post_json(sock_path: str, path: str, payload: dict, timeout_s: float = 120.0) -> tuple[int, dict | None, str]:
  body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
  req = (
    f"POST {path} HTTP/1.1\r\n"
    f"Host: localhost\r\n"
    f"Content-Type: application/json\r\n"
    f"Content-Length: {len(body)}\r\n"
    f"Connection: close\r\n"
    f"\r\n"
  ).encode("utf-8") + body

  with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
    s.settimeout(timeout_s)
    s.connect(sock_path)
    s.sendall(req)

    chunks = []
    while True:
      try:
        data = s.recv(65536)
      except socket.timeout:
        break
      if not data:
        break
      chunks.append(data)

  raw = b"".join(chunks).decode("utf-8", errors="replace")
  head, _, resp_body = raw.partition("\r\n\r\n")
  status_line = head.splitlines()[0] if head else ""
  code = 0
  try:
    code = int(status_line.split(" ")[1])
  except Exception:
    code = 0

  resp_json = None
  if resp_body.strip():
    try:
      resp_json = json.loads(resp_body)
    except Exception:
      resp_json = None

  return code, resp_json, raw

def _call_hostd(action: str, args: dict, wait: bool = True) -> tuple[int, dict]:
  sock_path = os.environ.get("HOSTD_SOCK", "/hostd/hostd.sock")
  path = "/v1/run?wait=1" if wait else "/v1/run"
  payload = {"action": action, "args": args}
  code, resp_json, raw = _unix_http_post_json(sock_path, path, payload, timeout_s=120.0)

  if isinstance(resp_json, dict):
    return code, resp_json

  return code, {"ok": False, "error": "Invalid JSON from hostd", "raw": raw}

routes = PromptServer.instance.routes

STATE_FILE = os.environ.get("GPU_SHED_STATE_FILE", "/run/gpu-shed.stopped")

def _read_shed_state() -> list[str]:
  if not os.path.exists(STATE_FILE):
    return []
  try:
    with open(STATE_FILE, "r", encoding="utf-8") as f:
      lines = [ln.strip() for ln in f.readlines()]
    return [ln for ln in lines if ln]
  except Exception:
    return []

@routes.post("/spirit/vram/shed")
async def spirit_vram_shed(request):
  body = {}
  try:
    body = await request.json()
  except Exception:
    body = {}

  args = body.get("args") if isinstance(body.get("args"), dict) else {}
  protect = args.get("protect", "comfyui")
  high_only = bool(args.get("high_only", True))
  quiet = bool(args.get("quiet", True))
  wait = bool(args.get("wait", True))

  code, resp = _call_hostd("gpu_shed.shed", {
    "protect": protect,
    "high_only": high_only,
    "quiet": quiet
  }, wait=wait)

  return web.json_response(resp, status=200 if code == 200 else 500)

@routes.post("/spirit/vram/restore")
async def spirit_vram_restore(request):
  body = {}
  try:
    body = await request.json()
  except Exception:
    body = {}

  args = body.get("args") if isinstance(body.get("args"), dict) else {}
  quiet = bool(args.get("quiet", True))
  wait = bool(args.get("wait", True))

  code, resp = _call_hostd("gpu_shed.restore", {
    "quiet": quiet
  }, wait=wait)

  return web.json_response(resp, status=200 if code == 200 else 500)

@routes.get("/spirit/vram/status")
async def spirit_vram_status(request):
  stopped = _read_shed_state()
  state_exists = os.path.exists(STATE_FILE)

  # restore is available if file exists AND has at least one container name
  can_restore = len(stopped) > 0

  return web.json_response({
    "can_restore": can_restore,
    "stopped_count": len(stopped),
    "stopped": stopped,
    "state_file_exists": state_exists,
    "state_file": STATE_FILE,
  }, status=200)
