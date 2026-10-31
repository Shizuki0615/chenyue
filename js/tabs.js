(function () { try {
(function () {
const tabs = document.querySelectorAll('.tab');
const pages = document.querySelectorAll('.page');
const sdLeaveSnap = () => { try { if (window.__mochiLeaveSnap) window.__mochiLeaveSnap('switch'); } catch (e) {} };
let _lastVisId = '', _healAt = 0, _healRaf = 0;
let _blurPh = null;
try { window.__mochiBlankHeal = window.__mochiBlankHeal || { n: 0, at: 0, last: '' }; } catch (e0) {}
function liveVisiblePage() {
const live = document.querySelectorAll('.page');
for (let i = 0; i < live.length; i++) if (!live[i].hidden) return live[i];
return null;
}
function healBlank() {
if (_healRaf) return;
_healRaf = requestAnimationFrame(() => {
_healRaf = 0;
try {
if (liveVisiblePage()) return; // 正常中间态：已经有人把页显出来了
const sp = document.getElementById('splash');
if (sp && !sp.classList.contains('hide')) return;
if (!window.__mochiDataReady) return;
const now = Date.now();
if (now - _healAt < 800) return;
const back = document.getElementById(_lastVisId) || document.getElementById('page-phone');
if (!back) return;
_healAt = now;
back.hidden = false;
const h = window.__mochiBlankHeal;
h.n++; h.at = now; h.last = back.id;
try { if (window.__jsErrors) window.__jsErrors.push('整屏空白自愈 ' + h.n + ' 次：切页后无任何可见页面，已补回 ' + back.id + '（最后可见页 ' + (_lastVisId || '?') + '）'); } catch (e1) {}
} catch (e2) {}
});
}
function hideAllPages() {
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // 同值不写：#336/#338 不唤醒无关页观察器
}
tabs.forEach(tab => {
tab.addEventListener('click', () => {
sdLeaveSnap();
const target = document.getElementById(tab.dataset.page || '');
if (!target) {
try { if (window.__jsErrors) window.__jsErrors.push('底部 tab 目标页缺失（data-page=' + (tab.dataset.page || '?') + '），已放弃本次切页'); } catch (e3) {}
return;
}
tabs.forEach(t => t.classList.remove('active'));
tab.classList.add('active');
hideAllPages();
target.hidden = false;
try {
const ph = _blurPh || (_blurPh = document.querySelector('.phone'));
if (ph && ph.classList.contains('desk-blur-on')) {
document.documentElement.classList.add('desk-swiping');
clearTimeout(window.__mochiBlurT);
window.__mochiBlurT = setTimeout(function () { document.documentElement.classList.remove('desk-swiping'); }, 400);
}
} catch (e0) {}
});
});
const FULL_PAGES = ['page-chat', 'page-group-chat', 'page-chat-settings', 'page-custom-cards', 'page-default-cards', 'page-fun-cards', 'page-mood-cards', 'page-reply-cards', 'page-theme', 'page-fav', 'page-fav-settings', 'page-memory', 'page-calendar', 'page-period', 'page-accounting', 'page-divine', 'page-music', 'page-music-lyric', 'page-stats', 'page-interact', 'page-checkin', 'page-ta-ask', 'page-ta-ask-survey', 'page-ta-choose', 'page-ta-curious', 'page-ta-roast', 'page-ta-checkin', 'page-ta-invite', 'page-checkin-cards', 'page-quote-cards', 'page-home', 'page-mail', 'page-mail-write', 'page-mail-reply', 'page-feed', 'page-feed-all', 'page-feed-friends', 'page-license', 'page-about', 'page-guide', 'page-featurehub', 'page-reply-settings', 'page-call-settings', 'page-sfx-settings', 'page-memo-arc', 'page-cjian', 'page-room', 'page-drift', 'page-my-arc', 'page-mood', 'page-reading', 'page-reading-settings'];
let _scPhone = null, _scTabbar = null, _scLastSig = null;
function syncChrome() {
let visible = null;
for (let i = 0; i < pages.length; i++) { if (!pages[i].hidden) { visible = pages[i]; break; } }
if (!visible) visible = liveVisiblePage();
if (visible) _lastVisId = visible.id;
else healBlank();
const isFull = visible ? FULL_PAGES.indexOf(visible.id) >= 0 : false;
const sig = (visible ? visible.id : '') + '|' + (isFull ? '1' : '0');
if (sig === _scLastSig) return;
_scLastSig = sig;
const phone = _scPhone || (_scPhone = document.querySelector('.phone'));
const tabbar = _scTabbar || (_scTabbar = document.querySelector('.tabbar'));
if (tabbar) tabbar.hidden = isFull;
if (phone) phone.classList.toggle('no-statusbar', isFull);
if (visible) visible.classList.toggle('full', isFull);
try {
const ae = document.activeElement;
if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) ae.blur();
} catch (e) {}
}
document.querySelectorAll('.page').forEach(p => {
const mo = new MutationObserver(syncChrome);
mo.observe(p, { attributes: true, attributeFilter: ['hidden'] });
});
syncChrome();
const appearanceRow = document.getElementById('row-appearance');
const themePage = document.getElementById('page-theme');
const themeBack = document.getElementById('theme-back');
if (appearanceRow && themePage) {
appearanceRow.addEventListener('click', () => {
sdLeaveSnap();
hideAllPages(); // FIX #815：实时清单，运行中才建的 .page 也一并关掉
themePage.hidden = false;
});
}
if (themeBack) {
themeBack.addEventListener('click', () => {
sdLeaveSnap();
const setPage = document.getElementById('page-setting');
if (!setPage) { hideAllPages(); themePage.hidden = false; return; } // FIX #815：兜底退回主题页，不留零可见页
hideAllPages();
setPage.hidden = false;
});
}
})();
(function () {
const inPwa = !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
const MAIN_PAGES = { 'page-phone': 1, 'page-chat': 1, 'page-chatcard': 1, 'page-setting': 1 };
function visiblePage() {
const live = document.querySelectorAll('.page');
for (let i = 0; i < live.length; i++) if (!live[i].hidden) return live[i];
return null;
}
const first = visiblePage();
if (inPwa && first) history.replaceState({ page: first.id }, '');
const stack = [];
if (first) stack.push(first.id);
function currentId() {
const v = visiblePage();
return v ? v.id : '';
}
function show(id) {
const t = id ? document.getElementById(id) : null;
if (!t) return false;
try { if (window.__mochiLeaveSnap) window.__mochiLeaveSnap('switch'); } catch (e) {}
document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== id; });
try { if (window.exitDecor) window.exitDecor(); } catch (e) {}
return true;
}
let recordTimer = 0;
function recordNow() {
recordTimer = 0;
const v = currentId();
if (!v) return;
if (stack.length && stack[stack.length - 1] === v) return;
if (inPwa) { try { history.pushState({ page: v }, ''); } catch (e) {} }
stack.push(v);
if (stack.length > 60) stack.splice(0, stack.length - 60);
}
const mo = new MutationObserver((muts) => {
for (let i = 0; i < muts.length; i++) {
const t = muts[i].target;
if (t && t.classList && t.classList.contains('page') && muts[i].attributeName === 'hidden') {
if (!recordTimer) recordTimer = setTimeout(recordNow, 0);
return;
}
}
});
mo.observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
function goBack(fallback) {
const cur = currentId();
if (cur && (!stack.length || stack[stack.length - 1] !== cur)) stack.push(cur);
if (stack.length > 1) stack.pop();
else { stack.length = 0; stack.push(fallback || 'page-phone'); }
const target = stack[stack.length - 1] || fallback || 'page-phone';
if (!show(target)) {
if (cur) { stack.length = 0; stack.push(cur); }
return cur;
}
if (inPwa) { try { history.pushState({ page: target }, ''); } catch (e) {} }
return target;
}
window.mochiGoBack = goBack;
function closeLayers() {
const layers = ['img-view-mask', 'modal-mask', 'qa-mask', 'tc-mask', 'poke-card', 'emoji-panel',
'chat-more-panel', 'chat-search', 'chat-decision-panel', 'chat-divine-panel', 'chat-snake-panel',
'avlib-card', 'ck-panel', 'feed-notice-panel', 'desk-msg', 'chat-ask-panel', 'msg-actions',
'pc-sheet-mask',
'screen-adj-panel'];
for (const id of layers) {
const el = document.getElementById(id);
if (!el || el.hidden) continue;
if (id === 'modal-mask') {
const cancel = document.getElementById('modal-cancel');
if (cancel) { try { cancel.click(); return true; } catch (e) {} }
}
el.hidden = true;
return true;
}
const mg = document.querySelector('.mg-mask:not([hidden])');
if (mg) { mg.hidden = true; return true; }
const callMask = document.getElementById('call-mask');
if (callMask && !callMask.hidden) {
const reject = document.getElementById('call-reject-btn');
if (reject && !reject.hidden) { reject.click(); return true; }
const hang = document.getElementById('call-hang-btn');
if (hang && !hang.hidden) { hang.click(); return true; }
callMask.hidden = true;
return true;
}
return false;
}
function kbOpen() {
try { const k = window.__mochiAndroidKb && window.__mochiAndroidKb(); if (k && k.kbActive) return true; } catch (e) {}
const ae = document.activeElement;
const phone = document.querySelector('.phone');
return !!(ae && phone && phone.contains(ae) &&
(ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));
}
function dismissKb() {
if (!kbOpen()) return false;
try { if (window.mochiKbDismiss) { window.mochiKbDismiss(); return true; } } catch (e) {}
try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
return true;
}
function initPlusBack() {
if (!window.plus || !window.plus.key || window.__mochiPlusBackBound) return;
window.__mochiPlusBackBound = true;
window.plus.key.addEventListener('backbutton', function () {
if (dismissKb()) return;
if (closeLayers()) return;
const cur = currentId();
if (MAIN_PAGES[cur]) {
if (cur !== 'page-phone') {
stack.length = 0;
stack.push('page-phone');
show('page-phone');
return;
}
try { if (window.plus.runtime && window.plus.runtime.quit) window.plus.runtime.quit(); } catch (e) {}
return;
}
goBack('page-phone');
}, false);
}
if (window.plus) { try { initPlusBack(); } catch (e) {} }
document.addEventListener('plusready', function () { try { initPlusBack(); } catch (e) {} }, false);
if (inPwa) {
window.addEventListener('popstate', function () {
if (closeLayers()) return;
if (stack.length <= 1) return;
stack.pop();
const target = stack[stack.length - 1];
if (target) show(target);
try { history.pushState({ page: target }, ''); } catch (e) {}
});
}
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("tabs.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("tabs.js"); try { console.error("[JS] tabs.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[tabs.js] " + String(__e && __e.message || __e)); } })();