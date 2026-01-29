import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const STYLE_ID = "spirit-vram-topbar-style";
const POS_KEY = "spirit.vram.topbar.pos.v1";

// Backend routes
const SHED_PATH = "/spirit/vram/shed";
const RESTORE_PATH = "/spirit/vram/restore";

// New: status route (you’ll add this in spirit_web.py below)
const STATUS_PATH = "/spirit/vram/status";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #spirit-vram-topbar {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border: 1px solid var(--interface-stroke, rgba(255,255,255,0.15));
      border-radius: 8px;
      user-select: none;
      pointer-events: auto;
      background: var(--comfy-menu-bg, rgba(0,0,0,0.35));
      box-shadow: var(--interface-panel-drop-shadow, 0 4px 14px rgba(0,0,0,0.35));
      backdrop-filter: blur(6px);
    }

    #spirit-vram-topbar.spirit-floating {
      position: fixed;
      z-index: 99999;
    }

    #spirit-vram-topbar .spirit-vram-btn {
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.06);
      cursor: pointer;
      font-size: 12px;
      line-height: 18px;
      transition: background 120ms ease, border-color 120ms ease, transform 60ms ease, color 120ms ease;
    }

    /* Requested cosmetics */
    #spirit-vram-topbar .spirit-vram-btn:hover {
      background: #64b5f6;
      border-color: #64b5f6;
      color: #0b1a24;
    }

    #spirit-vram-topbar .spirit-vram-btn:active {
      background: #42a5f5;
      border-color: #42a5f5;
      color: #0b1a24;
      transform: translateY(1px);
    }

    #spirit-vram-topbar .spirit-vram-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    #spirit-vram-topbar .spirit-vram-status {
      font-size: 12px;
      opacity: 0.85;
      padding-left: 6px;
      white-space: nowrap;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* New: restore-available indicator */
    #spirit-vram-topbar .spirit-vram-ind {
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.06);
      opacity: 0.9;
      white-space: nowrap;
    }

    #spirit-vram-topbar .spirit-vram-ind.ready {
      border-color: rgba(100, 181, 246, 0.9);
      background: rgba(100, 181, 246, 0.18);
    }

    #spirit-vram-topbar .spirit-vram-ind.off {
      opacity: 0.65;
    }

    /* handle hidden until hover */
    #spirit-vram-topbar .spirit-vram-handle {
      display: none;
      margin-left: 4px;
      cursor: move;
      opacity: 0.95;
    }

    #spirit-vram-topbar:hover .spirit-vram-handle {
      display: inline-block;
    }

    #spirit-vram-topbar .spirit-vram-divider {
      width: 1px;
      height: 16px;
      background: rgba(255,255,255,0.18);
      margin-left: 4px;
    }

    #spirit-vram-topbar.spirit-dragging {
      cursor: move;
    }
  `;
  document.head.appendChild(style);
}

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos?.x !== "number" || typeof pos?.y !== "number") return null;
    return pos;
  } catch {
    return null;
  }
}

function savePos(pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function clampPos(pos, width, height) {
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - width - pad);
  const maxY = Math.max(pad, window.innerHeight - height - pad);
  return {
    x: Math.min(Math.max(pos.x, pad), maxX),
    y: Math.min(Math.max(pos.y, pad), maxY),
  };
}

function applyPos(el, pos) {
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

async function postJson(path, payload) {
  const res = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = typeof data === "string" ? data : (data?.error || data?.message || res.statusText);
    throw new Error(msg);
  }

  return data;
}

async function getJson(path) {
  const res = await api.fetchApi(path, { method: "GET" });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === "string" ? data : (data?.error || data?.message || res.statusText);
    throw new Error(msg);
  }
  return data;
}

function makeDragHandleSvg() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("spirit-vram-handle");
  svg.setAttribute("title", "Drag");

  const circles = [
    "9 5", "9 12", "9 19",
    "15 5", "15 12", "15 19",
  ];
  for (const c of circles) {
    const [x, y] = c.split(" ").map(Number);
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", `M${x} ${y}m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0`);
    svg.appendChild(p);
  }

  return svg;
}

app.registerExtension({
  name: "spirit.hostd.topbar.vram",
  async setup() {
    ensureStyles();
    if (document.getElementById("spirit-vram-topbar")) return;

    const root = document.createElement("div");
    root.id = "spirit-vram-topbar";
    root.classList.add("spirit-floating");
    root.style.visibility = "hidden";

    const shedBtn = document.createElement("button");
    shedBtn.className = "spirit-vram-btn";
    shedBtn.textContent = "VRAM: SHED";

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "spirit-vram-btn";
    restoreBtn.textContent = "VRAM: RESTORE";

    const statusEl = document.createElement("div");
    statusEl.className = "spirit-vram-status";
    statusEl.textContent = "idle";

    // New indicator pill
    const indEl = document.createElement("div");
    indEl.className = "spirit-vram-ind off";
    indEl.textContent = "restore: ?";

    const divider = document.createElement("div");
    divider.className = "spirit-vram-divider";

    const handleSvg = makeDragHandleSvg();

    root.appendChild(shedBtn);
    root.appendChild(restoreBtn);
    root.appendChild(statusEl);
    root.appendChild(indEl);
    root.appendChild(divider);
    root.appendChild(handleSvg);
    document.body.appendChild(root);

    // Positioning
    let pos = loadPos();
    const place = () => {
      const rect = root.getBoundingClientRect();
      if (!pos) {
        pos = {
          x: window.innerWidth - rect.width - 12,
          y: 10,
        };
      }
      pos = clampPos(pos, rect.width, rect.height);
      applyPos(root, pos);
      root.style.visibility = "visible";
    };

    requestAnimationFrame(place);
    window.addEventListener("resize", () => {
      const rect = root.getBoundingClientRect();
      pos = clampPos(pos, rect.width, rect.height);
      applyPos(root, pos);
      savePos(pos);
    });

    const setStatus = (s) => { statusEl.textContent = s; };
    const setBusy = (busy) => {
      shedBtn.disabled = busy;
      // restoreBtn enabled/disabled is also controlled by restore-availability state,
      // so we only force-disable it while busy:
      if (busy) restoreBtn.disabled = true;
    };

    const setRestoreIndicator = (canRestore, count, sourceLabel) => {
      if (canRestore) {
        indEl.classList.remove("off");
        indEl.classList.add("ready");
        indEl.textContent = `restore: ready${typeof count === "number" ? ` (${count})` : ""}`;
        restoreBtn.disabled = false;
        restoreBtn.title = "Restore containers stopped by shed";
      } else {
        indEl.classList.remove("ready");
        indEl.classList.add("off");
        indEl.textContent = `restore: no`;
        restoreBtn.disabled = true;
        restoreBtn.title = "No shed state to restore";
      }
      if (sourceLabel) indEl.title = `source: ${sourceLabel}`;
    };

    // Poll backend for state file presence
    const refreshRestoreState = async () => {
      try {
        const data = await getJson(STATUS_PATH);
        const can = !!data?.can_restore;
        const cnt = typeof data?.stopped_count === "number" ? data.stopped_count : undefined;
        setRestoreIndicator(can, cnt, "server");
      } catch {
        // If status endpoint isn’t present yet, leave restore enabled (script is safe),
        // but show unknown.
        indEl.classList.remove("ready");
        indEl.classList.add("off");
        indEl.textContent = "restore: ?";
        indEl.title = "source: none (add /spirit/vram/status)";
        restoreBtn.disabled = false;
      }
    };

    // Do an initial check and then keep it fresh
    await refreshRestoreState();
    const statusTimer = window.setInterval(refreshRestoreState, 5000);

    // Actions
    shedBtn.addEventListener("click", async () => {
      setBusy(true);
      setStatus("shedding…");
      try {
        const data = await postJson(SHED_PATH, { wait: true, max_wait_seconds: 30 });
        setStatus(data?.status || "shed done");
      } catch (e) {
        setStatus(`error: ${e?.message || e}`);
      } finally {
        setBusy(false);
        await refreshRestoreState();
      }
    });

    restoreBtn.addEventListener("click", async () => {
      setBusy(true);
      setStatus("restoring…");
      try {
        const data = await postJson(RESTORE_PATH, { wait: true, max_wait_seconds: 30 });
        setStatus(data?.status || "restored");
      } catch (e) {
        setStatus(`error: ${e?.message || e}`);
      } finally {
        setBusy(false);
        await refreshRestoreState();
      }
    });

    // Dragging (handle-only)
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let base = { x: 0, y: 0 };

    const onMove = (ev) => {
      if (!dragging) return;
      dx = ev.clientX - startX;
      dy = ev.clientY - startY;
      root.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;

      root.classList.remove("spirit-dragging");
      root.style.transform = "";

      const rect = root.getBoundingClientRect();
      const newPos = clampPos(
        { x: base.x + dx, y: base.y + dy },
        rect.width,
        rect.height
      );

      pos = newPos;
      applyPos(root, pos);
      savePos(pos);

      dx = 0;
      dy = 0;

      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };

    handleSvg.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();

      const left = parseFloat(root.style.left || "0");
      const top = parseFloat(root.style.top || "0");

      base = { x: Number.isFinite(left) ? left : 0, y: Number.isFinite(top) ? top : 0 };
      startX = ev.clientX;
      startY = ev.clientY;
      dx = 0;
      dy = 0;

      dragging = true;
      root.classList.add("spirit-dragging");
      root.style.zIndex = "100000";
      document.body.style.userSelect = "none";

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    });

    handleSvg.addEventListener("dblclick", () => {
      localStorage.removeItem(POS_KEY);
      pos = null;
      place();
    });

    // If ComfyUI hot-reloads extensions, avoid orphaned intervals
    window.addEventListener("beforeunload", () => {
      window.clearInterval(statusTimer);
    });
  },
});
