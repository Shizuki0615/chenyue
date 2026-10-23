(function () { try {
(function () {
'use strict';
const G = 'xy-home-v2';
const store = window.xyStore(G);
const RD_INDEX_KEY = 'reading-books';
const RD_PREFS_KEY = 'reading-prefs';
const RD_BODY_P = 'xy-home-v2:reading-body:';
const RD_TOC_P = 'xy-home-v2:reading-toc:';
const RD_ANNO_P = 'xy-home-v2:reading-anno:';
const RD_MAX_BYTES = 20 * 1024 * 1024;
const RD_MAX_BOOKS = 20;
const RD_BAD_RATIO = 0.005;
function rdToast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2200);
}
function readIndex() {
let raw = null;
try { raw = store.get(RD_INDEX_KEY); } catch (e) { return []; }
if (raw === null || raw === undefined || raw === '') return [];
if (Array.isArray(raw)) return raw; // 大键可能以数组形态直驻内存缓存
try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function saveIndex(list) {
try {
store.set(RD_INDEX_KEY, JSON.stringify(list || []));
return true;
} catch (e) {
rdToast('书架保存失败：' + ((e && e.message) || '本地存储写入没有完成'));
return false;
}
}
function rdWriteFail(what) {
const err = new Error((what || '保存失败') + '：磁盘写入没有完成，请重试');
err.rdWrite = true;
throw err;
}
async function putBody(id, ch, text) {
let ok = false;
try { ok = await window.idbSet(RD_BODY_P + id + ':' + ch, String(text == null ? '' : text)); }
catch (e) { rdWriteFail('正文没保存上'); }
if (!ok) rdWriteFail('正文没保存上');
return true;
}
async function getBody(id, ch) {
try {
const v = await window.idbGet(RD_BODY_P + id + ':' + ch);
return typeof v === 'string' ? v : '';
} catch (e) { return ''; }
}
async function putToc(id, list) {
let ok = false;
try { ok = await window.idbSet(RD_TOC_P + id, JSON.stringify(list || [])); }
catch (e) { rdWriteFail('目录没保存上'); }
if (!ok) rdWriteFail('目录没保存上');
return true;
}
async function getToc(id) {
try {
const v = await window.idbGet(RD_TOC_P + id);
if (v === null || v === undefined || v === '') return [];
if (Array.isArray(v)) return v;
const a = JSON.parse(v);
return Array.isArray(a) ? a : [];
} catch (e) { return []; }
}
async function getAnnos(id, ch) {
try {
const v = await window.idbGet(RD_ANNO_P + id + ':' + ch);
if (v === null || v === undefined || v === '') return [];
if (Array.isArray(v)) return v;
const a = JSON.parse(v);
return Array.isArray(a) ? a : [];
} catch (e) { return []; }
}
async function putAnnos(id, ch, list) {
let ok = false;
try { ok = await window.idbSet(RD_ANNO_P + id + ':' + ch, JSON.stringify(list || [])); }
catch (e) { rdWriteFail('批注没保存上'); }
if (!ok) rdWriteFail('批注没保存上');
return true;
}
async function delBookData(id) {
const p1 = RD_BODY_P + id + ':';
const p2 = RD_ANNO_P + id + ':';
const p3 = RD_TOC_P + id;
let keys = null;
try { keys = await window.idbGetAllKeys(); } catch (e) { keys = null; }
const targets = [];
if (Array.isArray(keys)) {
for (let i = 0; i < keys.length; i++) {
const k = String(keys[i] || '');
if (k.indexOf(p1) === 0 || k.indexOf(p2) === 0 || k === p3) targets.push(k);
}
}
if (!targets.length) {
const toc = await getToc(id);
const n = Math.max(0, toc.length);
targets.push(p3);
for (let i = 0; i < n; i++) { targets.push(p1 + i); targets.push(p2 + i); }
}
let allOk = true;
for (let i = 0; i < targets.length; i++) {
let ok = false;
try { ok = await window.idbDelete(targets[i]); } catch (e) { ok = false; }
if (!ok) allOk = false;
}
return allOk;
}
const rdImp = { buf: null, name: '', text: '', source: '', chapters: null, bad: 0 };
function rdUtf8Size(s) {
const str = String(s || '');
if (typeof TextEncoder === 'function') {
try { return new TextEncoder().encode(str).length; } catch (e) {}
}
return str.length * 3;
}
function rdMB(bytes) { return (bytes / 1024 / 1024).toFixed(1); }
function rdDecode(buf, enc) {
let text = '';
try { text = new TextDecoder(enc, { fatal: false }).decode(buf); }
catch (e) {
try { text = new TextDecoder('utf-8').decode(buf); } catch (e2) { text = ''; }
}
let bad = 0, total = 0;
for (let i = 0; i < text.length; i++) {
const c = text.charCodeAt(i);
if (c === 0xFFFD) bad++;
if (c > 32) total++;
}
return { text: text, bad: total ? bad / total : 0 };
}
const RD_CH_TITLE_RE = /^\s*(第[0-9零一二三四五六七八九十百千万]+[章回节卷]|卷[0-9零一二三四五六七八九十百千]+|序章|楔子|番外[一二三四五六七八九十]*|Chapter\s+\d+)/i;
function splitChapters(text) {
const src = String(text == null ? '' : text);
const n = src.length;
if (!n) return [];
const lines = [];
let p = 0;
while (p <= n) {
let q = src.indexOf('\n', p);
if (q < 0) q = n;
const raw = src.slice(p, q);
lines.push({ s: p, e: q, text: raw.replace(/\r$/, '') });
if (q >= n) break;
p = q + 1;
}
const marks = [];
for (let i = 0; i < lines.length; i++) {
const ln = lines[i];
if (ln.text.trim() && RD_CH_TITLE_RE.test(ln.text)) marks.push({ s: ln.s, t: ln.text.trim().slice(0, 60) });
}
if (marks.length >= 2 || (marks.length === 1 && marks[0].s > 0)) {
return rdRangesFromMarks(src, marks);
}
const para = [];
let cur = -1;
for (let i = 0; i < lines.length; i++) {
const ln = lines[i];
const blank = !ln.text.trim();
if (blank) {
let j = i;
while (j + 1 < lines.length && !lines[j + 1].text.trim()) j++;
if (j > i) { // 至少两个连续空行 = 段簇边界
if (cur < 0) { cur = i; }
para.push({ s: cur >= 0 ? lines[cur].s : 0, e: ln.e });
cur = -1;
i = j;
}
continue;
}
if (cur < 0) cur = i;
}
if (para.length >= 2) {
const out = [];
let start = 0;
for (let i = 0; i < para.length; i++) {
const end = para[i].e;
if (end <= start) continue;
out.push({ t: '第 ' + (out.length + 1) + ' 节', s: start, e: end });
start = end;
}
if (start < n) out.push({ t: '第 ' + (out.length + 1) + ' 节', s: start, e: n });
if (out.length) { out[0].t = '前言'; return out; }
}
const out = [];
let s = 0;
while (s < n) {
const e = Math.min(n, s + 8000);
out.push({ t: out.length === 0 ? '前言' : '第 ' + (out.length + 1) + ' 节', s: s, e: e });
s = e;
}
return out;
}
function rdRangesFromMarks(src, marks) {
const n = src.length;
const out = [];
if (marks[0].s > 0 && src.slice(0, marks[0].s).trim()) {
out.push({ t: '前言', s: 0, e: marks[0].s });
}
for (let i = 0; i < marks.length; i++) {
const s = marks[i].s;
const e = i + 1 < marks.length ? marks[i + 1].s : n;
out.push({ t: marks[i].t || ('第 ' + (i + 1) + ' 节'), s: s, e: e });
}
const kept = out.filter(function (c) { return c.e > c.s; });
while (kept.length > 1 && !src.slice(kept[0].s, kept[0].e).trim()) {
kept[1].s = kept[0].s;
kept.shift();
}
return kept;
}
let page = null;
function buildPage() {
if (page) return page;
page = document.createElement('div');
page.className = 'page';
page.id = 'page-reading';
page.hidden = true;
page.innerHTML =
'<div class="rd-shelf" id="rd-shelf">' +
'<div class="rd-head">' +
'<button class="rd-back" id="rd-shelf-back" type="button">返回</button>' +
'<div class="rd-title">一起读书</div>' +
'<button class="rd-back" id="rd-import" type="button">导入</button>' +
'</div>' +
'<div class="rd-empty" id="rd-empty">书架还是空的，点右上角导入一本</div>' +
'<div class="rd-grid" id="rd-grid"></div>' +
'<div class="rd-usage" id="rd-usage"></div>' +
'<div class="rd-import" id="rd-import-panel" hidden>' +
'<div class="rd-import-main" id="rd-import-main">' +
'<div class="rd-import-head"><div class="rd-import-title">导入一本书</div>' +
'<button class="rd-back" id="rd-import-close" type="button">关闭</button></div>' +
'<label class="rd-file-label" for="rd-file">选择 TXT 文件</label>' +
'<input type="file" id="rd-file" accept=".txt,text/plain">' +
'<div class="rd-file-info" id="rd-file-info" hidden></div>' +
'<div class="rd-gbk-row" id="rd-gbk-row" hidden>' +
'<span>这段文字里乱码不少，可能不是 UTF-8</span>' +
'<button class="rd-btn" id="rd-gbk" type="button">按 GBK 重新解码</button>' +
'</div>' +
'<textarea id="rd-paste" placeholder="也可以把整本书粘贴到这里"></textarea>' +
'<div class="rd-import-foot"><button class="rd-btn rd-btn-primary" id="rd-import-go" type="button">开始导入</button></div>' +
'</div>' +
'<div class="rd-confirm" id="rd-confirm" hidden>' +
'<div class="rd-import-head"><button class="rd-back" id="rd-confirm-back" type="button">返回</button>' +
'<div class="rd-import-title">确认分章</div>' +
'<button class="rd-back" id="rd-confirm-merge-all" type="button">全部合并</button></div>' +
'<div class="rd-confirm-bar"><button class="rd-btn rd-btn-mini" id="rd-confirm-reset" type="button">恢复自动分章</button></div>' +
'<div class="rd-confirm-list" id="rd-confirm-list"></div>' +
'<div class="rd-import-foot"><button class="rd-btn rd-btn-primary" id="rd-confirm-go" type="button">确认导入</button></div>' +
'</div>' +
'</div>' +
'</div>' +
'<div class="rd-reader" id="rd-reader" hidden>' +
'<div class="rd-head">' +
'<button class="rd-back" id="rd-reader-back" type="button">返回</button>' +
'<div class="rd-title" id="rd-book-title"></div>' +
'<button class="rd-back" id="rd-font-btn" type="button">Aa</button>' +
'<button class="rd-back" id="rd-toc-btn" type="button">目录</button>' +
'</div>' +
'<div class="rd-body" id="rd-body"></div>' +
'<div class="rd-foot" id="rd-foot">' +
'<div class="rd-bar" id="rd-bar"><span class="rd-bar-fill" id="rd-bar-fill"></span><span class="rd-buddy-dot" id="rd-buddy-dot" hidden></span></div>' +
'<div class="rd-foot-row"><span id="rd-page-no">第 1 / 1 页</span><span id="rd-buddy"></span></div>' +
'</div>' +
'<div class="rd-prefs" id="rd-prefs" hidden>' +
'<div class="rd-prefs-row"><span>字号</span>' +
'<button class="rd-btn rd-btn-mini" data-fs="15" type="button">小</button>' +
'<button class="rd-btn rd-btn-mini" data-fs="17" type="button">标准</button>' +
'<button class="rd-btn rd-btn-mini" data-fs="19" type="button">大</button>' +
'<button class="rd-btn rd-btn-mini" data-fs="21" type="button">特大</button></div>' +
'<div class="rd-prefs-row"><span>行距</span>' +
'<button class="rd-btn rd-btn-mini" data-lh="1.7" type="button">紧</button>' +
'<button class="rd-btn rd-btn-mini" data-lh="1.9" type="button">松</button></div>' +
'</div>' +
'<div class="rd-toc" id="rd-toc" hidden>' +
'<div class="rd-import-head"><div class="rd-import-title">目录</div>' +
'<button class="rd-back" id="rd-toc-close" type="button">关闭</button></div>' +
'<div class="rd-toc-list" id="rd-toc-list"></div>' +
'</div>' +
'<div class="rd-selbar" id="rd-selbar" hidden>' +
'<button class="rd-selbar-btn" data-act="anno" type="button">批注</button>' +
'<button class="rd-selbar-btn" data-act="copy" type="button">复制</button>' +
'</div>' +
'<div class="rd-anno-sheet" id="rd-anno-sheet" hidden>' +
'<div class="rd-import-head"><div class="rd-import-title">选一张字卡</div>' +
'<button class="rd-back" id="rd-anno-close" type="button">关闭</button></div>' +
'<input class="rd-anno-search" id="rd-anno-search" type="text" placeholder="搜索字卡">' +
'<div class="rd-card-list" id="rd-card-list"></div>' +
'<div class="rd-write-box">' +
'<textarea id="rd-anno-write" placeholder="也可以自己写一条"></textarea>' +
'<button class="rd-btn" id="rd-anno-write-go" type="button">用这段文字</button>' +
'</div>' +
'</div>' +
'<div class="rd-anno-preview" id="rd-anno-preview" hidden>' +
'<div class="rd-import-head"><button class="rd-back" id="rd-anno-back" type="button">返回</button>' +
'<div class="rd-import-title">预览批注</div><span class="rd-back"></span></div>' +
'<div class="rd-prev-quote" id="rd-prev-quote"></div>' +
'<div class="rd-prev-text" id="rd-prev-text"></div>' +
'<div class="rd-import-foot"><button class="rd-btn rd-btn-primary" id="rd-anno-commit" type="button">贴上</button></div>' +
'</div>' +
'<div class="rd-anno-pop" id="rd-anno-pop" hidden>' +
'<div class="rd-import-head"><div class="rd-import-title">这句旁边的批注</div>' +
'<button class="rd-back" id="rd-anno-pop-close" type="button">关闭</button></div>' +
'<div class="rd-pop-list" id="rd-pop-list"></div>' +
'</div>' +
'</div>';
const phone = document.querySelector('.phone');
(phone || document.body).appendChild(page);
rdApplyPrefs(rdReadPrefs());
return page;
}
function rdOpen() {
buildPage();
rdRenderShelf();
rdRetryPendingDelete();
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
page.hidden = false;
requestAnimationFrame(function () {
const tabbar = document.querySelector('.tabbar');
const phone = document.querySelector('.phone');
if (tabbar) tabbar.hidden = true;
if (phone) phone.classList.add('no-statusbar');
page.classList.add('full');
});
}
function rdClose() {
if (!page) return;
rdWriteProgress();
rdCloseBookMenu();
page.classList.remove('full');
page.hidden = true;
const home = document.getElementById('page-phone');
if (home) home.hidden = false;
}
function rdShowShelf() {
if (!page) return;
rdWriteProgress();
closeToc();
rdClearSel(false);
rdCloseSheet();
rdClosePreview();
rdClosePop();
const prefs = document.getElementById('rd-prefs');
if (prefs) prefs.hidden = true;
const shelf = document.getElementById('rd-shelf');
const reader = document.getElementById('rd-reader');
const imp = document.getElementById('rd-import-panel');
if (shelf) shelf.hidden = false;
if (reader) reader.hidden = true;
if (imp) imp.hidden = true;
rdRenderShelf();
}
async function rdOpenBook(id) {
const list = readIndex();
const book = rdFindBook(id, list);
if (!book) { rdToast('这本书不在书架里'); return; }
const toc = await getToc(id);
const first = toc.length ? await getBody(id, 0) : '';
if (!toc.length || !first) {
if (!book.missing) { book.missing = true; saveIndex(list); }
if (window.openModal) {
window.openModal('这本书的正文不在备份里', '', null, {
noInput: true,
staticText: '重新导入同一个 TXT 即可继续，进度与批注会按原文重新定位。'
});
} else {
rdToast('这本书的正文不在备份里');
}
return;
}
const shelf = document.getElementById('rd-shelf');
const reader = document.getElementById('rd-reader');
const title = document.getElementById('rd-book-title');
const body = document.getElementById('rd-body');
if (shelf) shelf.hidden = true;
if (reader) reader.hidden = false;
if (title) title.textContent = book.title || '未命名';
if (body) body.textContent = '正在翻开…';
let ch = (book.progress && book.progress.ch) || 0;
if (ch < 0 || ch >= toc.length) ch = 0;
rdBook = {
id: id, toc: toc, ch: ch, off: (book.progress && book.progress.off) || 0,
cache: {}, text: '', pages: [], pageIdx: 0, anno: []
};
rdEnsureChapter('offset');
}
let rdBook = null;
const RD_PAGE_CACHE = {};
const RD_BIG_TEXT = 50000;
async function rdEnsureChapter(mode) {
const b = rdBook;
if (!b) return;
const body = document.getElementById('rd-body');
if (body) body.textContent = '正在翻开…';
let text = b.cache[b.ch];
if (text == null) text = await getBody(b.id, b.ch);
if (!rdBook || rdBook !== b) return;
b.cache[b.ch] = text || '';
if (b.ch + 1 < b.toc.length) {
const nx = b.ch + 1;
getBody(b.id, nx).then(function (t) {
if (!rdBook || rdBook !== b) return;
b.cache[nx] = t || '';
Object.keys(b.cache).forEach(function (k) {
const n = parseInt(k, 10);
if (n !== b.ch && n !== nx) delete b.cache[n];
});
}).catch(function () {});
}
if (!text) {
if (body) {
body.innerHTML = '<button class="rd-retry" id="rd-retry" type="button">这一章没有读到，点此重试</button>';
}
return;
}
b.text = text;
b.anno = await getAnnos(b.id, b.ch);
if (!rdBook || rdBook !== b) return;
b.pages = rdPaginateChapter(b);
rdCheckPagination(b.pages, b.text.length);
if (mode === 'last') b.pageIdx = Math.max(0, b.pages.length - 1);
else if (mode === 'offset') b.pageIdx = rdPageForOffset(b.pages, b.off);
else b.pageIdx = 0;
rdRenderPage();
}
function rdPageForOffset(pages, off) {
let lo = 0;
let hi = pages.length - 1;
let best = 0;
while (lo <= hi) {
const mid = (lo + hi) >> 1;
if (pages[mid].s <= off) { best = mid; lo = mid + 1; }
else hi = mid - 1;
}
return best;
}
function rdPaginateChapter(b) {
const body = document.getElementById('rd-body');
if (!body) return [{ s: 0, e: b.text.length }];
const cs = getComputedStyle(body);
const padL = parseFloat(cs.paddingLeft) || 0;
const padR = parseFloat(cs.paddingRight) || 0;
const w = Math.max(80, body.clientWidth - padL - padR);
const h = Math.max(80, body.clientHeight);
const fs = parseFloat(cs.fontSize) || 17;
let lh = parseFloat(cs.lineHeight);
if (!lh || isNaN(lh)) lh = fs * 1.8;
const key = b.id + '|' + b.ch + '|' + Math.round(w) + '|' + Math.round(h) + '|' + fs + '|' + lh;
if (RD_PAGE_CACHE[key]) return RD_PAGE_CACHE[key];
const pages = paginate(b.text, w, h, fs, lh, cs.fontFamily);
RD_PAGE_CACHE[key] = pages;
const keys = Object.keys(RD_PAGE_CACHE);
if (keys.length > 24) delete RD_PAGE_CACHE[keys[0]];
return pages;
}
function paginate(text, w, h, fs, lh, ff) {
const src = String(text == null ? '' : text);
const n = src.length;
if (!n) return [{ s: 0, e: 0 }];
const box = document.createElement('div');
box.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;' +
'white-space:pre-wrap;word-break:break-word;box-sizing:border-box;width:' + w + 'px;' +
'font-size:' + fs + 'px;line-height:' + lh + 'px;';
if (ff) box.style.fontFamily = ff;
document.body.appendChild(box);
const pages = [];
let s = 0;
const cap = n > RD_BIG_TEXT ? 3000 : n;
while (s < n) {
let lo = s + 1;
let hi = Math.min(n, s + cap);
let best = lo;
while (lo <= hi) {
const mid = (lo + hi) >> 1;
box.textContent = src.slice(s, mid);
if (box.scrollHeight <= h + 1) { best = mid; lo = mid + 1; }
else hi = mid - 1;
}
let e = best;
if (e < n) {
const c = src.charCodeAt(e);
if (c >= 0xDC00 && c <= 0xDFFF) e++;
}
pages.push({ s: s, e: e });
s = e;
}
if (box.parentNode) box.parentNode.removeChild(box);
return pages;
}
function rdCheckPagination(pages, len) {
const errs = [];
if (!pages || !pages.length) {
errs.push('没有分页结果');
} else {
if (pages[0].s !== 0) errs.push('第 0 页不是从 0 开始：' + pages[0].s);
for (let i = 0; i < pages.length; i++) {
const p = pages[i];
if (p.e <= p.s) errs.push('第 ' + (i + 1) + ' 页长度不为正');
if (i > 0 && p.s !== pages[i - 1].e) errs.push('第 ' + (i + 1) + ' 页与上一页不连续');
}
const last = pages[pages.length - 1];
if (len && last.e !== len) errs.push('最后一页没到章末：' + last.e + '/' + len);
}
if (errs.length) {
console.error('[reading] 分页不连续', errs);
try { (window.__jsErrors = window.__jsErrors || []).push({ step: 'reading-paginate', errs: errs }); } catch (e) {}
}
return !errs.length;
}
function rdRenderPage() {
const b = rdBook;
if (!b || !b.pages.length) return;
if (b.pageIdx < 0) b.pageIdx = 0;
if (b.pageIdx > b.pages.length - 1) b.pageIdx = b.pages.length - 1;
const body = document.getElementById('rd-body');
const p = b.pages[b.pageIdx];
rdPaintPage();
if (!body) return;
const no = document.getElementById('rd-page-no');
if (no) no.textContent = '第 ' + (b.pageIdx + 1) + ' / ' + b.pages.length + ' 页';
rdUpdateBar();
rdSaveProgress();
}
function rdUpdateBar() {
const b = rdBook;
if (!b) return;
const book = rdFindBook(b.id, readIndex());
const fill = document.getElementById('rd-bar-fill');
if (!fill) return;
let pct = 0;
if (book) {
const p = b.pages[b.pageIdx] || { s: 0 };
const probe = { progress: { ch: b.ch, off: p.s }, chWords: book.chWords, chapterCount: book.chapterCount };
pct = rdProgressPct(probe);
}
fill.style.width = pct + '%';
}
let rdSaveTimer = 0;
function rdSaveProgress() {
if (!rdBook) return;
clearTimeout(rdSaveTimer);
rdSaveTimer = setTimeout(rdWriteProgress, 300);
}
function rdWriteProgress() {
clearTimeout(rdSaveTimer);
rdSaveTimer = 0;
const b = rdBook;
if (!b) return;
const list = readIndex();
const book = rdFindBook(b.id, list);
if (!book) return;
const p = b.pages[b.pageIdx] || { s: 0 };
const chIdx = b.ch;
const start = p.s;
book.progress = { ch: chIdx, off: start };
book.lastOpenAt = Date.now();
saveIndex(list);
}
let rdSel = null;
let rdDraft = null;
let rdAnnoPool = [];
let rdSuppressTap = false;
function rdDeviceId() {
let id = '';
try { id = store.get('reading-device-id') || ''; } catch (e) {}
if (!id) {
id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
try { store.set('reading-device-id', id); } catch (e) {}
}
return id;
}
function rdPaintPage() {
const b = rdBook;
const body = document.getElementById('rd-body');
if (!b || !body || !b.pages.length) return;
const p = b.pages[b.pageIdx] || { s: 0, e: b.text.length };
const start = p.s;
const end = p.e;
const marks = {};
(b.anno || []).forEach(function (a) {
if (a && a.e > start && a.e <= end) marks[a.e] = (marks[a.e] || 0) + 1;
});
const cuts = Object.keys(marks).map(Number).sort(function (x, y) { return x - y; });
const sel = rdSel && rdSel.e > start && rdSel.s < end
? { s: Math.max(start, rdSel.s), e: Math.min(end, rdSel.e) } : null;
function emit(a, z) {
if (z <= a) return '';
if (!sel || z <= sel.s || a >= sel.e) return rdEsc(b.text.slice(a, z));
const s1 = Math.max(a, sel.s);
const e1 = Math.min(z, sel.e);
return rdEsc(b.text.slice(a, s1)) +
'<span class="rd-sel">' + rdEsc(b.text.slice(s1, e1)) + '</span>' +
rdEsc(b.text.slice(e1, z));
}
let html = '';
let i = start;
for (let k = 0; k < cuts.length; k++) {
const m = cuts[k];
html += emit(i, m);
const n = marks[m];
html += '<span class="rd-mark" data-pos="' + m + '" role="button">' + (n > 1 ? '<b>' + n + '</b>' : '') + '</span>';
i = m;
}
html += emit(i, end);
body.innerHTML = html;
let off = start;
const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
let node;
while ((node = walker.nextNode())) {
if (node.parentNode && node.parentNode.closest && node.parentNode.closest('.rd-mark')) continue;
node.__rdStart = off;
off += node.nodeValue.length;
}
}
function rdCaretAt(x, y) {
let node = null;
let off = 0;
try {
if (document.caretRangeFromPoint) {
const r = document.caretRangeFromPoint(x, y);
if (r) { node = r.startContainer; off = r.startOffset; }
} else if (document.caretPositionFromPoint) {
const p = document.caretPositionFromPoint(x, y);
if (p) { node = p.offsetNode; off = p.offset; }
}
} catch (e) { return -1; }
if (!node) return -1;
if (node.nodeType === 3) {
return typeof node.__rdStart === 'number' ? node.__rdStart + off : -1;
}
if (node.nodeType === 1) {
const kids = node.childNodes;
for (let i = Math.min(off, kids.length - 1); i >= 0; i--) {
const k = kids[i];
if (k && k.nodeType === 3 && typeof k.__rdStart === 'number') return k.__rdStart;
}
}
return -1;
}
const RD_SENT_END = '。！？!?…\n；;';
const RD_SENT_TAIL = '”’」』）】';
function rdSentenceAt(text, idx) {
const n = text.length;
if (idx < 0 || idx >= n) return null;
let s = idx;
while (s > 0 && RD_SENT_END.indexOf(text[s - 1]) < 0) s--;
let e = idx;
while (e < n && RD_SENT_END.indexOf(text[e]) < 0) e++;
if (e < n) {
e++;
while (e < n && RD_SENT_TAIL.indexOf(text[e]) >= 0) e++;
}
while (s < e && /\s/.test(text[s])) s++;
while (e > s && /\s/.test(text[e - 1])) e--;
if (e <= s) return null;
return { s: s, e: e, quote: text.slice(s, e) };
}
function rdClearSel(repaint) {
rdSel = null;
const bar = document.getElementById('rd-selbar');
if (bar) bar.hidden = true;
if (repaint) rdPaintPage();
}
function rdSelectAt(x, y) {
const b = rdBook;
if (!b) return;
const idx = rdCaretAt(x, y);
if (idx < 0) return;
const sent = rdSentenceAt(b.text, idx);
if (!sent) return;
rdSel = sent;
rdCloseSheet();
rdClosePreview();
rdClosePop();
rdPaintPage();
rdPlaceSelBar();
try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
}
function rdPlaceSelBar() {
const selEl = document.querySelector('#rd-body .rd-sel');
const bar = document.getElementById('rd-selbar');
const pageEl = document.getElementById('page-reading');
if (!selEl || !bar || !pageEl) return;
const r = selEl.getBoundingClientRect();
const pr = pageEl.getBoundingClientRect();
let left = r.left - pr.left + r.width / 2;
left = Math.max(72, Math.min(pr.width - 72, left));
let top = r.top - pr.top - 46;
if (top < 6) top = r.bottom - pr.top + 10;
bar.style.left = left + 'px';
bar.style.top = top + 'px';
bar.hidden = false;
}
function rdShowSelBar() {
if (!rdSel) return;
rdPaintPage();
rdPlaceSelBar();
}
function rdCopy(text) {
const s = String(text == null ? '' : text);
function fallback() {
try {
const ta = document.createElement('textarea');
ta.value = s;
ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
document.body.appendChild(ta);
ta.select();
document.execCommand('copy');
document.body.removeChild(ta);
rdToast('已复制');
} catch (e) { rdToast('复制没有成功'); }
}
try {
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(s).then(function () { rdToast('已复制'); }, fallback);
return;
}
} catch (e) {}
fallback();
}
function rdCardKey(text) {
const s = String(text || '');
let h = 5381;
for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
return 'c_' + (h >>> 0).toString(36);
}
function rdCardPool() {
let all = [];
try { all = (window.getCustomCards && window.getCustomCards()) || []; } catch (e) { all = []; }
return all.filter(function (c) {
if (typeof c !== 'string') return false;
const t = c.trim();
if (!t || t.length > 200) return false;
if (t.indexOf('data:') === 0 || t.indexOf('@@m:') === 0) return false;
if (/^https?:\/\//i.test(t) || t.indexOf('|||') >= 0) return false;
return true;
});
}
function rdRenderCards(q) {
const list = document.getElementById('rd-card-list');
if (!list) return;
const all = rdCardPool();
let pool;
if (q) {
const k = String(q).toLowerCase();
pool = all.filter(function (c) { return c.toLowerCase().indexOf(k) >= 0; }).slice(0, 30);
} else {
pool = all.slice(-8).reverse();
}
rdAnnoPool = pool;
if (!pool.length) {
list.innerHTML = '<div class="rd-empty">' +
(q ? '没有找到这样的字卡' : '字卡库还是空的，可以在下面自己写一条') + '</div>';
return;
}
list.innerHTML = pool.map(function (c, i) {
return '<button class="rd-card" type="button" data-i="' + i + '">' + rdEsc(c) + '</button>';
}).join('');
}
function rdOpenSheet() {
const sheet = document.getElementById('rd-anno-sheet');
if (!sheet || !rdSel) return;
const bar = document.getElementById('rd-selbar');
if (bar) bar.hidden = true;
const s = document.getElementById('rd-anno-search');
if (s) s.value = '';
const w = document.getElementById('rd-anno-write');
if (w) w.value = '';
rdRenderCards('');
sheet.hidden = false;
}
function rdCloseSheet() {
const el = document.getElementById('rd-anno-sheet');
if (el) el.hidden = true;
}
function rdClosePreview() {
const el = document.getElementById('rd-anno-preview');
if (el) el.hidden = true;
}
function rdClosePop() {
const el = document.getElementById('rd-anno-pop');
if (el) el.hidden = true;
}
function rdOpenPreview(text, cardId) {
if (!rdSel) return;
const body = String(text == null ? '' : text).trim();
if (!body) { rdToast('这条批注还是空的'); return; }
rdDraft = { text: body.slice(0, 500), cardId: cardId || '' };
const q = document.getElementById('rd-prev-quote');
const t = document.getElementById('rd-prev-text');
if (q) q.textContent = rdSel.quote;
if (t) t.textContent = rdDraft.text;
rdCloseSheet();
const pv = document.getElementById('rd-anno-preview');
if (pv) pv.hidden = false;
}
async function rdCommitAnno() {
const b = rdBook;
if (!b || !rdSel || !rdDraft) return;
const list = readIndex();
const book = rdFindBook(b.id, list);
if (!book) { rdToast('这本书不在书架里'); return; }
const used = Number(book.annoCount) || 0;
if (used >= 500) { rdToast('这本书的批注到 500 条上限了'); return; }
const item = {
id: 'an_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
by: 'me',
s: rdSel.s,
e: rdSel.e,
quote: rdSel.quote,
text: rdDraft.text,
cardId: rdDraft.cardId || '',
at: Date.now(),
rev: 1,
deviceId: rdDeviceId()
};
const arr = (b.anno || []).slice();
arr.push(item);
try { await putAnnos(b.id, b.ch, arr); }
catch (e) { rdToast((e && e.message) || '批注没写上：磁盘写入没有完成，请重试'); return; }
b.anno = arr;
const fresh = readIndex();
const freshBook = rdFindBook(b.id, fresh);
if (freshBook) { freshBook.annoCount = used + 1; saveIndex(fresh); }
rdDraft = null;
rdClosePreview();
rdClearSel(false);
rdPaintPage();
rdToast('已贴上');
}
function rdOpenPop(pos) {
const b = rdBook;
const list = document.getElementById('rd-pop-list');
const pop = document.getElementById('rd-anno-pop');
if (!b || !list || !pop) return;
const items = (b.anno || []).filter(function (a) { return a && a.e === pos; })
.sort(function (x, y) { return (x.at || 0) - (y.at || 0); });
if (!items.length) return;
rdClearSel(true);
list.innerHTML = items.map(function (a) {
const who = a.by === 'me' ? '我' : '他';
return '<div class="rd-pop-item"><div class="rd-pop-who">' + who + '</div>' +
'<div class="rd-pop-text">' + rdEsc(a.text || '') + '</div></div>';
}).join('');
pop.hidden = false;
}
function rdBounce(dir) {
const body = document.getElementById('rd-body');
if (!body || body._rdBounce) return;
const cls = dir > 0 ? 'rd-bounce-next' : 'rd-bounce-prev';
body.classList.add(cls);
body._rdBounce = 1;
setTimeout(function () { body.classList.remove(cls); body._rdBounce = 0; }, 200);
}
function rdTurn(dir) {
const b = rdBook;
if (!b) return;
if (dir > 0) {
if (b.pageIdx < b.pages.length - 1) { b.pageIdx++; rdRenderPage(); return; }
if (b.ch < b.toc.length - 1) { b.ch++; rdEnsureChapter('first'); return; }
rdBounce(1);
} else {
if (b.pageIdx > 0) { b.pageIdx--; rdRenderPage(); return; }
if (b.ch > 0) { b.ch--; rdEnsureChapter('last'); return; }
rdBounce(-1);
}
}
let rdTouch = null;
document.addEventListener('pointerdown', function (e) {
const el = e.target;
if (!el || !el.closest) return;
if (!rdBook || !el.closest('#rd-body') || el.closest('.rd-mark')) return;
const body = document.getElementById('rd-body');
if (!body) return;
rdTouch = { x: e.clientX, y: e.clientY, r: body.getBoundingClientRect() };
}, true);
document.addEventListener('pointerup', function (e) {
if (!rdTouch) return;
const t = rdTouch;
rdTouch = null;
if (!rdBook) return;
if (rdSuppressTap) { rdSuppressTap = false; return; }
if (e.target && e.target.closest && e.target.closest('.rd-mark')) return;
if (rdSel) { rdClearSel(true); return; }
const dx = e.clientX - t.x;
const dy = e.clientY - t.y;
if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) { rdTurn(dx < 0 ? 1 : -1); return; }
if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
const rel = (e.clientX - t.r.left) / Math.max(1, t.r.width);
if (rel < 0.32) rdTurn(-1);
else if (rel > 0.68) rdTurn(1);
}
}, true);
document.addEventListener('pointercancel', function () { rdTouch = null; }, true);
let rdSelTimer = 0, rdSelX = 0, rdSelY = 0;
function rdCancelSelPress() { if (rdSelTimer) { clearTimeout(rdSelTimer); rdSelTimer = 0; } }
document.addEventListener('pointerdown', function (e) {
if (!rdBook) return;
const el = e.target;
if (!el || !el.closest || !el.closest('#rd-body') || el.closest('.rd-mark')) return;
rdCancelSelPress();
rdSelX = e.clientX; rdSelY = e.clientY;
rdSelTimer = setTimeout(function () {
rdSelTimer = 0;
rdSuppressTap = true;
rdSelectAt(rdSelX, rdSelY);
}, 520);
}, true);
document.addEventListener('pointermove', function (e) {
if (!rdSelTimer) return;
if (Math.abs(e.clientX - rdSelX) > 10 || Math.abs(e.clientY - rdSelY) > 10) rdCancelSelPress();
}, true);
document.addEventListener('pointerup', rdCancelSelPress, true);
document.addEventListener('pointercancel', rdCancelSelPress, true);
function rdReadPrefs() {
try {
let raw = store.get(RD_PREFS_KEY);
if (!raw) return { fs: 17, lh: 1.8 };
const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
const fs = Number(o && o.fs);
const lh = Number(o && o.lh);
return {
fs: (fs >= 12 && fs <= 30) ? fs : 17,
lh: (lh >= 1.4 && lh <= 2.2) ? lh : 1.8
};
} catch (e) { return { fs: 17, lh: 1.8 }; }
}
function rdApplyPrefs(p) {
const body = document.getElementById('rd-body');
if (!body) return;
body.style.fontSize = (p && p.fs ? p.fs : 17) + 'px';
body.style.lineHeight = String((p && p.lh) || 1.8);
}
function rdSetPrefs(patch) {
const p = rdReadPrefs();
if (patch && patch.fs) p.fs = patch.fs;
if (patch && patch.lh) p.lh = patch.lh;
try { store.set(RD_PREFS_KEY, JSON.stringify(p)); }
catch (e) { rdToast('字号设置没保存上'); }
rdApplyPrefs(p);
const b = rdBook;
if (b && b.text) {
const off = b.pages[b.pageIdx] ? b.pages[b.pageIdx].s : 0;
b.pages = rdPaginateChapter(b);
rdCheckPagination(b.pages, b.text.length);
b.pageIdx = rdPageForOffset(b.pages, off);
rdRenderPage();
}
rdRenderPrefsActive();
}
function rdRenderPrefsActive() {
const p = rdReadPrefs();
const box = document.getElementById('rd-prefs');
if (!box) return;
box.querySelectorAll('[data-fs]').forEach(function (btn) {
btn.classList.toggle('on', Number(btn.getAttribute('data-fs')) === p.fs);
});
box.querySelectorAll('[data-lh]').forEach(function (btn) {
btn.classList.toggle('on', Number(btn.getAttribute('data-lh')) === p.lh);
});
}
function rdRenderToc() {
const list = document.getElementById('rd-toc-list');
if (!list) return;
const b = rdBook;
let html = '';
if (b) {
for (let i = 0; i < b.toc.length; i++) {
const t = b.toc[i] || {};
html += '<button class="rd-toc-row' + (i === b.ch ? ' on' : '') + '" data-ch="' + i + '" type="button">' +
'<span class="rd-toc-n">' + (i + 1) + '</span>' +
'<span class="rd-toc-t">' + rdEsc(t.t || ('第 ' + (i + 1) + ' 章')) + '</span></button>';
}
const book = rdFindBook(b.id, readIndex());
const lost = book && Array.isArray(book.lostAnnos) ? book.lostAnnos.length : 0;
if (lost) {
html += '<button class="rd-toc-row rd-toc-lost" data-lost="1" type="button">未定位批注（' + lost + '）</button>';
}
}
list.innerHTML = html;
const cur = list.querySelector('.rd-toc-row.on');
if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'center' }); } catch (e) {} }
}
function openToc() {
const toc = document.getElementById('rd-toc');
if (!toc) return;
rdRenderToc();
toc.hidden = false;
const prefs = document.getElementById('rd-prefs');
if (prefs) prefs.hidden = true;
}
function closeToc() {
const toc = document.getElementById('rd-toc');
if (toc) toc.hidden = true;
}
function rdJumpChapter(i) {
const b = rdBook;
if (!b) return;
const n = parseInt(i, 10);
if (!(n >= 0 && n < b.toc.length)) return;
closeToc();
b.ch = n;
b.off = 0;
rdEnsureChapter('first');
}
const RD_COLORS = ['#f4b6c2', '#c9d8f0', '#cfe8d5', '#f3e0b5', '#e2cdf0', '#f5cdb8', '#c8e4e8', '#ddd7f0'];
function rdEsc(s) {
return String(s == null ? '' : s)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function rdCoverColor(title) {
const s = String(title || '');
let n = 0;
for (let i = 0; i < s.length; i++) n += s.charCodeAt(i);
return RD_COLORS[n % RD_COLORS.length];
}
function rdProgressPct(book) {
const ch = (book.progress && book.progress.ch) || 0;
const off = (book.progress && book.progress.off) || 0;
const cw = Array.isArray(book.chWords) ? book.chWords : null;
if (cw && cw.length) {
let total = 0;
let before = 0;
for (let i = 0; i < cw.length; i++) { total += cw[i]; if (i < ch) before += cw[i]; }
if (total <= 0) return 0;
const inCh = Math.max(0, Math.min(off, cw[ch] || 0));
return Math.max(0, Math.min(100, Math.round(((before + inCh) / total) * 100)));
}
const n = book.chapterCount || 0;
if (!n) return 0;
return Math.max(0, Math.min(100, Math.round(((ch + 0.5) / n) * 100)));
}
function rdBadgeText(b) {
if (!b) return '';
if (b.missing) return '待重新导入';
if (b.status === 'done') return '他读完了';
if (b.buddy && b.buddy.waiting) return '等你';
return '共读中';
}
function rdRenderShelf() {
const grid = document.getElementById('rd-grid');
const empty = document.getElementById('rd-empty');
if (!grid) return;
const list = readIndex().slice();
list.sort(function (a, b) { return ((b && b.lastOpenAt) || 0) - ((a && a.lastOpenAt) || 0); });
let html = '';
for (let i = 0; i < list.length; i++) {
const b = list[i];
if (!b || !b.id) continue;
const title = b.title || '未命名';
html += '<div class="rd-book" data-id="' + rdEsc(b.id) + '">' +
'<div class="rd-cover" style="background:' + rdCoverColor(title) + '">' + rdEsc(title.slice(0, 1) || '书') + '</div>' +
'<div class="rd-line"><i style="width:' + rdProgressPct(b) + '%"></i></div>' +
'<div class="rd-book-title">' + rdEsc(title) + '</div>' +
'<span class="rd-badge">' + rdEsc(rdBadgeText(b)) + '</span>' +
'</div>';
}
grid.innerHTML = html;
if (empty) empty.hidden = list.length > 0;
const usage = document.getElementById('rd-usage');
if (usage) {
let bytes = 0;
for (let i = 0; i < list.length; i++) bytes += ((list[i] && list[i].size) || 0);
usage.textContent = '已用 ' + (bytes / 1024 / 1024).toFixed(1) + ' MB · ' + list.length + ' 本';
}
}
function rdFindBook(id, list) {
for (let i = 0; i < list.length; i++) { if (list[i] && list[i].id === id) return list[i]; }
return null;
}
function rdCloseBookMenu() {
const m = document.getElementById('rd-book-menu');
if (m && m.parentNode) m.parentNode.removeChild(m);
}
function rdOpenBookMenu(id) {
if (!page) return;
const book = rdFindBook(id, readIndex());
if (!book) return;
rdCloseBookMenu();
const m = document.createElement('div');
m.id = 'rd-book-menu';
m.className = 'rd-menu';
m.setAttribute('data-id', id);
m.innerHTML =
'<div class="rd-menu-title">' + rdEsc(book.title || '未命名') + '</div>' +
'<button class="rd-menu-item" data-act="rename" type="button">修改书名</button>' +
'<button class="rd-menu-item rd-menu-danger" data-act="delete" type="button">删除这本书</button>' +
'<button class="rd-menu-item" data-act="cancel" type="button">取消</button>';
page.appendChild(m);
}
function rdRenameBook(id) {
const list = readIndex();
const book = rdFindBook(id, list);
if (!book) return;
if (!window.openModal) { rdToast('弹窗组件不可用'); return; }
window.openModal('修改书名', book.title || '', function (v) {
const t = String(v == null ? '' : v).trim();
if (!t) { rdToast('书名不能为空'); return; }
book.title = t.slice(0, 40);
if (saveIndex(list)) { rdRenderShelf(); rdToast('书名已改'); }
});
}
function rdDeleteBook(id) {
const list = readIndex();
const book = rdFindBook(id, list);
if (!book) return;
if (!window.openModal) { rdToast('弹窗组件不可用'); return; }
window.openModal('删除这本书', '', async function () {
const ok = await delBookData(id);
if (!ok) {
book.pendingDelete = true;
saveIndex(list);
rdRenderShelf();
rdToast('有部分文件没删掉，已记下，下次打开会再试');
return;
}
const rest = list.filter(function (b) { return !b || b.id !== id; });
if (saveIndex(rest)) { rdRenderShelf(); rdToast('已删除'); }
}, { noInput: true, staticText: '「' + (book.title || '未命名') + '」的正文与批注会一起删除，且不可恢复。' });
}
async function rdRetryPendingDelete() {
const list = readIndex();
let changed = false;
for (let i = 0; i < list.length; i++) {
const b = list[i];
if (!b || !b.id || !b.pendingDelete) continue;
const ok = await delBookData(b.id);
if (ok) { list.splice(i, 1); i--; changed = true; }
}
if (changed) { saveIndex(list); rdRenderShelf(); }
}
function rdSetFileInfo(txt) {
const info = document.getElementById('rd-file-info');
if (!info) return;
if (!txt) { info.hidden = true; info.textContent = ''; return; }
info.hidden = false;
info.textContent = txt;
}
function rdOpenImport() {
if (!page) return;
rdImp.buf = null; rdImp.name = ''; rdImp.text = ''; rdImp.source = ''; rdImp.chapters = null; rdImp.bad = 0;
const panel = document.getElementById('rd-import-panel');
const main = document.getElementById('rd-import-main');
const cf = document.getElementById('rd-confirm');
const file = document.getElementById('rd-file');
const paste = document.getElementById('rd-paste');
if (file) { try { file.value = ''; } catch (e) {} }
if (paste) paste.value = '';
rdSetFileInfo('');
const gbk = document.getElementById('rd-gbk-row');
if (gbk) gbk.hidden = true;
if (main) main.hidden = false;
if (cf) cf.hidden = true;
if (panel) panel.hidden = false;
}
function rdCloseImport() {
const panel = document.getElementById('rd-import-panel');
const main = document.getElementById('rd-import-main');
const cf = document.getElementById('rd-confirm');
if (panel) panel.hidden = true;
if (main) main.hidden = false;
if (cf) cf.hidden = true;
rdImp.buf = null; rdImp.name = ''; rdImp.text = ''; rdImp.source = ''; rdImp.chapters = null;
}
function rdUseDecoded(d) {
rdImp.text = d.text || '';
rdImp.chapters = null;
const paste = document.getElementById('rd-paste');
if (paste && rdImp.source === 'paste') paste.value = rdImp.text;
const gbk = document.getElementById('rd-gbk-row');
if (gbk) gbk.hidden = !(rdImp.source === 'file' && d.bad > RD_BAD_RATIO);
if (rdImp.source === 'file') {
rdSetFileInfo(rdImp.name + ' · ' + rdImp.text.length + ' 字' + (d.bad > RD_BAD_RATIO ? '（疑似非 UTF-8）' : ''));
} else {
rdSetFileInfo(rdImp.text.trim() ? '粘贴内容 · ' + rdImp.text.length + ' 字' : '');
}
}
function rdStartImport() {
const text = String(rdImp.text || '');
if (!text.trim()) { rdToast('还没有选文件，也没有粘贴内容'); return; }
const bytes = rdUtf8Size(text);
if (bytes > RD_MAX_BYTES) { rdToast('这本约 ' + rdMB(bytes) + ' MB，超过单本 20MB 上限'); return; }
if (readIndex().length >= RD_MAX_BOOKS) { rdToast('书架最多 ' + RD_MAX_BOOKS + ' 本，先删一本'); return; }
const chapters = splitChapters(text);
if (!chapters.length) { rdToast('这本读不出内容，换个文件试试'); return; }
rdImp.chapters = chapters;
rdRenderConfirm();
const main = document.getElementById('rd-import-main');
const cf = document.getElementById('rd-confirm');
if (main) main.hidden = true;
if (cf) cf.hidden = false;
}
function rdLeaveConfirm() {
const main = document.getElementById('rd-import-main');
const cf = document.getElementById('rd-confirm');
if (cf) cf.hidden = true;
if (main) main.hidden = false;
}
function rdRenderConfirm() {
const list = document.getElementById('rd-confirm-list');
if (!list) return;
const chs = rdImp.chapters || [];
let html = '';
for (let i = 0; i < chs.length; i++) {
const c = chs[i];
html += '<div class="rd-cf-row" data-i="' + i + '">' +
'<button class="rd-cf-title" data-act="rename" type="button">' + rdEsc(c.t || ('第 ' + (i + 1) + ' 节')) + '</button>' +
'<div class="rd-cf-n">' + (c.e - c.s) + ' 字</div>' +
'<div class="rd-cf-ops">' +
(i < chs.length - 1 ? '<button class="rd-btn rd-btn-mini" data-act="merge" type="button">与下一章合并</button>' : '') +
'<button class="rd-btn rd-btn-mini" data-act="split" type="button">在此拆分</button>' +
'</div></div>';
}
list.innerHTML = html;
}
function rdRenameChapter(i) {
const chs = rdImp.chapters || [];
const c = chs[i];
if (!c) return;
if (!window.openModal) { rdToast('弹窗组件不可用'); return; }
window.openModal('章节标题', c.t || '', function (v) {
const t = String(v == null ? '' : v).trim();
if (!t) { rdToast('标题不能为空'); return; }
c.t = t.slice(0, 60);
rdRenderConfirm();
});
}
function rdMergeNext(i) {
const chs = rdImp.chapters || [];
if (!chs[i] || !chs[i + 1]) return;
chs[i].e = chs[i + 1].e;
chs.splice(i + 1, 1);
rdRenderConfirm();
}
function rdSplitAt(i) {
const chs = rdImp.chapters || [];
const c = chs[i];
if (!c) return;
const len = c.e - c.s;
if (len < 2) { rdToast('这一章太短，拆不开'); return; }
const def = c.s + Math.floor(len / 2);
if (!window.openModal) { rdToast('弹窗组件不可用'); return; }
window.openModal('在这一章的哪个字之后拆开', String(def), function (v) {
const at = parseInt(String(v == null ? '' : v).trim(), 10);
if (!(at > c.s && at < c.e)) { rdToast('要在 ' + c.s + ' 到 ' + c.e + ' 之间'); return; }
const right = { t: (c.t || '节') + '（下）', s: at, e: c.e };
c.t = (c.t || '节') + '（上）';
c.e = at;
chs.splice(i + 1, 0, right);
rdRenderConfirm();
});
}
function rdMergeAll() {
const chs = rdImp.chapters || [];
if (chs.length < 2) return;
const first = chs[0];
first.e = chs[chs.length - 1].e;
rdImp.chapters = [first];
rdRenderConfirm();
}
function rdResetChapters() {
if (!rdImp.text) return;
rdImp.chapters = splitChapters(rdImp.text);
rdRenderConfirm();
}
let rdConfirmBusy = false;
async function rdCommitImport() {
if (rdConfirmBusy) return;
const chs = rdImp.chapters || [];
const text = String(rdImp.text || '');
if (!chs.length || !text) { rdToast('还没有可导入的内容'); return; }
const go = document.getElementById('rd-confirm-go');
const goText = go ? go.textContent : '确认导入';
rdConfirmBusy = true;
if (go) { go.disabled = true; go.textContent = '正在写入…'; }
const id = 'bk_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 999);
let failCh = -1;
try {
await putToc(id, chs.map(function (c) { return { t: c.t, n: c.e - c.s }; }));
for (let i = 0; i < chs.length; i++) {
failCh = i;
await putBody(id, i, text.slice(chs[i].s, chs[i].e));
if (i > 0 && i % 10 === 0) await new Promise(function (r) { setTimeout(r, 0); });
}
failCh = -1;
const list = readIndex();
const title = rdImp.name ? rdImp.name.replace(/\.txt$/i, '') : '粘贴的书';
list.push({
id: id,
title: title || '未命名',
cover: '',
words: text.length,
chapterCount: chs.length,
chWords: chs.map(function (c) { return c.e - c.s; }),
size: rdUtf8Size(text),
createdAt: Date.now(),
lastOpenAt: Date.now(),
progress: { ch: 0, off: 0 },
buddy: { mode: 'follow', ch: 0, off: 0, updatedAt: Date.now(), waiting: false },
status: 'co',
cid: (typeof window.activePrefix === 'function' ? window.activePrefix() : 'default'),
lostAnnos: []
});
if (!saveIndex(list)) {
await delBookData(id);
throw new Error('书架索引没保存上');
}
rdCloseImport();
rdRenderShelf();
rdToast('已加入书架');
} catch (e) {
const rolled = failCh >= 0 ? await delBookData(id) : true;
rdToast('导入失败' + (failCh >= 0 ? '（第 ' + (failCh + 1) + ' 章）' : '') + '：' +
((e && e.message) || '写入没有完成') + (rolled ? '，已回滚' : '，回滚未完成，请到书架删掉这本'));
} finally {
rdConfirmBusy = false;
if (go) { go.disabled = false; go.textContent = goText; }
}
}
let rdPressTimer = 0, rdPressX = 0, rdPressY = 0, rdPressAt = 0;
function rdCancelPress() { if (rdPressTimer) { clearTimeout(rdPressTimer); rdPressTimer = 0; } }
document.addEventListener('pointerdown', function (e) {
const el = e.target;
if (!el || !el.closest) return;
const card = el.closest('#rd-grid .rd-book');
if (!card) return;
rdCancelPress();
rdPressX = e.clientX; rdPressY = e.clientY;
const id = card.getAttribute('data-id');
rdPressTimer = setTimeout(function () {
rdPressTimer = 0;
rdPressAt = Date.now();
try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
rdOpenBookMenu(id);
}, 450);
}, true);
document.addEventListener('pointermove', function (e) {
if (!rdPressTimer) return;
if (Math.abs(e.clientX - rdPressX) > 10 || Math.abs(e.clientY - rdPressY) > 10) rdCancelPress();
}, true);
document.addEventListener('pointerup', rdCancelPress, true);
document.addEventListener('pointercancel', rdCancelPress, true);
document.addEventListener('contextmenu', function (e) {
const el = e.target;
if (el && el.closest && (el.closest('#rd-grid .rd-book') || el.closest('#rd-body'))) e.preventDefault();
}, true);
document.addEventListener('click', function (e) {
const el = e.target;
if (!el || !el.closest) return;
const menuItem = el.closest('#rd-book-menu [data-act]');
if (menuItem) {
e.preventDefault();
const menu = document.getElementById('rd-book-menu');
const mid = menu ? menu.getAttribute('data-id') : '';
const act = menuItem.getAttribute('data-act');
rdCloseBookMenu();
if (act === 'rename') rdRenameBook(mid);
else if (act === 'delete') rdDeleteBook(mid);
return;
}
if (document.getElementById('rd-book-menu') && !el.closest('#rd-book-menu')) {
e.preventDefault();
rdCloseBookMenu();
return;
}
const mk = el.closest('.rd-mark');
if (mk) { e.preventDefault(); rdOpenPop(Number(mk.getAttribute('data-pos'))); return; }
const selBtn = el.closest('#rd-selbar [data-act]');
if (selBtn) {
e.preventDefault();
const act = selBtn.getAttribute('data-act');
if (act === 'anno') rdOpenSheet();
else if (act === 'copy' && rdSel) rdCopy(rdSel.quote);
return;
}
if (el.closest('#rd-anno-close')) { e.preventDefault(); rdCloseSheet(); rdClosePreview(); rdShowSelBar(); return; }
if (el.closest('#rd-anno-pop-close')) { e.preventDefault(); rdClosePop(); return; }
const cardBtn = el.closest('#rd-card-list .rd-card');
if (cardBtn) {
e.preventDefault();
const ci = Number(cardBtn.getAttribute('data-i'));
const text = rdAnnoPool[ci] || '';
rdOpenPreview(text, text ? rdCardKey(text) : '');
return;
}
if (el.closest('#rd-anno-write-go')) {
e.preventDefault();
const w = document.getElementById('rd-anno-write');
rdOpenPreview(w ? w.value : '', '');
return;
}
if (el.closest('#rd-anno-back')) { e.preventDefault(); rdClosePreview(); rdOpenSheet(); return; }
if (el.closest('#rd-anno-commit')) { e.preventDefault(); rdCommitAnno(); return; }
const app = el.closest('.app[data-app="reading"]');
if (app) {
const grid = app.closest('.app-grid');
if (grid && grid.classList.contains('editing')) return;
e.preventDefault();
rdOpen();
return;
}
if (el.closest('#rd-shelf-back')) { rdClose(); return; }
if (el.closest('#rd-reader-back')) { rdShowShelf(); return; }
if (el.closest('#rd-retry')) { e.preventDefault(); rdEnsureChapter('first'); return; }
if (el.closest('#rd-font-btn')) {
e.preventDefault();
const prefs = document.getElementById('rd-prefs');
if (prefs) { prefs.hidden = !prefs.hidden; rdRenderPrefsActive(); }
closeToc();
return;
}
const fsBtn = el.closest('#rd-prefs [data-fs]');
if (fsBtn) { e.preventDefault(); rdSetPrefs({ fs: Number(fsBtn.getAttribute('data-fs')) }); return; }
const lhBtn = el.closest('#rd-prefs [data-lh]');
if (lhBtn) { e.preventDefault(); rdSetPrefs({ lh: Number(lhBtn.getAttribute('data-lh')) }); return; }
if (el.closest('#rd-toc-btn')) { e.preventDefault(); openToc(); return; }
if (el.closest('#rd-toc-close')) { e.preventDefault(); closeToc(); return; }
const tocRow = el.closest('#rd-toc-list [data-ch]');
if (tocRow) { e.preventDefault(); rdJumpChapter(tocRow.getAttribute('data-ch')); return; }
if (el.closest('#rd-toc-list [data-lost]')) { e.preventDefault(); rdToast('这里会列出重新导入后没能定位的批注'); return; }
if (el.closest('#rd-import')) { e.preventDefault(); rdOpenImport(); return; }
if (el.closest('#rd-import-close')) { e.preventDefault(); rdCloseImport(); return; }
if (el.closest('#rd-import-go')) { e.preventDefault(); rdStartImport(); return; }
if (el.closest('#rd-confirm-back')) { e.preventDefault(); rdLeaveConfirm(); return; }
if (el.closest('#rd-confirm-merge-all')) { e.preventDefault(); rdMergeAll(); return; }
if (el.closest('#rd-confirm-reset')) { e.preventDefault(); rdResetChapters(); return; }
if (el.closest('#rd-confirm-go')) { e.preventDefault(); rdCommitImport(); return; }
const cfRow = el.closest('#rd-confirm-list .rd-cf-row');
if (cfRow) {
const ci = parseInt(cfRow.getAttribute('data-i'), 10) || 0;
if (el.closest('[data-act="rename"]')) { e.preventDefault(); rdRenameChapter(ci); return; }
if (el.closest('[data-act="merge"]')) { e.preventDefault(); rdMergeNext(ci); return; }
if (el.closest('[data-act="split"]')) { e.preventDefault(); rdSplitAt(ci); return; }
}
if (el.closest('#rd-gbk')) {
e.preventDefault();
if (!rdImp.buf) { rdToast('没有可重新解码的文件内容'); return; }
const d = rdDecode(rdImp.buf, 'gbk');
if (!d.text) { rdToast('按 GBK 也解不出来，换个文件试试'); return; }
rdUseDecoded(d);
rdToast('已按 GBK 重新解码');
return;
}
const card = el.closest('#rd-grid .rd-book');
if (card && card.getAttribute('data-id')) {
e.preventDefault();
if (Date.now() - rdPressAt < 700) { rdPressAt = 0; return; }
rdOpenBook(card.getAttribute('data-id'));
return;
}
});
document.addEventListener('change', async function (e) {
const el = e.target;
if (!el || el.id !== 'rd-file') return;
const file = el.files && el.files[0];
if (!file) return;
let buf = null;
try { buf = await file.arrayBuffer(); } catch (err) { rdToast('这个文件读不出来'); return; }
if (!buf || !buf.byteLength) { rdToast('这个文件读不出来'); return; }
rdImp.buf = buf;
rdImp.name = file.name || '未命名.txt';
rdImp.source = 'file';
rdImp.chapters = null;
rdUseDecoded(rdDecode(buf, 'utf-8'));
});
document.addEventListener('input', function (e) {
const el = e.target;
if (!el || el.id !== 'rd-paste') return;
rdImp.source = 'paste';
rdImp.buf = null;
rdImp.name = '';
rdImp.text = el.value || '';
rdImp.chapters = null;
const gbk = document.getElementById('rd-gbk-row');
if (gbk) gbk.hidden = true;
rdSetFileInfo(rdImp.text.trim() ? '粘贴内容 · ' + rdImp.text.length + ' 字' : '');
});
document.addEventListener('input', function (e) {
const el = e.target;
if (el && el.id === 'rd-anno-search') rdRenderCards(el.value || '');
});
window.__readingProbe = {
version: 2,
readIndex: readIndex,
splitChapters: splitChapters,
paginate: paginate,
open: rdOpen,
close: rdClose
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("reading.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("reading.js"); try { console.error("[JS] reading.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[reading.js] " + String(__e && __e.message || __e)); } })();