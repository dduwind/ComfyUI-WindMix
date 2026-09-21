/* ==========================================================================
 * WindMix — Execution Timer Widget
 *
 * A zero-click timer capsule. It lives on the page from the moment ComfyUI
 * opens (no node required in the workflow) and reads the same GlobalTimer
 * singleton that powers the "Fancy Timer Node" canvas node, so both displays
 * always agree.
 *
 * Interaction model is copied from the native run button (ComfyActionbar.vue):
 *   - the capsule floats over the canvas and can be dragged anywhere
 *   - dragging it near the top bar reveals a dashed "停靠到顶部" drop zone
 *   - releasing over that zone docks it into the top action bar
 *   - dragging it back out returns it to floating
 *   - a movement of less than DRAG_THRESHOLD px counts as a click, not a drag
 *
 * 入口模式不做设置项（用户明确不要）：默认悬浮，拖到顶栏即停靠。
 * ========================================================================== */
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/* ------------------------------------------------------------------ ids */

const STYLE_ID = "windmix-timer-widget-style";
const ID_CHIP = "windmix-timer-widget";
const ID_PANEL = "wm-timer-panel";
const ID_MENU = "wm-timer-menu";
const ID_DROP = "wm-timer-dropzone";

const LS = {
  docked: "windmix_timer_docked",
  pos: "windmix_timer_pos",
  size: "windmix_timer_size",
  history: "windmix_timer_history",
  last: "windmix_timer_last",
};

/* Three tiers. DS-Digital is the face now: a vector 7-segment font whose digits
   advance exactly half an em, so an 8-glyph "mm:ss:cc" readout measures 3.4em.
   The heights are unchanged from the previous revision; only the font sizes move
   (the fractions are back, so each tier gives back a little of the boost it got
   when the readout was 5 glyphs — a longer string at the same point size reads
   just as large without turning the capsule into a banner). */
const SIZES = {
  s: { h: 34, f: 18 },
  m: { h: 44, f: 24 },
  l: { h: 56, f: 30 },
};
const SIZE_LABELS = [["s", "小"], ["m", "中"], ["l", "大"]];

const HISTORY_MAX = 20;
const LIST_VISIBLE = 6;
const ROW_H = 22;
const DRAG_THRESHOLD = 5;
const GAP = 8;

/* --------------------------------------------------------------- storage */

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

/* ----------------------------------------------------------------- state */

const state = {
  docked: lsGet(LS.docked, false),
  pos: lsGet(LS.pos, null), // {x, y} top-left in viewport coords
  size: SIZES[lsGet(LS.size, "m")] ? lsGet(LS.size, "m") : "m",
  history: Array.isArray(lsGet(LS.history, [])) ? lsGet(LS.history, []) : [],
  lastMs: Number(lsGet(LS.last, 0)) || 0,
  panelOpen: false,
};

/* ----------------------------------------------------------------- clock */

/**
 * Thin facade over the run/stop signal. Primary source is the shared
 * GlobalTimer (hooked below); the raw api events are the fallback if the
 * Fancy Timer node module is unavailable.
 */
const Clock = {
  running: false,
  startedAt: 0,

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    startTick();
    render();
  },

  stop() {
    if (!this.running) return;
    const elapsed = Date.now() - this.startedAt;
    this.running = false;
    state.lastMs = elapsed;
    lsSet(LS.last, elapsed);
    pushHistory(elapsed);
    stopTick();
    render();
    if (state.panelOpen) renderPanel();
  },

  elapsed() {
    return this.running ? Date.now() - this.startedAt : state.lastMs;
  },
};

function pushHistory(ms) {
  state.history.unshift({ t: Date.now(), ms });
  if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
  lsSet(LS.history, state.history);
}

function clearHistory() {
  state.history = [];
  lsSet(LS.history, []);
  renderPanel();
}

/* ------------------------------------------------------------ formatting */

/* Two shapes of the same reading.
   `text`  = "mm:ss:cc" — 8 glyphs, what the capsule shows. The centiseconds are
             what make the readout feel alive; without them the capsule looks
             frozen for a full second at a time.
   `short` = "mm:ss" — 5 glyphs, what the history panel shows. A results list
             wants the number big and scannable, and the fraction is noise once
             the run is over.
   `mm`/`ss`/`cc` stay separate so the capsule can lay the halves out as their
   own fixed-width boxes and the colons never shift. */
