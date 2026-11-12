(function () { try {
(function () {
const store = window.xyStore('xy-home-v2');
const KEY = 'default-card-edits';
let rawAtBoot = null;
function parse(rawStr) {
const out = {};
try {
const raw = JSON.parse(rawStr || '{}');
if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
Object.keys(raw).forEach(function (key) {
const m = raw[key];
if (!m || typeof m !== 'object' || Array.isArray(m)) return;
Object.keys(m).forEach(function (orig) {
const v = m[orig];
if (typeof v === 'string' && v.trim()) {
if (!out[key]) out[key] = {};
out[key][orig] = v;
}
});
});
}
} catch (e) {}
return out;
}
const EDITS = (function () {
try { rawAtBoot = store.get(KEY); } catch (e) { rawAtBoot = null; }
return parse(rawAtBoot);
})();
const REV = {};
function rebuild(key) {
const src = EDITS[key] || {};
const rev = {};
Object.keys(src).forEach(function (orig) { rev[src[orig]] = orig; });
REV[key] = rev;
}
function rebuildAll() {
Object.keys(REV).forEach(function (k) { delete REV[k]; });
Object.keys(EDITS).forEach(rebuild);
}
rebuildAll();
function persist() {
try { store.set(KEY, JSON.stringify(EDITS)); } catch (e) {}
}
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
}
function rebuildFns() { return (window.presetTextEdit && window.presetTextEdit.__rebuildFns) || []; }
function runRebuildFns() {
rebuildFns().forEach(function (fn) { try { fn(); } catch (e) {} });
}
const api = {
KEY: KEY,
map: function (key) { return EDITS[key] || {}; },
count: function (key) { return Object.keys(EDITS[key] || {}).length; },
hasAny: function () { return Object.keys(EDITS).length > 0; },
isEdited: function (key, text) { const rev = REV[key]; return !!(rev && rev[text]); },
original: function (key, text) { const rev = REV[key]; return (rev && rev[text]) || text; },
text: function (key, orig) { const m = EDITS[key]; return (m && m[orig]) || orig; },
apply: function (key, fn) {
const m = EDITS[key];
if (!m) return;
Object.keys(m).forEach(function (orig) {
try { fn(m[orig], orig); } catch (e) {}
});
},
onRebuild: function (fn) {
if (typeof fn !== 'function') return;
api.__rebuildFns.push(fn);
},
__rebuildFns: [],
open: function (o) {
if (!window.openModal) { toast('弹窗组件不可用'); return; }
const key = o.key;
const shown = o.shown;
const orig = api.original(key, shown);
const edited = orig !== shown;
function finish(next) {
if (!next) { toast('字卡内容不能为空，已保留原文案'); return false; }
if (next === shown) return true; // 没改：不动存储
if (next === orig) {
if (o.exists && o.exists(orig)) {
toast('原文案已被另一张卡使用，先把那张改成别的文案再恢复');
return false;
}
} else if (o.exists && o.exists(next)) {
toast('同分类已有这张字卡：' + (next.length > 18 ? next.slice(0, 18) + '…' : next) + '，换一句再试');
return false;
}
if (!EDITS[key]) EDITS[key] = {};
if (next === orig) {
delete EDITS[key][orig];
if (!Object.keys(EDITS[key]).length) delete EDITS[key];
} else {
EDITS[key][orig] = next;
}
persist();
rebuild(key);
try { if (o.onChanged) o.onChanged(next, orig); } catch (e) {}
toast(next === orig ? '已恢复系统原文案' : '已更新这张系统字卡（所有桌面共用）');
return true;
}
window.openModal(o.title || '编辑系统字卡', typeof o.draft === 'string' ? o.draft : shown, function (v) {
const raw = String(v == null ? '' : v);
const next = o.multiline ? raw.replace(/\r\n?/g, '\n').trim() : raw.replace(/[\r\n]+/g, ' ').trim();
if (!finish(next)) {
if (next) api.open(Object.assign({}, o, { draft: next }));
}
}, {
maxlength: o.multiline ? 0 : (o.maxlength || 120),
textarea: !!o.multiline,
textareaRows: o.rows || 4,
staticText: o.staticText || (o.multiline
? '每行一句，保存后立即生效；原文案仍保留，可随时「恢复原文」。改动保存在本机，所有联系人桌面共用。'
: '只改这一张系统预设字卡：保存后列表和回复都立即用新文案，原文案仍保留，可随时「恢复原文」。改动保存在本机，所有联系人桌面共用。'),
extraBtn: edited ? {
label: '恢复原文',
fn: function (ctl) { if (finish(orig)) ctl.close(); }
} : null
});
}
};
window.presetTextEdit = api;
document.addEventListener('mochi-restore-done', function () {
try {
if (api.hasAny()) return;
let raw = null;
try { raw = store.get(KEY); } catch (e) { return; }
if (!raw || raw === rawAtBoot) return;
rawAtBoot = raw;
const fresh = parse(raw);
if (!Object.keys(fresh).length) return;
Object.keys(EDITS).forEach(function (k) { delete EDITS[k]; });
Object.keys(fresh).forEach(function (k) { EDITS[k] = fresh[k]; });
rebuildAll();
runRebuildFns();
} catch (e) {}
});
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("preset-edit.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("preset-edit.js"); try { console.error("[JS] preset-edit.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[preset-edit.js] " + String(__e && __e.message || __e)); } })();