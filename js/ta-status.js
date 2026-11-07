(function () { try {
(function () {
const G = 'xy-home-v2';
const PT = window.presetTextEdit;
const SD = window.TA_STATUS_DATA || { groups: [], cards: [] };
const ED = window.TA_EMO_DATA || { groups: [], cards: [] };
const META_KEY = 'ta-meta';
const LAYOUT_KEY = 'chat-head-layout';
const SHOW_KEY = 'chat-head-meta';
const WEIGHT_KEY = 'ta-status-weighted';
const PG_ID = { status: 'ts', emo: 'te' };
const EK = { status: 'ts', emo: 'te' };
function rootStore() { try { return window.xyStore(G); } catch (e) { return null; } }
function gGet(k, d) {
try { const s = rootStore(); const v = s ? s.get(k) : null; return (v === null || v === undefined || v === '') ? d : v; } catch (e) { return d; }
}
function gSet(k, v) { try { const s = rootStore(); if (s) s.set(k, String(v)); } catch (e) {} }
function layoutPref() { return gGet(LAYOUT_KEY, 'classic') === 'wx' ? 'wx' : 'classic'; }
function metaOn() { return gGet(SHOW_KEY, '1') !== '0'; }
function weightedOn() { return gGet(WEIGHT_KEY, '1') !== '0'; }
function activeCid() { return window.__activeCid || 'default'; }
function storeOf(cid) {
try {
if (window.storeForCid) return window.storeForCid(cid);
return window.xyStore(G + ':' + (cid || 'default'));
} catch (e) { return null; }
}
function loadMeta(cid) {
let m = null;
try {
const s = storeOf(cid);
const raw = s ? s.get(META_KEY) : null;
if (raw) m = JSON.parse(raw);
} catch (e) { m = null; }
if (!m || typeof m !== 'object' || Array.isArray(m)) m = {};
return m;
}
function saveMeta(cid, m) {
try { const s = storeOf(cid); if (s) s.set(META_KEY, JSON.stringify(m)); } catch (e) {}
}
function aStore() { try { return window.activeStore(); } catch (e) { return null; } }
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function dataOf(kind) { return kind === 'status' ? SD : ED; }
function editKey(kind, g) { return (kind === 'status' ? 'ts:' : 'te:') + g; }
function offKey(kind, g, c) { return (kind === 'status' ? 'ts-off-' : 'te-off-') + g + ':' + c; }
function applyEdits(kind) {
if (!PT) return;
const D = dataOf(kind);
(D.groups || []).forEach(function (g) {
PT.apply(editKey(kind, g.group), function (newText, orig) {
(D.cards || []).forEach(function (c) {
if (c && c.group === g.group && c.content === orig) c.content = newText;
});
});
});
}
applyEdits('status');
applyEdits('emo');
if (PT) PT.onRebuild(function () { applyEdits('status'); applyEdits('emo'); });
function isCardOff(kind, g, c) {
if (window.presetGroup && window.presetGroup.isOff(PG_ID[kind], g)) return true;
const st = aStore();
if (!st) return false;
if (st.get(offKey(kind, g, c)) === '1') return true;
const orig = PT ? PT.original(editKey(kind, g), c) : c;
return orig !== c && st.get(offKey(kind, g, orig)) === '1';
}
function setCardOff(kind, g, c, off) {
const st = aStore();
if (st) st.set(offKey(kind, g, c), off ? '1' : '0');
}
function hisClock(cid) {
let t = null;
try { t = window.cjianTaTimeOf ? window.cjianTaTimeOf(cid) : null; } catch (e) { t = null; }
if (!t || typeof t.hh !== 'number' || typeof t.mm !== 'number') return null;
const now = Date.now();
const base = (typeof t.last === 'number' && t.last > 0 && t.last <= now) ? t.last : now;
const mins = Math.floor((now - base) / 60000);
let total = (t.hh * 60 + t.mm + mins) % 1440;
if (total < 0) total += 1440;
return { hh: Math.floor(total / 60), mm: total % 60 };
}
function clockText(cid) {
const c = hisClock(cid);
return c ? pad(c.hh) + ':' + pad(c.mm) : '';
}
function groups(kind) {
const D = dataOf(kind);
const out = [];
(D.groups || []).forEach(function (g) {
const cards = (D.cards || []).filter(function (c) {
return c && c.group === g.group && !isCardOff(kind, g.group, c.content);
});
if (cards.length) out.push({ g: g, cards: cards });
});
return out;
}
function roll(kind, cur) {
const pool = groups(kind);
if (!pool.length) return null;
const hour = (function () {
const c = hisClock(activeCid());
return c ? c.hh : new Date().getHours();
})();
const ws = pool.map(function (x) {
let w = Math.max(0.05, Number(x.g.weight) || 1);
if (kind === 'status' && weightedOn()) {
const hs = x.g.hours || [];
w = hs.indexOf(hour) >= 0 ? w * 3 : w * 0.4;
}
return w;
});
const total = ws.reduce(function (a, b) { return a + b; }, 0);
let rollv = Math.random() * total;
let pick = pool[pool.length - 1];
for (let i = 0; i < pool.length; i++) {
rollv -= ws[i];
if (rollv < 0) { pick = pool[i]; break; }
}
let cards = pick.cards;
if (cards.length > 1 && cur && cur.text) {
const without = cards.filter(function (c) { return c.content !== cur.text; });
if (without.length) cards = without;
}
const card = cards[Math.floor(Math.random() * cards.length)];
return {
text: card.content,
g: pick.g.group,
last: Date.now(),
next: 1 + Math.random() * 7,
locked: !!(cur && cur.locked)
};
}
function syncRec(kind, rec) {
const D = dataOf(kind);
let found = null;
(D.cards || []).forEach(function (c) {
if (!c || c.group !== rec.g) return;
if (c.content === rec.text) found = c;
else if (PT && PT.original(editKey(kind, rec.g), c.content) === rec.text) found = c;
});
if (found && found.content !== rec.text) rec.text = found.content;
return rec;
}
function inPool(kind, rec) {
const D = dataOf(kind);
return (D.cards || []).some(function (c) {
return c && c.group === rec.g && c.content === rec.text && !isCardOff(kind, c.group, c.content);
});
}
function ensureKind(kind, m) {
const now = Date.now();
let rec = m[kind];
if (rec && rec.text) {
rec = syncRec(kind, rec);
if (rec.locked) return rec;
const due = (typeof rec.last !== 'number') || (now - rec.last >= (Number(rec.next) || 1) * 36e5);
if (!due && inPool(kind, rec)) return rec;
}
const next = roll(kind, rec);
if (!next) return null;
m[kind] = next;
return next;
}
function current(kind) {
const cid = activeCid();
const m = loadMeta(cid);
const before = JSON.stringify(m[kind] || null);
const rec = ensureKind(kind, m);
if (JSON.stringify(m[kind] || null) !== before) saveMeta(cid, m);
return rec;
}
let lastMetaText = null;
function refreshMeta() {
const el = document.getElementById('chat-meta');
if (!el) return;
const cid = activeCid();
const parts = [];
const clk = clockText(cid);
if (clk) parts.push(clk);
if (metaOn()) {
const s = current('status');
if (s && s.text) parts.push(s.text);
const e = current('emo');
if (e && e.text) parts.push(e.text);
}
const txt = parts.join(' · ');
if (txt === lastMetaText) return;
lastMetaText = txt;
el.textContent = txt;
el.hidden = !txt;
}
function applyLayout() {
const page = document.getElementById('page-chat');
if (!page) return;
const wx = layoutPref() === 'wx';
if (page.classList.contains('ch-head-wx') !== wx) page.classList.toggle('ch-head-wx', wx);
}
window.applyChatHeadPrefs = function () { applyLayout(); refreshMeta(); };
window.taMetaRefresh = refreshMeta;
window.taMetaApi = {
layout: layoutPref,
metaOn: metaOn,
weighted: weightedOn,
current: function (kind) { return current(kind); },
clock: function () { return clockText(activeCid()); },
reroll: function (kind) { return rerollNow(kind); },
lock: function (kind, on) { setLocked(kind, on); }
};
function rerollNow(kind) {
const cid = activeCid();
const m = loadMeta(cid);
const rec = roll(kind, m[kind]);
if (!rec) { toast('这一类字卡已全部停用，先去「他的状态」里开启几张'); return null; }
m[kind] = rec;
saveMeta(cid, m);
renderPage();
refreshMeta();
toast('已换一个' + (kind === 'status' ? '状态' : '情绪') + '：' + rec.text);
return rec;
}
function setLocked(kind, on) {
const cid = activeCid();
const m = loadMeta(cid);
if (!m[kind]) { toast('还没有可锁定的' + (kind === 'status' ? '状态' : '情绪')); return; }
m[kind].locked = !!on;
if (on) {
m[kind].last = Date.now();
m[kind].next = 1 + Math.random() * 7;
} else {
m[kind].last = Date.now();
m[kind].next = 1 + Math.random() * 7;
}
saveMeta(cid, m);
renderPage();
refreshMeta();
toast(on ? '已锁定：不会再自动更换' : '已恢复自动更换');
}
const pageEl = document.getElementById('page-ta-status');
const listEl = document.getElementById('ts-list');
let tsKind = 'status';
let tsQ = '';
function esc(s) {
return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function setTxt(id, v) {
const el = document.getElementById(id);
if (el) el.textContent = v;
}
function updateCounts() {
setTxt('cc-ta-status-count', String((SD.cards || []).length));
}
function renderNow() {
if (!pageEl) return;
const s = current('status');
const e = current('emo');
setTxt('ts-now-status', s && s.text ? s.text : '暂无可用状态');
setTxt('ts-now-emo', e && e.text ? e.text : '暂无可用情绪');
const sl = document.getElementById('ts-lock-status');
if (sl) {
const on = !!(s && s.locked);
sl.textContent = on ? '恢复自动' : '锁定';
sl.classList.toggle('on', on);
}
const el = document.getElementById('ts-lock-emo');
if (el) {
const on = !!(e && e.locked);
el.textContent = on ? '恢复自动' : '锁定';
el.classList.toggle('on', on);
}
const hint = s || e;
let tip = '自动更换：状态与情绪每 1~8 小时换一次';
if (hint) {
const left = Math.max(0, (Number(hint.last) || Date.now()) + (Number(hint.next) || 1) * 36e5 - Date.now());
const h = Math.max(1, Math.round(left / 36e5));
tip += '（约 ' + h + ' 小时后）';
}
if (s && s.locked) tip += ' · 状态已锁定';
setTxt('ts-now-hint', tip);
const w = document.getElementById('ts-weighted');
if (w) w.checked = weightedOn();
}
let tsGroup = '';
function renderBarReal() {
const bar = document.getElementById('ts-groups-bar');
if (!bar) return;
bar.innerHTML = '';
const D = dataOf(tsKind);
const chips = [['', '全部']].concat((D.groups || []).map(function (g) { return [g.group, g.group]; }));
chips.forEach(function (pair) {
const c = document.createElement('span');
c.className = 'cc-g-chip' + (tsGroup === pair[0] ? ' sel' : '');
c.textContent = pair[1];
c.addEventListener('click', function () { tsGroup = pair[0]; renderBarReal(); renderList(); });
bar.appendChild(c);
});
}
function renderList() {
if (!listEl) return;
const D = dataOf(tsKind);
let shown = D.groups || [];
if (tsGroup) shown = shown.filter(function (g) { return g.group === tsGroup; });
const wMap = {};
(D.cards || []).forEach(function (c) { (wMap[c.group] = wMap[c.group] || []).push(c); });
const flat = [];
shown.forEach(function (g) {
const arr = (wMap[g.group] || []).filter(function (c) { return !tsQ || c.content.indexOf(tsQ) >= 0; });
if (!arr.length && !(tsQ && g.group.indexOf(tsQ) >= 0)) return;
flat.push({ header: true, gname: g.group, count: arr.length });
arr.forEach(function (c) { flat.push({ card: c }); });
});
listEl.innerHTML = '';
if (!flat.length) {
listEl.innerHTML = '<div class="cc-empty">暂无' + (tsKind === 'status' ? '状态' : '情绪') + '字卡</div>';
return;
}
const frag = document.createDocumentFragment();
flat.forEach(function (it) {
if (it.header) {
const h = document.createElement('div');
const off = !!(window.presetGroup && window.presetGroup.isOff(PG_ID[tsKind], it.gname));
h.className = 'cc-group-header' + (off ? ' off' : '');
h.innerHTML = window.presetGroup
? window.presetGroup.headerHTML(PG_ID[tsKind], it.gname, it.gname, it.count, '')
: '<span class="ccg-name">' + esc(it.gname) + '</span><span class="ccg-count">' + it.count + '</span>';
frag.appendChild(h);
if (window.presetGroup) window.presetGroup.bind(h, PG_ID[tsKind], it.gname, function (nowOff) {
renderList();
refreshMeta();
toast(nowOff ? '已停用分组：' + it.gname : '已启用分组：' + it.gname);
});
return;
}
const c = it.card;
const off = isCardOff(tsKind, c.group, c.content);
const ekey = editKey(tsKind, c.group);
const edited = !!(PT && PT.isEdited(ekey, c.content));
const d = document.createElement('div');
d.className = 'cc-item glass' + (off ? ' off' : '');
d.innerHTML = '<div class="cc-txt"><div class="t">' + esc(c.content) + ' <span class="tc-known' +
(edited ? ' edited' : '') + '">' + (edited ? '已改' : '系统') + '</span></div></div>' +
(PT ? '<button type="button" class="preset-edit-btn" title="编辑这张系统字卡" aria-label="编辑这张系统字卡">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>' : '') +
'<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
frag.appendChild(d);
if (PT) d.querySelector('.preset-edit-btn').addEventListener('click', function () {
PT.open({
key: ekey,
shown: c.content,
exists: function (next) {
const D2 = dataOf(tsKind);
return (D2.cards || []).some(function (x) {
return x && x.group === c.group && x.content === next && x !== c;
});
},
onChanged: function (next, orig) {
c.content = next;
const cid = activeCid();
const m = loadMeta(cid);
const rec = m[tsKind];
if (rec && rec.g === c.group && rec.text === orig) {
rec.text = next;
saveMeta(cid, m);
}
renderNow();
renderList();
refreshMeta();
}
});
});
d.querySelector('input').addEventListener('change', function () {
const nowOff = !d.querySelector('input').checked;
setCardOff(tsKind, c.group, c.content, nowOff);
d.classList.toggle('off', nowOff);
renderNow();
refreshMeta();
toast((nowOff ? '已停用：' : '已启用：') + (c.content.length > 16 ? c.content.slice(0, 16) + '…' : c.content));
});
});
listEl.appendChild(frag);
}
function renderPage() {
if (!pageEl) return;
renderNow();
renderBarReal();
renderList();
}
(function wirePage() {
if (!pageEl) return;
listEl.classList.add('preset-list');
updateCounts();
renderPage();
const tabs = document.getElementById('ts-tabs');
const si = document.getElementById('ts-search-input');
if (tabs) {
tabs.querySelectorAll('.them-tab').forEach(function (t) {
t.addEventListener('click', function () {
tsKind = t.dataset.ts === 'emo' ? 'emo' : 'status';
tsQ = '';
tsGroup = '';
tabs.querySelectorAll('.them-tab').forEach(function (x) { x.classList.toggle('active', x === t); });
const gt = document.getElementById('ts-groups-title');
if (gt) gt.textContent = tsKind === 'status' ? '状态分组' : '情绪分组';
if (si) {
si.value = '';
si.placeholder = tsKind === 'status' ? '搜索状态字卡' : '搜索情绪字卡';
}
renderPage();
});
});
}
if (si) {
si.addEventListener('input', function () { tsQ = si.value.trim(); renderList(); });
si.addEventListener('keydown', function (e) {
if (e.key === 'Escape') { si.value = ''; tsQ = ''; renderList(); si.blur(); }
});
}
const weighted = document.getElementById('ts-weighted');
if (weighted) {
weighted.checked = weightedOn();
weighted.addEventListener('change', function () {
gSet(WEIGHT_KEY, weighted.checked ? '1' : '0');
toast(weighted.checked ? '已开启：状态按他的作息加权' : '已关闭：状态均匀抽取');
});
}
const rs = document.getElementById('ts-reroll-status');
if (rs) rs.addEventListener('click', function () { rerollNow('status'); });
const re = document.getElementById('ts-reroll-emo');
if (re) re.addEventListener('click', function () { rerollNow('emo'); });
const ls = document.getElementById('ts-lock-status');
if (ls) ls.addEventListener('click', function () {
const rec = current('status');
setLocked('status', !(rec && rec.locked));
});
const le = document.getElementById('ts-lock-emo');
if (le) le.addEventListener('click', function () {
const rec = current('emo');
setLocked('emo', !(rec && rec.locked));
});
const li = document.getElementById('li-ta-status');
if (li) li.addEventListener('click', function () {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
pageEl.hidden = false;
renderPage();
});
const back = document.getElementById('ts-back');
if (back) back.addEventListener('click', function () {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
})();
function tick() { applyLayout(); refreshMeta(); }
setInterval(tick, 60000);
document.addEventListener('contact-switched', tick);
document.addEventListener('mochi-restore-done', tick);
document.addEventListener('mochi-fg-resume', tick);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') tick(); });
window.addEventListener('pageshow', function (e) { if (e.persisted) tick(); });
window.addEventListener('focus', tick);
(function watchChatPage() {
const p = document.getElementById('page-chat');
if (!p || !window.MutationObserver) return;
try {
new MutationObserver(function () { if (!p.hidden) refreshMeta(); }).observe(p, { attributes: true, attributeFilter: ['hidden'] });
} catch (e) {}
})();
tick();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("ta-status.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("ta-status.js"); try { console.error("[JS] ta-status.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[ta-status.js] " + String(__e && __e.message || __e)); } })();