import json
import os
import urllib.request
import urllib.error

from aiohttp import web
from server import PromptServer

WEB_DIRECTORY = "./js"
__all__ = ["WEB_DIRECTORY"]

VRAM_MANAGER_URL = os.environ.get("VRAM_MANAGER_URL", "http://vram-manager:8100")


def _http_post_json(url: str, payload: dict, timeout_s: float = 120.0) -> tuple[int, dict | None, str]:
  """POST JSON to vram-manager."""
  body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
  req = urllib.request.Request(
    url,
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
  )
  try:
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
      raw = resp.read().decode("utf-8")
      try:
        data = json.loads(raw)
      except json.JSONDecodeError:
        data = None
      return resp.status, data, raw
  except urllib.error.HTTPError as e:
    raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
    try:
      data = json.loads(raw)
    except Exception:
      data = None
    return e.code, data, raw
  except Exception as e:
    return 0, None, str(e)


def _http_get_json(url: str, timeout_s: float = 10.0) -> tuple[int, dict | None, str]:
  """GET JSON from vram-manager."""
  req = urllib.request.Request(url, method="GET")
  try:
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
      raw = resp.read().decode("utf-8")
      try:
        data = json.loads(raw)
      except json.JSONDecodeError:
        data = None
      return resp.status, data, raw
  except urllib.error.HTTPError as e:
    raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
    try:
      data = json.loads(raw)
    except Exception:
      data = None
    return e.code, data, raw
  except Exception as e:
    return 0, None, str(e)


routes = PromptServer.instance.routes


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
  wait = bool(args.get("wait", True))

  # Normalize protect to a list
  if isinstance(protect, str):
    protect_list = [c.strip() for c in protect.split(",") if c.strip()]
  elif isinstance(protect, list):
    protect_list = protect
  else:
    protect_list = ["comfyui"]

  payload = {
    "protect": protect_list,
    "high_only": high_only,
  }

  base_url = VRAM_MANAGER_URL.rstrip("/")
  wait_param = "1" if wait else "0"
  url = f"{base_url}/api/shed?wait={wait_param}"

  code, resp_json, raw = _http_post_json(url, payload, timeout_s=120.0)

  if isinstance(resp_json, dict):
    return web.json_response(resp_json, status=200 if code == 200 else 500)

  return web.json_response({"ok": False, "error": "Invalid response from vram-manager", "raw": raw}, status=500)


@routes.post("/spirit/vram/restore")
async def spirit_vram_restore(request):
  body = {}
  try:
    body = await request.json()
  except Exception:
    body = {}

  payload = {}

  base_url = VRAM_MANAGER_URL.rstrip("/")
  args = body.get("args") if isinstance(body.get("args"), dict) else {}
  wait = bool(args.get("wait", True))
  wait_param = "1" if wait else "0"
  url = f"{base_url}/api/restore?wait={wait_param}"

  code, resp_json, raw = _http_post_json(url, payload, timeout_s=120.0)

  if isinstance(resp_json, dict):
    return web.json_response(resp_json, status=200 if code == 200 else 500)

  return web.json_response({"ok": False, "error": "Invalid response from vram-manager", "raw": raw}, status=500)


@routes.get("/spirit/vram/status")
async def spirit_vram_status(request):
  base_url = VRAM_MANAGER_URL.rstrip("/")
  url = f"{base_url}/api/status"

  code, resp_json, raw = _http_get_json(url, timeout_s=10.0)

  if code != 200 or not isinstance(resp_json, dict):
    return web.json_response({
      "can_restore": False,
      "stopped_count": 0,
      "stopped": [],
      "error": f"vram-manager unreachable (code={code})",
    }, status=200)

  shed_state = resp_json.get("shed_state", [])
  can_restore = len(shed_state) > 0

  return web.json_response({
    "can_restore": can_restore,
    "stopped_count": len(shed_state),
    "stopped": shed_state,
    # Pass through the full status for the panel if needed
    "gpu": resp_json.get("gpu"),
    "consumers": resp_json.get("consumers"),
  }, status=200)