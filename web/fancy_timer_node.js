import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// WindMix-internal IDs. No longer reference the upstream CRT plugin's namespace.
const STYLE_ID = "fancy-timer-style";
const FONT_ID = "fancy-timer-font";
let eventsBound = false;

// ComfyUI serves the plugin's web/ directory at /extensions/ComfyUI-WindMix/,
// but NOT the top-level Font/ folder. We instead fetch the font from the
// /windmix/font/<file> route exposed by Fancy_Timer_Node.py (which reads
// <plugin>/Font/<file>) and embed it via @font-face as a data: URL.
//
// The loader is shared (see window.__wmFancyTimer.ensureFont) so other WindMix
// front-end modules — e.g. web/windmix_timer_widget.js — can guarantee the font
// without racing this module's own setup().
let _fontPromise = null;

// DS-Digital Bold: a vector 7-segment face — crisp at any size, unlike the
// pixel-based font it replaces. The file is already bold, so every rule that
// uses it must NOT ask for font-weight: bold, or the browser synthesises a
// second helping of weight and the strokes smear.
const FONT_FILE = "DS-Digital-Bold.ttf";
const FONT_FAMILY = "DS-Digital";

async function _loadFontAsDataURL(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        // base64-encode in chunks to avoid call-stack limits
        const bytes = new Uint8Array(buf);
        let bin = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return "data:font/ttf;base64," + btoa(bin);
    } catch (e) {
        console.warn("[WindMix fancy-timer] font load failed:", e);
        return null;
    }
}

// --- The Global Timer Manager ---
const GlobalTimer = {
    startTime: 0,
    intervalId: null,
    isRunning: false,
    activeNodes: new Set(),

    // mm:ss:cc — 8 glyphs. Two fractional digits (centiseconds) keep the
    // readout visibly ticking, which is the whole point of the node; a third
    // digit is unreadable at any refresh rate and only widens the string.
    // Both this node and web/windmix_timer_widget.js render this same format.
    formatTime(ms) {
        if (ms < 0) ms = 0;
        const minutes     = String(Math.floor(ms / 60000)).padStart(2, '0');
        const seconds     = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
        const centiseconds = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
        return {
            str: `${minutes}:${seconds}:${centiseconds}`,
            minutes,
            seconds,
            centiseconds,
        };
    },

    setDisplay(node, time) {
        if (!node.timerDisplay) return;
        if (node._segMin) {
            node._segMin.textContent = time.minutes;
            node._segSec.textContent = time.seconds;
            node._segMs.textContent  = time.centiseconds;
        } else {
            node.timerDisplay.textContent = time.str;
        }
    },

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startTime = Date.now();

        this.activeNodes.forEach(node => {
            if (node.timerDisplay) node.timerDisplay.classList.add('fancy-timer-running');
        });

        this.intervalId = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            const time = this.formatTime(elapsed);
            this.activeNodes.forEach(node => this.setDisplay(node, time));
        }, 33);
    },

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        clearInterval(this.intervalId);

        const finalTime = this.formatTime(Date.now() - this.startTime);

        this.activeNodes.forEach(node => {
            if (node.timerDisplay) {
                this.setDisplay(node, finalTime);
                node.timerDisplay.classList.remove('fancy-timer-running');
            }
            node.properties.elapsed_time_str = finalTime.str;
        });
    },

    registerNode(node) { this.activeNodes.add(node); },
    unregisterNode(node) { this.activeNodes.delete(node); },
};

// Inject the @font-face for "DS-Digital" by base64-embedding the .ttf served
// from our /windmix/font/ route (single reliable source). Idempotent and
// concurrency-safe: repeated callers share the same in-flight promise.
function ensureFancyTimerFont() {
    if (_fontPromise) return _fontPromise;
    _fontPromise = (async () => {
        if (document.getElementById(FONT_ID)) return true;
        const candidates = [
            "/windmix/font/" + encodeURIComponent(FONT_FILE),
        ];
        let dataUrl = null;
        for (const url of candidates) {
            dataUrl = await _loadFontAsDataURL(url);
            if (dataUrl) break;
        }
        if (!dataUrl) {
            console.warn(`[WindMix fancy-timer] could not load ${FONT_FILE}; falling back to system monospace`);
            return false;
        }
        const fontStyle = document.createElement("style");
        fontStyle.id = FONT_ID;
        fontStyle.innerText = `
            @font-face {
                font-family: "${FONT_FAMILY}";
                src: url("${dataUrl}") format("truetype");
                font-weight: normal;
                font-style: normal;
            }
        `;
        document.head.appendChild(fontStyle);
        return true;
    })();
    return _fontPromise;
}

// Shared surface for other WindMix front-end modules. Assigned at module-eval
// time so consumers that run later (e.g. another extension's setup()) see it.
window.__wmFancyTimer = {
    GlobalTimer,
    formatTime: (ms) => GlobalTimer.formatTime(ms),
    ensureFont: ensureFancyTimerFont,
};