function fmt(ms) {
  let v = Number(ms);
  if (!Number.isFinite(v) || v < 0) v = 0;
  const p2 = (n) => String(n).padStart(2, "0");
  const mm = p2(Math.floor(v / 60000));
  const ss = p2(Math.floor((v % 60000) / 1000));
  const cc = p2(Math.floor((v % 1000) / 10));
  return { mm, ss, cc, text: `${mm}:${ss}:${cc}`, short: `${mm}:${ss}` };
}

function wallClock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ------------------------------------------------------------------- dom */

let chip = null;
let panel = null;
let menu = null;
let dropZone = null;
let drag = null;
let tickRaf = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function buildChip() {
  const root = el("div");
  root.id = ID_CHIP;
  root.setAttribute("role", "button");
  root.setAttribute("tabindex", "-1");
  root.title = "Execution Timer — 点击查看历史，右键设置，拖动可停靠到顶栏";

  const grip = el("span", "wm-t-grip", "⠿");
  grip.setAttribute("aria-hidden", "true");

  const time = el("span", "wm-t-time");
  const mm = el("span", "wm-t-seg", "--");
  const sep1 = el("span", "wm-t-sep", ":");
  const ss = el("span", "wm-t-seg", "--");
  const sep2 = el("span", "wm-t-sep", ":");
  const cc = el("span", "wm-t-seg wm-t-cc", "--");
  time.append(mm, sep1, ss, sep2, cc);

  const caret = el("span", "wm-t-caret");
  caret.setAttribute("aria-hidden", "true");

  root.append(grip, time, caret);
  root._seg = { mm, ss, cc };
  return root;
}

function applySize() {
  if (!chip) return;
  if (chip.classList.contains("wm-docked")) {
    // Docked sizing is fixed by CSS so the chip matches the top bar height.
    chip.style.removeProperty("--wm-t-h");
    chip.style.removeProperty("--wm-t-f");
    return;
  }
  const s = SIZES[state.size] || SIZES.m;
  chip.style.setProperty("--wm-t-h", `${s.h}px`);
  chip.style.setProperty("--wm-t-f", `${s.f}px`);
}

/* The readout now changes every 10ms, so most frames rewrite all three
   segments — but `textContent` is still only touched when a glyph actually
   differs, which keeps the DOM quiet during the ~99 frames out of 100 where the
   centisecond digit is unchanged. */
