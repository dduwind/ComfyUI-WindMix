// ComfyUI-WindMix — 宽屏预设文本管理器（供 ⚡ 预设文本 节点调用）
// 左栏：预设目录（用户自建 + 全部预设/未分类，带数量角标），可新建目录、发送整个目录到节点。
// 右栏：当前目录内容，卡片/表格两种布局，搜索，新建预设，每条可编辑/删除/发送。
// 编辑区支持拖入或点击上传预览图，保存时压图落盘到插件 presets/images/。
import { app } from "../../scripts/app.js";
// 编辑弹窗的内容框自动补全：与「⚡ 预设文本」节点共用同一套引擎与词库缓存
import { attachAutoComplete, detachAutoComplete } from "./js/prompt_studio/windmix_preset_ac.js";

const API_PRESETS = "/windmix/preset_text/presets";
const API_IMAGE = "/windmix/preset_text/image";

// 无图时的占位示意图（图片相框 + 山/太阳）
const PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5L7 20"/></svg>';
// 设置缩略图框左侧的小图标
const SET_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>';

// 统一图标库（线条 SVG，跟随 currentColor）
const CHEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';
const KEBAB_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const SEND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
const DEL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
const TOOL_SELALL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
const TOOL_IMPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const TOOL_EXPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>';
const TOOL_NEW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

