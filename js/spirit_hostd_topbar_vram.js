import { app } from "../../scripts/app.js"
import { api } from "../../scripts/api.js"

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isVisible(el) {
  if (!el) return false
  const cs = getComputedStyle(el)
  if (cs.display === "none") return false
  if (cs.visibility === "hidden") return false
  if (cs.opacity === "0") return false
  if (el.getClientRects().length === 0) return false
  return true
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
      pointer-events: auto;
    }
    #spirit-vram-topbar.spirit-floating {
      position: fixed;
      top: 10px;
      right: 12px;
      z-index: 999999;
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

async function waitForVisibleActionbar() {
  // This is the *new* topbar container in your pasted HTML.
  for (let i = 0; i < 200; i++) {
    const bar = document.querySelector(".actionbar-container")
    if (isVisible(bar)) return bar
    await sleep(50)
  }
  return null
}

function pickDockContainer(actionbar) {
  // In your HTML, the "nice" row of buttons/monitors sits under a flex container with mx-2.
  // If that changes, we fall back to the actionbar itself.
  const row = actionbar.querySelector(".flex.gap-2.mx-2")
  if (isVisible(row)) return row
  return actionbar
}

function buildOrRebuildRoot(root) {
  root.innerHTML = ""

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
}

app.registerExtension({
  // (optional) bumping the name helps if the old extension is cached weirdly
  name: "spirit.hostd.topbar.vram",

  async setup() {
    ensureStyles()

    console.log("[spirit.hostd.topbar.vram] setup() running")

    // Reuse existing element if it already exists (even if it’s stuck in hidden legacy menu)
    let root = document.getElementById("spirit-vram-topbar")
    if (!root) {
      root = document.createElement("div")
      root.id = "spirit-vram-topbar"
    }

    buildOrRebuildRoot(root)

    // Always force a visible fallback first
    root.classList.add("spirit-floating")
    if (root.parentElement !== document.body) {
      document.body.appendChild(root)
    }

    // Then try to dock into the new action bar
    const actionbar = await waitForVisibleActionbar()
    if (!actionbar) {
      console.warn("[spirit.hostd.topbar.vram] actionbar not found, staying floating")
      return
    }

    const dock = pickDockContainer(actionbar)

    // If it’s already docked, do nothing; otherwise move it
    if (root.parentElement !== dock) {
      dock.appendChild(root)
    }

    // When docked, remove floating positioning
    root.classList.remove("spirit-floating")
    root.style.marginRight = "8px"

    console.log("[spirit.hostd.topbar.vram] docked into actionbar")
  }
})