function setSeg(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function render() {
  if (!chip) return;
  const has = Clock.running || state.lastMs > 0;
  const t = fmt(Clock.elapsed());
  setSeg(chip._seg.mm, has ? t.mm : "--");
  setSeg(chip._seg.ss, has ? t.ss : "--");
  setSeg(chip._seg.cc, has ? t.cc : "--");
  chip.classList.toggle("wm-running", Clock.running);
  chip.classList.toggle("wm-done", !Clock.running && state.lastMs > 0);
  chip.classList.toggle("wm-empty", !has);
  applySize();
}

function startTick() {
  if (tickRaf !== null) return;
  const loop = () => {
    if (!Clock.running) {
      tickRaf = null;
      return;
    }
    render();
    if (state.panelOpen) renderPanel();
    tickRaf = requestAnimationFrame(loop);
  };
  tickRaf = requestAnimationFrame(loop);
}

function stopTick() {
  if (tickRaf !== null) cancelAnimationFrame(tickRaf);
  tickRaf = null;
}

/* -------------------------------------------------------------- placement */

/** Top-bar mount points, most specific first. */
function findDockTarget() {
  const selectors = [
    '[data-testid="action-bar-buttons"]',
    '[data-testid="action-bar-card"]',
    ".legacy-topbar-container",
  ];
  for (const sel of selectors) {
    const node = document.querySelector(sel);
    if (node) return node;
  }
  return null;
}

function chipSize() {
  const r = chip.getBoundingClientRect();
  return { w: r.width || 130, h: r.height || SIZES[state.size].h };
}

/** True when the point is over empty app space (graph canvas / body). */
function isFreeSpot(x, y) {
  const node = document.elementFromPoint(Math.round(x), Math.round(y));
  if (!node) return true;
  if (node === document.body || node === document.documentElement) return true;
  if (node.tagName === "CANVAS") return true; // the litegraph canvas is "empty"
  if (chip && (node === chip || chip.contains(node))) return true;
  return false;
}

/**
 * Bottom-right by preference, but nudged off anything already parked there.
 * ComfyUI's own zoom/minimap button group sits in the exact corner (z-1200),
 * and companion plugins (e.g. comfy-pilot) drop bubbles nearby — landing on
 * top of them would swallow their clicks.
 */
function defaultPos() {
  const { w, h } = chipSize();
  const m = 16;
  const right = Math.round(window.innerWidth - w - m);
  const bottom = Math.round(window.innerHeight - h - m);
  const candidates = [
    { x: right, y: bottom },
    { x: right, y: bottom - 76 }, // above the bottom-right tool cluster
    { x: right, y: bottom - 152 },
    { x: right - 190, y: bottom }, // left of the cluster
  ];
  for (const c of candidates) {
    if (isFreeSpot(c.x + w / 2, c.y + h / 2)) return c;
  }
  return candidates[1];
}

function clampPos(p) {
  const { w, h } = chipSize();
  return {
    x: Math.min(Math.max(0, Math.round(p.x)), Math.max(0, window.innerWidth - w)),
    y: Math.min(Math.max(0, Math.round(p.y)), Math.max(0, window.innerHeight - h)),
  };
}

/**
 * Reconciles state.docked with the actual DOM. Safe to call repeatedly — it is
 * also the guard against Vue re-rendering the top bar and dropping our node.
 */
function applyPlacement() {
  if (!chip || drag) return;
  const target = state.docked ? findDockTarget() : null;

  if (target) {
    chip.classList.add("wm-docked");
    chip.classList.remove("wm-floating");
    chip.style.left = "";
    chip.style.top = "";
    if (chip.parentElement !== target) target.appendChild(chip);
  } else {
    // "docked" requested but the top bar is absent (e.g. UseNewMenu=Disabled or
    // a front-end refactor): degrade gracefully to floating, never break.
    chip.classList.remove("wm-docked");
    chip.classList.add("wm-floating");
    if (chip.parentElement !== document.body) document.body.appendChild(chip);
    if (!state.pos) state.pos = defaultPos();
    state.pos = clampPos(state.pos);
    chip.style.left = `${state.pos.x}px`;
    chip.style.top = `${state.pos.y}px`;
  }
  applySize();
  if (state.panelOpen) positionPanel();
}

/* -------------------------------------------------------------- drop zone */

function showDropZone() {
  const target = findDockTarget();
  if (!target) {
    hideDropZone();
    return;
  }
  if (!dropZone) {
    dropZone = el("div", "", "停靠到顶部");
    dropZone.id = ID_DROP;
  }
  if (dropZone.parentElement !== target || target.firstChild !== dropZone) {
    target.insertBefore(dropZone, target.firstChild);
  }
}

function hideDropZone() {
  if (dropZone) dropZone.remove();
}

function dropZoneRect() {
  if (!dropZone || !dropZone.isConnected) showDropZone();
  if (!dropZone || !dropZone.isConnected) return null;
  return dropZone.getBoundingClientRect();
}

function isOverDropZone(x, y) {
  const r = dropZoneRect();
  if (!r) return false;
  return x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10;
}

function updateDropZoneHot(x, y) {
  if (!dropZone) return;
  dropZone.classList.toggle("wm-hot", isOverDropZone(x, y));
}

/* ------------------------------------------------------------------ panel */

function buildPanel() {
  const root = el("div");
  root.id = ID_PANEL;
  root.innerHTML = `
    <div class="wm-p-head">
      <span class="wm-p-title">运行历史</span>
      <button type="button" class="wm-p-clear">清空</button>
    </div>
    <div class="wm-p-stats">
      <div class="wm-p-stat"><span class="wm-p-k">本次</span><span class="wm-p-v wm-v-run" data-k="cur">--:--</span></div>
      <div class="wm-p-stat"><span class="wm-p-k">平均</span><span class="wm-p-v" data-k="avg">--:--</span></div>
      <div class="wm-p-stat"><span class="wm-p-k">最快</span><span class="wm-p-v wm-v-best" data-k="best">--:--</span></div>
    </div>
    <div class="wm-p-list" data-k="list"></div>
    <div class="wm-p-empty" data-k="empty">暂无记录 · 运行一次工作流即可开始统计</div>
  `;
  const q = (k) => root.querySelector(`[data-k="${k}"]`);
  q("list").style.maxHeight = `${LIST_VISIBLE * ROW_H}px`;
  root.querySelector(".wm-p-clear").addEventListener("click", (ev) => {
    ev.stopPropagation();
    clearHistory();
  });
  root._q = q;
  return root;
}

function renderPanel() {
  if (!panel || !state.panelOpen) return;

  const cur = Clock.running ? Clock.elapsed() : state.lastMs;
  panel._q("cur").textContent = Clock.running || state.lastMs > 0 ? fmt(cur).short : "--:--";

  const list = state.history;
  if (list.length) {
    const avg = Math.round(list.reduce((a, b) => a + b.ms, 0) / list.length);
    const best = list.reduce((a, b) => (b.ms < a.ms ? b : a), list[0]);
    panel._q("avg").textContent = fmt(avg).short;
    panel._q("best").textContent = fmt(best.ms).short;
  } else {
    panel._q("avg").textContent = "--:--";
    panel._q("best").textContent = "--:--";
  }

  const box = panel._q("list");
  box.textContent = "";

  if (Clock.running) {
    const row = el("div", "wm-p-row wm-p-row-now");
    row.append(el("span", "wm-p-time", wallClock(Date.now())), el("span", "wm-p-dur", fmt(Clock.elapsed()).short));
    box.appendChild(row);
  }
  list.forEach((item, i) => {
    const row = el("div", `wm-p-row${!Clock.running && i === 0 ? " wm-p-row-now" : ""}`);
    row.append(el("span", "wm-p-time", wallClock(item.t)), el("span", "wm-p-dur", fmt(item.ms).short));
    box.appendChild(row);
  });

  panel._q("empty").style.display = list.length || Clock.running ? "none" : "block";
  box.style.display = list.length || Clock.running ? "block" : "none";
}

function positionPanel() {
  if (!panel || !state.panelOpen || !chip) return;
  const c = chip.getBoundingClientRect();
  const pw = panel.offsetWidth || 272;
  const ph = panel.offsetHeight || 160;
  const docked = chip.classList.contains("wm-docked");

  let left = c.right - pw; // right edges aligned with the chip
  left = Math.min(Math.max(GAP, left), Math.max(GAP, window.innerWidth - pw - GAP));

  let top;
  if (docked) {
    top = c.bottom + GAP; // drop downward from the top bar
    if (top + ph > window.innerHeight - GAP) top = Math.max(GAP, c.top - GAP - ph);
  } else {
    top = c.top - GAP - ph; // float upward from a floating capsule
    if (top < GAP) top = Math.min(Math.max(GAP, window.innerHeight - ph - GAP), c.bottom + GAP);
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function openPanel() {
  if (!panel) panel = buildPanel();
  if (panel.parentElement !== document.body) document.body.appendChild(panel);
  state.panelOpen = true;
  chip.classList.add("wm-open");
  renderPanel();
  positionPanel();
  requestAnimationFrame(positionPanel);
}

function closePanel() {
  if (!state.panelOpen) return;
  state.panelOpen = false;
  chip.classList.remove("wm-open");
  if (panel) panel.remove();
}

function togglePanel() {
  if (state.panelOpen) closePanel();
  else openPanel();
}

/* ------------------------------------------------------------- context menu */

function menuRow(label, onClick) {
  const row = el("div", "wm-m-row", label);
  row.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hideMenu();
    onClick();
  });
  return row;
}

function buildMenu() {
  hideMenu();
  const root = el("div");
  root.id = ID_MENU;

  root.appendChild(el("div", "wm-m-label", "尺寸"));
  const sizes = el("div", "wm-m-sizes");
  SIZE_LABELS.forEach(([key, label]) => {
    const btn = el("button", `wm-m-size${state.size === key ? " wm-on" : ""}`, label);
    btn.type = "button";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.size = key;
      lsSet(LS.size, key);
      applySize();
      if (!chip.classList.contains("wm-docked")) applyPlacement();
      hideMenu();
    });
    sizes.appendChild(btn);
  });
  root.appendChild(sizes);
  root.appendChild(el("div", "wm-m-sep"));

  if (state.docked) {
    root.appendChild(
      menuRow("取消停靠", () => {
        state.docked = false;
        lsSet(LS.docked, false);
        applyPlacement();
      })
    );
  } else {
    root.appendChild(
      menuRow("复位位置", () => {
        state.pos = defaultPos();
        lsSet(LS.pos, state.pos);
        applyPlacement();
      })
    );
  }
  root.appendChild(menuRow("清空历史", clearHistory));

  menu = root;
  return root;
}

