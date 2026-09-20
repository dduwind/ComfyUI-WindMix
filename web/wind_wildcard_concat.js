// wildmix_wildcard_concat.js — refresh-safe + exact ordering
// Keeps all existing widgets on reload, rebuilds rows only when absent,
// and reorders the top controls to: path, Add, Clear, Toggle, prefix.
// Also respects "rows_json" as backing state (hidden).

import { app } from "/scripts/app.js";

app.registerExtension({
  name: "windmix.wildcards.dynamic.canvas.order_and_refresh_fix",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "Wind_WildcardConcat_Dynamic") return;

    const superCreate    = nodeType.prototype.onNodeCreated;
    const superConfigure = nodeType.prototype.configure;

    // ------- tiny helpers -------
    const RANDOM_VALUE = "random";
    const RANDOM_LABEL = "🎲 random";

    function _insertAt(node, widget, index) {
      if (!widget) return;
      const i = node.widgets.indexOf(widget);
      if (i !== -1) node.widgets.splice(i, 1);
      const safeIndex = Math.max(0, Math.min(index, node.widgets.length));
      node.widgets.splice(safeIndex, 0, widget);
    }

    function placeTopOrdering(node) {
      if (!node.widgets || !node.widgets.length) return;
      const find = (name) => (node.widgets || []).find(w => w && w.name === name);

      const dirW   = find("wildcards_dir");       // 1) path
      const delimW = find("string_delimiter");    // 2)
      const addW   = find("➕ Add Wildcard");     // 3)
      const clrW   = find("🧹 Clear All");        // 4)
      const hdrW   = find("windmix_wc_header");      // 5) toggle-all header
      const prefW  = find("prefix");              // 6)

      let i = 0;
      _insertAt(node, dirW,  i++);  // path
      _insertAt(node, delimW,i++);  // delimiter
      _insertAt(node, addW,  i++);  // add
      _insertAt(node, clrW,  i++);  // clear
      _insertAt(node, hdrW,  i++);  // toggle all
      _insertAt(node, prefW, i++);  // prefix
      node.setDirtyCanvas(true, true);
    }

    function hasRowWidgets(node) {
      const ws = node.widgets || [];
      // Head widgets we create below get names "windmix_wc_row_#"
      return ws.some(w => typeof w?.name === "string" && w.name.startsWith("windmix_wc_row_"));
    }

    // ------- row factory (header + details) -------
    function makeRowFactory(node) {
      // simple cache for listing wildcards
      const cache = { files: null, lines: {} };

      function currentDir() {
        const w = (node.widgets||[]).find(w => w.name === "wildcards_dir");
        return (w && typeof w.value === "string") ? w.value.trim() : "";
      }
      async function listFiles() {
        if (cache.files) return cache.files;
        try {
          const dir = encodeURIComponent(currentDir());
          const r = await fetch(`/wildmix/wildcards/files?dir=${dir}`);
          const j = await r.json();
          cache.files = Array.isArray(j.files) ? j.files : [];
        } catch { cache.files = []; }
        return cache.files;
      }
      async function listLines(file) {
        if (!file) return [RANDOM_VALUE];
        if (cache.lines[file]) return cache.lines[file];
        try {
          const dir = encodeURIComponent(currentDir());
          const r = await fetch(`/wildmix/wildcards/lines?file=${encodeURIComponent(file)}&dir=${dir}`);
          const j = await r.json();
          cache.lines[file] = Array.isArray(j.lines) ? j.lines : [RANDOM_VALUE];
        } catch { cache.lines[file] = [RANDOM_VALUE]; }
        return cache.lines[file];
      }

      // expose a hook so changing the path clears caches & refreshes combos
      node._windmixRefreshLinesFromPath = async () => {
        cache.files = null; cache.lines = {};
        for (const r of (node._windmixRows||[])) {
          const files = await listFiles();
          if (!files.includes(r.data.file)) r.data.file = files[0] || "";
          const raw  = await listLines(r.data.file);
          const vals = raw.map(x => x===RANDOM_VALUE ? RANDOM_LABEL : x);
          r.widgets.lineW.options.values = vals;
          if (!vals.includes(r.data.line)) {
            r.data.line = RANDOM_LABEL;
            r.widgets.lineW.value = RANDOM_LABEL;
          }
        }
        node._windmixSync?.(); node.setDirtyCanvas(true,true);
      };

      // Header custom widget (toggle/file/weight strip)
      function headerWidgetForRow(rowRef) {
        return {
          name: `windmix_wc_row`,
          type: "custom",
          draw(ctx, n, width, y, h) {
            const data = rowRef.data;
            const W = n.size?.[0] ?? width;
            const rowH = 20;
            const y0 = y;
            // bg
            ctx.save();
            ctx.globalAlpha = app.canvas.editor_alpha;
            ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR || "#3a3a3a";
            ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR || "#555";
            ctx.beginPath();
            // set the new widget rounded rectangle (left margin, y, width, height, radius)
            ctx.roundRect?.(15, y0, W - 30, rowH, 10);
            ctx.fill();
            if (ctx.roundRect) ctx.stroke();
            ctx.restore();

            // toggle pill
            const pillH = 14;
            const pillW = 22;
            const tX = 18, tY = y0 + (rowH - pillH)/2;
            ctx.save();
            ctx.globalAlpha = app.canvas.editor_alpha;
            ctx.fillStyle = data.on ? "#76c06b" : "#888";
            ctx.beginPath(); ctx.roundRect?.(tX, tY, pillW, pillH, pillH/2); ctx.fill();
            ctx.fillStyle = "#fff";
            const knobX = data.on ? (tX + pillW - 7) : (tX + 7);
            ctx.beginPath(); ctx.arc(knobX, tY + pillH/2, 5, 0, Math.PI*2); ctx.fill();
            ctx.restore();

            // file chooser label
            const fileLeft = tX + pillW + 16;
            const fileRight = W - 110;
            const midY = y0 + rowH/2 + 0.5;
            ctx.save();
            ctx.globalAlpha = app.canvas.editor_alpha;
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR || "#ddd";
            ctx.textAlign = "left"; ctx.textBaseline = "middle";
            const label = data.file || "Choose file";
            const fit = (txt, maxW) => {
              if (ctx.measureText(txt).width <= maxW) return txt;
              const ell = "…", ellW = ctx.measureText(ell).width;
              let lo=0, hi=txt.length;
              while (lo<=hi) {
                const mid=(lo+hi)>>1;
                const w = ctx.measureText(txt.slice(0, mid)).width;
                if (w <= maxW - ellW) lo = mid + 1; else hi = mid - 1;
              }
              return txt.slice(0, hi) + ell;
            };
            ctx.fillText(fit(label, Math.max(40, fileRight - fileLeft - 12)), fileLeft, midY);
            ctx.textAlign = "right"; ctx.fillText("▾", fileRight, midY);
            ctx.restore();

            // strength ◀ value ▶
            const numW = 70;
            const rightStart = W - 18 - numW;
            ctx.save();
            ctx.globalAlpha = app.canvas.editor_alpha;
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR || "#ddd";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const numCenter = rightStart + numW/2;
            ctx.fillText(String((Number(data.weight)||1).toFixed(2)), numCenter, midY);
            ctx.restore();

            // hit map
            this._hits = {
              toggle: [tX, pillW],
              file:   [fileLeft, Math.max(40, fileRight - fileLeft)],
              dec:    [rightStart, 20],
              inc:    [rightStart + numW - 20, 20],
              val:    [rightStart + 20, numW - 40],
            };
          },
          mouse(e, pos, n) {
            const t = e?.type || e?.event?.type || "";
            if (t !== "pointerdown" && t !== "mousedown" && t !== "down") return false;
            const x = pos[0];
            const h = this._hits || {};
            function inside(b){ if (!b) return false; const [bx,bw]=b; return x>=bx && x<=bx+bw; }

            if (inside(h.toggle)) { rowRef.data.on = !rowRef.data.on; n._windmixSync(); n.setDirtyCanvas(true,true); return true; }
            if (inside(h.file)) {
              (async ()=>{
                const files = await rowRef.listFiles();
                new LiteGraph.ContextMenu(files.length?files:["(no files)"], {
                  event: e, callback: async (v)=>{
                    if (typeof v === "string" && v!=="(no files)") {
                      rowRef.data.file = v;
                      const raw = await rowRef.listLines(v);
                      const vals = raw.map(x => x===RANDOM_VALUE ? RANDOM_LABEL : x);
                      rowRef.widgets.lineW.options.values = vals;
                      if (!vals.includes(rowRef.data.line)) {
                        rowRef.data.line = RANDOM_LABEL; rowRef.widgets.lineW.value = RANDOM_LABEL;
                      }
                      n._windmixSync(); n.setDirtyCanvas(true,true);
                    }
                  }
                });
              })();
              return true;
            }
            if (inside(h.dec)) { rowRef.data.weight = Math.round(((rowRef.data.weight||1)-0.05)*100)/100; n._windmixSync(); n.setDirtyCanvas(true,true); return true; }
            if (inside(h.inc)) { rowRef.data.weight = Math.round(((rowRef.data.weight||1)+0.05)*100)/100; n._windmixSync(); n.setDirtyCanvas(true,true); return true; }
            if (inside(h.val)) {
              app.canvas.prompt("Strength", (rowRef.data.weight||1).toFixed(2), v=>{
                const num = Number(v); rowRef.data.weight = Number.isFinite(num)? Math.round(num*100)/100:1.00;
                n._windmixSync(); n.setDirtyCanvas(true,true);
              }, e);
              return true;
            }
            return false;
          },
          serializeValue(){ return { ...rowRef.data }; }
        };
      }

      return async function addRow(preset) {
        node._windmixRows ??= [];

        const data = {
          on:     preset?.on ?? true,
          file:   (preset?.file||"").trim(),
          line:   preset?.line ? (preset.line===RANDOM_VALUE?RANDOM_LABEL:preset.line) : RANDOM_LABEL,
          weight: Number.isFinite(preset?.weight) ? Math.round(preset.weight*100)/100 : 1.0,
          suffix: typeof preset?.suffix === "string" ? preset.suffix : "",
        };

        // build rowRef with delegates to listFiles/listLines
        const rowRef = { data, widgets: {}, listFiles, listLines };
        const head = node.addCustomWidget( headerWidgetForRow(rowRef) );
        rowRef.head = head;

        const lineW = node.addWidget("combo",  "Line",   data.line, (v)=>{ data.line = v||RANDOM_LABEL; node._windmixSync(); }, { values:[RANDOM_LABEL], serialize:false });
        const sfxW  = node.addWidget("string", "Suffix", data.suffix, (v)=>{ data.suffix = v ?? ""; node._windmixSync(); }, { serialize:false, multiline:false });
        const rmW   = node.addWidget("button", "❌ Remove", null, ()=>{
          const ih = node.widgets.indexOf(head); if (ih!==-1) node.widgets.splice(ih,1);
          for (const w of [lineW,sfxW,rmW]) { const i=node.widgets.indexOf(w); if (i!==-1) node.widgets.splice(i,1); }
          node._windmixRows = (node._windmixRows||[]).filter(r => r.widgets.rmW !== rmW);
          relabel(); node._windmixSync(); return true;
        }, { serialize:false });
        rowRef.widgets = { lineW, sfxW, rmW };

        // initialize combos
        const files = await listFiles();
        if (!files.includes(data.file)) data.file = files[0] || "";
        const raw  = await listLines(data.file);
        const vals = raw.map(x => x===RANDOM_VALUE ? RANDOM_LABEL : x);
        lineW.options.values = vals;
        if (!vals.includes(data.line)) { data.line = RANDOM_LABEL; lineW.value = RANDOM_LABEL; }

        node._windmixRows.push(rowRef);
        relabel(); node._windmixSync(); node.graph?.setDirtyCanvas(true,true);

        function relabel() {
          let i=1;
          for (const r of (node._windmixRows||[])) {
            r.head.name = `windmix_wc_row_${i}`;
            r.widgets.lineW.name = `Line ${i}`;
            r.widgets.sfxW.name  = `Suffix ${i}`;
            r.widgets.rmW.name   = `❌ Remove ${i}`;
            i++;
          }
        }
      };
    }

    // ------- state sync to rows_json -------
    function installStateSync(node) {
      const rowsJson = (node.widgets||[]).find(w => w.name === "rows_json");
      if (!rowsJson) return;
      rowsJson.hidden = true; rowsJson.computeSize = () => [0,0];

      node._windmixSync = () => {
        const payload = (node._windmixRows||[]).map(r => ({
          on: !!r.data.on,
          file: (r.data.file||"").trim(),
          line: (r.data.line===RANDOM_LABEL?RANDOM_VALUE:(r.data.line||"")).trim(),
          weight: Number.isFinite(r.data.weight) ? Math.round(r.data.weight*100)/100 : 1.0,
          suffix: r.data.suffix ?? ""
        }));
        rowsJson.value = JSON.stringify(payload);
        node.graph?.setDirtyCanvas(true,true);
      };
    }

    // ------- toggle-all header -------
    function addToggleAllHeader(node) {
      const header = {
        name: "windmix_wc_header",
        type: "custom",
        draw(ctx, n, W, y, h) {
          const rows = n._windmixRows||[];
          const allOn  = rows.length && rows.every(r=>!!r.data.on);
          const allOff = rows.length && rows.every(r=>!r.data.on);
          const tri    = (!rows.length) ? false : (allOn ? true : (allOff ? false : null));

          // pill + label
          const pillH=18, pillW=28, x=10, y0=y + 2;
          ctx.save();
          ctx.globalAlpha = app.canvas.editor_alpha;
          ctx.fillStyle = "#aaa";
          ctx.beginPath(); ctx.roundRect?.(x, y0, pillW, pillH, pillH/2); ctx.fill();
          ctx.fillStyle = (tri===true?"#76c06b":tri===null?"#d0a846":"#888");
          const knobX = (tri===true) ? (x + pillW - 8) : (tri===null ? (x + pillW/2) : (x + 8));
          ctx.beginPath(); ctx.arc(knobX, y0 + pillH/2, 6, 0, Math.PI*2); ctx.fill();
          ctx.restore();

          ctx.save();
          ctx.globalAlpha = app.canvas.editor_alpha;
          ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR || "#ddd";
          ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText("Toggle All", x + pillW + 8, y + h/2 + 0.5);
          ctx.restore();

          this._hit = [x, pillW];
        },
        mouse(e, pos, n) {
          const t = e?.type || e?.event?.type || "";
          if (t !== "pointerdown" && t !== "mousedown" && t !== "down") return false;
          const x = pos[0];
          const [bx,bw] = this._hit || [0,0];
          if (x>=bx && x<=bx+bw) {
            const rows = n._windmixRows||[];
            const allOn  = rows.length && rows.every(r=>!!r.data.on);
            const flip = !(allOn === true);
            for (const r of rows) r.data.on = flip;
            n._windmixSync?.(); n.setDirtyCanvas(true,true);
            return true;
          }
          return false;
        },
        serializeValue(){ return {}; }
      };
      return node.addCustomWidget(header);
    }

    // ====== Hook in ======
    nodeType.prototype.onNodeCreated = function () {
      superCreate && superCreate.apply(this, arguments);

      // (1) rows_json sync
      installStateSync(this);

      // (2) row factory (provides this._windmixAddRow)
      this._windmixAddRow = makeRowFactory(this);

      // (3) top buttons (assumes your Python exposed these buttons/strings already)
      // If they already exist, we simply reuse; otherwise add them.
      let addBtn = (this.widgets||[]).find(w => w.name === "➕ Add Wildcard");
      if (!addBtn) addBtn = this.addWidget("button","➕ Add Wildcard",null,()=>this._windmixAddRow(),{serialize:false});

      let clearBtn = (this.widgets||[]).find(w => w.name === "🧹 Clear All");
      if (!clearBtn) clearBtn = this.addWidget("button","🧹 Clear All",null,()=>{
        for (const r of (this._windmixRows||[])) {
          const idxH = this.widgets.indexOf(r.head); if (idxH!==-1) this.widgets.splice(idxH,1);
          for (const w of Object.values(r.widgets)) {
            const i = this.widgets.indexOf(w); if (i!==-1) this.widgets.splice(i,1);
          }
        }
        this._windmixRows = [];
        const rj = (this.widgets||[]).find(w=>w.name==="rows_json"); if (rj) rj.value="[]";
        this.graph?.setDirtyCanvas(true,true);
      },{serialize:false});

      // (4) toggle-all header
      let hdr = (this.widgets||[]).find(w => w.name === "windmix_wc_header");
      if (!hdr) hdr = addToggleAllHeader(this);

      // (5) when path changes, refresh combos
      const pathW = (this.widgets||[]).find(w => w.name === "wildcards_dir");
      if (pathW) {
        const orig = pathW.callback;
        pathW.callback = (v)=>{ orig && orig(v); this._windmixRefreshLinesFromPath?.(); };
      }

      // Place top ordering once at create
      placeTopOrdering(this);
    };

    nodeType.prototype.configure = function (info) {
      superConfigure && superConfigure.apply(this, arguments);

      // do NOT wipe node.widgets here — that was the bug causing losses

      // re-install sync if missing (defensive)
      installStateSync(this);

      // rebuild rows from rows_json ONLY if there are no visible rows yet
      try {
        if (!hasRowWidgets(this) && typeof this._windmixAddRow === "function") {
          const rowsJson = (this.widgets||[]).find(w => w.name === "rows_json");
          const saved = rowsJson ? JSON.parse(rowsJson.value || "[]") : [];
          if (Array.isArray(saved) && saved.length) {
            (async () => {
              for (const r of saved) await this._windmixAddRow(r);
              placeTopOrdering(this);
              this.setDirtyCanvas(true, true);
            })();
          }
        }
      } catch {}

      // Re-enforce ordering (path, add, clear, toggle, prefix)
      placeTopOrdering(this);
    };
  },
});
