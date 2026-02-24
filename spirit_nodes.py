import json
import os
import urllib.request
import urllib.error

import folder_paths
import nodes

from comfy_execution.graph import ExecutionBlocker


VRAM_MANAGER_URL = os.environ.get("VRAM_MANAGER_URL", "http://vram-manager:8100")


def _http_post_json(url: str, payload: dict, timeout_s: float = 120.0) -> tuple[int, dict | None, str]:
  """POST JSON to vram-manager and return (status_code, parsed_json, raw_body)."""
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


class SpiritHostdGpuShed:
  @classmethod
  def INPUT_TYPES(cls):
    return {
      "required": {
        "enabled": ("BOOLEAN", {"default": True}),
      },
      "optional": {
        "vram_manager_url": ("STRING", {"default": ""}),
        "protect": ("STRING", {"default": "comfyui"}),
        "high_only": ("BOOLEAN", {"default": True}),
        "wait": ("BOOLEAN", {"default": True}),
        "strict": ("BOOLEAN", {"default": False}),
      }
    }

  RETURN_TYPES = ("BOOLEAN", "STRING")
  RETURN_NAMES = ("ok", "message")
  FUNCTION = "run"
  CATEGORY = "spirit/hostd"

  def run(
    self,
    enabled: bool,
    vram_manager_url: str = "",
    protect: str = "comfyui",
    high_only: bool = True,
    wait: bool = True,
    strict: bool = False
  ):
    if not enabled:
      return (True, "Preflight disabled")

    base_url = (vram_manager_url.strip() or VRAM_MANAGER_URL).rstrip("/")

    protect_list = [c.strip() for c in protect.split(",") if c.strip()]

    payload = {
      "protect": protect_list,
      "high_only": bool(high_only),
    }

    wait_param = "1" if wait else "0"
    url = f"{base_url}/api/shed?wait={wait_param}"

    code, resp_json, raw = _http_post_json(url, payload, timeout_s=120.0)

    ok = (code == 200) and isinstance(resp_json, dict) and resp_json.get("ok") is True
    msg = f"vram-manager code={code}, resp={resp_json}"

    if not ok and strict:
      raise RuntimeError(f"[SpiritHostdGpuShed] {msg}\nRaw response:\n{raw}")

    return (bool(ok), msg)


class SpiritCheckpointLoaderGated:
  @classmethod
  def INPUT_TYPES(cls):
    return {
      "required": {
        "enabled": ("BOOLEAN", {"default": True}),
        "ckpt_name": (folder_paths.get_filename_list("checkpoints"),),
      },
      "optional": {
        "fail_message": ("STRING", {"default": "Checkpoint load blocked (enabled=false)"}),
        "strict": ("BOOLEAN", {"default": False}),
      }
    }

  RETURN_TYPES = ("MODEL", "CLIP", "VAE")
  FUNCTION = "load_checkpoint"
  CATEGORY = "loaders"

  def load_checkpoint(self, enabled: bool, ckpt_name: str, fail_message: str = "", strict: bool = False):
    if not enabled:
      if strict:
        raise RuntimeError(fail_message or "Checkpoint load blocked (enabled=false)")
      blocker = ExecutionBlocker(fail_message or None)
      return (blocker, blocker, blocker)

    return nodes.CheckpointLoaderSimple().load_checkpoint(ckpt_name)


NODE_CLASS_MAPPINGS = {
  "SpiritHostdGpuShed": SpiritHostdGpuShed,
  "SpiritCheckpointLoaderGated": SpiritCheckpointLoaderGated,
}

NODE_DISPLAY_NAME_MAPPINGS = {
  "SpiritHostdGpuShed": "Hostd GPU Shed (preflight)",
  "SpiritCheckpointLoaderGated": "Checkpoint Loader (gated)",
}