// --- ComfyUI Extension Definition ---
const FancyTimerNodeExtension = {
    name: "WindMix.FancyTimerNode",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "FancyTimerNode") {
            const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
            const originalOnRemoved = nodeType.prototype.onRemoved;
            const originalOnSerialize = nodeType.prototype.onSerialize;
            const originalOnConfigure = nodeType.prototype.onConfigure;

            nodeType.prototype.onNodeCreated = function () {
                originalOnNodeCreated?.apply(this, arguments);
                this.bgcolor = "#000000";
                this.color = "#000000";
                this.title = "Execution Timer";
                this.properties = this.properties || {};
                this.size = [420, 130];

                // Black body, painted by us. Reason: the Vue renderer (Nodes 2.0)
                // ignores node.bgcolor, so the node body stayed transparent and
                // the light canvas grey showed through — purple #7300ff landed at
                // only ~2.2:1 contrast, below the 3:1 large-text floor. The
                // display container coincides exactly with the widget rect
                // (verified in the live front-end), so filling it black restores
                // the intended instrument-panel look. Corners stay square: the
                // real node body has a 0px radius, so rounding here would only
                // punch grey notches into the bottom edge.
                const container = document.createElement("div");
                container.style.cssText = `width: 100%; height: 100%; position: relative; background: #000000; --text-color: #7300ff;`;

                this.timerDisplay = document.createElement("div");
                this.timerDisplay.className = "fancy-timer-display";

                // Fixed-width segments so colons never shift
                this._segMin   = document.createElement("span");
                this._segMin.className = "fancy-timer-seg";
                const _col1    = document.createElement("span");
                _col1.className = "fancy-timer-sep";
                _col1.textContent = ":";
                this._segSec   = document.createElement("span");
                this._segSec.className = "fancy-timer-seg";
                const _col2    = document.createElement("span");
                _col2.className = "fancy-timer-sep";
                _col2.textContent = ":";
                this._segMs    = document.createElement("span");
                this._segMs.className = "fancy-timer-seg fancy-timer-seg-ms";
                this.timerDisplay.append(this._segMin, _col1, this._segSec, _col2, this._segMs);

                const saved = (this.properties.elapsed_time_str || "00:00:00").split(":");
                this._segMin.textContent = saved[0] || "00";
                this._segSec.textContent = saved[1] || "00";
                this._segMs.textContent  = saved[2] || "00";

                container.appendChild(this.timerDisplay);
                this.addDOMWidget("fancyTimer", "Fancy Timer", container, { serialize: false });

                GlobalTimer.registerNode(this);
            };

            nodeType.prototype.onRemoved = function() {
                GlobalTimer.unregisterNode(this);
                this.timerDisplay = null;
                originalOnRemoved?.apply(this, arguments);
            };
            nodeType.prototype.onSerialize = function(o) {
                originalOnSerialize?.apply(this, arguments);
                o.properties = this.properties;
            };
            nodeType.prototype.onConfigure = function(info) {
                originalOnConfigure?.apply(this, arguments);
                this.properties = info.properties || {};
                if (this._segMin) {
                    const parts = (this.properties.elapsed_time_str || "00:00:00").split(":");
                    this._segMin.textContent = parts[0] || "00";
                    this._segSec.textContent = parts[1] || "00";
                    this._segMs.textContent  = parts[2] || "00";
                }
            };
        }
    },

    async setup() {
        // Shared, idempotent font bootstrap (windmix_timer_widget.js uses the
        // same promise, so the two extensions never duplicate @font-face rules).
        await ensureFancyTimerFont();

        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement("style");
            style.id = STYLE_ID;
            // Color-only effects: a gentle green "glow-pulse" while running,
            // default purple when stopped. No text-shadow (per request).
            // DS-Digital Bold is a single-weight face, so no font-weight: bold
            // anywhere — requesting it would make the browser fake-embolden the
            // glyphs and erode the segment gaps that make the face readable.
            style.innerText = `
                .fancy-timer-display {
                    text-align: center; width: 100%; height: 100%; position: absolute;
                    top: 0; left: 0; background: transparent; border: none;
                    color: var(--text-color);
                    font-family: "${FONT_FAMILY}", 'Courier New', 'Consolas', 'Monaco', monospace;
                    box-sizing: border-box; outline: none; margin: 0;
                    overflow: hidden; display: flex; justify-content: center;
                    align-items: center; font-size: 64px;
                    transition: color 0.5s ease-in-out;
                    font-variant-numeric: tabular-nums;
                    letter-spacing: 0;
                    white-space: nowrap;
                }
                /* Pulsing green glow while the timer is running (no shadow). */
                .fancy-timer-display.fancy-timer-running {
                    animation: fancy-text-glow-pulse 1.3s ease-in-out infinite;
                }
                @keyframes fancy-text-glow-pulse {
                    0%, 100% { color: #8dff9e; }
                    50%      { color: #3df05f; }
                }
                .fancy-timer-seg {
                    display: inline-block;
                    width: 2ch;
                    text-align: center;
                }
                /* Centiseconds: same 2-digit reservation as the other segments.
                   Was 3ch back when the node carried milliseconds. */
                .fancy-timer-seg-ms {
                    width: 2ch;
                    opacity: 0.85;
                }
                .fancy-timer-sep {
                    display: inline-block;
                    width: 0.5ch;
                    text-align: center;
                    opacity: 0.5;
                }
            `;
            document.head.appendChild(style);
        }

        if (eventsBound) return;
        eventsBound = true;

        api.addEventListener("execution_start", () => GlobalTimer.start());
        api.addEventListener("executing", ({ detail }) => {
            if (detail === null) GlobalTimer.stop();
        });
        api.addEventListener("execution_error", () => GlobalTimer.stop());
        api.addEventListener("execution_interrupted", () => GlobalTimer.stop());
    }
};

app.registerExtension(FancyTimerNodeExtension);
