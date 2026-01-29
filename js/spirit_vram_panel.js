import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function mkButton(label) {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.width = "100%";
  b.style.padding = "10px";
  b.style.marginBottom = "10px";
  b.style.borderRadius = "8px";
  b.style.border = "1px solid var(--border-color)";
  b.style.background = "var(--comfy-menu-bg)";
  b.style.cursor = "pointer";
  return b;
}

function mkPre() {
  const p = document.createElement("pre");
  p.style.whiteSpace = "pre-wrap";
  p.style.wordBreak = "break-word";
  p.style.fontSize = "12px";
  p.style.padding = "10px";
  p.style.borderRadius = "8px";
  p.style.border = "1px solid var(--border-color)";
  p.style.background = "var(--comfy-input-bg)";
  p.textContent = "Idle";
  return p;
}

async function postJson(path, obj) {
  const res = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj ?? {})
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

app.registerExtension({
  name: "sapph1ros.spirit_vram_panel",
  async setup() {
    app.extensionManager.registerSidebarTab({
      id: "spiritVram",
      icon: "pi pi-bolt",
      title: "VRAM",
      tooltip: "Spirit VRAM tools",
      type: "custom",
      render: (el) => {
        el.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.style.padding = "10px";
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "10px";

        const shedBtn = mkButton("VRAM: SHED");
        const restoreBtn = mkButton("VRAM: RESTORE");
        const out = mkPre();

        shedBtn.onclick = async () => {
          out.textContent = "Running shed…";
          const r = await postJson("/spirit/vram/shed", { args: { protect: "comfyui", high_only: true, quiet: true, wait: true } });
          out.textContent = JSON.stringify(r, null, 2);
        };

        restoreBtn.onclick = async () => {
          out.textContent = "Running restore…";
          const r = await postJson("/spirit/vram/restore", { args: { quiet: true, wait: true } });
          out.textContent = JSON.stringify(r, null, 2);
        };

        wrap.appendChild(shedBtn);
        wrap.appendChild(restoreBtn);
        wrap.appendChild(out);
        el.appendChild(wrap);
      }
    });
  }
});