function showMenuAt(x, y) {
  const root = buildMenu();
  document.body.appendChild(root);
  const w = root.offsetWidth || 152;
  const h = root.offsetHeight || 160;
  // Flip at the screen edges like a native context menu. The capsule defaults
  // to the bottom-right, where ComfyUI's tool cluster and companion widgets
  // (comfy-pilot sits at z-9999) live — a clamped menu would land underneath
  // them, a flipped one always lands on open canvas.
  let left = x;
  if (left + w > window.innerWidth - GAP) left = x - w;
  let top = y;
  if (top + h > window.innerHeight - GAP) top = y - h;
  left = Math.min(Math.max(GAP, left), Math.max(GAP, window.innerWidth - w - GAP));
  top = Math.min(Math.max(GAP, top), Math.max(GAP, window.innerHeight - h - GAP));
  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
}

function hideMenu() {
  if (menu) menu.remove();
  menu = null;
}

/* ------------------------------------------------------------------- drag */

function onPointerDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const rect = chip.getBoundingClientRect();
  drag = {
    pointerId: e.pointerId,
    sx: e.clientX,
    sy: e.clientY,
    offX: e.clientX - rect.left,
    offY: e.clientY - rect.top,
    moved: false,
  };
  try {
    chip.setPointerCapture(e.pointerId);
  } catch {
    /* capture is best-effort */
  }
  chip.addEventListener("pointermove", onPointerMove);
  chip.addEventListener("pointerup", onPointerUp);
  chip.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const nx = e.clientX - drag.offX;
  const ny = e.clientY - drag.offY;

  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    chip.classList.add("wm-dragging");
    closePanel();
    hideMenu();
    if (state.docked) {
      // Undock the instant a real drag starts — same rule as the run button.
      state.docked = false;
      lsSet(LS.docked, false);
      state.pos = { x: nx, y: ny };
      applyPlacementForce();
      try {
        chip.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    showDropZone();
  }

  chip.style.left = `${nx}px`;
  chip.style.top = `${ny}px`;
  state.pos = { x: nx, y: ny };
  updateDropZoneHot(e.clientX, e.clientY);
}

