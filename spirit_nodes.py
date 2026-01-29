import json
import os
import socket

import folder_paths
import nodes

from comfy_execution.graph import ExecutionBlocker


def _unix_http_post_json(sock_path: str, path: str, payload: dict, timeout_s: float = 10.0) -> tuple[int, dict | None, str]:
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
  status_code = 0
  try:
    status_code = int(status_line.split(" ")[1])
  except Exception:
    status_code = 0

  resp_json = None
  if resp_body.strip():
    try:
      resp_json = json.loads(resp_body)
    except Exception:
      resp_json = None

  return status_code, resp_json, raw


class SpiritHostdGpuShed:
  @classmethod
  def INPUT_TYPES(cls):
    return {
      "required": {
        "enabled": ("BOOLEAN", {"default": True}),
      },
      "optional": {
        "hostd_socket": ("STRING", {"default": ""}),
        "protect": ("STRING", {"default": "comfyui"}),
        "high_only": ("BOOLEAN", {"default": True}),
        "quiet": ("BOOLEAN", {"default": True}),
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
    hostd_socket: str = "",
    protect: str = "comfyui",
    high_only: bool = True,
    quiet: bool = True,
    wait: bool = True,
    strict: bool = False
  ):
    if not enabled:
      return (True, "Preflight disabled")

    sock_path = hostd_socket.strip() or os.environ.get("HOSTD_SOCK", "/hostd/hostd.sock")
    path = "/v1/run?wait=1" if wait else "/v1/run"

    payload = {
      "action": "gpu_shed.shed",
      "args": {
        "protect": protect,
        "high_only": bool(high_only),
        "quiet": bool(quiet),
      }
    }

    code, resp_json, raw = _unix_http_post_json(sock_path, path, payload, timeout_s=30.0)

    ok = (code == 200) and isinstance(resp_json, dict) and resp_json.get("ok") is True
    msg = f"hostd code={code}, resp={resp_json}"

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
