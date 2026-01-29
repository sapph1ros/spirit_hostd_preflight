import { app } from "../../scripts/app.js"
import { api } from "../../scripts/api.js"

// IMPORTANT:
// Use the exact same endpoint your current working UI buttons call.
// If you don’t remember it, open your existing working widget JS and copy it here.
const ENDPOINT = "/spirit/hostd/run"  // <- replace with your real route if different

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForMenuEl() {
  // New menu (top/bottom) commonly exposes .comfy-menu
  // Fallbacks are here to survive UI changes.
  const selectors = [
    ".comfy-menu",
    "#comfyui-menu",
    "#menu"
  ]

  for (let i = 0; i < 200; i++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el) return el
    }
    await sleep(50)
  }
  throw new Error("Top bar element not found (menu not ready?)")
}

function ensureStyles() {
  if (document.getElementById("spirit-vram-topbar-style")) return
  const style = document.createElement("style")
  style.id = "spirit-vram-topbar-style"
  style.textContent = `
    #spirit-vram-topbar {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      margin-left: 8px;
      user-select: none;
    }
    #spirit-vram-topbar .spirit-vram-btn {
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.06);
      cursor: pointer;
      font-size: 12px;
      line-height: 18px;
    }
    #spirit-vram-topbar .spirit-vram-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    #spirit-vram-topbar .spirit-vram-status {
      font-size: 12px;
      opacity: 0.85;
      padding-left: 6px;
      white-space: nowrap;
      max-width: 340px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `
  document.head.appendChild(style)
}

async function callHostd(action, args) {
  // If your ComfyUI endpoint proxies to hostd’s /v1/run and supports wait,
  // keep wait=true so you don’t race “busy” states.
  const payload = { action, args: args || {} }

  const res = await api.fetchApi(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    data = { ok: false, error: "bad_json_response" }
  }

  if (!res.ok) {
    const msg = data?.error || `http_${res.status}`
    throw new Error(msg)
  }
  return data
}

function pickMenuAttachPoint(menuEl) {
  // If ComfyUI has a “right side” container, prefer it.
  // Otherwise just append into the menu root.
  return menuEl.querySelector(".comfy-menu-right") || menuEl
}

app.registerExtension({
  name: "spirit.hostd.topbar.vram",

  async setup() {
    ensureStyles()

    const menuEl = await waitForMenuEl()
    const mountEl = pickMenuAttachPoint(menuEl)

    // Avoid duplicates on hot reloads
    if (document.getElementById("spirit-vram-topbar")) return

    const root = document.createElement("div")
    root.id = "spirit-vram-topbar"

    const shedBtn = document.createElement("button")
    shedBtn.className = "spirit-vram-btn"
    shedBtn.textContent = "VRAM: SHED"

    const restoreBtn = document.createElement("button")
    restoreBtn.className = "spirit-vram-btn"
    restoreBtn.textContent = "VRAM: RESTORE"

    const status = document.createElement("div")
    status.className = "spirit-vram-status"
    status.textContent = "idle"

    async function run(action, args) {
      shedBtn.disabled = true
      restoreBtn.disabled = true
      status.textContent = `running: ${action}…`

      try {
        const data = await callHostd(action, args)
        status.textContent = data?.ok ? `ok (${data.duration_ms} ms)` : `failed (${data?.rc ?? "?"})`
      } catch (e) {
        status.textContent = `error: ${e?.message || e}`
      } finally {
        shedBtn.disabled = false
        restoreBtn.disabled = false
      }
    }

    shedBtn.onclick = () => run("gpu_shed.shed", {
      protect: "comfyui",
      high_only: true,
      quiet: true
    })

    restoreBtn.onclick = () => run("gpu_shed.restore", {
      quiet: true
    })

    root.appendChild(shedBtn)
    root.appendChild(restoreBtn)
    root.appendChild(status)

    mountEl.appendChild(root)
  }
})