/** applyPlacement() bails out while a drag is active; this bypasses the guard. */
function applyPlacementForce() {
  const keep = drag;
  drag = null;
  applyPlacement();
  drag = keep;
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;

  chip.removeEventListener("pointermove", onPointerMove);
  chip.removeEventListener("pointerup", onPointerUp);
  chip.removeEventListener("pointercancel", onPointerUp);
  try {
    chip.releasePointerCapture(e.pointerId);
  } catch {
    /* noop */
  }
  chip.classList.remove("wm-dragging");

  if (!d.moved) {
    togglePanel();
    return;
  }

  const dock = isOverDropZone(e.clientX, e.clientY);
  hideDropZone();

  if (dock) {
    state.docked = true;
    lsSet(LS.docked, true);
    state.pos = clampPos({ x: e.clientX - d.offX, y: e.clientY - d.offY });
    lsSet(LS.pos, state.pos);
  } else {
    state.pos = clampPos({ x: e.clientX - d.offX, y: e.clientY - d.offY });
    lsSet(LS.pos, state.pos);
  }
  applyPlacement();
}

function onContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  closePanel();
  showMenuAt(e.clientX, e.clientY);
}

/* --------------------------------------------------------- global wiring */

function bindGlobal() {
  // Capture phase: runs before inner handlers, so a click inside the chip /
  // panel / menu never accidentally dismisses them.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target;
      if (chip && t instanceof Node && chip.contains(t)) return;
      if (panel && t instanceof Node && panel.contains(t)) return;
      if (menu && t instanceof Node && menu.contains(t)) return;
      closePanel();
      hideMenu();
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePanel();
      hideMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (state.panelOpen) positionPanel();
    else applyPlacement();
  });

  window.addEventListener(
    "scroll",
    () => {
      if (state.panelOpen) positionPanel();
      else if (menu) hideMenu();
    },
    true
  );
}

/**
 * Drive Clock from the shared GlobalTimer. Falls back to raw api events when
 * the Fancy Timer node module is missing, so the capsule always works.
 */
