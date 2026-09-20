import { app } from "../../scripts/app.js";

// WindMix - 分辨率 (Resolution)
// 搬运自 ComfyUI-TJ_NODE 的 TJ_Resolution；去除 auto_set / 底部预览图 / TJ 标识。
// UI 灰阶配色跟随 ComfyUI 系统主题变量；仅控件选中态保留 WindMix 紫（#534AB7）。

const NODE_CLASS = "WindMix_Resolution";

const ACCENT      = "#534AB7";
const ACCENT_TEXT = "#9b8af5";
const ACCENT_SOFT = "rgba(83, 74, 183, 0.28)";

const PRESETS = [
    { label: "1:1",  w: 1, h: 1 },
    { label: "16:9", w: 16, h: 9 },
    { label: "9:16", w: 9, h: 16 },
    { label: "2:1",  w: 2, h: 1 },
    { label: "3:2",  w: 3, h: 2 },
    { label: "2:3",  w: 2, h: 3 },
    { label: "4:3",  w: 4, h: 3 },
    { label: "3:4",  w: 3, h: 4 },
    { label: "4:5",  w: 4, h: 5 },
];
const BASES = [512, 768, 1024, 1536];
// 比例别代表分率列表 — LTX-2 / Z-Image / Klein / Flux / Krea2 等
const RATIO_SIZES = {
    "1:1":  [[512,512],[768,768],[1024,1024],[1280,1280],[1328,1328],[1408,1408],[1536,1536],[2048,2048]],
    "16:9": [[832,464],[1280,720],[1344,752],[1536,864],[1600,896],[1664,928],[1792,1008],[1920,1088]],
    "2:1":  [[512,256],[1024,512],[1280,640],[1536,768],[1600,800],[1792,896],[1920,960],[2048,1024]],
    "3:2":  [[1024,688],[1216,816],[1248,832],[1344,896],[1536,1024],[1584,1056],[1728,1152],[1920,1280]],
    "4:3":  [[1024,768],[1152,864],[1280,960],[1408,1056],[1472,1104],[1600,1200],[1920,1440],[2048,1536]],
    "4:5":  [[640,800],[768,960],[832,1040],[1024,1280],[1152,1440],[1280,1600],[1440,1800],[1536,1920]],
};
// 纵向比例 = 横向的转置
const SIZE_TRANSPOSE = { "9:16": "16:9", "2:3": "3:2", "3:4": "4:3" };

const SNAPS = [8, 16, 32, 64];

const gcd = (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) { [a, b] = [b, a % b]; } return a || 1; };
const snapTo = (v, m) => Math.max(m, Math.round(v / m) * m);
// 获取比例对应的代表分辨率列表
const sizesFor = (rw, rh) => {
    const key = `${rw}:${rh}`;
    if (RATIO_SIZES[key]) return RATIO_SIZES[key].map(([w, h]) => ({ w, h }));
    const t = SIZE_TRANSPOSE[key];
    if (t && RATIO_SIZES[t]) return RATIO_SIZES[t].map(([w, h]) => ({ w: h, h: w }));
    return [];
};

const css = (el, s) => { el.style.cssText = s; return el; };
const mkDiv = (s = "") => css(document.createElement("div"), s);
const mkSpan = (t, s = "") => { const e = css(document.createElement("span"), s); e.textContent = t; return e; };

const BTN_BASE = `
    display:flex;align-items:center;justify-content:center;gap:6px;
    padding:7px 8px;font-size:12px;cursor:pointer;
    background:var(--component-node-widget-background, #f0f0f0);
    color:var(--node-component-widget-input, #000);
    border:1px solid var(--node-component-border, #ccc);border-radius:6px;
    font-family:inherit;transition:background .12s,border-color .12s;
`;

