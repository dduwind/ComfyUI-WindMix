// ComfyUI-WindMix — 预设文本管理器（V3 换皮：紫粉渐变深色视觉，供 ⚡ 预设文本 节点调用）
// 顶栏(64px)：W 渐变图标 + 渐变标题「预设文本管理器」+ 副标 WindMix Presets + 搜索框
//   + 全选 / 发送选中(带计数高亮) / 导入 / 导出 / 新建预设(渐变实心)。
// 左目录(300px)：全部预设/无目录虚拟行 + 大分类折叠组(chevron+计数胶囊+⋯菜单)
//   + 小分类圆点行(整行可拖拽调序/跨类移动，⋯菜单含「移动到…」子菜单)。
// 右画廊：衬线大标题 + 计数 meta + 画廊/列表分段切换；卡片=背景图+底部渐变遮罩+标题信息区
//   (tag胶囊/衬线名/一行描述)，悬停正中三圆钮(编辑/复制/发送)+右上删除+左上选中圈；
//   无图卡=紫调纹理+描边首字母大字+悬停底部胶囊设图；单击标题选中/双击行内改名/点图看大图。
// 编辑弹窗(1060px)：左名称+内容(自动补全保留)，右预览图拖放区，保存时压图落盘 presets/images/。
// 数据层不变：API_PRESETS / API_IMAGE、发送节点、导入导出 JSON、localStorage 视图记忆均按原逻辑。
import { app } from "../../scripts/app.js";
// 编辑弹窗的内容框自动补全：与「⚡ 预设文本」节点共用同一套引擎与词库缓存
import { attachAutoComplete, detachAutoComplete } from "./js/prompt_studio/windmix_preset_ac.js";

const API_PRESETS = "/windmix/preset_text/presets";
const API_IMAGE = "/windmix/preset_text/image";

// HTML 转义（V3 卡片用模板字符串渲染，名称/内容必须先转义防注入）
function escHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 无图时的占位示意图（图片相框 + 山/太阳；也用于列表行缩略图与编辑弹窗拖图区）
const PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5L7 20"/></svg>';
// 设置缩略图胶囊小条左侧的小图标
const SET_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>';

// 统一图标库（线条 SVG，跟随 currentColor）
const SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
const LINES_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7h18M3 12h18M3 17h18"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';
const KEBAB_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const SEND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
const DEL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
const TOOL_SELALL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
const TOOL_IMPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const TOOL_EXPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>';
const TOOL_NEW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