function hookTimer() {
  const shared = window.__wmFancyTimer;
  if (shared && shared.GlobalTimer) {
    const GT = shared.GlobalTimer;
    const origStart = GT.start;
    const origStop = GT.stop;

    GT.start = function (...args) {
      const ret = origStart.apply(GT, args);
      Clock.start();
      return ret;
    };
    GT.stop = function (...args) {
      const wasRunning = GT.isRunning;
      const ret = origStop.apply(GT, args);
      if (wasRunning) Clock.stop();
      return ret;
    };

    if (GT.isRunning) Clock.start();
    return true;
  }

  api.addEventListener("execution_start", () => Clock.start());
  api.addEventListener("executing", ({ detail }) => {
    if (detail === null || detail === undefined) Clock.stop();
  });
  api.addEventListener("execution_error", () => Clock.stop());
  api.addEventListener("execution_interrupted", () => Clock.stop());
  return false;
}

/* ---------------------------------------------------------------- styles */

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
/* ---------- capsule shell ---------- */
#${ID_CHIP} {
  --wm-t-h: 44px;
  --wm-t-f: 24px;

  position: fixed;
  z-index: 1300;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 3px;
  height: var(--wm-t-h);
  padding: 0 10px;
  border-radius: calc(var(--wm-t-h) * .28);
  /* DS-Digital Bold is the only weight the family ships — never ask for bold
     here, the browser would fake-embolden it and close up the segment gaps. */
  font-family: "DS-Digital", "Courier New", Consolas, Monaco, monospace;
  font-size: var(--wm-t-f);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
  cursor: grab;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  transition: color .5s ease-in-out, background-color .3s ease, border-color .3s ease;
}

#${ID_CHIP}.wm-floating {
  background: #000000;
  border: 1px solid rgba(255, 255, 255, .12);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
}

#${ID_CHIP}.wm-docked {
  position: static;
  /* 36px is exactly the height of the actionbar row this button lives in
     (measured on the real page): the row is 36px, the third-party button strip
     28px, the run button 32px, the Manager cluster 36px. So the chip is as tall
     as the tallest native control and still fits without stretching the bar.
     The font then gets the room to be a genuine readout rather than a label. */
  height: 36px;
  font-size: 25px;
  padding: 0 9px;
  margin: 0;
  border-radius: 8px;
  cursor: default;
  /* Dark plate, same body as the floating capsule, with a violet outline
     instead of the old green one.
     ⚠️ The body is dark in BOTH themes, so the readout colours are one set for
     every theme and the separate html.dark-theme override block is gone. The
     old light-theme set is unusable here: its dim was rgba(0,0,0,.32) — pure
     black at 32%, invisible on a dark plate.
     ⚠️ OPAQUE, and that is load-bearing, not taste. This used to be
     rgba(10,10,14,.82), which measured rgb(54,54,57) once composited over the
     light top bar — 18% of the bar bled through. On that washed plate the
     node's violet #7300ff scored 1.82:1, i.e. barely visible, while the pale
     #a78bfa it replaced scored 4.43:1: the saturated violet the brief asked for
     was the WEAKER of the two. Solid #000 puts the readout on the same backdrop
     as the canvas timer node and lifts #7300ff to 3.17:1 — exactly the node's
     own figure. A translucent plate cannot carry a saturated violet. */
  background: #000000;
  border: 1px solid rgba(167, 139, 250, .50);
}

#${ID_CHIP}.wm-dragging {
  cursor: grabbing;
  transition: none;
}
#${ID_CHIP}.wm-dragging .wm-t-grip { width: 10px; opacity: .55; }

/* ---------- time readout ---------- */
/* Flat colour. No neon, no rim, no fog.
   An earlier revision built a full 7-layer neon tube here — a pure-white
   1px/3px rim riding the glyph outline plus coloured fog bleeding outward — and
   its physics was right: a white rim only reads when the fill underneath is
   pulled well below white (rim-to-fill luminance gap >= 0.4). It looked correct
   at 30px. But the readout spends nearly all of its life at the 25px docked
   size, and at 25px a 1px rim simply cannot resolve — it reads as extra blur
   rather than as light, which is the opposite of the intent.
   Rather than inflate the docked font size just to carry the effect, the effect
   is gone. Flat colour is crisp at every size and costs nothing to maintain.
   ⚠️ Keep the readout shadow-free. If a glow is ever wanted back, the docked
   font size has to come up FIRST — a 1px rim cannot survive at 25px. */