function mkBtn(txt, fn, extra = "") {
    const b = css(document.createElement("button"), BTN_BASE + extra);
    b.textContent = txt;
    b.onclick = fn;
    return b;
}
function setActive(btn, on) {
    if (!btn) return;
    btn.style.background = on ? ACCENT : "var(--component-node-widget-background, #f0f0f0)";
    btn.style.borderColor = on ? ACCENT : "var(--node-component-border, #ccc)";
    btn.style.color = on ? "#fff" : "var(--node-component-widget-input, #000)";
    btn.style.fontWeight = on ? "600" : "400";
}
function mkNumInput(val, onChange) {
    const i = css(document.createElement("input"), `
        width:100%;box-sizing:border-box;text-align:center;
        background:var(--component-node-widget-background, #f0f0f0);
        color:var(--node-component-widget-input, #000);
        border:1px solid var(--node-component-border, #ccc);border-radius:6px;
        padding:8px 4px;font-size:15px;font-weight:700;font-family:inherit;
    `);
    i.type = "number";
    i.value = String(val);
    i.oninput = () => onChange(i.value);
    return i;
}
// 比例预览用的小图形图标
function mkShape(rw, rh) {
    const box = 18;
    let w = box, h = box;
    if (rw >= rh) h = Math.max(6, Math.round(box * rh / rw));
    else w = Math.max(6, Math.round(box * rw / rh));
    const wrap = mkDiv(`width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`);
    wrap.appendChild(mkDiv(`width:${w}px;height:${h}px;background:var(--text-secondary, #888);border-radius:2px;`));
    return wrap;
}