let _wmPmStyleInjected = false;
function injectStyle() {
    if (_wmPmStyleInjected) return;
    _wmPmStyleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
.wm-pm-backdrop { position:fixed; left:0; top:0; width:100%; height:100%; z-index:10000;
  background:rgba(15,17,26,0.55); display:flex; align-items:center; justify-content:center; font-family:system-ui,sans-serif; }
.wm-pm-modal { width:1515px; max-width:96vw; height:1122px; max-height:94vh; display:flex; background:#2a2a2a;
  color:#eee; border:1px solid #444; border-radius:14px; overflow:hidden;
  box-shadow:0 14px 50px rgba(0,0,0,.55); font-size:15px; }
.wm-pm-left { width:300px; flex:none; border-right:1px solid #3a3a3a; background:#232323;
  display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.wm-pm-left-head { padding:17px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #3a3a3a;
  font-weight:500; font-size:16px; }
.wm-pm-folder-btn { display:flex; align-items:center; gap:5px; font-size:13px; color:#9b8af5;
  border:1px solid #534AB7; background:rgba(83,74,183,.14); padding:5px 11px; border-radius:7px; cursor:pointer; }
.wm-pm-dirs { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:12px; display:flex; flex-direction:column; gap:10px; overscroll-behavior:contain; }
.wm-pm-dirs::-webkit-scrollbar { width:11px; }
.wm-pm-dirs::-webkit-scrollbar-track { background:rgba(0,0,0,.22); border-radius:6px; }
.wm-pm-dirs::-webkit-scrollbar-thumb { background:rgba(155,138,245,.6); border-radius:6px; border:2px solid rgba(0,0,0,.22); }
.wm-pm-dirs::-webkit-scrollbar-thumb:hover { background:rgba(155,138,245,.9); }
.wm-pm-dirs { scrollbar-width:thin; scrollbar-color:rgba(155,138,245,.6) rgba(0,0,0,.22); }
.wm-pm-dir-toggle { width:30px; height:30px; flex:none; display:inline-flex; align-items:center; justify-content:center;
  border-radius:8px; background:rgba(155,138,245,.14); color:#9b8af5; font-size:18px; margin-right:4px; cursor:pointer;
  transition:transform .2s ease, background .16s; }
.wm-pm-dir-toggle.expanded { transform:rotate(90deg); background:rgba(155,138,245,.28); }
/* 虚拟行（全部预设 / 无目录） */
.wm-pm-dir-vrow { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:10px; cursor:pointer; color:#ccc; transition:.16s; border:1px solid transparent; flex-shrink:0; }
.wm-pm-dir-vrow:hover { background:rgba(83,74,183,.1); }
.wm-pm-dir-vrow.active { background:rgba(83,74,183,.18); border:1px solid #534AB7; color:#fff; }
.wm-pm-dir-vrow.drag-over { border-color:#534AB7; background:rgba(83,74,183,.18); }
.wm-pm-dir-vrow .vname { flex:1; font-size:14px; }
/* 大分类区块 */
.wm-pm-big { border:1px solid #3a3a3a; border-radius:12px; background:rgba(255,255,255,.02); overflow:hidden; transition:.18s; flex-shrink:0; }
.wm-pm-big.drop-active { border-color:#9b8af5; box-shadow:0 0 0 2px rgba(155,138,245,.45) inset; background:rgba(155,138,245,.08); }
.wm-pm-big.active { border-color:rgba(155,138,245,.4); }
.wm-pm-big-head { display:flex; align-items:center; gap:8px; padding:11px 13px; cursor:pointer; transition:.16s; user-select:none; -webkit-user-select:none; }
.wm-pm-big-head:hover { background:rgba(155,138,245,.08); }
.wm-pm-big.expanded .wm-pm-big-head { border-bottom:1px solid #3a3a3a; }
.wm-pm-big-name { flex:1; min-width:0; font-weight:600; font-size:15px; word-break:break-all; }
/* 小分类胶囊（可拖拽归类） */
.wm-pm-sm-wrap { padding:8px 10px 11px 12px; display:flex; flex-direction:column; gap:9px; }
.wm-pm-sm { display:flex; align-items:center; gap:8px; padding:8px 12px; width:100%; box-sizing:border-box; background:#2a2a2a;
  border:1px solid #444; border-radius:9px; cursor:grab; transition:.16s; user-select:none; }
.wm-pm-sm:hover { border-color:#534AB7; background:#2c2c3c; }
.wm-pm-sm:active { cursor:grabbing; }
.wm-pm-sm.dragging { opacity:.4; }
.wm-pm-sm.active { border-color:#534AB7; background:rgba(155,138,245,.12); }
/* 分类导出勾选：统一圆角方块复选框（带对勾 SVG） */
.wm-pm-chk { width:18px; height:18px; flex:none; display:flex; align-items:center; justify-content:center;
  border:1.5px solid #444; border-radius:5px; cursor:pointer; color:#9b8af5; background:#2a2a2a; transition:.14s; }
.wm-pm-chk:hover { border-color:#9b8af5; }
.wm-pm-chk.on { background:#534AB7; border-color:#534AB7; color:#fff; }
.wm-pm-chk svg { width:11px; height:11px; opacity:0; transition:.14s; }
.wm-pm-chk.on svg { opacity:1; }
.wm-pm-big.dragging, .wm-pm-sm.dragging { opacity:.4; }
/* ===== 分类行统一模板（大/小分类共用） ===== */
.wm-pm-cat { display:flex; align-items:center; gap:8px; padding:9px 10px; border-radius:8px; transition:.16s; position:relative; cursor:pointer; user-select:none; -webkit-user-select:none; }
.wm-pm-cat:hover { background:rgba(155,138,245,.08); }
.wm-pm-cat.active { background:rgba(155,138,245,.12); }
.wm-pm-cat.is-view { border-color:#534AB7; background:rgba(155,138,245,.1); }
.wm-pm-grip { color:#777; display:flex; flex-direction:column; gap:2px; flex:none; opacity:0; transition:.16s; cursor:grab; }
.wm-pm-cat:hover .wm-pm-grip { opacity:.6; }
.wm-pm-grip i { width:3px; height:3px; border-radius:50%; background:currentColor; display:block; }
.wm-pm-chev { width:22px; height:22px; flex:none; display:flex; align-items:center; justify-content:center; border-radius:6px; background:rgba(155,138,245,.14); color:#9b8af5; transition:transform .22s ease, background .16s; }
.wm-pm-chev.expanded { transform:rotate(90deg); background:rgba(155,138,245,.24); }
.wm-pm-chev svg { width:14px; height:14px; }
.wm-pm-cname { flex:1; min-width:0; font-size:13.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-pm-sm .wm-pm-cname { font-weight:500; font-size:13px; }
.wm-pm-count { background:#3a3a3a; border-radius:12px; padding:2px 9px; font-size:13px; flex:none; }
.wm-pm-kebab { width:24px; height:24px; flex:none; display:flex; align-items:center; justify-content:center; border-radius:6px; color:#888; cursor:pointer; opacity:0; transition:.16s; }
.wm-pm-cat:hover .wm-pm-kebab { opacity:1; }
.wm-pm-kebab:hover { background:rgba(155,138,245,.14); color:#fff; }
.wm-pm-kebab svg { width:16px; height:16px; }
.wm-pm-cat.dragging { opacity:.4; }
/* 选中态角标 / 行内对勾 */
.wm-pm-card .sel-badge { position:absolute; top:9px; left:9px; z-index:6; width:24px; height:24px; border-radius:50%; background:#9b8af5; color:#fff; display:none; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,.35); }
.wm-pm-card .sel-badge svg { width:14px; height:14px; }
.wm-pm-card.selected .sel-badge { display:flex; }
.wm-pm-row .sel-badge { display:none; color:#9b8af5; margin-left:2px; }
.wm-pm-row .sel-badge svg { width:16px; height:16px; }
.wm-pm-row.selected .sel-badge { display:flex; }
/* 行内图标尺寸 / 更多菜单图标 */
.wm-pm-ic svg { width:15px; height:15px; }
.wm-pm-more-item { display:flex; align-items:center; gap:9px; }
.wm-pm-more-item svg { width:14px; height:14px; flex:none; }
.wm-pm-more-item.danger:hover { background:rgba(229,115,115,.14); color:#e57373; }

/* 内联重命名输入框 */
.wm-pm-rename-input { flex:1; min-width:0; font-size:15px; font-weight:600; font-family:inherit;
  background:#2a2a2a; border:1px solid #534AB7; border-radius:5px;
  padding:2px 7px; color:#eee; }
/* 新建小分类按钮：与小分类同尺寸、带外框、带淡底色 */
.wm-pm-add-sub { display:flex; align-items:center; gap:8px; padding:8px 12px; width:100%; box-sizing:border-box;
  background:#2a2a2a; border:1px solid #444; border-radius:9px;
  cursor:pointer; transition:.16s; color:#9b8af5; font-size:13.5px; user-select:none; }
.wm-pm-add-sub:hover { border-color:#534AB7; background:rgba(83,74,183,.12); }
.wm-pm-grip { color:#777; display:flex; flex-direction:column; gap:2px; flex:none; }
.wm-pm-grip i { width:3px; height:3px; border-radius:50%; background:currentColor; display:block; }
.wm-pm-sm-name { flex:1; font-size:13.5px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-pm-dir-del { width:20px; height:20px; display:flex; align-items:center; justify-content:center;
  border-radius:5px; color:#888; font-size:13px; cursor:pointer; }
.wm-pm-dir-del:hover { color:#e57373; background:rgba(229,115,115,0.12); }
.wm-pm-badge { background:#3a3a3a; border-radius:12px; padding:2px 10px; font-size:13px; }
.wm-pm-badge.on { background:#534AB7; color:#fff; }
.wm-pm-sendall { margin:13px; padding:12px 0; background:#534AB7; color:#fff; border:none; border-radius:9px;
  cursor:pointer; font-weight:500; text-align:center; }
.wm-pm-sendall:hover { background:#3c3489; }
.wm-pm-right { flex:1; display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; }
.wm-pm-rhead { display:flex; align-items:center; gap:13px; padding:14px 17px; border-bottom:1px solid #3a3a3a; }
.wm-pm-rhead .ttl { font-weight:500; }
.wm-pm-search { flex:1; background:#2a2a2a; border:1px solid #444; border-radius:7px;
  padding:7px 11px; color:#eee; font-size:14px; }
.wm-pm-toggle { display:flex; border:1px solid #444; border-radius:7px; overflow:hidden; height:38px; }
.wm-pm-toggle span { width:38px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#aaa; transition:.16s; }
.wm-pm-toggle span:hover { background:rgba(155,138,245,.12); }
.wm-pm-toggle span.on { background:#534AB7; color:#fff; }
/* 统一工具按钮（图标+文字）：38px 高、同圆角同边框 */
.wm-pm-tool { display:inline-flex; align-items:center; gap:6px; height:38px; padding:0 13px; border-radius:7px;
  background:#2a2a2a; border:1px solid #444; color:#ccc; cursor:pointer; font-size:13px; transition:.16s; white-space:nowrap; }
.wm-pm-tool svg { width:15px; height:15px; flex:none; }
.wm-pm-tool:hover { border-color:#534AB7; color:#fff; background:#2c2c3c; }
.wm-pm-tool.on, .wm-pm-tool.primary { background:#534AB7; border-color:#534AB7; color:#fff; }
.wm-pm-tool.primary:hover { background:#3c3489; }
.wm-pm-tool.ghost { border-color:#534AB7; color:#9b8af5; }
.wm-pm-tool.ghost:hover { background:rgba(83,74,183,.12); }
.wm-pm-tool:disabled { opacity:.4; cursor:default; filter:none; background:#2a2a2a; color:#aaa; border-color:#444; }
/* 工具栏分组分隔线 */
.wm-pm-sep { width:1px; height:24px; background:#3a3a3a; flex:none; }
/* 左侧目录栏底部「选中分类」上下文操作条：勾选后才浮现 */
.wm-pm-selbar { display:none; flex-direction:column; gap:8px; padding:11px 13px; border-top:1px solid #3a3a3a;
  background:#232323; }
.wm-pm-selbar.show { display:flex; }
.wm-pm-selbar-count { font-size:12.5px; color:#9a9a9a; }
.wm-pm-selbar-btns { display:flex; gap:8px; }
.wm-pm-selbar-btns button { flex:1; padding:9px 0; border-radius:8px; font-size:13.5px; cursor:pointer; border:1px solid #534AB7;
  background:#534AB7; color:#fff; transition:.14s; }
.wm-pm-selbar-btns button:hover { background:#3c3489; }
.wm-pm-selbar-btns button.ghost { background:transparent; color:#9b8af5; }
.wm-pm-selbar-btns button.ghost:hover { background:rgba(83,74,183,.12); }
.wm-pm-selbar-btns button.danger { background:transparent; color:#ff6b6b; border-color:rgba(255,107,107,.5); }
.wm-pm-selbar-btns button.danger:hover { background:rgba(255,107,107,.14); }
.wm-pm-selbar-btns button:disabled { opacity:.4; cursor:default; background:#2a2a2a; color:#aaa;
  border-color:#444; }
/* 「移动到…」浮层：列出所有大分类 */
.wm-pm-move-pop { position:fixed; z-index:10001; min-width:200px; max-height:320px; overflow-y:auto; transform:translateY(-100%);
  background:#2a2a2a; color:#eee; border:1px solid #444;
  border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.55); padding:6px; }
.wm-pm-move-title { font-size:12.5px; color:#9a9a9a; padding:6px 9px 8px; }
.wm-pm-move-item { padding:9px 11px; border-radius:7px; cursor:pointer; font-size:14px; transition:.14s; }
.wm-pm-move-item:hover { background:rgba(83,74,183,.18); }
.wm-pm-move-item.new { color:#9b8af5; border-top:1px solid #3a3a3a; margin-top:4px; }
.wm-pm-list { flex:1; overflow:auto; padding:16px; align-content:start; }
.wm-pm-list.grid { display:grid; grid-template-columns:repeat(5, minmax(148px, 1fr)); grid-auto-rows:300px;
  gap:13px; align-items:stretch; }
.wm-pm-card { background:#1f1f1f; border:1px solid #3a3a3a; border-radius:12px;
  overflow:hidden; display:flex; flex-direction:column; min-height:0; position:relative; transition:.2s; box-shadow:0 4px 14px rgba(0,0,0,.22); }
.wm-pm-card:hover { transform:translateY(-4px); border-color:rgba(155,138,245,.5); box-shadow:0 12px 30px rgba(0,0,0,.4); }
.wm-pm-card.selected { border:2px solid #9b8af5; box-shadow:0 0 0 3px rgba(155,138,245,.32), 0 12px 30px rgba(0,0,0,.4); }
.wm-pm-card.dragging { opacity:.4; }
.wm-pm-card.drop-target { border-color:#9b8af5; box-shadow:0 0 0 3px rgba(155,138,245,.45), 0 12px 30px rgba(0,0,0,.4); }
.wm-pm-banner { flex:1; min-height:0; background:#3a3a5a; display:flex; align-items:center; justify-content:center;
  color:#9b8af5; font-size:14px; background-size:cover; background-position:center; position:relative; cursor:pointer; transition:.18s; }
.wm-pm-banner.hover { box-shadow:inset 0 0 0 3px #9b8af5; }
/* 缩略图无图时的占位示意图 */
.wm-pm-banner .wm-pm-ph { display:flex; }
.wm-pm-ph svg { width:66px; height:66px; opacity:.45; color:#9b8af5; }
/* 大图欣赏浮层（点击缩略图弹出，可滚轮缩放） */
.wm-pm-lightbox { position:fixed; inset:0; z-index:100008; background:rgba(10,11,18,.86);
  display:flex; align-items:center; justify-content:center; cursor:zoom-out; }
.wm-pm-lightbox img { max-width:92vw; max-height:92vh; border-radius:10px; box-shadow:0 16px 60px rgba(0,0,0,.6);
  cursor:zoom-in; transition:transform .12s ease; }
.wm-pm-lightbox .lb-close { position:fixed; top:18px; right:22px; width:42px; height:42px; border-radius:50%;
  display:flex; align-items:center; justify-content:center; font-size:18px; color:#fff; background:rgba(40,40,54,.8);
  border:1px solid rgba(155,138,245,.35); cursor:pointer; }
.wm-pm-lightbox .lb-close:hover { background:#534AB7; }
.wm-pm-lightbox .lb-hint { position:fixed; bottom:18px; left:0; right:0; text-align:center; color:#cfcfe6; font-size:13px; opacity:.8; }
/* 表格视图缩略图无图占位 */
.wm-pm-row .thumb svg { width:22px; height:22px; opacity:.5; color:#9b8af5; }
/* 当前查看分类名（搜索框左侧的胶囊标签） */
.wm-pm-cat-chip { display:inline-flex; align-items:center; max-width:220px; height:32px; flex:none; padding:0 12px;
  border-radius:7px; background:rgba(155,138,245,.12); border:1px solid rgba(155,138,245,.35); color:#d6cffb;
  font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 悬停操作层：平时隐藏，鼠标移上卡片才浮现；pointer-events:none 让缩略图点击/拖入穿透 */
.wm-pm-actions { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;
  background:linear-gradient(180deg, rgba(18,18,26,.30), rgba(18,18,26,.62)); opacity:0; transition:.2s; backdrop-filter:blur(1px); pointer-events:none; }
.wm-pm-card:hover .wm-pm-actions { opacity:1; }
.wm-pm-act-row { display:flex; align-items:center; justify-content:center; gap:14px; }
/* 缩略图底部：点击/拖入设图提示（半透明底框，悬停浮现；比设计稿 7px 加高） */
.wm-pm-banner-cap { position:absolute; left:0; right:0; bottom:0; z-index:4;
  display:flex; align-items:center; justify-content:center; gap:6px; padding:15px 0;
  font-size:12px; color:#fff; background:rgba(14,14,21,.62);
  opacity:0; transition:.18s; pointer-events:none; cursor:pointer; }
.wm-pm-banner-cap svg { width:14px; height:14px; }
.wm-pm-card:hover .wm-pm-banner-cap { opacity:1; pointer-events:auto; }
.wm-pm-act { width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px;
  cursor:pointer; color:#fff; background:rgba(40,40,54,.78); border:1px solid rgba(155,138,245,.35); transition:.16s; transform:translateY(6px); pointer-events:none; }
.wm-pm-card:hover .wm-pm-act { transform:translateY(0); pointer-events:auto; }
.wm-pm-act:hover { background:#534AB7; border-color:#534AB7; transform:translateY(-2px) scale(1.06); }
.wm-pm-act.send { color:#9b8af5; }
/* 统一三个悬停图标尺寸：复制按钮 SVG 自带 20px，编辑/发送无 width/height 会按浏览器默认(≈300px)溢出，显式约束为 20px */
.wm-pm-act svg { width:20px; height:20px; }
/* 删除按钮：直接挂在图片(banner)上，悬停时浮现，定位在图片右上角，独立于三个居中按钮 */
.wm-pm-del-corner { position:absolute; top:8px; right:8px; z-index:5; width:36px; height:36px; border-radius:11px; font-size:15px;
  display:flex; align-items:center; justify-content:center; cursor:pointer; color:#fff; background:rgba(40,40,54,.78);
  border:1px solid rgba(155,138,245,.35); transition:.16s; opacity:0; pointer-events:none; }
.wm-pm-card:hover .wm-pm-del-corner { opacity:1; pointer-events:auto; }
.wm-pm-del-corner:hover { background:#e57373; border-color:#e57373; }
.wm-pm-card .body { padding:9px 12px; height:44px; flex:none; display:flex; align-items:center; cursor:grab; user-select:none; transition:.16s; }
.wm-pm-card .body:active { cursor:grabbing; }
.wm-pm-title { flex:1; min-width:0; font-weight:600; font-size:15px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-pm-card .prev { display:none; }
.wm-pm-ic { width:30px; height:30px; border-radius:7px; border:1px solid #444; background:#2a2a2a;
  display:flex; align-items:center; justify-content:center; cursor:pointer; color:#ccc; flex:none; }
.wm-pm-ic.send { color:#9b8af5; border-color:#534AB7; }
.wm-pm-ic.del:hover { color:#e57373; border-color:#e57373; }
.wm-pm-ic.edit:hover { color:#fff; border-color:#534AB7; }
.wm-pm-row { display:flex; align-items:center; gap:13px; padding:12px 13px; border:1px solid #3a3a3a;
  border-radius:9px; margin-bottom:11px; background:#1f1f1f; cursor:pointer; transition:.16s; }
.wm-pm-row:hover { border-color:rgba(155,138,245,.4); }
.wm-pm-row.selected { border:1px solid #9b8af5; box-shadow:0 0 0 2px rgba(155,138,245,.25) inset; }
.wm-pm-row .thumb { width:58px; height:58px; border-radius:7px; flex:none; background:#3a3a5a;
  background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; color:#9b8af5; font-size:12px; cursor:pointer; }
.wm-pm-row .meta { flex:1; min-width:0; }
.wm-pm-row .meta .name { font-weight:500; }
.wm-pm-row .meta .prev { color:#aaa; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wm-pm-row-actions { display:flex; align-items:center; gap:8px; flex:none; }
.wm-pm-more-menu { position:fixed; min-width:140px; background:#2a2a2a; border:1px solid #444;
  border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.5); padding:6px; z-index:100007; }
.wm-pm-more-item { padding:9px 13px; border-radius:7px; cursor:pointer; font-size:14px; color:#eee; }
.wm-pm-more-item:hover { background:rgba(155,138,245,.18); color:#fff; }
.wm-pm-empty { color:#aaa; opacity:0.7; padding:30px; text-align:center; }
.wm-pm-drop { width:68px; border:1px dashed #555; border-radius:7px; display:flex; align-items:center;
  justify-content:center; color:#888; font-size:13px; cursor:pointer; text-align:center; }
.wm-pm-drop.hover { border-color:#534AB7; color:#9b8af5; }
.wm-pm-save { margin-top:12px; background:#534AB7; color:#fff; border:none; border-radius:7px;
  padding:10px 21px; cursor:pointer; font-weight:500; font-size:14px; }
.wm-pm-save:hover { background:#3c3489; }
.wm-pm-hidden-file { display:none; }
.wm-pm-toast { position:fixed; left:50%; top:22px; transform:translateX(-50%); z-index:100005;
  background:#534AB7; color:#fff; padding:10px 22px; border-radius:8px; font-size:14px;
  box-shadow:0 8px 26px rgba(0,0,0,.45); opacity:0; transition:opacity .25s ease; pointer-events:none; }
.wm-pm-toast.show { opacity:1; }
.wm-pm-edit-modal-bd { position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:100006; }
.wm-pm-edit-modal { width:1320px; max-width:96vw; background:#2a2a2a; color:#eee;
  border:1px solid #444; border-radius:14px; padding:28px; box-shadow:0 16px 54px rgba(0,0,0,.55); }
.wm-pm-edit-modal h4 { margin:0 0 18px; font-size:22px; font-weight:600; }
.wm-pm-edit-modal .erow { display:flex; flex-direction:column; gap:14px; align-items:stretch; }
.wm-pm-edit-modal input, .wm-pm-edit-modal textarea { background:#2a2a2a; border:1px solid #444;
  border-radius:8px; padding:12px 16px; color:#eee; font-family:inherit; font-size:18px; }
.wm-pm-edit-modal .e-name { flex:none; width:100%; font-size:20px; }
.wm-pm-edit-modal textarea { flex:1; min-height:420px; resize:vertical; font-size:20px; line-height:1.55; box-sizing:border-box; }
.wm-pm-edit-actions { display:flex; gap:14px; justify-content:flex-end; margin-top:22px; }
.wm-pm-edit-actions button { padding:13px 38px; border-radius:9px; cursor:pointer; font-size:20px; border:1px solid #444; }
.wm-pm-edit-actions .ok { background:#534AB7; color:#fff; border-color:#534AB7; }
.wm-pm-edit-actions .ok:hover { background:#3c3489; }
.wm-pm-edit-actions .cancel { background:transparent; color:#eee; }
.wm-pm-edit-actions .cancel:hover { border-color:#eee; }
.wm-pm-banner.hover, .wm-pm-row .thumb.hover { border-color:#534AB7; color:#9b8af5; filter:brightness(1.15); }
`;
    document.head.appendChild(s);
}

// ============ 全局状态与 DOM ============
const state = {
    node: null,
    folder: "全部预设", // 当前选中的「小分类」名；大分类视图时为 ""；"全部预设"/"无目录" 为虚拟视图
    parent: "", // 当前选中的「大分类」名；"" 表示未限定大分类（虚拟视图）
    expanded: new Set(), // 已展开的大分类名集合
    layout: "card",
    search: "",
    folders: [],
    presets: [],
    editing: null, // 正在编辑的预设对象（或 {id:null} 表示新建）
    pendingImage: "", // 待保存的图片相对路径或空
    selected: new Set(), // 选中的预设 id（用于批量发送 / 批量移动到其他文件夹）
    exportCats: new Set(), // 选中的分类 key（用于导出）："B||<大分类名>" 或 "S||<小分类名>|<大分类名>"
};

// 视图状态持久化：记住上次浏览的小分类 + 左侧树的展开状态，下次打开直接恢复。
const WM_VIEW_KEY = "windmix_preset_view_v1";
function saveViewState() {
    try {
        localStorage.setItem(WM_VIEW_KEY, JSON.stringify({
            folder: state.folder,
            parent: state.parent,
            expanded: Array.from(state.expanded),
        }));
    } catch (e) { /* localStorage 不可用时静默忽略 */ }
}
function loadViewState() {
    try {
        const raw = localStorage.getItem(WM_VIEW_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (!d || typeof d !== "object") return null;
        return {
            folder: typeof d.folder === "string" ? d.folder : "全部预设",
            parent: typeof d.parent === "string" ? d.parent : "",
            expanded: Array.isArray(d.expanded)
                ? d.expanded.filter((x) => typeof x === "string")
                : [],
        };
    } catch (e) { return null; }
}
// 校验当前视图指向的分类是否仍存在（防止恢复到一个已删除的分类）
function viewValid() {
    const f = state.folder, p = state.parent;
    if (f === "全部预设" || f === "无目录") return true;
    if (f === "" && p) {
        return state.folders.some((x) => x.type === "big" && x.name === p);
    }
    if (f && p) {
        const big = state.folders.find((x) => x.type === "big" && x.name === p);
        return !!(big && (big.children || []).some((c) => c.name === f));
    }
    return false;
}

let backdrop = null;
let els = {};

function apiFetch(url, opts) {
    // HTTP 状态检查 + 安全 JSON 解析：服务端 500 / 返回 HTML 错误页时，
    // 直接 r.json() 会抛 SyntaxError 把真实错误原因掩盖掉
    return fetch(url, opts).then(async (r) => {
        let data = null;
        try { data = await r.json(); } catch (e) { data = null; }
        if (!r.ok) return { success: false, message: "请求失败 (HTTP " + r.status + ")" };
        return data || { success: false, message: "服务端返回为空" };
    });
}

let _pmToastTimer = null;
function toast(msg) {
    let el = document.querySelector(".wm-pm-toast");
    if (!el) {
        el = document.createElement("div");
        el.className = "wm-pm-toast";
        document.body.append(el);
    }
    el.textContent = msg;
    void el.offsetWidth; // 重排以重启过渡
    el.classList.add("show");
    if (_pmToastTimer) clearTimeout(_pmToastTimer);
    _pmToastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

// 读取图片文件为 dataURL（Promise 版，供卡片上传复用）
function readFileAsDataURL(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

let _pendingUploadPreset = null; // 卡片点击上传时暂存的目标预设
async function uploadCardImage(p, file) {
    if (!file) return;
    const dataURL = await readFileAsDataURL(file);
    if (!dataURL) {
        toast("图片读取失败");
        return;
    }
    try {
        const r = await apiFetch(API_IMAGE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: dataURL, name: (p && p.name) || "", id: (p && p.id) || "" }),
        });
        if (r && r.success) {
            const u = await apiFetch(API_PRESETS, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "update", id: p.id, image: r.path }),
            });
            if (u && u.success) {
                toast("已更新预览图：" + (p.name || ""));
                loadPresets();
            } else {
                toast("更新失败：" + (u && u.message));
            }
        } else {
            toast("图片上传失败：" + (r && r.message));
        }
    } catch (e) {
        toast("图片上传失败");
    }
}

async function loadPresets() {
    const folderParam = state.folder || ""; // 大分类视图时 folder 为 ""，靠 parent 过滤
    let url = API_PRESETS + "?folder=" + encodeURIComponent(folderParam);
    if (state.parent) url += "&parent=" + encodeURIComponent(state.parent);
    try {
        const data = await apiFetch(url);
        if (data && data.success) {
            state.folders = data.folders || [];
            state.presets = data.presets || [];
        }
        // 若恢复/当前视图指向的分类已不存在，回退到「全部预设」并记住
        if (!viewValid()) {
            state.folder = "全部预设";
            state.parent = "";
            state.expanded = new Set();
            saveViewState();
            // 后端对未知分类返回空列表，刚拿到的数据对应失效视图；
            // 重置后必须重新拉取「全部预设」，否则内容区一片空白直到下次手动操作
            const data2 = await apiFetch(API_PRESETS + "?folder=" + encodeURIComponent("全部预设"));
            if (data2 && data2.success) {
                state.folders = data2.folders || [];
                state.presets = data2.presets || [];
            }
        }
    } catch (e) {
        console.error("[WindMix] 加载预设失败", e);
    }
    renderFolders();
    renderPresets();
}

// 选择某个目录（folder=小分类名，parent=大分类名；虚拟视图 folder 为 "全部预设"/"无目录"）
function updateCatChip() {
    if (!els || !els.catChip) return;
    let label;
    if (state.folder === "全部预设" || (!state.folder && !state.parent)) label = "全部预设";
    else if (state.folder === "无目录") label = "无目录";
    else if (state.parent && state.folder) label = state.parent + " / " + state.folder;
    else if (state.parent) label = state.parent;
    else label = "全部预设";
    els.catChip.textContent = label;
    els.catChip.title = "当前查看：" + label;
}
function selectFolder(folder, parent) {
    state.folder = folder;
    state.parent = parent || "";
    state.editing = null;
    state.selected.clear();
    hideEditor();
    updateCatChip();
    saveViewState();
    loadPresets();
}

// 通用：渲染一个虚拟目录行（全部预设 / 无目录）
function buildVirtualRow(f, isAll) {
    const active = isAll ? state.folder === "全部预设" : state.folder === "无目录";
    const d = document.createElement("div");
    d.className = "wm-pm-dir-vrow" + (active ? " active" : "");
    const name = document.createElement("span");
    name.className = "vname";
    name.textContent = f.name;
    const right = document.createElement("div");
    right.style.cssText = "display:flex; align-items:center; gap:5px;";
    const badge = document.createElement("span");
    badge.className = "wm-pm-badge" + (active ? " on" : "");
    badge.textContent = f.count;
    right.append(badge);
    d.append(name, right);
    d.addEventListener("click", () => selectFolder(isAll ? "全部预设" : "无目录", ""));
    // 「无目录」接受拖入（拖入=归为无目录），「全部预设」不接收拖拽
    if (!isAll) attachDirDrop(d, "", "");
    return d;
}

// 渲染大分类区块（含展开/折叠、计数、全选勾选、拖入；内部包含小分类）
function buildBigBlock(f) {
    const isExpanded = state.expanded.has(f.name);
    const active = state.parent === f.name && !state.folder;
    const wrap = document.createElement("div");
    wrap.className = "wm-pm-big" + (isExpanded ? " expanded" : "") + (active ? " active" : "");
    wrap.dataset.bigName = f.name; // 供容器级大分类重排定位（放宽落点用）
    const childKeys = (f.children || []).map((c) => "S||" + c.name + "|" + f.name);
    const bigAllOn = childKeys.length > 0 && childKeys.every((k) => state.exportCats.has(k));
    const head = catRow({
        cls: "wm-pm-big-head",
        // 大分类需自身可拖拽才能发起「reorder-big:」重排；显式 draggable=false 会让父级 wrap 也拖不动
        draggable: true,
        hasChevron: true,
        expanded: isExpanded,
        chkOn: bigAllOn,
        viewActive: active,
        name: f.name,
        count: f.count,
        onDragStart: (e) => {
            e.dataTransfer.setData("text/plain", "reorder-big:" + f.name);
            e.dataTransfer.effectAllowed = "move";
            wrap.classList.add("dragging");
        },
        onDragEnd: () => { wrap.classList.remove("dragging"); },
        onChev: () => {
            if (state.expanded.has(f.name)) state.expanded.delete(f.name);
            else state.expanded.add(f.name);
            saveViewState();
            renderFolders();
        },
        onChk: () => toggleBigCats(f),
        onView: () => selectFolder("", f.name),
        onDbl: (nameEl) => startInlineRename(nameEl, f.name, ""),
        onCtx: (nameEl) => ([
            { label: "重命名", icon: EDIT_SVG, onClick: () => startInlineRename(nameEl, f.name, "") },
            { label: "新建子分类", icon: TOOL_NEW_SVG, onClick: () => newSmallFolder(f.name) },
            { label: "删除", icon: DEL_SVG, danger: true, onClick: () => deleteFolder(f.name, "") },
        ]),
    });
    wrap.append(head);

    // 展开时列出小分类（可拖拽归类）；新建小分类入口收进大分类的「⋯」菜单
    if (isExpanded) {
        const sw = document.createElement("div");
        sw.className = "wm-pm-sm-wrap";
        (f.children || []).forEach((c) => sw.append(buildSmallRow(c, f.name)));
        wrap.append(sw);
    }

    // 拖入本大分类区块 = 小分类重新归类 / 预设移动到该大分类
    attachBigDrop(wrap, f.name);
    return wrap;
}

// 渲染小分类（可拖拽到别的大分类重新归类），与 big 共用 catRow 模板
function buildSmallRow(c, bigName) {
    const active = state.parent === bigName && state.folder === c.name;
    const catKey = "S||" + c.name + "|" + bigName;
    const on = state.exportCats.has(catKey);
    const d = catRow({
        cls: "wm-pm-sm",
        draggable: true,
        hasChevron: false,
        chkOn: on,
        viewActive: active,
        name: c.name,
        count: c.count,
        onChk: () => {
            if (state.exportCats.has(catKey)) state.exportCats.delete(catKey);
            else state.exportCats.add(catKey);
            renderFolders(); // 同步父级大分类的「全选」勾选态
        },
        onView: () => selectFolder(c.name, bigName),
        onDbl: (nameEl) => startInlineRename(nameEl, c.name, bigName),
        onCtx: (nameEl) => ([
            { label: "重命名", icon: EDIT_SVG, onClick: () => startInlineRename(nameEl, c.name, bigName) },
            { label: "删除", icon: DEL_SVG, danger: true, onClick: () => deleteFolder(c.name, bigName) },
        ]),
    });
    // 拖拽小分类到别的大分类 → 重新归类（数据以 small: 前缀标识）
    d.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", "small:" + c.name + "|" + bigName);
        e.dataTransfer.effectAllowed = "move";
        d.classList.add("dragging");
    });
    d.addEventListener("dragend", () => { d.classList.remove("dragging"); });
    // 同一大分类内拖拽重排：dragover 必须无条件 preventDefault 才允许 drop（HTML5 规定 dragover 阶段 getData 读不到，只能在 drop 阶段读）
    d.addEventListener("dragover", (e) => {
        e.preventDefault();
        d.classList.add("drag-over");
    });
    d.addEventListener("dragleave", () => d.classList.remove("drag-over"));
    d.addEventListener("drop", (e) => {
        const data = e.dataTransfer.getData("text/plain") || "";
        if (!data.startsWith("small:")) return; // 预设拖入交给 attachDirDrop
        const payload = data.slice("small:".length);
        const sep = payload.indexOf("|");
        const draggedName = payload.slice(0, sep);
        const oldParent = payload.slice(sep + 1);
        if (oldParent !== bigName || draggedName === c.name) return; // 跨大分类/自身不在此处理
        e.preventDefault();
        e.stopPropagation();
        d.classList.remove("drag-over");
        const rect = d.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        reorderSmallWithinBig(bigName, draggedName, c.name, after);
    });
    // 拖入预设到此小分类 → 归入该小分类
    attachDirDrop(d, c.name, bigName);
    return d;
}

// 生成目录删除按钮（带 parent 以便后端定位大类/小类）
function makeDirDel(name, parent) {
    const del = document.createElement("span");
    del.className = "wm-pm-dir-del";
    del.textContent = "✕";
    del.title = "删除目录";
    del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFolder(name, parent);
    });
    return del;
}

// 分类行统一模板：拖拽手柄 · 折叠箭头(可选) · 勾选框 · 名称 · 数量 · 更多(⋯)
function catRow(o) {
    const row = document.createElement("div");
    row.className = "wm-pm-cat " + (o.cls || "") + (o.chkOn ? " active" : "") + (o.viewActive ? " is-view" : "");
    row.setAttribute("draggable", o.draggable ? "true" : "false");
    row.innerHTML =
        '<span class="wm-pm-grip"><i></i><i></i><i></i></span>' +
        (o.hasChevron ? '<span class="wm-pm-chev' + (o.expanded ? " expanded" : "") + '">' + CHEV_SVG + '</span>' : '') +
        '<span class="wm-pm-chk ' + (o.chkOn ? "on" : "") + '">' + CHECK_SVG + '</span>' +
        '<span class="wm-pm-cname"></span>' +
        '<span class="wm-pm-count">' + (o.count != null ? o.count : "") + '</span>' +
        '<span class="wm-pm-kebab" title="更多操作">' + KEBAB_SVG + '</span>';
    row.querySelector(".wm-pm-cname").textContent = o.name;
    if (o.onChev) row.querySelector(".wm-pm-chev").addEventListener("click", (e) => { e.stopPropagation(); o.onChev(); });
    row.querySelector(".wm-pm-chk").addEventListener("click", (e) => { e.stopPropagation(); o.onChk && o.onChk(); });
    const nm = row.querySelector(".wm-pm-cname");
    // 单击=选中（220ms 防抖，避开双击）；双击名称=重命名。用短延时区分单击/双击，避免双击时被 re-render 打断。
    let clickTimer = null;
    if (o.onView) {
        row.addEventListener("click", () => {
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            clickTimer = setTimeout(() => { clickTimer = null; o.onView(); }, 220);
        });
    }
    if (o.onDbl) nm.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        o.onDbl(nm);
    });
    row.querySelector(".wm-pm-kebab").addEventListener("click", (e) => {
        e.stopPropagation();
        openCatCtx(e.currentTarget, (o.onCtx ? o.onCtx(nm) : []));
    });
    if (o.onDragStart) row.addEventListener("dragstart", o.onDragStart);
    if (o.onDragEnd) row.addEventListener("dragend", o.onDragEnd);
    return row;
}

// 分类行「⋯」更多菜单（重命名 / 新建子分类 / 删除）
function openCatCtx(anchor, items) {
    closeMoreMenu();
    const menu = document.createElement("div");
    menu.className = "wm-pm-more-menu";
    items.forEach((it) => {
        const mi = document.createElement("div");
        mi.className = "wm-pm-more-item" + (it.danger ? " danger" : "");
        mi.innerHTML = (it.icon || "") + "<span>" + it.label + "</span>";
        mi.addEventListener("click", (ev) => { ev.stopPropagation(); closeMoreMenu(); it.onClick && it.onClick(); });
        menu.append(mi);
    });
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 6, left = rect.left;
    if (top + 240 > window.innerHeight) top = rect.top - 240;
    menu.style.position = "fixed";
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
    document.body.append(menu);
    setTimeout(() => document.addEventListener("click", closeMoreMenu), 0);
}

// 给目录行挂拖入逻辑：拖入的卡片（含选中整体）移动到 (folder, parent)
function attachDirDrop(d, folder, parent) {
    d.addEventListener("dragover", (e) => {
        e.preventDefault();
        d.classList.add("drag-over");
    });
    d.addEventListener("dragleave", () => d.classList.remove("drag-over"));
    d.addEventListener("drop", (e) => {
        const data = e.dataTransfer.getData("text/plain") || "";
        if (data.startsWith("small:")) return; // 小分类重排交给 buildSmallRow 的 drop 处理
        if (data.startsWith("reorder-big:")) return; // 大分类重排交给外层 wrap 的 drop（放行冒泡）
        e.preventDefault();
        e.stopPropagation(); // 阻止冒泡到外层大分类区块，确保卡片落入的是此小分类而非大分类
        d.classList.remove("drag-over");
        const id = data;
        if (!id) return;
        let ids = [id];
        if (state.selected.size > 0 && state.selected.has(id)) ids = [...state.selected];
        apiFetch(API_PRESETS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "move_many", ids, folder, parent }),
        }).then((r) => {
            state.selected.clear();
            loadPresets();
            if (r && r.success) toast("已移动 " + (r.moved || ids.length) + " 项");
        });
    });
}

// 大分类区块拖入：small: 前缀=小分类重新归类；否则=预设移动到该大分类
function attachBigDrop(wrap, bigName) {
    wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.classList.add("drop-active"); });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("drop-active"));
    wrap.addEventListener("drop", (e) => {
        e.preventDefault();
        wrap.classList.remove("drop-active");
        const data = e.dataTransfer.getData("text/plain") || "";
        if (data.startsWith("reorder-big:")) return; // 大分类重排交给容器级 drop（放宽落点，区块缝隙也接受）
        if (data.startsWith("small:")) {
            // 数据格式： "small:<小分类名>|<旧大分类名>"
            const payload = data.slice("small:".length);
            const sep = payload.indexOf("|");
            const name = payload.slice(0, sep);
            const oldParent = payload.slice(sep + 1);
            // 同一大分类内的排序交给小分类行 drop 处理；此处忽略，避免误判为跨类归类而误报「目标大分类下已存在同名小分类」
            if (oldParent === bigName) return;
            apiFetch(API_PRESETS, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "move_folder", name, old_parent: oldParent, new_parent: bigName }),
            }).then((r) => {
                if (r && r.success) {
                    state.expanded.add(bigName);
                    loadPresets();
                    toast("已将「" + name + "」归类到「" + bigName + "」");
                } else {
                    alert("归类失败：" + (r && r.message));
                }
            });
            return;
        }
        // 预设卡片拖入 → 移动到该大分类（folder 留空，按 parent 归类）
        const id = data;
        if (!id) return;
        let ids = [id];
        if (state.selected.size > 0 && state.selected.has(id)) ids = [...state.selected];
        apiFetch(API_PRESETS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "move_many", ids, folder: "", parent: bigName }),
        }).then((r) => {
            state.selected.clear();
            loadPresets();
            if (r && r.success) toast("已移动 " + (r.moved || ids.length) + " 项到「" + bigName + "」");
        });
    });
}

// 容器级大分类重排：整个左栏目录面板都是大分类重排落点（含区块间缝隙）。
// attachBigDrop 里 reorder-big 不再处理、冒泡到这里统一按鼠标 Y 在各大分类区块中线定位。
function attachBigReorderZone(box) {
    box.addEventListener("dragover", (e) => {
        const t = (e.dataTransfer && e.dataTransfer.types) || [];
        if (Array.from(t).includes("text/plain")) e.preventDefault(); // 允许投放
    });
    box.addEventListener("drop", (e) => {
        const data = e.dataTransfer.getData("text/plain") || "";
        if (!data.startsWith("reorder-big:")) return; // 小分类/预设拖放交给各自处理器
        e.preventDefault();
        e.stopPropagation();
        const dragged = data.slice("reorder-big:".length);
        const blocks = Array.from(box.querySelectorAll(".wm-pm-big"));
        let target = null, after = false;
        for (const blk of blocks) {
            const rect = blk.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) { target = blk.dataset.bigName; after = false; break; }
            target = blk.dataset.bigName; after = true; // 越过该区块中线 → 插到它之后
        }
        if (!target || target === dragged) return;
        reorderBigFolders(dragged, target, after);
    });
}

// ============ 分类重排 / 重命名 / 导入导出 辅助 ============

// 取某大分类下小分类的当前顺序（来自 state.folders 树）
function getSmallNames(bigName) {
    const big = (state.folders || []).find((f) => f.type === "big" && f.name === bigName);
    return big && big.children ? big.children.map((c) => c.name) : [];
}
// 取大分类的当前顺序
function getBigNames() {
    return (state.folders || []).filter((f) => f.type === "big").map((f) => f.name);
}

// 大分类勾选框 = 全选 / 取消其下所有小分类（切换所有子 S|| 键）
function toggleBigCats(f) {
    const childKeys = (f.children || []).map((c) => "S||" + c.name + "|" + f.name);
    if (!childKeys.length) return;
    const allOn = childKeys.every((k) => state.exportCats.has(k));
    if (allOn) childKeys.forEach((k) => state.exportCats.delete(k));
    else childKeys.forEach((k) => state.exportCats.add(k));
    renderFolders(); // 同步各子分类复选框与底部操作条
}

// 大分类拖拽重排
function reorderBigFolders(dragged, target, after) {
    const names = getBigNames();
    if (!names.includes(dragged) || dragged === target) return;
    const without = names.filter((n) => n !== dragged);
    let idx = without.indexOf(target);
    if (idx < 0) idx = without.length;
    else if (after) idx += 1;
    without.splice(idx, 0, dragged);
    apiFetch(API_PRESETS, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder_folders", parent: "", names: without }),
    }).then((r) => { if (r && r.success) loadPresets(); else alert("排序失败：" + (r && r.message)); });
}

// 小分类在同一大分类内拖拽重排
function reorderSmallWithinBig(bigName, dragged, target, after) {
    const names = getSmallNames(bigName);
    if (!names.includes(dragged)) return;
    const without = names.filter((n) => n !== dragged);
    let idx = without.indexOf(target);
    if (idx < 0) idx = without.length;
    else if (after) idx += 1;
    without.splice(idx, 0, dragged);
    apiFetch(API_PRESETS, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder_folders", parent: bigName, names: without }),
    }).then((r) => { if (r && r.success) loadPresets(); else alert("排序失败：" + (r && r.message)); });
}

// 卡片拖到卡片上重排：把 draggedId 插到 targetId 之前/之后（after 时取目标的下一张可见卡片作 beforeId）。
// 后端 reorder 在全局预设数组内把 id 移到 beforeId 之前；beforeId 为空则移到末尾。
function reorderPreset(draggedId, targetId, after) {
    if (!draggedId || draggedId === targetId) return;
    let beforeId = targetId;
    if (after) {
        const ids = visiblePresets().map((p) => p.id);
        const idx = ids.indexOf(targetId);
        beforeId = (idx >= 0 && idx + 1 < ids.length) ? ids[idx + 1] : null;
    }
    apiFetch(API_PRESETS, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", id: draggedId, beforeId }),
    }).then((r) => { if (r && r.success) loadPresets(); else alert("排序失败：" + (r && r.message)); });
}

// 重命名分类（大/小）
function renameCategory(oldName, newName, parent) {
    newName = (newName || "").trim();
    if (!newName) return;
    if (newName === oldName) return;
    apiFetch(API_PRESETS, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename_folder", old_name: oldName, new_name: newName, parent: parent || "" }),
    }).then((r) => {
        if (r && r.success) {
            // 若正在查看该分类，同步更新当前视图
            if (parent === "" && state.parent === oldName) state.parent = newName;
            if (state.folder === oldName && state.parent === (parent || "")) state.folder = newName;
            loadPresets();
        } else {
            alert("重命名失败：" + (r && r.message));
        }
    });
}

// 双击分类名 → 内联编辑
function startInlineRename(nameEl, oldName, parent) {
    if (nameEl.querySelector("input")) return;
    const input = document.createElement("input");
    input.className = "wm-pm-rename-input";
    input.value = oldName;
    nameEl.textContent = "";
    nameEl.append(input);
    input.focus();
    input.select();
    let done = false;
    const commit = () => { if (done) return; done = true; renameCategory(oldName, input.value, parent); };
    const cancel = () => { if (done) return; done = true; nameEl.textContent = oldName; };
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("click", (e) => e.stopPropagation());
}

// ============ 导入 / 导出 ============
function downloadJSON(arr, filename) {
    const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function collectExportPresets(kind) {
    if (kind === "selected") {
        return (state.presets || []).filter((p) => state.selected.has(p.id));
    }
    if (kind === "current") {
        return visiblePresets();
    }
    // cats / all 需要全量
    const all = await apiFetch(API_PRESETS + "?all=1");
    const allPresets = (all && all.presets) || [];
    if (kind === "all") return allPresets;
    // cats：按勾选的分类过滤
    const out = [];
    allPresets.forEach((p) => {
        for (const key of state.exportCats) {
            if (key.startsWith("B||")) {
                if (p.parent === key.slice(3)) { out.push(p); break; }
            } else if (key.startsWith("S||")) {
                const sep = key.indexOf("|", 3);
                const name = key.slice(3, sep);
                const parent = key.slice(sep + 1);
                if (p.folder === name && p.parent === parent) { out.push(p); break; }
            }
        }
    });
    return out;
}

async function doExport(kind) {
    const list = await collectExportPresets(kind);
    if (!list || !list.length) { toast("没有可导出的内容"); return; }
    const slim = list.map((p) => ({ name: p.name, content: p.content, folder: p.folder, parent: p.parent, image: p.image }));
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadJSON(slim, "windmix_presets_" + kind + "_" + ts + ".json");
    toast("已导出 " + slim.length + " 条预设");
}

function openExportMenu(btn) {
    closeMoreMenu();
    const menu = document.createElement("div");
    menu.className = "wm-pm-more-menu";
    const items = [];
    if (state.selected.size > 0) items.push({ label: "导出选中卡片 (" + state.selected.size + ")", fn: () => doExport("selected") });
    if (state.exportCats.size > 0) items.push({ label: "导出选中分类 (" + state.exportCats.size + ")", fn: () => doExport("cats") });
    items.push({ label: "导出当前目录", fn: () => doExport("current") });
    items.push({ label: "导出全部预设", fn: () => doExport("all") });
    items.forEach((it) => {
        const mi = document.createElement("div");
        mi.className = "wm-pm-more-item";
        mi.textContent = it.label;
        mi.addEventListener("click", (ev) => { ev.stopPropagation(); closeMoreMenu(); it.fn(); });
        menu.append(mi);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = Math.max(8, rect.right - 160) + "px";
    menu.style.top = (rect.bottom + 6) + "px";
    document.body.append(menu);
    setTimeout(() => document.addEventListener("click", closeMoreMenu), 0);
}

function importFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); }
        catch (e) { alert("JSON 解析失败：" + e.message); return; }
        apiFetch(API_PRESETS, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "import_presets", data: parsed }),
        }).then((r) => {
            if (r && r.success) {
                state.folder = "全部预设";
                state.parent = "";
                state.expanded = new Set();
                saveViewState();
                loadPresets();
                toast("已导入 " + (r.added || 0) + " 条预设到「未分类/未分类」");
            } else {
                alert("导入失败：" + (r && r.message));
            }
        });
    };
    reader.onerror = () => alert("文件读取失败");
    reader.readAsText(file);
}

// ============ 选中分类的上下文操作条（移动 / 导出 / 删除） ============
function updateCatSelBar() {
    if (!els.selbar) return;
    const small = [...state.exportCats].filter((k) => k.startsWith("S||"));
    const big = [...state.exportCats].filter((k) => k.startsWith("B||"));
    if (state.exportCats.size === 0) { els.selbar.classList.remove("show"); return; }
    els.selbar.classList.add("show");
    let txt = "已选 " + small.length + " 个小分类";
    if (big.length) txt += " / " + big.length + " 个大分类";
    els.selbarCount.textContent = txt;
    // 移动只针对小分类；只勾了大类时置灰并提示
    els.moveBtn.disabled = small.length === 0;
    els.moveBtn.title = small.length ? "将勾选的小分类移动到其他大分类" : "请至少勾选一个小分类（大类不能作为移动目标）";
}

// 「移动到…」浮层：列出所有大分类作为目标
function openMoveMenu(btn) {
    closeMoreMenu();
    closeMovePop();
    const pop = document.createElement("div");
    pop.className = "wm-pm-move-pop";
    const title = document.createElement("div");
    title.className = "wm-pm-move-title";
    title.textContent = "移动勾选的小分类到大分类：";
    pop.append(title);
    const bigs = (state.folders || []).filter((f) => f.type === "big").map((f) => f.name);
    bigs.forEach((bn) => {
        const it = document.createElement("div");
        it.className = "wm-pm-move-item";
        it.textContent = bn;
        it.addEventListener("click", (ev) => { ev.stopPropagation(); closeMovePop(); moveSelectedCats(bn); });
        pop.append(it);
    });
    const newIt = document.createElement("div");
    newIt.className = "wm-pm-move-item new";
    newIt.textContent = "＋ 新建大分类…";
    newIt.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        closeMovePop();
        const nm = prompt("新建目标大分类名称：");
        if (!nm) return;
        const nmt = nm.trim();
        if (!nmt) return;
        await apiFetch(API_PRESETS, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add_folder", name: nmt, parent: "" }),
        }).catch(() => {});
        moveSelectedCats(nmt);
    });
    pop.append(newIt);
    const rect = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, rect.left) + "px";
    pop.style.top = (rect.top - 8) + "px"; // 配合 CSS transform:translateY(-100%) 向上展开
    document.body.append(pop);
    setTimeout(() => document.addEventListener("click", closeMovePop), 0);
    els._movePop = pop;
}
function closeMovePop() {
    if (els._movePop) { els._movePop.remove(); els._movePop = null; document.removeEventListener("click", closeMovePop); }
}

// 把勾选的每一个小分类移动到目标大分类（复用后端 move_folder）
function moveSelectedCats(targetBig) {
    if (!targetBig) return;
    const small = [...state.exportCats].filter((k) => k.startsWith("S||"));
    if (!small.length) return;
    let pending = small.length, done = 0, okCount = 0;
    small.forEach((key) => {
        const sep = key.indexOf("|", 3);
        const name = key.slice(3, sep);
        const oldParent = key.slice(sep + 1);
        apiFetch(API_PRESETS, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "move_folder", name, old_parent: oldParent, new_parent: targetBig }),
        }).then((r) => { if (r && r.success) okCount++; })
            .finally(() => {
                done++;
                if (done === pending) {
                    state.exportCats.clear();
                    state.expanded.add(targetBig);
                    loadPresets();
                    toast("已移动 " + okCount + " 个小分类到「" + targetBig + "」");
                }
            });
    });
}

// 渲染两级目录树：虚拟（全部预设/无目录）→ 大分类区块(可展开，内含小分类)
function renderFolders() {
    const box = els.dirs;
    box.innerHTML = "";
    const folders = state.folders || [];
    folders.forEach((f) => {
        if (f.type === "all") {
            box.append(buildVirtualRow(f, true));
        } else if (f.type === "uncategorized") {
            box.append(buildVirtualRow(f, false));
        } else if (f.type === "big") {
            box.append(buildBigBlock(f));
        }
    });
    // 注：新建大分类入口已在左栏顶部「大分类」按钮，底部不再重复添加
    updateCatSelBar();
}

async function deleteFolder(name, parent) {
    // 取全量预设（不受当前视图过滤影响），准确判断该文件夹是否为空
    const all = await apiFetch(API_PRESETS + "?all=1");
    const presets = (all && all.presets) || state.presets || [];
    const count = parent
        ? presets.filter((p) => p.folder === name && p.parent === parent).length
        : presets.filter((p) => p.parent === name || (p.parent === "" && p.folder === name)).length;
    // 空文件夹直接删除；非空才弹确认（并显示将一并删除的预设数量）
    if (count > 0 && !confirm("确定删除目录「" + name + "」？该目录下的 " + count + " 条预设将一并永久删除，不可恢复！")) return;
    const r = await apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_folder", name, parent: parent || "", purge: true }),
    });
    if (r && r.success) {
        // 若当前正在查看被删除的目录，退回「全部预设」
        if ((state.parent === name && state.folder === (parent || "")) ||
            (parent === "" && state.parent === name)) {
            state.folder = "全部预设";
            state.parent = "";
        }
        loadPresets();
    } else {
        alert("删除目录失败：" + (r && r.message));
    }
}

// 批量删除当前勾选的分类（小分类 + 大分类）：一次确认、逐个调后端 delete_folder
async function deleteSelectedCats() {
    const small = [...state.exportCats]
        .filter((k) => k.startsWith("S||"))
        // key 格式："S||<小分类名>|<大分类名>"（含两个分隔符），不能用 split("||") 一次拆出 3 段
        .map((k) => {
            const rest = k.slice(3); // 去掉 "S||"
            const i = rest.indexOf("|");
            return { name: rest.slice(0, i), parent: rest.slice(i + 1) };
        });
    const big = [...state.exportCats]
        .filter((k) => k.startsWith("B||"))
        .map((k) => ({ name: k.slice(3), parent: "" }));
    if (!small.length && !big.length) return;
    // 计算受影响预设数（去重，避免大分类与其小分类重复计入）
    const all = await apiFetch(API_PRESETS + "?all=1");
    const presets = (all && all.presets) || state.presets || [];
    const aff = new Set();
    for (const s of small) for (const p of presets) if (p.folder === s.name && p.parent === s.parent) aff.add(p.id);
    for (const b of big) for (const p of presets) if (p.parent === b.name) aff.add(p.id);
    const n = small.length + big.length;
    const msg = "确定删除选中的 " + n + " 个分类？" +
        (aff.size ? "其下的 " + aff.size + " 条预设将一并永久删除，不可恢复！" : "其中没有预设。");
    if (!confirm(msg)) return;
    const callDelete = (name, parent) => apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_folder", name, parent: parent || "", purge: true }),
    });
    let failed = 0;
    // 先删小分类，再删大分类：避免大分类级联删除已删的小分类时后端报「未找到」
    for (const s of small) { const r = await callDelete(s.name, s.parent); if (!(r && r.success)) failed++; }
    for (const b of big) { const r = await callDelete(b.name, ""); if (!(r && r.success)) failed++; }
    if (failed) alert("有 " + failed + " 个分类删除失败（可能已被移除）。");
    // 若当前正停留在被删目录，退回「全部预设」
    for (const s of small) {
        if (state.folder === s.name && state.parent === s.parent) { state.folder = "全部预设"; state.parent = ""; }
    }
    for (const b of big) {
        if (state.parent === b.name) { state.folder = "全部预设"; state.parent = ""; }
    }
    state.exportCats.clear();
    loadPresets();
}

function visiblePresets() {
    const q = state.search.trim().toLowerCase();
    let list = state.presets;
    if (q) list = list.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.content || "").toLowerCase().includes(q));
    return list;
}

function bannerBg(p) {
    if (p.image) return "url('" + API_IMAGE + "?path=" + encodeURIComponent(p.image) + "')";
    return "";
}

// 弹出大图欣赏：滚轮缩放、点击图片切换 1:1 / 2×、点击空白关闭
function openLightbox(p) {
    if (!p.image) return;
    closeLightbox();
    const lb = document.createElement("div");
    lb.className = "wm-pm-lightbox";
    const img = document.createElement("img");
    img.src = API_IMAGE + "?path=" + encodeURIComponent(p.image);
    img.alt = p.name || "";
    let scale = 1;
    img.addEventListener("click", (e) => {
        e.stopPropagation();
        scale = scale > 1.05 ? 1 : 2;
        img.style.transform = "scale(" + scale + ")";
    });
    img.addEventListener("wheel", (e) => {
        e.preventDefault();
        scale = Math.min(4, Math.max(0.5, scale + (e.deltaY < 0 ? 0.2 : -0.2)));
        img.style.transform = "scale(" + scale + ")";
    }, { passive: false });
    const close = document.createElement("div");
    close.className = "lb-close";
    close.textContent = "✕";
    close.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
    const hint = document.createElement("div");
    hint.className = "lb-hint";
    hint.textContent = "滚轮缩放 · 点击图片切换 1:1 / 2× · 点击空白处关闭";
    lb.append(img, close, hint);
    lb.addEventListener("click", closeLightbox);
    document.body.append(lb);
    els._lightbox = lb;
}
function closeLightbox() {
    if (els._lightbox) { els._lightbox.remove(); els._lightbox = null; }
}

function renderPresets() {
    const list = els.list;
    list.className = "wm-pm-list" + (state.layout === "card" ? " grid" : "");
    list.innerHTML = "";
    const presets = visiblePresets();
    if (!presets.length) {
        const e = document.createElement("div");
        e.className = "wm-pm-empty";
        e.textContent = "暂无预设，点击右上「新建预设」";
        list.append(e);
        return;
    }
    presets.forEach((p) => {
        if (state.layout === "card") list.append(buildCard(p));
        else list.append(buildRow(p));
    });
    updateSelCount();
}

function buildCard(p) {
    const card = document.createElement("div");
    card.className = "wm-pm-card" + (state.selected.has(p.id) ? " selected" : "");
    card.draggable = false; // 拖拽由标题栏触发，避免与缩略图点击冲突

    // 缩略图 banner：点击/拖入上传；悬停浮现操作条
    const banner = document.createElement("div");
    banner.className = "wm-pm-banner";
    const bg = bannerBg(p);
    if (bg) {
        banner.style.backgroundImage = bg;
        banner.title = "点击查看大图";
    } else {
        banner.innerHTML = '<span class="wm-pm-ph">' + PLACEHOLDER_SVG + "</span>";
        banner.title = "点击或拖入图片设置缩略图";
    }
    const actions = document.createElement("div");
    actions.className = "wm-pm-actions";
    // 第三个按钮：复制（在原卡片后生成副本）；重命名与导出 JSON 在其它入口已有，故此处只保留复制
    const copyBtn = document.createElement("span");
    copyBtn.className = "wm-pm-act copy";
    copyBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
    copyBtn.title = "复制（在原卡片后生成副本）";
    copyBtn.addEventListener("click", (e) => { e.stopPropagation(); duplicatePresetAfter(p); });
    const actRow = document.createElement("div");
    actRow.className = "wm-pm-act-row";
    actRow.append(
        actBtn(EDIT_SVG, "edit", "编辑", () => openEditor(p)),
        actBtn(SEND_SVG, "send", "发送", () => sendPreset(p)),
        copyBtn,
    );
    actions.append(actRow);
    banner.append(actions);
    // 缩略图底部：点击/拖入设图提示（半透明底框，悬停浮现；比设计稿 7px 加高）
    const cap = document.createElement("div");
    cap.className = "wm-pm-banner-cap";
    cap.innerHTML = SET_ICON_SVG + "<span>点击或拖入图片设置缩略图</span>";
    cap.addEventListener("click", (e) => {
        e.stopPropagation();
        _pendingUploadPreset = p;
        if (els.uploadInput) els.uploadInput.click();
    });
    banner.append(cap);

    // 删除按钮直接挂在图片(banner)右上角，悬停时浮现，独立于三个居中按钮
    const delBtn = document.createElement("span");
    delBtn.className = "wm-pm-del-corner";
    delBtn.textContent = "✕";
    delBtn.title = "删除";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deletePreset(p); });
    banner.append(delBtn);

    // 缩略图(有图)点击 = 弹出大图欣赏；无图时点击不响应（设置走下方专用框）
    banner.addEventListener("click", () => {
        if (bg) { openLightbox(p); return; }
        _pendingUploadPreset = p;
        if (els.uploadInput) els.uploadInput.click();
    });
    banner.addEventListener("dragover", (e) => {
        // 仅拦截「文件」拖放用于设图；预设卡片拖放(text/plain)放行冒泡给 card 做重排
        if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault(); e.stopPropagation(); banner.classList.add("hover");
        }
    });
    banner.addEventListener("dragleave", () => banner.classList.remove("hover"));
    banner.addEventListener("drop", (e) => {
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) { e.preventDefault(); e.stopPropagation(); banner.classList.remove("hover"); uploadCardImage(p, f); }
    });

    // 标题栏：点击=选中（外圈加粗高亮）；拖拽=移动到其他分类
    const body = document.createElement("div");
    body.className = "body";
    body.draggable = true;
    body.title = "点击选中 · 拖拽到左侧分类可移动";
    const title = document.createElement("span");
    title.className = "wm-pm-title";
    title.textContent = p.name;
    body.append(title);
    body.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.selected.has(p.id)) state.selected.delete(p.id);
        else state.selected.add(p.id);
        card.classList.toggle("selected", state.selected.has(p.id));
        updateSelCount();
    });
    body.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", p.id);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
        try { e.dataTransfer.setDragImage(card, 20, 20); } catch (_) {}
    });
    body.addEventListener("dragend", () => card.classList.remove("dragging"));

    // 卡片拖到卡片上 = 重排（预设 id 拖放；文件拖放已在 banner 拦截用于设图）
    card.addEventListener("dragover", (e) => {
        const t = (e.dataTransfer && e.dataTransfer.types) || [];
        if (Array.from(t).includes("Files")) return; // 文件拖放交给 banner
        e.preventDefault();
        card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", (e) => {
        card.classList.remove("drop-target");
        const id = e.dataTransfer.getData("text/plain");
        if (!id || id === p.id) return;
        if (!state.presets.some((x) => x.id === id)) return; // 非本插件预设拖放，忽略
        e.preventDefault();
        e.stopPropagation();
        const rect = card.getBoundingClientRect();
        const after = (e.clientX - rect.left) > rect.width / 2; // 网格按左右半区插入前/后
        reorderPreset(id, p.id, after);
    });

    // 选中态角标（左上角紫色圆形对勾）
    const cardBadge = document.createElement("div");
    cardBadge.className = "sel-badge";
    cardBadge.innerHTML = CHECK_SVG;

    card.append(cardBadge, banner, body);
    return card;
}

function buildRow(p) {
    const row = document.createElement("div");
    row.className = "wm-pm-row" + (state.selected.has(p.id) ? " selected" : "");
    row.title = "点击选中（可批量发送）";
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const bg = bannerBg(p);
    if (bg) {
        thumb.style.backgroundImage = bg;
        thumb.title = "点击查看大图";
    } else {
        thumb.innerHTML = PLACEHOLDER_SVG;
        thumb.title = "点击设置预览图";
    }
    thumb.addEventListener("click", (e) => {
        e.stopPropagation();
        if (bg) openLightbox(p);
        else { _pendingUploadPreset = p; if (els.uploadInput) els.uploadInput.click(); }
    });
    thumb.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        thumb.classList.add("hover");
    });
    thumb.addEventListener("dragleave", () => thumb.classList.remove("hover"));
    thumb.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        thumb.classList.remove("hover");
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uploadCardImage(p, f);
    });
    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = p.name;
    const prev = document.createElement("div");
    prev.className = "prev";
    prev.textContent = p.content || "";
    meta.append(name, prev);
    const actions = document.createElement("div");
    actions.className = "wm-pm-row-actions";
    actions.append(
        iconBtn(EDIT_SVG, "edit", () => openEditor(p)),
        iconBtn(SEND_SVG, "send", () => sendPreset(p)),
        iconBtn(DEL_SVG, "del", () => deletePreset(p)),
    );
    // 点击行 = 选中/取消（外圈高亮）
    row.addEventListener("click", () => {
        if (state.selected.has(p.id)) state.selected.delete(p.id);
        else state.selected.add(p.id);
        row.classList.toggle("selected", state.selected.has(p.id));
        updateSelCount();
    });
    // 选中态行内对勾
    const rowBadge = document.createElement("div");
    rowBadge.className = "sel-badge";
    rowBadge.innerHTML = CHECK_SVG;
    row.append(thumb, meta, rowBadge, actions);
    return row;
}

function iconBtn(text, cls, fn) {
    const b = document.createElement("span");
    b.className = "wm-pm-ic " + cls;
    b.innerHTML = text;
    b.addEventListener("click", fn);
    return b;
}

// 卡片悬停操作条按钮（默认 pointer-events:none，仅悬停时启用，避免隐形误触）
function actBtn(text, cls, title, fn) {
    const b = document.createElement("span");
    b.className = "wm-pm-act " + cls;
    b.innerHTML = text;
    b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(e); });
    return b;
}

// 「更多 ⋯」下拉菜单：重命名 / 复制 / 导出 JSON
function toggleMoreMenu(card, p) {
    closeMoreMenu();
    const menu = document.createElement("div");
    menu.className = "wm-pm-more-menu";
    const items = [
        { label: "重命名", fn: () => openEditor(p) },
        { label: "复制", fn: () => duplicatePreset(p) },
        { label: "导出 JSON", fn: () => exportPreset(p) },
    ];
    items.forEach((it) => {
        const mi = document.createElement("div");
        mi.className = "wm-pm-more-item";
        mi.textContent = it.label;
        mi.addEventListener("click", (ev) => { ev.stopPropagation(); closeMoreMenu(); it.fn(); });
        menu.append(mi);
    });
    const rect = card.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = Math.max(8, rect.right - 160) + "px";
    menu.style.top = (rect.top + 8) + "px";
    document.body.append(menu);
    setTimeout(() => document.addEventListener("click", closeMoreMenu), 0);
}

function closeMoreMenu() {
    document.querySelectorAll(".wm-pm-more-menu").forEach((m) => m.remove());
    document.removeEventListener("click", closeMoreMenu);
}

function duplicatePreset(p) {
    apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate", id: p.id }),
    }).then((r) => {
        if (r && r.success) { toast("已复制「" + (p.name || "") + "」"); loadPresets(); }
        else alert("复制失败：" + (r && r.message));
    });
}

// 复制并插入到原卡片之后（而非末尾）：后端 after_id 控制插入位置
function duplicatePresetAfter(p) {
    apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate", id: p.id, after_id: p.id }),
    }).then((r) => {
        if (r && r.success) { toast("已复制「" + (p.name || "") + "」到原卡片之后"); loadPresets(); }
        else alert("复制失败：" + (r && r.message));
    });
}

function exportPreset(p) {
    const data = JSON.stringify(
        { name: p.name, content: p.content, folder: p.folder, parent: p.parent, image: p.image },
        null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (p.name || "preset") + ".json";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("已导出「" + (p.name || "") + "」");
}

function clearCardDrag() {
    if (!backdrop) return;
    backdrop.querySelectorAll(".drag-over, .drop-active, .dragging")
        .forEach((el) => el.classList.remove("drag-over", "drop-active", "dragging"));
    closeMoreMenu();
}

// ============ 编辑区（弹出框） ============
// 内容框自动补全：引擎 #setup() 会往 textarea 上挂 keydown/keyup/click/blur 监听，且没有 destroy，
// 而这里的 textarea 是复用同一个元素（不像节点内容弹窗每次重建）→ 只能挂一次实例；
// 每次隐藏时把下拉摘掉即可，引擎的 #update 会在下次输入时重新挂回 document.body。
// 层级：.wm-pm-backdrop 是 z-index:10000 的层叠上下文，编辑弹窗在其中是 100006；
// 下拉挂在 document.body 上，取 100010 稳压整个管理器。
const EDITOR_AC_ZINDEX = 100010;
const EDITOR_AC_WIDTH = 560;
let _editorAc = null;        // 已建立的补全实例（挂在 els.editContent 上）
let _editorAcEl = null;      // 该实例挂载的 textarea（用来判断是否需要重挂）

// 幂等挂载。引擎 #setup() 往 textarea 上绑了 keydown/keypress/keyup/click/blur 且**没有 destroy**
// （都是 bind 出来的匿名函数，removeEventListener 摘不掉），所以「同一个 textarea 只能 new 一次」，
// 否则每次按键会触发多个实例、下拉叠加。
// 这里用「实例 + 目标元素」判断，而不用一次性布尔量：attachAutoComplete 是异步的，
// 若首次因词库还没就绪而返回 null，布尔量一旦置位就再也不重试 → 编辑/新增会永久失去补全。
function bindEditorAutoComplete() {
    if (!els.editContent) return;
    if (_editorAc && _editorAcEl === els.editContent) return; // 已在用，复用实例
    _editorAcEl = els.editContent;
    attachAutoComplete(els.editContent, { zIndex: EDITOR_AC_ZINDEX, width: EDITOR_AC_WIDTH }).then((ac) => {
        if (ac) _editorAc = ac;
    });
}
// 隐藏时只摘下拉的 DOM，**保留实例引用与 textarea 上的监听**：
// 引擎 #update 会在下次输入时按需把下拉重新挂回 document.body。
function clearEditorAutoComplete() {
    detachAutoComplete(_editorAc);
}

function openEditor(p) {
    state.editing = p; // p 可能是已有预设，或新建时传入 {id:null, name:"", content:"", folder:state.folder}
    state.pendingImage = p && p.image ? p.image : "";
    renderEditor();
    bindEditorAutoComplete();
    if (els.editBd) els.editBd.style.display = "flex";
}
function hideEditor() {
    clearEditorAutoComplete();
    if (els.editBd) els.editBd.style.display = "none";
}
function renderEditor() {
    const p = state.editing;
    const isNew = !p || p.id == null;
    els.editLbl.textContent = isNew ? "新建预设" : "正在编辑：" + (p.name || "");
    els.editName.value = p ? p.name || "" : "";
    els.editContent.value = p ? p.content || "" : "";
    // 图片编辑已转移到缩略图直接上传，编辑弹窗不再处理图片
}

async function saveEditor() {
    const p = state.editing;
    const name = els.editName.value.trim();
    const content = els.editContent.value;
    if (!name) {
        alert("名称不能为空");
        return;
    }
    const isNew = !p || p.id == null;
    let image = state.pendingImage;
    // 若有待上传的原图（dataURL），先上传拿路径
    if (image && image.startsWith("data:")) {
        try {
            const r = await apiFetch(API_IMAGE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: image }),
            });
            if (r && r.success) image = r.path;
            else image = "";
        } catch (e) {
            image = "";
        }
    }
    if (isNew) {
        // 依据当前视图计算归属：(小分类, 大分类)；大分类视图则小分类留空；虚拟视图归无目录
        let folder = "", parent = "";
        if (state.parent && state.folder) { folder = state.folder; parent = state.parent; }
        else if (state.parent && !state.folder) { folder = ""; parent = state.parent; }
        else { folder = ""; parent = ""; }
        const r = await apiFetch(API_PRESETS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "add",
                name,
                content,
                folder,
                parent,
                image,
                enabled: true,
            }),
        });
        if (!r || !r.success) alert("保存失败：" + (r && r.message));
    } else {
        const r = await apiFetch(API_PRESETS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", id: p.id, name, content, image }),
        });
        if (!r || !r.success) alert("保存失败：" + (r && r.message));
    }
    state.editing = null;
    state.pendingImage = "";
    hideEditor();
    loadPresets();
}

async function deletePreset(p) {
    if (!confirm("确定删除预设「" + (p.name || "") + "」？")) return;
    const r = await apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: p.id }),
    });
    if (r && r.success) loadPresets();
}

function sendPreset(p) {
    if (!state.node || !state.node.addPresetTextEntry) {
        alert("未关联到节点");
        return;
    }
    state.node.addPresetTextEntry(p.name, p.content || "");
    toast("已发送「" + (p.name || "") + "」到节点");
}

// 批量发送当前选中的预设到节点
function sendSelected() {
    if (!state.node || !state.node.addPresetTextEntry) {
        alert("未关联到节点");
        return;
    }
    const ids = [...state.selected];
    if (!ids.length) {
        alert("请先勾选要发送的预设");
        return;
    }
    const map = new Map(state.presets.map((p) => [p.id, p]));
    let n = 0;
    ids.forEach((id) => {
        const p = map.get(id);
        if (p) {
            state.node.addPresetTextEntry(p.name, p.content || "");
            n++;
        }
    });
    toast("已发送 " + n + " 条选中预设到节点");
    state.selected.clear();
    renderPresets();
    updateSelCount();
}

// 更新「发送选中」按钮文案与可用状态
function updateSelCount() {
    if (!els.sendSel) return;
    const n = state.selected.size;
    els.sendSel.textContent = n > 0 ? "发送选中 (" + n + ")" : "发送选中";
    els.sendSel.disabled = n === 0;
}

async function sendFolder() {
    if (!state.node || !state.node.addPresetTextFolder) {
        alert("未关联到节点");
        return;
    }
    const list = state.presets.filter((p) => p.enabled !== false);
    if (!list.length) {
        alert("当前目录没有可发送的预设");
        return;
    }
    // 用当前目录名作为节点内文件夹名；大分类视图用大分类名，虚拟视图用更具描述性的名字
    let fname = state.folder || state.parent || "预设目录";
    if (fname === "全部预设" || fname === "无目录") fname = "来自预设的文件夹";
    state.node.addPresetTextFolder(fname, list.map((p) => ({
        title: p.name || "",
        content: p.content || "",
        enabled: p.enabled !== false,
    })));
    toast("已发送目录「" + fname + "」到节点（含 " + list.length + " 条）");
}

// ============ 新建目录 / 新建预设 ============
// 新建大分类（parent=""）
function newBigFolder() {
    const name = prompt("新大分类名称：");
    if (!name) return;
    const nm = name.trim();
    apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_folder", name: nm, parent: "" }),
    }).then((r) => {
        if (r && r.success) {
            state.expanded.add(nm);
            loadPresets();
        } else alert("新建大分类失败：" + (r && r.message));
    });
}

// 在指定大分类下新建小分类
function newSmallFolder(bigName) {
    const name = prompt("在「" + bigName + "」下新建小分类名称：");
    if (!name) return;
    const nm = name.trim();
    apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_folder", name: nm, parent: bigName }),
    }).then((r) => {
        if (r && r.success) {
            state.expanded.add(bigName);
            loadPresets();
        } else alert("新建小分类失败：" + (r && r.message));
    });
}

function newPreset() {
    state.editing = { id: null, name: "", content: "", folder: state.folder, image: "" };
    state.pendingImage = "";
    renderEditor();
    bindEditorAutoComplete();
    if (els.editBd) els.editBd.style.display = "flex";
}

// ============ 构建 Modal ============
function buildModal() {
    injectStyle();
    backdrop = document.createElement("div");
    backdrop.className = "wm-pm-backdrop";
    backdrop.style.display = "none";
    backdrop.addEventListener("mousedown", (e) => {
        if (e.target === backdrop) close();
    });

    const modal = document.createElement("div");
    modal.className = "wm-pm-modal";

    // 左栏
    const left = document.createElement("div");
    left.className = "wm-pm-left";
    const lhead = document.createElement("div");
    lhead.className = "wm-pm-left-head";
    const ltitle = document.createElement("span");
    ltitle.textContent = "预设目录";
    const fbtn = document.createElement("button");
    fbtn.className = "wm-pm-folder-btn";
    fbtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9b8af5" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> 大分类';
    fbtn.addEventListener("click", newBigFolder);
    lhead.append(ltitle, fbtn);
    const dirs = document.createElement("div");
    dirs.className = "wm-pm-dirs";
    attachBigReorderZone(dirs); // 整个左栏都接受大分类重排拖放（含缝隙）
    const sendAll = document.createElement("button");
    sendAll.className = "wm-pm-sendall";
    sendAll.textContent = "发送整个目录到节点";
    sendAll.addEventListener("click", sendFolder);
    // 选中分类后的上下文操作条（勾选小分类才浮现）：移动 / 导出 / 删除
    const selbar = document.createElement("div");
    selbar.className = "wm-pm-selbar";
    const selbarCount = document.createElement("div");
    selbarCount.className = "wm-pm-selbar-count";
    const selbarBtns = document.createElement("div");
    selbarBtns.className = "wm-pm-selbar-btns";
    const moveBtn = document.createElement("button");
    moveBtn.textContent = "移动到…";
    moveBtn.title = "将勾选的小分类移动到其他大分类";
    moveBtn.addEventListener("click", (e) => { e.stopPropagation(); openMoveMenu(moveBtn); });
    const expSelBtn = document.createElement("button");
    expSelBtn.className = "ghost";
    expSelBtn.textContent = "导出选中";
    expSelBtn.addEventListener("click", () => { closeMoreMenu(); doExport("cats"); });
    const clearBtn = document.createElement("button");
    clearBtn.className = "danger";
    clearBtn.textContent = "删除";
    clearBtn.title = "删除选中的分类（其下预设一并永久删除，不可恢复）";
    clearBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteSelectedCats(); });
    selbarBtns.append(moveBtn, expSelBtn, clearBtn);
    selbar.append(selbarCount, selbarBtns);
    left.append(lhead, dirs, selbar, sendAll);

    // 右栏
    const right = document.createElement("div");
    right.className = "wm-pm-right";
    const rhead = document.createElement("div");
    rhead.className = "wm-pm-rhead";
    const ttl = document.createElement("span");
    ttl.className = "ttl";
    ttl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9b8af5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    // 当前查看分类名（显示在搜索框左侧，类似设计稿）
    const catChip = document.createElement("span");
    catChip.className = "wm-pm-cat-chip";
    catChip.textContent = "全部预设";
    const search = document.createElement("input");
    search.className = "wm-pm-search";
    search.placeholder = "搜索…";
    let _searchTimer = null;
    search.addEventListener("input", () => {
        state.search = search.value;
        // 防抖：预设量大（数百条卡片）时每敲一个字符就全量重建 DOM 会明显卡顿，
        // 合并连续输入后只渲染一次；搜索功能本身不变
        if (_searchTimer) clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => renderPresets(), 180);
    });
    const toggle = document.createElement("div");
    toggle.className = "wm-pm-toggle";
    const CARD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
    const TABLE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>';
    const tCard = document.createElement("span");
    tCard.innerHTML = CARD_ICON;
    tCard.title = "卡片";
    tCard.className = state.layout === "card" ? "on" : "";
    const tTable = document.createElement("span");
    tTable.innerHTML = TABLE_ICON;
    tTable.title = "表格";
    tTable.className = state.layout === "table" ? "on" : "";
    tCard.addEventListener("click", () => {
        state.layout = "card";
        tCard.className = "on";
        tTable.className = "";
        renderPresets();
    });
    tTable.addEventListener("click", () => {
        state.layout = "table";
        tTable.className = "on";
        tCard.className = "";
        renderPresets();
    });
    toggle.append(tCard, tTable);
    // 分组②：选择类 —— 全选 / 导入 / 导出
    const selectAllBtn = document.createElement("button");
    selectAllBtn.className = "wm-pm-tool";
    selectAllBtn.innerHTML = TOOL_SELALL_SVG + "<span>全选</span>";
    selectAllBtn.title = "选中当前视图全部卡片（再次点击取消）";
    selectAllBtn.addEventListener("click", () => {
        const visible = visiblePresets();
        const allSel = visible.length > 0 && visible.every((p) => state.selected.has(p.id));
        if (allSel) state.selected.clear();
        else visible.forEach((p) => state.selected.add(p.id));
        renderPresets();
        updateSelCount();
    });
    const importBtn = document.createElement("button");
    importBtn.className = "wm-pm-tool";
    importBtn.innerHTML = TOOL_IMPORT_SVG + "<span>导入</span>";
    importBtn.title = "导入 JSON（自动保留其中的小分类/大分类，缺失分类会自动创建）";
    importBtn.addEventListener("click", () => { if (els.importInput) els.importInput.click(); });
    const exportBtn = document.createElement("button");
    exportBtn.className = "wm-pm-tool";
    exportBtn.innerHTML = TOOL_EXPORT_SVG + "<span>导出</span>";
    exportBtn.title = "导出：选中卡片 / 选中分类 / 当前目录 / 全部";
    exportBtn.addEventListener("click", (e) => { e.stopPropagation(); openExportMenu(exportBtn); });
    // 分隔线
    const sep1 = document.createElement("div");
    sep1.className = "wm-pm-sep";
    const sep2 = document.createElement("div");
    sep2.className = "wm-pm-sep";
    // 分组③：动作类 —— 发送选中 / ＋ 新建预设
    const sendSel = document.createElement("button");
    sendSel.className = "wm-pm-tool primary";
    sendSel.textContent = "发送选中";
    sendSel.disabled = true;
    sendSel.title = "将选中的预设批量发送到节点";
    sendSel.addEventListener("click", sendSelected);
    const newP = document.createElement("button");
    newP.className = "wm-pm-tool ghost";
    newP.innerHTML = TOOL_NEW_SVG + "<span>新建预设</span>"; // 图标本身就是加号，文字里不再重复写「＋」
    newP.addEventListener("click", newPreset);
    rhead.append(ttl, catChip, search, toggle, sep1, selectAllBtn, importBtn, exportBtn, sep2, sendSel, newP);

    const list = document.createElement("div");
    list.className = "wm-pm-list";

    right.append(rhead, list);
    modal.append(left, right);
    backdrop.append(modal);

    // 编辑区（改为弹出框，与前端的输入弹窗一致）
    const editBd = document.createElement("div");
    editBd.className = "wm-pm-edit-modal-bd";
    editBd.style.display = "none";
    const editModal = document.createElement("div");
    editModal.className = "wm-pm-edit-modal";
    const editLbl = document.createElement("h4");
    const erow = document.createElement("div");
    erow.className = "erow";
    const editName = document.createElement("input");
    editName.className = "e-name";
    editName.placeholder = "名称";
    const editContent = document.createElement("textarea");
    editContent.placeholder = "在此输入文本内容…";
    // 标题在上、内容在下（erow 已是 flex-direction:column）；
    // 图片编辑已转移到缩略图直接点击/拖拽上传，这里不放图片框
    erow.append(editName, editContent);
    const actions = document.createElement("div");
    actions.className = "wm-pm-edit-actions";
    const cancel = document.createElement("button");
    cancel.className = "cancel";
    cancel.textContent = "取消";
    cancel.addEventListener("click", hideEditor);
    const save = document.createElement("button");
    save.className = "ok";
    save.textContent = "保存";
    save.addEventListener("click", saveEditor);
    actions.append(cancel, save);
    editModal.append(editLbl, erow, actions);
    editBd.append(editModal);
    editBd.addEventListener("mousedown", (e) => { if (e.target === editBd) hideEditor(); });
    backdrop.append(editBd);

    // 卡片图片上传用的隐藏文件选择框（共用）
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = "image/*";
    uploadInput.className = "wm-pm-hidden-file";
    uploadInput.addEventListener("change", () => {
        const f = uploadInput.files && uploadInput.files[0];
        const p = _pendingUploadPreset;
        _pendingUploadPreset = null;
        if (f && p) uploadCardImage(p, f);
        uploadInput.value = "";
    });
    backdrop.append(uploadInput);

    // 导入 JSON 用的隐藏文件选择框
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.className = "wm-pm-hidden-file";
    importInput.addEventListener("change", () => {
        const f = importInput.files && importInput.files[0];
        importInput.value = "";
        importFromFile(f);
    });
    backdrop.append(importInput);

    document.body.append(backdrop);

    els = { dirs, list, editBd, editLbl, editName, editContent, ttl, catChip, uploadInput, importInput, sendSel, selbar, selbarCount, moveBtn, _movePop: null };
}

function open(node) {
    if (!backdrop) buildModal();
    state.node = node;
    // 恢复上次浏览的目录与左侧树展开状态；首次打开则默认「全部预设」
    const saved = loadViewState();
    if (saved) {
        state.folder = saved.folder;
        state.parent = saved.parent;
        state.expanded = new Set(saved.expanded);
        // 若上次停留在某小分类，确保其父大分类展开，否则该小分类在树里不可见
        if (saved.folder && saved.parent && saved.folder !== "全部预设" && saved.folder !== "无目录") {
            state.expanded.add(saved.parent);
        }
    } else {
        state.folder = "全部预设";
        state.parent = "";
        state.expanded = new Set();
    }
    updateCatChip();
    state.editing = null;
    state.selected.clear();
    state.exportCats.clear();
    state.pendingImage = "";
    hideEditor();
    backdrop.style.display = "flex";
    if (node && node.__stData && node.__stData.separator) {
        // 同步当前节点所在目录（暂无，使用默认全部预设）
    }
    loadPresets();
}

function close() {
    if (backdrop) backdrop.style.display = "none";
    closeLightbox();
}

// 供 ⚡ 预设文本 节点的「保存到预设」：把一组文本作为新目录存入预设管理器并打开该目录。
async function importFolder(name, entries) {
    if (!backdrop) buildModal();
    const fname = (name || "新建文件夹").trim() || "新建文件夹";
    const post = (payload) => apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).catch(() => ({}));
    // 先确保「未分类」大分类存在（已存在时后端返回失败，忽略即可），
    // 否则创建小分类会被「父级大分类不存在」校验拦下，整目录保存静默失败
    await post({ action: "add_folder", name: "未分类", parent: "" });
    // 新建目录（已存在则忽略错误）——归入「未分类」大分类下作为小分类，与旧模板自动识别逻辑一致
    await post({ action: "add_folder", name: fname, parent: "未分类" });
    // 批量添加：一次请求写完，避免逐条 add 造成预设文件 N+1 次全量重写
    const items = (entries || []).map((e) => ({
        name: (e && e.title) || "未命名",
        content: (e && e.content) || "",
    }));
    if (items.length) {
        await post({ action: "add_many", items, folder: fname, parent: "未分类" });
    }
    // 静默保存：不主动打开弹窗。仅当管理器当前已打开时刷新以显示新目录。
    let opened = false;
    if (backdrop && backdrop.style.display === "flex") {
        state.folder = fname;
        state.parent = "未分类";
        updateCatChip();
        state.expanded.add("未分类");
        state.editing = null;
        state.selected.clear();
        state.pendingImage = "";
        hideEditor();
        saveViewState();
        loadPresets();
        opened = true;
    }
    toast("已保存到预设：「" + fname + "」" + (opened ? "" : "（节点内文件夹已备份）"));
}

// 供 ⚡ 预设文本 节点的单条文本「保存到预设」：单条文本直接存入「未分类/未分类」，不新建目录。
async function importPreset(name, content) {
    if (!backdrop) buildModal();
    const pname = (name || "").trim() || "未命名";
    const post = (payload) => apiFetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).catch(() => ({}));
    // 确保「未分类」大分类与其下同名小分类存在（已存在时后端返回失败，忽略即可）
    await post({ action: "add_folder", name: "未分类", parent: "" });
    await post({ action: "add_folder", name: "未分类", parent: "未分类" });
    await post({ action: "add", name: pname, content: content || "", folder: "未分类", parent: "未分类" });
    // 管理器当前已打开时刷新列表以显示新条目
    if (backdrop && backdrop.style.display === "flex") {
        state.folder = "未分类";
        state.parent = "未分类";
        updateCatChip();
        state.expanded.add("未分类");
        saveViewState();
        loadPresets();
    }
    toast("已保存到预设：「" + pname + "」（未分类）");
}

window.WindMixPresetManager = { open, close, newBigFolder, newSmallFolder, importFolder, importPreset };