#${ID_CHIP} .wm-t-time {
  display: flex;
  align-items: baseline;
  /* Idle: neutral grey-green. With the glow gone this only has to be legible on
     the dark plate, so it returns to #a8b4ac — the value the neon revision had
     to darken solely to keep "off" quieter than "lit". */
  color: #a8b4ac;
  transition: color .5s ease-in-out;
}
/* Finished: pale violet.
   We did try the canvas node's saturated #7300ff verbatim. On the solid black
   plate it measures 3.17:1, which technically clears the large-text threshold,
   but it still reads as "dim" rather than "lit" — a saturated violet has a
   relative luminance of only 0.11, so on black it sinks instead of glowing.
   Luminance, not hue, is what the eye judges here. #a78bfa sits at 0.34 and
   scores 7.72:1 on the same plate. The node keeps #7300ff because it is 64px
   with its own solid backdrop; this readout lives at 25px, where it needs the
   extra lift.
   ⚠️ The plate stays solid #000 either way — that was the real fix; see the
   note on .wm-docked. */
#${ID_CHIP}.wm-done .wm-t-time { color: #a78bfa; }
/* Running: green. No pulse — at 25px a colour breath is decoration rather than
   information, and the centiseconds already supply all the motion the eye
   needs. */
#${ID_CHIP}.wm-running .wm-t-time { color: #4ade80; }
/* min-width (not width) so a font whose digit advance exceeds its "0" advance
   can never clip the last glyph; the reserved box keeps the colons from
   jittering. */
#${ID_CHIP} .wm-t-seg { display: inline-block; min-width: 2ch; text-align: center; }
#${ID_CHIP} .wm-t-sep { display: inline-block; width: .5ch; text-align: center; opacity: .5; }
/* Centiseconds: dimmed a little so the eye lands on the seconds first. Same
   point size as the other segments — the fraction is what makes the readout
   feel alive, so it should not be shrunk into illegibility. */
#${ID_CHIP} .wm-t-cc { opacity: .82; }

/* ---------- hover affordances ---------- */
#${ID_CHIP} .wm-t-grip,
#${ID_CHIP} .wm-t-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0;
  opacity: 0;
  overflow: hidden;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-weight: normal;
  white-space: nowrap;
  transition: width .18s ease, opacity .18s ease, transform .18s ease;
}
#${ID_CHIP} .wm-t-caret { font-size: .72em; }
#${ID_CHIP} .wm-t-caret::before { content: "▴"; }
#${ID_CHIP}.wm-docked .wm-t-caret::before { content: "▾"; }
#${ID_CHIP}:hover .wm-t-grip  { width: 10px; opacity: .55; }
#${ID_CHIP}:hover .wm-t-caret { width: 10px; opacity: .7; }
#${ID_CHIP}.wm-open .wm-t-caret { transform: rotate(180deg); }

/* ---------- history panel ---------- */
#${ID_PANEL} {
  position: fixed;
  z-index: 1400;
  box-sizing: border-box;
  width: 272px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(12, 12, 16, .94);
  border: 1px solid rgba(255, 255, 255, .10);
  box-shadow: 0 12px 36px rgba(0, 0, 0, .45);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #e8e8ee;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  user-select: none;
  -webkit-user-select: none;
}
#${ID_PANEL} .wm-p-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
#${ID_PANEL} .wm-p-title { font-size: 12px; font-weight: 600; letter-spacing: .3px; }
#${ID_PANEL} .wm-p-clear {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, .48);
  font: inherit;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
}
#${ID_PANEL} .wm-p-clear:hover { background: rgba(255, 255, 255, .10); color: #fff; }
#${ID_PANEL} .wm-p-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  margin-bottom: 10px;
}
/* Narrow side padding buys the readout its extra pixels; the taller top and
   bottom padding is what makes the cells feel like proper tiles. */