app.registerExtension({
    name: "WindMix.Resolution",

    async nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;

        const get = (n) => node.widgets?.find((w) => w.name === n);
        const wW = get("width"), wH = get("height");
        if (!wW || !wH) return;
        // 原始 widget 隐藏，用 DOM UI 替代
        for (const w of [wW, wH]) {
            w.type = "hidden";
            w.hidden = true;
            w.computeSize = () => [0, -4];
        }

        // ── 状态 ──
        const st = {
            mode: "preset",         // "preset" | "ratio" | "res"
            rw: 1, rh: 1,
            base: 1024,
            snap: 16,
            w: Number(wW.value) || 1024,
            h: Number(wH.value) || 1024,
        };

        const pushValues = () => {
            wW.value = st.w;
            wH.value = st.h;
            app.graph.setDirtyCanvas(true);
        };

        // ── 容器 ──
        const wrap = mkDiv(`
            padding:10px;background:var(--node-component-surface, #fff);border-radius:8px;
            font-family:'Segoe UI',sans-serif;color:var(--node-component-widget-input, #000);
            width:100%;box-sizing:border-box;
        `);

        // 1) 比例预设 3x3 网格
        const grid = mkDiv("display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;");
        wrap.appendChild(grid);
        const presetBtns = PRESETS.map((p) => {
            const b = css(document.createElement("button"), BTN_BASE);
            b.appendChild(mkShape(p.w, p.h));
            b.appendChild(mkSpan(p.label));
            b.onclick = () => {
                st.mode = "preset"; st.rw = p.w; st.rh = p.h;
                pickNearestSize();
                render();
            };
            grid.appendChild(b);
            return b;
        });

        // 2) 模式选择
        const modeRow = mkDiv("display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;");
        wrap.appendChild(modeRow);
        const bModeRatio = mkBtn("自定义比例", () => { st.mode = "ratio"; applyFromBase(); render(); });
        const bModeRes   = mkBtn("自定义分辨率", () => { st.mode = "res"; render(); });
        modeRow.append(bModeRatio, bModeRes);

        // 3) 面板
        const panel = mkDiv("border:1px solid var(--node-component-border, #ccc);border-radius:8px;padding:12px;background:var(--component-node-widget-background, #f0f0f0);");
        wrap.appendChild(panel);

        // 3-0) 比例代表分辨率列表（preset 模式专用）
        const sizeList = mkDiv("display:flex;flex-direction:column;border:1px solid var(--node-component-border, #ccc);border-radius:8px;overflow:hidden;");
        panel.appendChild(sizeList);

        // 3-1) 比例输入行（ratio 模式专用）
        const ratioRow = mkDiv("display:flex;align-items:center;gap:8px;margin-bottom:10px;");
        ratioRow.appendChild(mkSpan("RATIO", "color:var(--text-secondary, #666);font-size:11px;letter-spacing:.08em;flex-shrink:0;"));
        const rwIn = mkNumInput(st.rw, (v) => { st.rw = Math.max(1, parseFloat(v) || 1); applyFromWidth(); render("rw"); });
        const rhIn = mkNumInput(st.rh, (v) => { st.rh = Math.max(1, parseFloat(v) || 1); applyFromHeight(); render("rh"); });
        const swapRatio = mkBtn("⇄", () => {
            [st.rw, st.rh] = [st.rh, st.rw];
            [st.w, st.h] = [st.h, st.w];
            render();
        }, "flex-shrink:0;width:44px;font-size:16px;");
        const rwWrap = mkDiv("flex:1;"); rwWrap.appendChild(rwIn);
        const rhWrap = mkDiv("flex:1;"); rhWrap.appendChild(rhIn);
        ratioRow.append(rwWrap, swapRatio, rhWrap);
        panel.appendChild(ratioRow);

        // 3-2) 基准尺寸按钮（ratio 模式专用）
        const baseRow = mkDiv("display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;");
        panel.appendChild(baseRow);
        const baseBtns = BASES.map((b) => {
            const btn = mkBtn(String(b), () => { st.base = b; applyFromBase(); render(); });
            baseRow.appendChild(btn);
            return btn;
        });

        // 3-3) WIDTH / HEIGHT
        const whLabels = mkDiv("display:flex;gap:8px;margin-bottom:4px;");
        const whRow = mkDiv("display:flex;align-items:center;gap:8px;margin-bottom:10px;");
        panel.append(whLabels, whRow);
        const lblW = mkSpan("WIDTH", "flex:1;text-align:center;color:var(--text-secondary, #666);font-size:11px;letter-spacing:.08em;");
        const lblH = mkSpan("HEIGHT", "flex:1;text-align:center;color:var(--text-secondary, #666);font-size:11px;letter-spacing:.08em;");
        whLabels.append(lblW, lblH);

        const wIn = mkNumInput(st.w, (v) => {
            st.w = Math.max(8, parseInt(v) || 8);
            if (st.mode === "ratio") applyFromWidth();
            render("w");
        });
        const hIn = mkNumInput(st.h, (v) => {
            st.h = Math.max(8, parseInt(v) || 8);
            if (st.mode === "ratio") applyFromHeight();
            render("h");
        });
        const swapWH = mkBtn("⇄", () => { [st.w, st.h] = [st.h, st.w]; render(); },
            "flex-shrink:0;width:44px;font-size:16px;");
        const wWrap = mkDiv("flex:1;"); wWrap.appendChild(wIn);
        const hWrap = mkDiv("flex:1;"); hWrap.appendChild(hIn);
        whRow.append(wWrap, swapWH, hWrap);

        // 3-4) 对齐粒度
        const snapRow = mkDiv("display:flex;align-items:center;gap:6px;margin-bottom:12px;");
        panel.appendChild(snapRow);
        snapRow.appendChild(mkSpan("⊞", "color:var(--text-secondary, #666);font-size:14px;flex-shrink:0;"));
        const snapBtns = SNAPS.map((s) => {
            const b = mkBtn(String(s), () => { st.snap = s; applySnap(); render(); },
                "padding:4px 9px;font-size:11px;flex-shrink:0;");
            snapRow.appendChild(b);
            return b;
        });

        // ── 计算函数 ──
        function pickNearestSize() {
            const list = sizesFor(st.rw, st.rh);
            let best = list[2] || list[0];
            let bestD = Infinity;
            for (const s2 of list) {
                const d = Math.abs(s2.w - st.w) + Math.abs(s2.h - st.h);
                if (d < bestD) { bestD = d; best = s2; }
            }
            st.w = best.w; st.h = best.h;
        }
        function renderSizeList() {
            sizeList.innerHTML = "";
            const list = sizesFor(st.rw, st.rh);
            list.forEach((s2, i) => {
                const on = (s2.w === st.w && s2.h === st.h);
                const row = mkDiv(`
                    padding:11px 8px;text-align:center;cursor:pointer;font-size:14px;
                    border-bottom:${i < list.length - 1 ? "1px solid var(--node-component-border, #ccc)" : "none"};
                    background:${on ? ACCENT_SOFT : "transparent"};
                    color:${on ? ACCENT_TEXT : "var(--node-component-widget-input, #000)"};
                    font-weight:${on ? "700" : "400"};
                `);
                row.textContent = `${s2.w} × ${s2.h}`;
                row.onmouseenter = () => { if (!on) row.style.background = "var(--component-node-widget-background-hovered, #e0e0e0)"; };
                row.onmouseleave = () => { if (!on) row.style.background = "transparent"; };
                row.onclick = () => { st.w = s2.w; st.h = s2.h; render(); };
                sizeList.appendChild(row);
            });
        }

        function applyFromBase() {
            st.w = snapTo(st.base, st.snap);
            st.h = snapTo(st.base * st.rh / st.rw, st.snap);
        }
        function applyFromWidth(snap = true) {
            st.h = snap ? snapTo(st.w * st.rh / st.rw, st.snap) : Math.round(st.w * st.rh / st.rw);
        }
        function applyFromHeight(snap = true) {
            st.w = snap ? snapTo(st.h * st.rw / st.rh, st.snap) : Math.round(st.h * st.rw / st.rh);
        }
        function applySnap() {
            st.w = snapTo(st.w, st.snap);
            st.h = snapTo(st.h, st.snap);
            if (st.mode === "ratio") applyFromWidth();
        }

        // ── 渲染 ──
        function render(skip = null) {
            const isPreset = st.mode === "preset";
            const isRatio  = st.mode === "ratio";
            const isRes    = st.mode === "res";

            sizeList.style.display = isPreset ? "flex" : "none";
            ratioRow.style.display = isRatio ? "flex" : "none";
            baseRow.style.display  = isRatio ? "grid" : "none";
            whLabels.style.display = isPreset ? "none" : "flex";
            whRow.style.display    = isPreset ? "none" : "flex";
            snapRow.style.display  = isPreset ? "none" : "flex";
            swapWH.style.display = isRes ? "flex" : "none";

            setActive(bModeRatio, isRatio);
            setActive(bModeRes, isRes);
            presetBtns.forEach((b, i) => {
                const p = PRESETS[i];
                setActive(b, isPreset && p.w === st.rw && p.h === st.rh);
            });
            if (isPreset) renderSizeList();
            baseBtns.forEach((b, i) => setActive(b, BASES[i] === st.base));
            snapBtns.forEach((b, i) => setActive(b, SNAPS[i] === st.snap));

            if (skip !== "rw") rwIn.value = String(st.rw);
            if (skip !== "rh") rhIn.value = String(st.rh);
            if (skip !== "w")  wIn.value  = String(st.w);
            if (skip !== "h")  hIn.value  = String(st.h);

            pushValues();
        }

        // ── DOM widget 注册 ──
        const host = document.createElement("div");
        host.style.cssText = "width:100%;box-sizing:border-box;";
        host.appendChild(wrap);
        node.addDOMWidget("windmix_resolution_ui", "custom", host, { serialize: false });

        // ── 尺寸适配 ──
        const MIN_W = 320;
        const fitNode = () => {
            const contentH = wrap.scrollHeight;
            if (!contentH) return;
            const scale = app.canvas?.ds?.scale || 1;
            const hostH = host.getBoundingClientRect().height / scale;
            if (!hostH) return;
            const overhead = node.size[1] - hostH;
            const target = Math.round(overhead + contentH);
            if (Math.abs(target - node.size[1]) > 2) {
                node.setSize([Math.max(MIN_W, node.size[0] || MIN_W), Math.max(120, target)]);
                node.setDirtyCanvas(true, true);
            }
        };
        const origOnResize = node.onResize;
        node.onResize = function (size) {
            if (size[0] < MIN_W) size[0] = MIN_W;
            origOnResize?.apply(this, arguments);
        };
        if (Array.isArray(node.min_size)) node.min_size[0] = MIN_W;
        else node.min_size = [MIN_W, 0];

        // 跟随 ComfyUI 系统主题配色：不强制节点卡片/连接点颜色（输出小圈圈恢复系统默认）；
        // 仅 UI 控件选中态保留 WindMix 紫（ACCENT 系列）作为品牌强调色。

        render();
        node.setSize([Math.max(MIN_W, node.size[0] || 360), node.size[1]]);
        requestAnimationFrame(fitNode);
        setTimeout(fitNode, 120);

        // ResizeObserver 实时同步
        if (typeof ResizeObserver !== "undefined") {
            let raf = null;
            const ro = new ResizeObserver(() => {
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => { try { fitNode(); } catch (_) {} });
            });
            ro.observe(wrap);
        }
    },
});
