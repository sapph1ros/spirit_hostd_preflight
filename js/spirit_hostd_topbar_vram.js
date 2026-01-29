import { app } from "../../scripts/app.js"
import { api } from "../../scripts/api.js"

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
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
      user-select: none;
    }
    #spirit-vram-topbar.spirit-floating {
      position: fixed;
      top: 10px;
      right: 12px;
      z-index: 99999;
      background: rgba(0,0,0,0.35);
      backdrop-filter: blur(6px);
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

async function postJson(path, obj) {
  const res = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj ?? {})
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

async function waitForAnchorEl() {
  // Prefer stable IDs first. Comfy docs use queue-button in examples. :contentReference[oaicite:1]{index=1}
  const selectors = [
    "#queue-button",
    "#run-button",
    "[data-testid='queue-button']",
    "[data-testid='run-button']",
    "button[aria-label='Run']",
    "button[aria-label='Queue Prompt']",
    "button[title='Run']",
    "button[title='Queue Prompt']"
  ]

  for (let i = 0; i < 200; i++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el) return el
    }
    await sleep(50)
  }
  return null
}

function mountNextToAnchor(root, anchor) {
  // Try to insert right next to the Run/Queue button without making assumptions about menu classes.
  const parent = anchor?.parentElement
  if (!parent) return false

  // Insert just before the anchor so it appears immediately left of Run/Queue.
  parent.insertBefore(root, anchor)
  root.style.marginRight = "8px"
  return true
}

app.registerExtension({
  name: "spirit.hostd.topbar.vram",

  async setup() {
    ensureStyles()

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

    async function run(kind) {
      shedBtn.disabled = true
      restoreBtn.disabled = true
      status.textContent = `running: ${kind}…`

      try {
        let r = null
        if (kind === "shed") {
          r = await postJson("/spirit/vram/shed", {
            args: { protect: "comfyui", high_only: true, quiet: true, wait: true }
          })
        } else {
          r = await postJson("/spirit/vram/restore", {
            args: { quiet: true, wait: true }
          })
        }
        status.textContent = r.ok ? "ok" : `failed (${r.status})`
      } catch (e) {
        status.textContent = `error: ${e?.message || e}`
      } finally {
        shedBtn.disabled = false
        restoreBtn.disabled = false
      }
    }

    shedBtn.onclick = () => run("shed")
    restoreBtn.onclick = () => run("restore")

    root.appendChild(shedBtn)
    root.appendChild(restoreBtn)
    root.appendChild(status)

    const anchor = await waitForAnchorEl()
    const mounted = anchor ? mountNextToAnchor(root, anchor) : false

    if (!mounted) {
      // Fallback: guaranteed visible, even if ComfyUI changes its topbar DOM again.
      root.classList.add("spirit-floating")
      document.body.appendChild(root)
      status.textContent = "idle (floating)"
    }
  }
})