#${ID_PANEL} .wm-p-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 4px;
  border-radius: 10px;
  background: rgba(255, 255, 255, .05);
  text-align: center;
}
#${ID_PANEL} .wm-p-k { font-size: 11px; color: rgba(255, 255, 255, .45); }
#${ID_PANEL} .wm-p-v {
  /* DS-Digital at 30px occupies less width than the previous 24px of the old
     face (its digits are 0.5em, the old font's ~0.6em), so shrinking the string
     to 5 glyphs buys a 25% larger numeral inside the same 79px cell. */
  font-family: "DS-Digital", "Courier New", Consolas, Monaco, monospace;
  font-size: 30px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #e8e8ee;
  white-space: nowrap;
}
#${ID_PANEL} .wm-p-v.wm-v-run  { color: #4ade80; }
#${ID_PANEL} .wm-p-v.wm-v-best { color: #a78bfa; }
#${ID_PANEL} .wm-p-list { overflow-y: auto; overscroll-behavior: contain; }
#${ID_PANEL} .wm-p-list::-webkit-scrollbar { width: 6px; }
#${ID_PANEL} .wm-p-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, .16);
  border-radius: 3px;
}
#${ID_PANEL} .wm-p-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: ${ROW_H}px;
  padding: 0 8px;
  border-radius: 6px;
  border-left: 2px solid transparent;
}
#${ID_PANEL} .wm-p-row:hover { background: rgba(255, 255, 255, .06); }
#${ID_PANEL} .wm-p-row-now {
  border-left-color: #4ade80;
  background: rgba(74, 222, 128, .08);
}
#${ID_PANEL} .wm-p-time { color: rgba(255, 255, 255, .45); font-size: 11px; }
#${ID_PANEL} .wm-p-dur {
  font-family: "DS-Digital", "Courier New", Consolas, Monaco, monospace;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: #e8e8ee;
}
#${ID_PANEL} .wm-p-row-now .wm-p-dur { color: #4ade80; }
#${ID_PANEL} .wm-p-empty {
  padding: 14px 4px;
  text-align: center;
  color: rgba(255, 255, 255, .34);
  font-size: 11px;
  line-height: 1.6;
}

/* ---------- context menu ---------- */
#${ID_MENU} {
  position: fixed;
  z-index: 1500;
  min-width: 152px;
  padding: 5px;
  border-radius: 10px;
  background: rgba(12, 12, 16, .96);
  border: 1px solid rgba(255, 255, 255, .12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #e8e8ee;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  user-select: none;
  -webkit-user-select: none;
}
#${ID_MENU} .wm-m-label {
  padding: 5px 8px 3px;
  color: rgba(255, 255, 255, .40);
  font-size: 10px;
  letter-spacing: .4px;
}
#${ID_MENU} .wm-m-sizes { display: flex; gap: 4px; padding: 0 5px 4px; }
#${ID_MENU} .wm-m-size {
  flex: 1;
  height: 24px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, .14);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
#${ID_MENU} .wm-m-size:hover { background: rgba(255, 255, 255, .10); }
#${ID_MENU} .wm-m-size.wm-on {
  background: rgba(167, 139, 250, .22);
  border-color: rgba(167, 139, 250, .60);
  color: #c4b5fd;
}
#${ID_MENU} .wm-m-sep {
  height: 1px;
  margin: 4px 6px;
  background: rgba(255, 255, 255, .10);
}
#${ID_MENU} .wm-m-row {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
#${ID_MENU} .wm-m-row:hover { background: rgba(255, 255, 255, .10); }

/* ---------- drop zone ---------- */
#${ID_DROP} {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104px;
  height: 26px;
  margin: 0 4px;
  border: 2px dashed #3b82f6;
  border-radius: 7px;
  background: rgba(59, 130, 246, .10);
  color: #60a5fa;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
  transition: transform .12s ease, background-color .12s ease, box-shadow .12s ease;
}
#${ID_DROP}.wm-hot {
  transform: scale(1.06);
  background: rgba(59, 130, 246, .24);
  box-shadow: 0 0 16px rgba(59, 130, 246, .55);
}
`;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------- extension */

app.registerExtension({
  name: "WindMix.TimerWidget",
  async setup() {
    if (document.getElementById(ID_CHIP)) return; // already mounted

    ensureStyle();
    const shared = window.__wmFancyTimer;
    if (shared && shared.ensureFont) {
      shared.ensureFont(); // shares the in-flight promise with the node module
    }

    chip = buildChip();
    document.body.appendChild(chip);
    chip.addEventListener("pointerdown", onPointerDown);
    chip.addEventListener("contextmenu", onContextMenu);

    applyPlacement();
    render();
    bindGlobal();
    hookTimer();

    // Vue re-renders the top bar regularly; re-attach if our node was dropped
    // or the bar itself was swapped out. Skipped while dragging.
    setInterval(() => {
      if (drag) return;
      applyPlacement();
    }, 700);
  },
});