let _wmPmStyleInjected = false;
function injectStyle() {
    if (_wmPmStyleInjected) return;
    _wmPmStyleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
/* ================= V3 设计令牌（固定深色，弹窗不跟随 ComfyUI 主题） ================= */
.wm-pm-backdrop { position:fixed; left:0; top:0; width:100%; height:100%; z-index:10000;
  background:rgba(8,8,12,.66); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center;
  font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif;
  --bg:#101014; --bg2:#15151b; --srf:#1b1b23; --srf2:#20202a; --srf3:#262632;
  --ink:#f2f1f7; --ink2:#a7a5b8; --ink3:#6d6b7f;
  --line:#2b2b38; --line2:#383847; --violet:#8b7cf7;
  --grad:linear-gradient(115deg,#8b7cf7 0%,#6a5ae0 45%,#b16ce8 100%);
  --glow:0 0 0 1px rgba(139,124,247,.35),0 12px 40px -8px rgba(106,90,224,.45);
  --serif:"Georgia","Songti SC","SimSun",serif; --danger:#e57373; }
.wm-pm-modal { width:1515px; max-width:96vw; height:1122px; max-height:94vh; display:flex; flex-direction:column;
  background:var(--bg2); color:var(--ink); border:1px solid var(--line2); border-radius:14px; overflow:hidden;
  box-shadow:0 30px 80px rgba(0,0,0,.6); font-size:14px; position:relative; }

/* ---------- 顶栏（64px，flex-shrink:0） ---------- */
.wm-pm-top { flex:none; flex-shrink:0; height:64px; display:flex; align-items:center; gap:16px; padding:0 24px;
  border-bottom:1px solid var(--line); }
.wm-pm-brand { display:flex; align-items:center; gap:10px; flex:none; }
.wm-pm-brand .mark { width:30px; height:30px; border-radius:9px; background:var(--grad); display:flex; align-items:center;
  justify-content:center; font-weight:800; font-size:15px; color:#fff; box-shadow:0 6px 18px -4px rgba(139,124,247,.55); }
.wm-pm-brand .wm { font-size:16px; font-weight:700; letter-spacing:.5px; background:var(--grad);
  -webkit-background-clip:text; background-clip:text; color:transparent; display:block; }
.wm-pm-brand .sub { font-size:10.5px; color:var(--ink3); letter-spacing:2.5px; text-transform:uppercase;
  display:block; margin-top:1px; }
.wm-pm-topsearch { flex:1; max-width:460px; margin:0 auto; display:flex; align-items:center; gap:10px;
  background:var(--srf); border:1px solid var(--line); border-radius:12px; padding:0 14px; height:38px;
  color:var(--ink3); transition:.15s; }
.wm-pm-topsearch:focus-within { border-color:var(--violet); box-shadow:0 0 0 3px rgba(139,124,247,.15); }
.wm-pm-topsearch svg { width:15px; height:15px; flex:none; }
.wm-pm-topsearch input { flex:1; background:none; border:none; outline:none; color:var(--ink); font-size:13px; font-family:inherit; }
.wm-pm-top-actions { display:flex; gap:8px; margin-left:auto; flex:none; }
.wm-pm-tbtn { height:34px; padding:0 13px; border-radius:10px; border:1px solid var(--line2); background:var(--srf);
  color:var(--ink2); font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;
  transition:.14s; font-family:inherit; white-space:nowrap; flex:none; }
.wm-pm-tbtn svg { width:13px; height:13px; flex:none; }
.wm-pm-tbtn:hover { border-color:var(--violet); color:var(--ink); }
.wm-pm-tbtn.act { border-color:var(--violet); color:var(--violet); background:rgba(139,124,247,.1); }
.wm-pm-tbtn:disabled { opacity:.4; cursor:default; }
.wm-pm-tbtn:disabled:hover { border-color:var(--line2); color:var(--ink2); }
.wm-pm-tbtn.new { background:var(--grad); border:none; color:#fff; font-weight:600; box-shadow:0 8px 22px -6px rgba(139,124,247,.6); }
.wm-pm-tbtn.new:hover { filter:brightness(1.08); }

/* ---------- 主体 ---------- */
.wm-pm-main { flex:1; display:flex; min-height:0; }

/* 左目录（300px） */
.wm-pm-left { width:300px; flex:none; flex-shrink:0; border-right:1px solid var(--line); display:flex;
  flex-direction:column; min-height:0; background:rgba(21,21,27,.6); backdrop-filter:blur(8px); }
.wm-pm-left-head { flex:none; padding:18px 18px 10px; display:flex; align-items:center; justify-content:space-between; }
.wm-pm-left-head .t { font-size:10.5px; letter-spacing:2.5px; color:var(--ink3); text-transform:uppercase; }
.wm-pm-folder-btn { height:24px; padding:0 10px; border-radius:8px; border:1px solid var(--line2); color:var(--ink2);
  display:flex; align-items:center; gap:4px; cursor:pointer; font-size:11.5px; background:none; font-family:inherit; flex:none; }
.wm-pm-folder-btn:hover { border-color:var(--violet); color:var(--violet); }
.wm-pm-dirs { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:4px 12px 12px;
  scrollbar-width:thin; overscroll-behavior:contain; }
.wm-pm-dirs::-webkit-scrollbar { width:5px; }
.wm-pm-dirs::-webkit-scrollbar-thumb { background:var(--line2); border-radius:3px; }
/* 虚拟行（全部预设 / 无目录） */
.wm-pm-dir-vrow { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:10px; color:var(--ink2);
  cursor:pointer; position:relative; transition:.14s; flex-shrink:0; }
.wm-pm-dir-vrow svg { width:15px; height:15px; flex:none; }
.wm-pm-dir-vrow .vname { flex:1; font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-pm-dir-vrow .c { font-size:11px; color:var(--ink3); }
.wm-pm-dir-vrow:hover { background:var(--srf); color:var(--ink); }
.wm-pm-dir-vrow.on { background:var(--srf2); color:var(--ink); }
.wm-pm-dir-vrow.on::before { content:""; position:absolute; left:-12px; top:50%; transform:translateY(-50%);
  width:3px; height:18px; border-radius:0 3px 3px 0; background:var(--grad); }
.wm-pm-dir-vrow.on .c { color:var(--violet); }
.wm-pm-dir-vrow.drag-over { border:1px dashed var(--violet); background:rgba(139,124,247,.1); }
/* 大分类组 */
.wm-pm-big { margin-top:12px; flex-shrink:0; }
.wm-pm-big-head { display:flex; align-items:center; gap:7px; padding:6px 10px; cursor:pointer; color:var(--ink2); border-radius:9px; }
.wm-pm-big-head:hover { background:var(--srf); }
.wm-pm-chev { width:9px; height:9px; border-right:1.8px solid var(--ink3); border-bottom:1.8px solid var(--ink3);
  transform:rotate(-45deg); transition:transform .18s; flex:none; margin:0 4px; }
.wm-pm-big.expanded .wm-pm-chev { transform:rotate(45deg); }
.wm-pm-cname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-pm-big .wm-pm-cname { font-size:12.5px; font-weight:700; letter-spacing:.5px; }
.wm-pm-count { font-size:10.5px; color:var(--ink3); background:var(--srf2); border-radius:999px; padding:2px 9px; flex:none; }
.wm-pm-big.dragging, .wm-pm-sm.dragging, .wm-pm-card.dragging, .wm-pm-row.dragging { opacity:.35; }
.wm-pm-big.drop-active { outline:1.5px dashed var(--violet); outline-offset:2px; border-radius:12px; }
.wm-pm-sm-wrap { margin:5px 0 0 15px; padding-left:11px; border-left:1px solid var(--line);
  display:flex; flex-direction:column; gap:1px; }
/* 小分类行（圆点 + 名称 + 计数 + ⋯，整行可拖） */
.wm-pm-sm { display:flex; align-items:center; gap:8px; padding:6px 9px; border-radius:9px; color:var(--ink2);
  cursor:pointer; position:relative; font-size:12.5px; }
.wm-pm-sm .fdot { width:5px; height:5px; border-radius:50%; background:var(--line2); flex:none; transition:.15s; }
.wm-pm-sm .wm-pm-cname { font-size:12.5px; font-weight:400; }
.wm-pm-sm .c { font-size:10.5px; color:var(--ink3); flex:none; }
.wm-pm-sm .wm-pm-kebab { opacity:0; transition:.12s; flex:none; }
.wm-pm-sm:hover .wm-pm-kebab { opacity:1; }
.wm-pm-sm:hover { background:var(--srf); color:var(--ink); }
.wm-pm-sm:hover .fdot { background:var(--violet); }
.wm-pm-sm.on { color:var(--ink); font-weight:600; }
.wm-pm-sm.on .fdot { background:var(--violet); box-shadow:0 0 8px var(--violet); }
.wm-pm-sm.on::before { content:""; position:absolute; left:-12px; top:50%; transform:translateY(-50%);
  width:2px; height:14px; background:var(--grad); border-radius:2px; }
.wm-pm-sm.drag-over { border:1px dashed var(--violet); background:rgba(139,124,247,.1); }
.wm-pm-kebab { width:20px; height:20px; border-radius:6px; display:flex; align-items:center; justify-content:center;
  cursor:pointer; color:var(--ink3); }
.wm-pm-kebab:hover { background:rgba(139,124,247,.15); color:var(--violet); }
.wm-pm-kebab svg { width:12px; height:12px; }
.wm-pm-rename-input { background:var(--srf2); border:1px solid var(--violet); border-radius:8px; padding:5px 9px;
  color:var(--ink); font-size:12px; outline:none; width:100%; font-family:inherit; box-sizing:border-box; }
/* 左栏底部：只有渐变「发送整个目录」大按钮 */
.wm-pm-side-f { flex:none; flex-shrink:0; border-top:1px solid var(--line); padding:12px; }
.wm-pm-sendall { width:100%; padding:11px 0; border-radius:11px; background:var(--grad); color:#fff; border:none;
  font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 10px 26px -8px rgba(139,124,247,.55); font-family:inherit; }
.wm-pm-sendall:hover { filter:brightness(1.08); }

/* 右画廊 */
.wm-pm-right { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
.wm-pm-vhead { flex:none; flex-shrink:0; padding:22px 30px 0; display:flex; align-items:flex-end;
  justify-content:space-between; gap:16px; }
.wm-pm-vhead .ttl { font-family:var(--serif); font-size:27px; font-weight:600; letter-spacing:.5px; line-height:1.15;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%; }
.wm-pm-vhead .ttl em { font-style:normal; background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
.wm-pm-vhead .meta { margin-top:7px; font-size:11.5px; color:var(--ink3); letter-spacing:.4px; }
.wm-pm-vhead .meta b { color:var(--violet); font-weight:600; }
.wm-pm-vtools { display:flex; align-items:center; gap:9px; padding-bottom:5px; flex:none; }
.wm-pm-seg { display:flex; background:var(--srf); border:1px solid var(--line); border-radius:10px; padding:3px; gap:3px; }
.wm-pm-seg button { border:none; background:none; border-radius:7px; padding:6px 14px; font-size:12px;
  color:var(--ink3); cursor:pointer; font-family:inherit; }
.wm-pm-seg button.on { background:var(--srf3); color:var(--ink); box-shadow:0 2px 8px rgba(0,0,0,.35); }
.wm-pm-list { flex:1; min-height:0; overflow-y:auto; padding:18px 30px 28px; scrollbar-width:thin;
  display:flex; flex-direction:column; gap:10px; align-content:start; }
.wm-pm-list::-webkit-scrollbar { width:7px; }
.wm-pm-list::-webkit-scrollbar-thumb { background:var(--line2); border-radius:4px; }
.wm-pm-list::-webkit-scrollbar-thumb:hover { background:var(--violet); }
.wm-pm-list.grid { display:grid; grid-template-columns:repeat(5, minmax(148px, 1fr)); grid-auto-rows:300px;
  gap:13px; align-items:stretch; }

/* ---------- 卡片（V3 cardHTML 结构） ---------- */
.wm-pm-card { position:relative; border-radius:15px; overflow:hidden; background:var(--srf);
  border:1px solid var(--line); cursor:pointer; transition:.2s; }
.wm-pm-card:hover { transform:translateY(-4px); border-color:rgba(139,124,247,.5); box-shadow:var(--glow); }
.wm-pm-card.selected { border-color:var(--violet); box-shadow:var(--glow); }
.wm-pm-card .ph { position:absolute; inset:0; background-size:cover; background-position:center;
  transition:transform .4s ease; cursor:zoom-in; }
.wm-pm-card:hover .ph { transform:scale(1.05); }
.wm-pm-card .veil { position:absolute; inset:0; background:linear-gradient(180deg,transparent 40%,rgba(12,12,18,.9) 88%); pointer-events:none; }
.wm-pm-card .info { position:absolute; left:0; right:0; bottom:0; padding:13px 14px; pointer-events:auto; }
.wm-pm-card .tag { display:inline-block; font-size:9.5px; letter-spacing:1.2px; color:var(--violet);
  border:1px solid rgba(139,124,247,.4); border-radius:999px; padding:2px 8px; background:rgba(139,124,247,.1);
  margin-bottom:6px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:middle; }
.wm-pm-card .nm { font-family:var(--serif); font-size:15.5px; font-weight:600; line-height:1.25;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:auto; }
.wm-pm-card .ds { font-size:10.5px; color:var(--ink2); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wm-pm-card .sel { position:absolute; top:11px; left:11px; width:22px; height:22px; border-radius:50%;
  border:1.5px solid rgba(255,255,255,.55); background:rgba(12,12,18,.3); backdrop-filter:blur(4px);
  display:flex; align-items:center; justify-content:center; opacity:0; transition:.15s; z-index:3; }
.wm-pm-card:hover .sel { opacity:1; }
.wm-pm-card .sel svg { width:12px; height:12px; color:#fff; opacity:0; }
.wm-pm-card.selected .sel { opacity:1; background:var(--grad); border-color:transparent; }
.wm-pm-card.selected .sel svg { opacity:1; }
/* 悬停浮现卡片正中三圆钮：编辑 / 复制 / 发送 */
.wm-pm-card .ops { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.9); z-index:4;
  display:flex; gap:8px; opacity:0; transition:.18s; }
.wm-pm-card:hover .ops { opacity:1; transform:translate(-50%,-50%) scale(1); }
.wm-pm-card .ops span { width:30px; height:30px; border-radius:9px; background:rgba(12,12,18,.6);
  backdrop-filter:blur(6px); border:1px solid rgba(255,255,255,.16); display:flex; align-items:center;
  justify-content:center; color:#e8e6f5; cursor:pointer; }
.wm-pm-card .ops span svg { width:13px; height:13px; }
.wm-pm-card .ops span:hover { background:var(--grad); border-color:transparent; }
/* 右上角悬停删除圆钮（hover 变红） */
.wm-pm-card .delc { position:absolute; top:10px; right:10px; z-index:4; width:28px; height:28px; border-radius:9px;
  background:rgba(12,12,18,.6); backdrop-filter:blur(6px); border:1px solid rgba(255,255,255,.16); display:flex;
  align-items:center; justify-content:center; color:#e8e6f5; cursor:pointer; opacity:0; transition:.15s; }
.wm-pm-card:hover .delc { opacity:1; }
.wm-pm-card .delc:hover { background:var(--danger); border-color:var(--danger); }
.wm-pm-card .delc svg { width:13px; height:13px; }
/* 无图卡：紫调纹理背景 + 右上描边首字母大字 */
.wm-pm-card.noimg .fallback { position:absolute; inset:0;
  background:repeating-linear-gradient(135deg,rgba(139,124,247,.05) 0 2px,transparent 2px 14px),
  radial-gradient(320px 220px at 30% 20%,rgba(139,124,247,.14),transparent 70%),var(--srf2); }
.wm-pm-card .fb-letter { position:absolute; top:12px; right:16px; font-family:var(--serif); font-size:52px;
  font-weight:700; color:transparent; -webkit-text-stroke:1.2px rgba(139,124,247,.45); line-height:1; z-index:1; }
/* 无图卡悬停底部胶囊小条：点击/拖图设缩略图 */
.wm-pm-card .setimg { position:absolute; left:50%; bottom:74px; transform:translate(-50%,6px); z-index:5;
  display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px;
  border:1px solid rgba(139,124,247,.5); background:rgba(12,12,18,.72); backdrop-filter:blur(6px);
  color:var(--ink2); font-size:11px; cursor:pointer; opacity:0; transition:.16s; white-space:nowrap; pointer-events:none; }
.wm-pm-card:hover .setimg { opacity:1; transform:translate(-50%,0); pointer-events:auto; }
.wm-pm-card .setimg:hover { border-color:var(--violet); color:var(--violet); background:rgba(139,124,247,.16); }
.wm-pm-card .setimg svg { width:13px; height:13px; }
.wm-pm-card.drop-target { border-color:var(--violet); box-shadow:0 0 0 3px rgba(139,124,247,.35); }
.wm-pm-card .rn { width:100%; background:var(--srf2); border:1px solid var(--violet); border-radius:6px;
  padding:3px 7px; color:var(--ink); font-size:13px; font-family:var(--serif); outline:none; box-sizing:border-box; }

/* ---------- 列表视图 ---------- */
.wm-pm-row { display:flex; align-items:center; gap:14px; padding:10px 14px; border:1px solid var(--line);
  border-radius:13px; background:var(--srf); cursor:pointer; transition:.15s; }
.wm-pm-row:hover { border-color:rgba(139,124,247,.45); background:var(--srf2); }
.wm-pm-row.selected { border-color:var(--violet); background:rgba(139,124,247,.08); }
.wm-pm-row .th { width:52px; height:52px; border-radius:10px; flex:none; background-size:cover;
  background-position:center; background-color:var(--srf3); display:flex; align-items:center; justify-content:center;
  color:var(--ink3); cursor:pointer; border:1px solid var(--line); }
.wm-pm-row .th svg { width:20px; height:20px; opacity:.5; }
.wm-pm-row .th:hover, .wm-pm-row .th.hover { border-color:var(--violet); }
.wm-pm-row .nm { width:190px; flex:none; font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-pm-row .tg { font-size:9.5px; letter-spacing:1px; color:var(--violet); border:1px solid rgba(139,124,247,.35);
  border-radius:999px; padding:2px 8px; flex:none; }
.wm-pm-row .ds { flex:1; min-width:0; color:var(--ink3); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wm-pm-row .ops { display:flex; gap:6px; flex:none; }
.wm-pm-row .ops span { width:28px; height:28px; border-radius:8px; border:1px solid var(--line2); display:flex;
  align-items:center; justify-content:center; color:var(--ink2); cursor:pointer; }
.wm-pm-row .ops span svg { width:12px; height:12px; }
.wm-pm-row .ops span:hover { border-color:var(--violet); color:var(--violet); }
.wm-pm-row .ops span.del:hover { border-color:var(--danger); color:var(--danger); }
.wm-pm-empty { color:var(--ink3); padding:60px 0; text-align:center; font-size:13px; grid-column:1/-1; }

/* ---------- 编辑弹窗（V3：1060px，左名称+内容 / 右拖图区） ---------- */
.wm-pm-edit-modal-bd { position:fixed; inset:0; background:rgba(8,8,12,.66); backdrop-filter:blur(3px);
  display:none; align-items:center; justify-content:center; z-index:100006; }
.wm-pm-edit-modal { width:1060px; max-width:94vw; max-height:88vh; background:var(--srf); border:1px solid var(--line2);
  border-radius:18px; padding:24px; display:flex; flex-direction:column; gap:14px;
  box-shadow:0 30px 80px rgba(0,0,0,.6); color:var(--ink); }
.wm-pm-edit-modal h4 { margin:0; font-size:16px; font-weight:700; display:flex; align-items:center; gap:10px;
  font-family:var(--serif); }
.wm-pm-edit-modal h4 .x { margin-left:auto; width:28px; height:28px; border-radius:9px; display:flex;
  align-items:center; justify-content:center; cursor:pointer; color:var(--ink3); font-size:14px; }
.wm-pm-edit-modal h4 .x:hover { color:var(--danger); background:rgba(229,115,115,.12); }
.wm-pm-edit-modal .erow { display:flex; gap:16px; flex:1; min-height:0; }
.wm-pm-edit-modal .col { flex:1; min-width:0; display:flex; flex-direction:column; gap:12px; }
.wm-pm-edit-modal input.e-name { background:var(--bg2); border:1px solid var(--line2); border-radius:10px;
  padding:11px 14px; color:var(--ink); font-size:14px; outline:none; font-family:inherit; }
.wm-pm-edit-modal input.e-name:focus { border-color:var(--violet); box-shadow:0 0 0 3px rgba(139,124,247,.15); }
.wm-pm-edit-modal textarea { flex:1; min-height:320px; background:var(--bg2); border:1px solid var(--line2);
  border-radius:10px; padding:12px 14px; color:var(--ink); font-size:13px; line-height:1.65; font-family:inherit;
  resize:vertical; outline:none; }
.wm-pm-edit-modal textarea:focus { border-color:var(--violet); box-shadow:0 0 0 3px rgba(139,124,247,.15); }
.wm-pm-dropzone { flex:1; min-height:320px; border:1.5px dashed var(--line2); border-radius:14px;
  background:var(--bg2); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
  color:var(--ink3); cursor:pointer; transition:.15s; background-size:cover; background-position:center;
  position:relative; overflow:hidden; }
.wm-pm-dropzone:hover, .wm-pm-dropzone.hover { border-color:var(--violet); color:var(--violet); }
.wm-pm-dropzone > svg { width:38px; height:38px; opacity:.6; }
.wm-pm-dropzone .hint { font-size:13px; }
.wm-pm-dropzone .sub2 { font-size:11px; opacity:.75; }
.wm-pm-dropzone.hasimg { border-style:solid; }
.wm-pm-dropzone.hasimg > svg, .wm-pm-dropzone.hasimg .hint, .wm-pm-dropzone.hasimg .sub2 { opacity:0; }
.wm-pm-dropzone .veil2 { display:none; }
.wm-pm-dropzone.hasimg .veil2 { position:absolute; inset:0; background:rgba(8,8,12,.5); display:flex;
  align-items:center; justify-content:center; color:#fff; font-size:13px; opacity:0; transition:.15s; border-radius:13px; }
.wm-pm-dropzone.hasimg:hover .veil2 { opacity:1; }
.wm-pm-edit-actions { display:flex; gap:11px; justify-content:flex-end; }
.wm-pm-edit-actions button { padding:10px 28px; border-radius:10px; cursor:pointer; font-size:13px;
  border:1px solid var(--line2); background:transparent; color:var(--ink2); font-family:inherit; }
.wm-pm-edit-actions .ok { background:var(--grad); color:#fff; border-color:transparent; font-weight:600; }
.wm-pm-edit-actions .ok:hover { filter:brightness(1.08); }
.wm-pm-edit-actions .cancel:hover { border-color:var(--ink2); color:var(--ink); }

/* ---------- 大图 lightbox / 菜单 / toast ---------- */
.wm-pm-lightbox { position:fixed; inset:0; z-index:100008; background:rgba(8,8,12,.9); display:flex;
  align-items:center; justify-content:center; cursor:zoom-out; }
.wm-pm-lightbox img { max-width:92vw; max-height:92vh; border-radius:12px; box-shadow:0 16px 60px rgba(0,0,0,.6);
  cursor:zoom-in; transition:transform .12s ease; }
.wm-pm-lightbox .lb-close { position:fixed; top:18px; right:22px; width:42px; height:42px; border-radius:50%;
  display:flex; align-items:center; justify-content:center; font-size:18px; color:#fff; background:rgba(40,40,54,.8);
  border:1px solid rgba(139,124,247,.35); cursor:pointer; }
.wm-pm-lightbox .lb-close:hover { background:#8b7cf7; }
.wm-pm-lightbox .lb-hint { position:fixed; bottom:16px; left:0; right:0; text-align:center; color:#cfcfe6;
  font-size:12px; opacity:.75; }
/* 菜单挂在 body 上，拿不到 backdrop 的 CSS 变量，颜色一律写字面量 */
.wm-pm-more-menu { position:fixed; min-width:158px; background:#20202a; border:1px solid #383847;
  border-radius:11px; box-shadow:0 14px 40px rgba(0,0,0,.55); padding:5px; z-index:100007;
  font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif; }
.wm-pm-more-item { padding:8px 12px; border-radius:8px; cursor:pointer; font-size:12.5px; display:flex;
  align-items:center; gap:9px; color:#a7a5b8; }
.wm-pm-more-item:hover { background:rgba(139,124,247,.14); color:#f2f1f7; }
.wm-pm-more-item.danger:hover { background:rgba(229,115,115,.14); color:#e57373; }
.wm-pm-more-item svg { width:13px; height:13px; flex:none; }
.wm-pm-more-item.title { color:#6d6b7f; cursor:default; font-size:11px; letter-spacing:1px; }
.wm-pm-more-item.title:hover { background:none; color:#6d6b7f; }
.wm-pm-toast { position:fixed; left:50%; top:20px; transform:translateX(-50%); z-index:100005;
  background:linear-gradient(115deg,#8b7cf7 0%,#6a5ae0 45%,#b16ce8 100%);
  color:#fff; padding:9px 22px; border-radius:10px; font-size:13px; box-shadow:0 10px 30px rgba(139,124,247,.4);
  opacity:0; transition:opacity .2s; pointer-events:none; }
.wm-pm-toast.show { opacity:1; }
.wm-pm-hidden-file { display:none; }
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
};

// 视图状态持久化：记住上次浏览的小分类 + 左侧树的展开状态，下次打开直接恢复。
const WM_VIEW_KEY = "windmix_preset_view_v1";
function saveViewState() {
    try {
        localStorage.setItem(WM_VIEW_KEY, JSON.stringify({
            folder: state.folder,
            parent: state.parent,
            expanded: Array.from(state.expanded),
            layout: state.layout,
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
            layout: d.layout === "table" ? "table" : "card",
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

async function loadPresets(onDone) {
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
    if (typeof onDone === "function") onDone();
}

// 选择某个目录（folder=小分类名，parent=大分类名；虚拟视图 folder 为 "全部预设"/"无目录"）
// 渲染右画廊头部（V3：衬线大标题 + 计数 meta）；updateCatChip 名字沿用，调用点不变
function updateCatChip() {
    if (!els || !els.vTitle) return;
    let label;
    if (state.folder === "全部预设" || (!state.folder && !state.parent)) label = "全部<em>预设</em>";
    else if (state.folder === "无目录") label = "无<em>目录</em>";
    else if (state.parent && state.folder) label = escHtml(state.folder);
    else if (state.parent) label = escHtml(state.parent);
    else label = "全部<em>预设</em>";
    els.vTitle.innerHTML = label;
    els.vTitle.title = "当前查看目录";
}
function updateVMeta() {
    if (!els || !els.vMeta) return;
    const n = visiblePresets().length;
    let extra = "";
    if (state.parent && state.folder) extra = " · " + escHtml(state.parent) + " / " + escHtml(state.folder);
    else if (state.parent) extra = " · 大分类（含其下小分类）";
    els.vMeta.innerHTML = "<b>" + n + "</b> 个预设" + extra;
}
function selectFolder(folder, parent, onDone) {
    state.folder = folder;
    state.parent = parent || "";
    state.editing = null;
    state.selected.clear();
    hideEditor();
    updateCatChip();
    saveViewState();
    loadPresets(onDone);
}

// 通用：渲染一个虚拟目录行（全部预设 / 无目录），V3 vrow：图标 + 名称 + 计数，选中态左侧渐变竖条
function buildVirtualRow(f, isAll) {
    const active = isAll ? state.folder === "全部预设" : state.folder === "无目录";
    const d = document.createElement("div");
    d.className = "wm-pm-dir-vrow" + (active ? " on" : "");
    d.innerHTML = (isAll ? GRID_SVG : LINES_SVG);
    const name = document.createElement("span");
    name.className = "vname";
    name.textContent = f.name;
    const badge = document.createElement("span");
    badge.className = "c";
    badge.textContent = f.count;
    d.append(name, badge);
    d.addEventListener("click", () => selectFolder(isAll ? "全部预设" : "无目录", ""));
    // 「无目录」接受拖入（拖入=归为无目录），「全部预设」不接收拖拽
    if (!isAll) attachDirDrop(d, "", "");
    return d;
}

// 渲染大分类区块（V3 grp：chevron 折叠 + 名称 + 计数胶囊 + ⋯菜单；无勾选框），内部包含小分类
function buildBigBlock(f) {
    const isExpanded = state.expanded.has(f.name);
    const wrap = document.createElement("div");
    wrap.className = "wm-pm-big" + (isExpanded ? " expanded" : "");
    wrap.dataset.bigName = f.name; // 供容器级大分类重排定位（放宽落点用）
    const head = catRow({
        cls: "wm-pm-big-head",
        // 大分类需自身可拖拽才能发起「reorder-big:」重排；显式 draggable=false 会让父级 wrap 也拖不动
        draggable: true,
        hasChevron: true,
        expanded: isExpanded,
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
        onView: () => selectFolder("", f.name),
        onDbl: (nameEl) => startInlineRename(nameEl, f.name, ""),
        onCtx: (nameEl) => ([
            { label: "重命名", icon: EDIT_SVG, onClick: () => startInlineRename(nameEl, f.name, "") },
            { label: "新建小分类", icon: TOOL_NEW_SVG, onClick: () => newSmallFolder(f.name) },
            { label: "发送此分类", icon: SEND_SVG, onClick: () => sendCategory("", f.name) },
            { label: "导出此分类", icon: TOOL_EXPORT_SVG, onClick: () => exportCategory(f.name, "") },
            { label: "删除", icon: DEL_SVG, danger: true, onClick: () => deleteFolder(f.name, "") },
        ]),
    });
    wrap.append(head);

    // 展开时列出小分类（可拖拽归类）
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

// 渲染小分类（V3 frow：圆点 + 名称 + 计数 + ⋯菜单；整行可拖，无拖拽点阵图标）
function buildSmallRow(c, bigName) {
    const active = state.parent === bigName && state.folder === c.name;
    const d = catRow({
        cls: "wm-pm-sm",
        draggable: true,
        hasChevron: false,
        dot: true,
        viewActive: active,
        name: c.name,
        count: c.count,
        onView: () => selectFolder(c.name, bigName),
        onDbl: (nameEl) => startInlineRename(nameEl, c.name, bigName),
        onCtx: (nameEl) => ([
            { label: "重命名", icon: EDIT_SVG, onClick: () => startInlineRename(nameEl, c.name, bigName) },
            { label: "发送此分类", icon: SEND_SVG, onClick: () => sendCategory(c.name, bigName) },
            { label: "导出此分类", icon: TOOL_EXPORT_SVG, onClick: () => exportCategory(c.name, bigName) },
            { label: "移动到…", icon: SEND_SVG, onClick: (anchor) => openMoveSubmenu(anchor, c.name, bigName) },
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

// 「移动到…」子菜单：列出其他大分类，选中后调用后端 move_folder 把小分类移过去（复用拖拽跨类移动的同一接口）
function openMoveSubmenu(anchor, name, oldParent) {
    closeMoreMenu();
    const bigs = (state.folders || []).filter((f) => f.type === "big" && f.name !== oldParent);
    if (!bigs.length) { toast("没有其他大分类"); return; }
    const menu = document.createElement("div");
    menu.className = "wm-pm-more-menu";
    const title = document.createElement("div");
    title.className = "wm-pm-more-item title";
    title.textContent = "移动到";
    menu.append(title);
    bigs.forEach((b) => {
        const it = document.createElement("div");
        it.className = "wm-pm-more-item";
        it.innerHTML = LINES_SVG + "<span>" + escHtml(b.name) + "</span>";
        it.addEventListener("click", (ev) => {
            ev.stopPropagation();
            closeMoreMenu();
            apiFetch(API_PRESETS, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "move_folder", name, old_parent: oldParent, new_parent: b.name }),
            }).then((r) => {
                if (r && r.success) {
                    state.expanded.add(b.name);
                    saveViewState();
                    loadPresets();
                    toast("已将「" + name + "」移动到「" + b.name + "」");
                } else {
                    alert("移动失败：" + (r && r.message));
                }
            });
        });
        menu.append(it);
    });
    const rect = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = Math.min(rect.right + 8, window.innerWidth - 190) + "px";
    menu.style.top = Math.max(8, rect.top) + "px";
    document.body.append(menu);
    setTimeout(() => document.addEventListener("click", closeMoreMenu), 0);
}

// 分类行统一模板（V3）：折叠箭头(可选) / 圆点(小分类) · 名称 · 计数 · 更多(⋯)；无拖拽点阵、无勾选框
function catRow(o) {
    const row = document.createElement("div");
    row.className = "wm-pm-cat " + (o.cls || "") + (o.viewActive ? " on" : "");
    row.setAttribute("draggable", o.draggable ? "true" : "false");
    row.innerHTML =
        (o.hasChevron ? '<span class="wm-pm-chev"></span>' : '') +
        (o.dot ? '<span class="fdot"></span>' : '') +
        '<span class="wm-pm-cname"></span>' +
        (o.count != null ? '<span class="' + (o.dot ? "c" : "wm-pm-count") + '">' + o.count + '</span>' : '') +
        '<span class="wm-pm-kebab" title="更多操作">' + KEBAB_SVG + '</span>';
    row.querySelector(".wm-pm-cname").textContent = o.name;
    if (o.onChev) row.querySelector(".wm-pm-chev").addEventListener("click", (e) => { e.stopPropagation(); o.onChev(); });
    const nm = row.querySelector(".wm-pm-cname");
    // 单击=切换视图（220ms 防抖，避开双击）；双击名称=重命名。用短延时区分单击/双击，避免双击时被 re-render 打断。
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
    const kebab = row.querySelector(".wm-pm-kebab");
    kebab.addEventListener("click", (e) => {
        e.stopPropagation();
        openCatCtx(kebab, (o.onCtx ? o.onCtx(nm) : []));
    });
    if (o.onDragStart) row.addEventListener("dragstart", o.onDragStart);
    if (o.onDragEnd) row.addEventListener("dragend", o.onDragEnd);
    return row;
}

// 分类行「⋯」更多菜单（V3 .menu 样式：深色圆角、hover 紫底、删除项红色）
function openCatCtx(anchor, items) {
    closeMoreMenu();
    const menu = document.createElement("div");
    menu.className = "wm-pm-more-menu";
    items.forEach((it) => {
        const mi = document.createElement("div");
        mi.className = "wm-pm-more-item" + (it.danger ? " danger" : "");
        mi.innerHTML = (it.icon || "") + "<span>" + escHtml(it.label) + "</span>";
        mi.addEventListener("click", (ev) => { ev.stopPropagation(); closeMoreMenu(); it.onClick && it.onClick(anchor); });
        menu.append(mi);
    });
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 6, left = rect.left;
    if (top + 240 > window.innerHeight) top = rect.top - 240;
    menu.style.position = "fixed";
    menu.style.left = Math.max(8, Math.min(left, window.innerWidth - 190)) + "px";
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
    // all 需要全量
    const all = await apiFetch(API_PRESETS + "?all=1");
    const allPresets = (all && all.presets) || [];
    if (kind === "all") return allPresets;
    // category：导出指定分类（小分类按 folder+parent 精确，大分类按 parent 含其所有小分类）
    const out = [];
    allPresets.forEach((p) => {
        if (kind.parent === "" || kind.parent == null) {
            // 大分类：parent 命中，或旧数据里 parent 为空但 folder 等于大分类名
            if (p.parent === kind.name || (p.parent === "" && p.folder === kind.name)) out.push(p);
        } else if (p.folder === kind.name && p.parent === kind.parent) {
            out.push(p);
        }
    });
    return out;
}

async function doExport(kind) {
    const list = await collectExportPresets(kind);
    if (!list || !list.length) { toast("没有可导出的内容"); return; }
    const slim = list.map((p) => ({ name: p.name, content: p.content, folder: p.folder, parent: p.parent, image: p.image }));
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const tag = (typeof kind === "string") ? kind : "cat";
    downloadJSON(slim, "windmix_presets_" + tag + "_" + ts + ".json");
    toast("已导出 " + slim.length + " 条预设");
}

// 目录「⋯」菜单：导出此分类（不依赖已删除的勾选导出栏）
function exportCategory(name, parent) {
    doExport({ name, parent: parent || "" });
}

// 目录「⋯」菜单：发送此分类到节点——切到该目录视图后走原「发送整个目录」逻辑
// folder/parent 语义与 selectFolder 一致：小分类=(名,大分类名)，大分类=("",大分类名)
function sendCategory(folder, parent) {
    selectFolder(folder, parent, () => { sendFolder(); }); // loadPresets 完成后数据就绪再发送
}

function openExportMenu(btn) {
    closeMoreMenu();
    const menu = document.createElement("div");
    menu.className = "wm-pm-more-menu";
    const items = [];
    if (state.selected.size > 0) items.push({ label: "导出选中卡片 (" + state.selected.size + ")", fn: () => doExport("selected") });
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
    // 注：新建大分类入口已在左栏顶部「＋ 大分类」按钮
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
        updateVMeta();
        updateSelCount();
        return;
    }
    presets.forEach((p) => {
        if (state.layout === "card") list.append(buildCard(p));
        else list.append(buildRow(p));
    });
    updateVMeta();
    updateSelCount();
}

// 预设标题行内改名（V3：双击标题触发，回车保存 / Escape 取消，复用后端 update 接口）
function startInlinePresetRename(nmEl, p) {
    if (nmEl.querySelector("input")) return;
    const old = p.name || "";
    const inp = document.createElement("input");
    inp.className = "rn";
    inp.value = old;
    nmEl.textContent = "";
    nmEl.append(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        const v = inp.value.trim();
        if (save && v && v !== old) {
            apiFetch(API_PRESETS, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "update", id: p.id, name: v, content: p.content, image: p.image }),
            }).then((r) => {
                if (r && r.success) { toast("已重命名"); loadPresets(); }
                else { nmEl.textContent = old; alert("重命名失败：" + (r && r.message)); }
            });
        } else {
            nmEl.textContent = old;
        }
    };
    inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    inp.addEventListener("blur", () => finish(true));
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("dblclick", (e) => e.stopPropagation());
}

// 切换选中态（卡片 / 行共用）
function togglePresetSelected(p, el) {
    if (state.selected.has(p.id)) state.selected.delete(p.id);
    else state.selected.add(p.id);
    el.classList.toggle("selected", state.selected.has(p.id));
    updateSelCount();
}

// 构建 V3 卡片：背景图(有图) / 紫调纹理+首字母(无图) + 底部信息区 + 悬停三圆钮/删除/选中圈/设图胶囊
function buildCard(p) {
    const card = document.createElement("div");
    const hasImg = !!p.image;
    card.className = "wm-pm-card" + (hasImg ? "" : " noimg") + (state.selected.has(p.id) ? " selected" : "");
    // 分类标签：小分类名 > 大分类名 > 未分类
    const tagText = p.folder || p.parent || "未分类";
    const letter = ((p.name || "?").trim().charAt(0) || "?").toUpperCase();
    card.innerHTML =
        (hasImg
            ? '<div class="ph"></div><div class="veil"></div>'
            : '<div class="fallback"></div><div class="fb-letter">' + escHtml(letter) + '</div>') +
        '<div class="info"><span class="tag">' + escHtml(tagText) + '</span>' +
        '<div class="nm"></div><div class="ds"></div></div>' +
        '<div class="sel">' + CHECK_SVG + '</div>' +
        '<div class="ops">' +
        '<span data-act="edit" title="编辑">' + EDIT_SVG + '</span>' +
        '<span data-act="copy" title="复制（在原卡片后生成副本）">' + COPY_SVG + '</span>' +
        '<span data-act="send" title="发送到节点">' + SEND_SVG + '</span>' +
        '</div>' +
        '<div class="delc" title="删除">' + DEL_SVG + '</div>' +
        (hasImg ? '' : '<div class="setimg" title="点击或拖入图片设置缩略图">' + SET_ICON_SVG + '<span>点击/拖图设缩略图</span></div>');
    card.querySelector(".nm").textContent = p.name || "";
    card.querySelector(".ds").textContent = p.content || "";
    if (hasImg) card.querySelector(".ph").style.backgroundImage = bannerBg(p);

    // 正中三圆钮：编辑 / 复制 / 发送
    card.querySelectorAll(".ops span").forEach((b) => {
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            const act = b.dataset.act;
            if (act === "edit") openEditor(p);
            else if (act === "copy") duplicatePresetAfter(p);
            else if (act === "send") sendPreset(p);
        });
    });
    // 右上删除
    card.querySelector(".delc").addEventListener("click", (e) => { e.stopPropagation(); deletePreset(p); });
    // 无图卡底部胶囊：点击走文件选择上传
    const setimg = card.querySelector(".setimg");
    if (setimg) setimg.addEventListener("click", (e) => {
        e.stopPropagation();
        _pendingUploadPreset = p;
        if (els.uploadInput) els.uploadInput.click();
    });

    // 有图卡单击图片区 = 看大图；无图卡没有 ph，点纹理区冒泡到 card 走选中
    const ph = card.querySelector(".ph");
    if (ph) ph.addEventListener("click", (e) => { e.stopPropagation(); openLightbox(p); });

    // 标题信息区：单击=选中/取消（220ms 防抖避开双击）；双击名称=行内改名；整区可拖=归类
    const info = card.querySelector(".info");
    const nm = card.querySelector(".nm");
    info.draggable = true;
    info.title = "单击选中 · 双击改名 · 拖到左侧分类可移动";
    let clickTimer = null;
    info.addEventListener("click", (e) => {
        e.stopPropagation();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; } // 双击时第二次 click 不重复切
        clickTimer = setTimeout(() => { clickTimer = null; togglePresetSelected(p, card); }, 220);
    });
    nm.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        startInlinePresetRename(nm, p);
    });
    info.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", p.id);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
        try { e.dataTransfer.setDragImage(card, 20, 20); } catch (_) {}
    });
    info.addEventListener("dragend", () => card.classList.remove("dragging"));

    // 卡片其余区域单击=选中
    card.addEventListener("click", () => togglePresetSelected(p, card));

    // 拖放：文件拖入=设/换缩略图；预设卡片拖入=网格重排（左右半区插入前/后）
    card.addEventListener("dragover", (e) => {
        const t = (e.dataTransfer && e.dataTransfer.types) || [];
        if (Array.from(t).includes("Files")) { e.preventDefault(); e.stopPropagation(); card.classList.add("drop-target"); return; }
        e.preventDefault();
        card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", (e) => {
        card.classList.remove("drop-target");
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) { e.preventDefault(); e.stopPropagation(); uploadCardImage(p, f); return; }
        const id = e.dataTransfer.getData("text/plain");
        if (!id || id === p.id) return;
        if (!state.presets.some((x) => x.id === id)) return; // 非本插件预设拖放，忽略
        e.preventDefault();
        e.stopPropagation();
        const rect = card.getBoundingClientRect();
        const after = (e.clientX - rect.left) > rect.width / 2; // 网格按左右半区插入前/后
        reorderPreset(id, p.id, after);
    });
    return card;
}

// 列表视图行（V3）：缩略图 + 名称 + 分类标签 + 内容预览 + 行尾操作钮（编辑/复制/发送/删除）
function buildRow(p) {
    const row = document.createElement("div");
    row.className = "wm-pm-row" + (state.selected.has(p.id) ? " selected" : "");
    row.title = "点击选中（可批量发送）";
    row.innerHTML =
        '<div class="th"></div>' +
        '<div class="nm"></div>' +
        '<span class="tg">' + escHtml(p.folder || p.parent || "未分类") + '</span>' +
        '<div class="ds"></div>' +
        '<div class="ops">' +
        '<span data-act="edit" title="编辑">' + EDIT_SVG + '</span>' +
        '<span data-act="copy" title="复制">' + COPY_SVG + '</span>' +
        '<span data-act="send" title="发送到节点">' + SEND_SVG + '</span>' +
        '<span class="del" data-act="del" title="删除">' + DEL_SVG + '</span>' +
        '</div>';
    row.querySelector(".nm").textContent = p.name || "";
    row.querySelector(".ds").textContent = p.content || "";
    const thumb = row.querySelector(".th");
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
    row.querySelectorAll(".ops span").forEach((b) => {
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            const act = b.dataset.act;
            if (act === "edit") openEditor(p);
            else if (act === "copy") duplicatePresetAfter(p);
            else if (act === "send") sendPreset(p);
            else if (act === "del") deletePreset(p);
        });
    });
    // 点击行 = 选中/取消
    row.addEventListener("click", () => togglePresetSelected(p, row));
    return row;
}

function closeMoreMenu() {
    document.querySelectorAll(".wm-pm-more-menu").forEach((m) => m.remove());
    document.removeEventListener("click", closeMoreMenu);
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
    // 标题里含关闭按钮(.x)，只改 .lbl 文案，避免 textContent 把按钮清掉
    const lbl = els.editLbl.querySelector(".lbl");
    if (lbl) lbl.textContent = isNew ? "新建预设" : "正在编辑：" + (p.name || "");
    els.editName.value = p ? p.name || "" : "";
    els.editContent.value = p ? p.content || "" : "";
    renderDropzone();
}

// 渲染编辑弹窗右侧拖图区：有 pendingImage(dataURL) 或已有图(相对路径) 时显示预览+「点击更换图片」遮罩
function renderDropzone() {
    const dz = els.dropzone;
    if (!dz) return;
    const img = state.pendingImage;
    if (img) {
        const url = img.startsWith("data:") ? img : API_IMAGE + "?path=" + encodeURIComponent(img);
        dz.style.backgroundImage = "url('" + url.replace(/'/g, "%27") + "')";
        dz.classList.add("hasimg");
    } else {
        dz.style.backgroundImage = "";
        dz.classList.remove("hasimg");
    }
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
    // 把库里的 id 一起带过去：节点用它做「书签三态」绑定，
    // 之后这条文本在库里被移动目录也认得出是同一条。
    state.node.addPresetTextEntry(p.name, p.content || "", p.id);
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
            state.node.addPresetTextEntry(p.name, p.content || "", p.id);
            n++;
        }
    });
    toast("已发送 " + n + " 条选中预设到节点");
    state.selected.clear();
    renderPresets();
    updateSelCount();
}

// 更新「发送选中」按钮文案与可用状态（V3：选中数>0 时高亮显示计数）
function updateSelCount() {
    if (!els.sendSel) return;
    const n = state.selected.size;
    const lbl = els.sendSel.querySelector(".lbl");
    if (lbl) lbl.textContent = n > 0 ? "发送选中 (" + n + ")" : "发送选中";
    els.sendSel.disabled = n === 0;
    els.sendSel.classList.toggle("act", n > 0);
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
        presetId: p.id || "",
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

// ============ 构建 Modal（V3：顶栏 + 左目录 + 右画廊 + 编辑弹窗） ============
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

    // ---------- 顶栏（64px，flex-shrink:0） ----------
    const top = document.createElement("div");
    top.className = "wm-pm-top";
    const brand = document.createElement("div");
    brand.className = "wm-pm-brand";
    brand.innerHTML = '<div class="mark">W</div><div><span class="wm">预设文本管理器</span><span class="sub">WindMix Presets</span></div>';
    // 搜索框（居中，聚焦紫描边；防抖逻辑沿用原实现）
    const topsearch = document.createElement("div");
    topsearch.className = "wm-pm-topsearch";
    topsearch.innerHTML = SEARCH_SVG;
    const search = document.createElement("input");
    search.placeholder = "搜索预设名称或内容…";
    let _searchTimer = null;
    search.addEventListener("input", () => {
        state.search = search.value;
        // 防抖：预设量大（数百条卡片）时每敲一个字符就全量重建 DOM 会明显卡顿，
        // 合并连续输入后只渲染一次；搜索功能本身不变
        if (_searchTimer) clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => renderPresets(), 180);
    });
    topsearch.append(search);
    // 右侧按钮组：全选 / 发送选中 / 导入 / 导出 / 新建预设
    const topActions = document.createElement("div");
    topActions.className = "wm-pm-top-actions";
    const selectAllBtn = document.createElement("button");
    selectAllBtn.className = "wm-pm-tbtn";
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
    const sendSel = document.createElement("button");
    sendSel.className = "wm-pm-tbtn";
    sendSel.innerHTML = SEND_SVG + '<span class="lbl">发送选中</span>';
    sendSel.disabled = true;
    sendSel.title = "将选中的预设批量发送到节点";
    sendSel.addEventListener("click", sendSelected);
    const importBtn = document.createElement("button");
    importBtn.className = "wm-pm-tbtn";
    importBtn.innerHTML = TOOL_IMPORT_SVG + "<span>导入</span>";
    importBtn.title = "导入 JSON（自动保留其中的小分类/大分类，缺失分类会自动创建）";
    importBtn.addEventListener("click", () => { if (els.importInput) els.importInput.click(); });
    const exportBtn = document.createElement("button");
    exportBtn.className = "wm-pm-tbtn";
    exportBtn.innerHTML = TOOL_EXPORT_SVG + "<span>导出</span>";
    exportBtn.title = "导出：选中卡片 / 当前目录 / 全部";
    exportBtn.addEventListener("click", (e) => { e.stopPropagation(); openExportMenu(exportBtn); });
    const newP = document.createElement("button");
    newP.className = "wm-pm-tbtn new";
    newP.innerHTML = TOOL_NEW_SVG + "<span>新建预设</span>"; // 图标本身就是加号，文字里不再重复写「＋」
    newP.addEventListener("click", newPreset);
    topActions.append(selectAllBtn, sendSel, importBtn, exportBtn, newP);
    top.append(brand, topsearch, topActions);

    // ---------- 主体：左目录 + 右画廊 ----------
    const main = document.createElement("div");
    main.className = "wm-pm-main";

    const left = document.createElement("div");
    left.className = "wm-pm-left";
    const lhead = document.createElement("div");
    lhead.className = "wm-pm-left-head";
    const ltitle = document.createElement("span");
    ltitle.className = "t";
    ltitle.textContent = "Preset Library · 预设目录";
    const fbtn = document.createElement("button");
    fbtn.className = "wm-pm-folder-btn";
    fbtn.textContent = "＋ 大分类";
    fbtn.title = "新建大分类";
    fbtn.addEventListener("click", newBigFolder);
    lhead.append(ltitle, fbtn);
    const dirs = document.createElement("div");
    dirs.className = "wm-pm-dirs";
    attachBigReorderZone(dirs); // 整个左栏都接受大分类重排拖放（含缝隙）
    // 底部：渐变「发送整个目录到节点」大按钮（勾选导出底栏已按 V3 移除）
    const sideF = document.createElement("div");
    sideF.className = "wm-pm-side-f";
    const sendAll = document.createElement("button");
    sendAll.className = "wm-pm-sendall";
    sendAll.textContent = "发送整个目录到节点";
    sendAll.addEventListener("click", sendFolder);
    sideF.append(sendAll);
    left.append(lhead, dirs, sideF);

    const right = document.createElement("div");
    right.className = "wm-pm-right";
    const vhead = document.createElement("div");
    vhead.className = "wm-pm-vhead";
    const vleft = document.createElement("div");
    const vTitle = document.createElement("div");
    vTitle.className = "ttl";
    const vMeta = document.createElement("div");
    vMeta.className = "meta";
    vleft.append(vTitle, vMeta);
    const vtools = document.createElement("div");
    vtools.className = "wm-pm-vtools";
    // 画廊 / 列表 分段切换（记忆到 localStorage 视图状态）
    const seg = document.createElement("div");
    seg.className = "wm-pm-seg";
    const segCard = document.createElement("button");
    segCard.innerHTML = GRID_SVG + " 画廊";
    segCard.title = "画廊视图";
    const segRow = document.createElement("button");
    segRow.innerHTML = LINES_SVG + " 列表";
    segRow.title = "列表视图";
    function syncSeg() {
        segCard.classList.toggle("on", state.layout === "card");
        segRow.classList.toggle("on", state.layout !== "card");
    }
    segCard.addEventListener("click", () => {
        state.layout = "card";
        syncSeg();
        saveViewState();
        renderPresets();
    });
    segRow.addEventListener("click", () => {
        state.layout = "table";
        syncSeg();
        saveViewState();
        renderPresets();
    });
    syncSeg();
    seg.append(segCard, segRow);
    vtools.append(seg);
    vhead.append(vleft, vtools);

    const list = document.createElement("div");
    list.className = "wm-pm-list";

    right.append(vhead, list);
    main.append(left, right);
    modal.append(top, main);
    backdrop.append(modal);

    // ---------- 编辑弹窗（V3：1060px，左名称+内容 / 右预览图拖放区） ----------
    const editBd = document.createElement("div");
    editBd.className = "wm-pm-edit-modal-bd";
    editBd.style.display = "none";
    const editModal = document.createElement("div");
    editModal.className = "wm-pm-edit-modal";
    const editLbl = document.createElement("h4");
    editLbl.innerHTML = '<span class="lbl">新建预设</span><span class="x" title="关闭">✕</span>';
    editLbl.querySelector(".x").addEventListener("click", hideEditor);
    const erow = document.createElement("div");
    erow.className = "erow";
    const colL = document.createElement("div");
    colL.className = "col";
    const editName = document.createElement("input");
    editName.className = "e-name";
    editName.placeholder = "名称";
    const editContent = document.createElement("textarea");
    editContent.placeholder = "在此输入文本内容…";
    colL.append(editName, editContent);
    // 右列：预览图拖放区（点击/拖图上传；已有图 hover 显示「点击更换图片」遮罩）
    const colR = document.createElement("div");
    colR.className = "col";
    const dropzone = document.createElement("div");
    dropzone.className = "wm-pm-dropzone";
    dropzone.innerHTML = PLACEHOLDER_SVG +
        '<div class="hint">点击或拖入图片设置预览图</div>' +
        '<div class="sub2">保存时自动压缩落盘到 presets/images/</div>' +
        '<div class="veil2">点击更换图片</div>';
    dropzone.addEventListener("click", () => { if (els.editImageInput) els.editImageInput.click(); });
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("hover"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("hover"));
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("hover");
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) readFileAsDataURL(f).then((url) => { state.pendingImage = url; renderDropzone(); });
    });
    colR.append(dropzone);
    erow.append(colL, colR);
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

    // 编辑弹窗专用隐藏文件框（选择图片 → dataURL 暂存，保存时走原 API_IMAGE 上传）
    const editImageInput = document.createElement("input");
    editImageInput.type = "file";
    editImageInput.accept = "image/*";
    editImageInput.className = "wm-pm-hidden-file";
    editImageInput.addEventListener("change", () => {
        const f = editImageInput.files && editImageInput.files[0];
        editImageInput.value = "";
        if (f) readFileAsDataURL(f).then((url) => { state.pendingImage = url; renderDropzone(); });
    });
    backdrop.append(editImageInput);

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

    els = { dirs, list, editBd, editLbl, editName, editContent, dropzone, editImageInput,
            vTitle, vMeta, uploadInput, importInput, sendSel, searchInput: search, syncSeg };
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
        state.layout = saved.layout;
        // 若上次停留在某小分类，确保其父大分类展开，否则该小分类在树里不可见
        if (saved.folder && saved.parent && saved.folder !== "全部预设" && saved.folder !== "无目录") {
            state.expanded.add(saved.parent);
        }
    } else {
        state.folder = "全部预设";
        state.parent = "";
        state.expanded = new Set();
        state.layout = "card";
    }
    if (els.syncSeg) els.syncSeg(); // 恢复视图后同步「画廊/列表」分段按钮选中态
    if (els.searchInput) { els.searchInput.value = ""; state.search = ""; } // 每次打开清空搜索
    updateCatChip();
    state.editing = null;
    state.selected.clear();
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
    // 后端按提交顺序回传新建 id，节点靠它把整组文本与库里条目一一对应绑好
    let newIds = [];
    if (items.length) {
        const r = await post({ action: "add_many", items, folder: fname, parent: "未分类" });
        if (r && Array.isArray(r.ids)) newIds = r.ids;
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
    return newIds;
}

// 供 ⚡ 预设文本 节点的单条文本「保存到预设」：单条文本直接存入「未分类/未分类」，不新建目录。
// 返回值是新建条目的库 id（失败返回 ""），节点用它给自己绑上书签。
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
    const r = await post({ action: "add", name: pname, content: content || "", folder: "未分类", parent: "未分类" });
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
    return r && r.success ? (r.id || "") : "";
}

window.WindMixPresetManager = { open, close, newBigFolder, newSmallFolder, importFolder, importPreset };
