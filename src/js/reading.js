// ===== 功能：一起读书（书架 / 真分页阅读 / 字卡批注 / 他的位置与回应） =====
// 本地优先：不联网、不引入后端，所有「他」的行为由本地规则与文案池生成。
// 书籍正文按章进 IndexedDB（大键直存，绕开 localStorage 配额），书架索引走 xyStore；
// 批注按「书 + 章」分键，永不整本读改写。
// 数据形状预留 sync 字段（by / rev / deviceId），将来接真实同步时不需要重写语义。
(function () {
  'use strict';
  const G = 'xy-home-v2';
  const store = window.xyStore(G);

  // 书架索引键（只存书目元信息，条目很小）
  const RD_INDEX_KEY = 'reading-books';
  // 字号/行距/背景偏好：全局小键，不进备份白名单也不进书架索引
  const RD_PREFS_KEY = 'reading-prefs';
  const RD_BG_KEY = 'reading-bg';
  const RD_COOP_KEY = 'reading-coop';
  // 阅读习惯：只记「哪天、读多久、翻几页、大约几点」，不记正文；小键随备份一起走
  const RD_HABIT_KEY = 'reading-habits';
  const RD_HABIT_DAYS = 45;
  // IDB 键前缀：正文 / 目录 / 批注
  const RD_BODY_P = 'xy-home-v2:reading-body:';
  const RD_TOC_P = 'xy-home-v2:reading-toc:';
  const RD_ANNO_P = 'xy-home-v2:reading-anno:';
  // 单本上限 20MB（中文约 700 万字）。正文不进备份、只占本机 IndexedDB，
  // 但要整本读进内存再分章，再往上会明显拖慢导入，也会挤占手机存储。
  const RD_MAX_BYTES = 20 * 1024 * 1024;
  const RD_MAX_BOOKS = 20;
  const RD_BAD_RATIO = 0.005;

  // 轻提示（本文件独立作用域，自带一份；样式复用全局 .cc-toast）
  function rdToast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2200);
  }

  // ===== 书架索引 =====
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

  // ===== 正文 / 目录 / 批注读写 =====
  // 写失败必须明确抛出，调用方 toast；宁可让用户知道没存上，也不静默吞掉。
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
  // 删这本书的全部键：按前缀扫，避免「改过分章后按目录章数删会剩尾巴」。
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
      // 扫不到清单时退回按目录章数逐个删（至少把正文/批注主键清掉）
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

  // ===== 导入：解码与探测 =====
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

  // ===== 分章算法 =====
  // 优先级：章节标题行 → 连续两个空行聚段 → 每 8000 字硬切。
  // 硬约束：从 0 到文末每一段都被某一章覆盖，不丢字（宁可把空白并进相邻章）。
  const RD_CH_TITLE_RE = /^\s*(?:(?:上|中|下)(?:卷|部|篇)|第[0-9零一二三四五六七八九十百千万]+[章回节卷]|卷[0-9零一二三四五六七八九十百千]+|序章|楔子|番外[一二三四五六七八九十]*|Chapter\s+\d+)/i;

  function splitChapters(text) {
    const src = String(text == null ? '' : text);
    const n = src.length;
    if (!n) return [];
    // 行扫描：记录每一行的起点与标题命中
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
    // 没有标题行：连续两个空行聚成段簇
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
    // 仍不足 2 章：每 8000 字硬切
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
    // 第一个标题之前的内容单独算「前言」，不能把后面每段标题前的内容也当前言（会与正章重复）
    if (marks[0].s > 0 && src.slice(0, marks[0].s).trim()) {
      out.push({ t: '前言', s: 0, e: marks[0].s });
    }
    // 每个标题行管到下一个标题起点
    for (let i = 0; i < marks.length; i++) {
      const s = marks[i].s;
      const e = i + 1 < marks.length ? marks[i + 1].s : n;
      out.push({ t: marks[i].t || ('第 ' + (i + 1) + ' 节'), s: s, e: e });
    }
    // 只留非空章；首段若纯空白并进下一章
    const kept = out.filter(function (c) { return c.e > c.s; });
    while (kept.length > 1 && !src.slice(kept[0].s, kept[0].e).trim()) {
      kept[1].s = kept[0].s;
      kept.shift();
    }
    return kept;
  }

  // ===== 页面骨架 =====
  let page = null;
  function buildPage() {
    if (page) return page;
    page = document.createElement('div');
    page.className = 'page';
    page.id = 'page-reading';
    page.hidden = true;
    page.innerHTML =
      '<div class="rd-shelf" id="rd-shelf">' +
        '<div class="chat-head">' +
          '<span class="ch-back" id="rd-shelf-back">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
          '</span>' +
          '<span class="ch-name">读书</span>' +
          '<button class="ch-settings" id="rd-import" type="button" title="导入">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          '</button>' +
          '<button class="ch-settings" id="rd-shelf-settings" type="button" title="设置">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="rd-empty" id="rd-empty">书架还是空的，点右上角导入一本</div>' +
        '<div class="rd-grid" id="rd-grid"></div>' +
        '<div class="rd-ledger" id="rd-ledger" hidden></div>' +
        '<div class="rd-usage" id="rd-usage"></div>' +
        '<div class="rd-import" id="rd-import-panel" hidden>' +
          '<div class="rd-import-main" id="rd-import-main">' +
            '<div class="rd-import-head"><div class="rd-import-title">导入一本书</div>' +
              '<button class="rd-back" id="rd-import-close" type="button">关闭</button></div>' +
            '<input class="rd-imp-name" id="rd-imp-name" type="text" maxlength="40" placeholder="书名（可留空；留空时用文件名或「粘贴的书」）">' +
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
        '<div class="chat-head rd-reader-head">' +
          '<button class="ch-back" id="rd-reader-back" type="button" aria-label="返回">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
          '</button>' +
          '<span class="ch-name" id="rd-book-title"></span>' +
          '<button class="ch-settings" id="rd-toc-btn" type="button" aria-label="目录" title="目录">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="rd-body" id="rd-body"></div>' +
        '<div class="rd-foot" id="rd-foot">' +
          '<div class="rd-bar" id="rd-bar"><span class="rd-bar-fill" id="rd-bar-fill"></span><span class="rd-buddy-dot" id="rd-buddy-dot" hidden></span></div>' +
          '<div class="rd-foot-row" id="rd-foot-row" role="button">' +
            '<span class="rd-lamp" id="rd-lamp" hidden><i class="rd-lamp-dot rd-lamp-me"></i><i class="rd-lamp-dot rd-lamp-him"></i></span>' +
            '<span id="rd-page-no">第 1 / 1 页</span><span id="rd-buddy"></span></div>' +
        '</div>' +
        '<div class="rd-buddy-card" id="rd-buddy-card" hidden>' +
          '<div class="rd-import-head"><div class="rd-import-title">他在哪</div>' +
            '<button class="rd-back" id="rd-buddy-close" type="button">关闭</button></div>' +
          '<div class="rd-buddy-row"><span class="rd-buddy-av" id="rd-buddy-av"></span>' +
            '<div class="rd-buddy-state" id="rd-buddy-state"></div></div>' +
          '<div class="rd-buddy-pos" id="rd-buddy-pos"></div>' +
          '<div class="rd-buddy-near" id="rd-buddy-near"></div>' +
          '<div class="rd-buddy-habit" id="rd-buddy-habit"></div>' +
          '<div class="rd-buddy-modes" id="rd-buddy-modes">' +
            '<button class="rd-btn rd-btn-mini" data-bmode="follow" type="button">跟随我</button>' +
            '<button class="rd-btn rd-btn-mini" data-bmode="solo" type="button">独立推进</button>' +
            '<button class="rd-btn rd-btn-mini" data-bmode="skip" type="button">今天不读</button>' +
          '</div>' +
          '<div class="rd-import-foot"><button class="rd-btn rd-btn-primary" id="rd-buddy-jump" type="button" hidden>去他那里</button></div>' +
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
        '<div class="rd-anno-ops" id="rd-anno-ops" hidden>' +
          '<button class="rd-menu-item" data-act="edit" type="button">修改这条批注</button>' +
          '<button class="rd-menu-item rd-menu-danger" data-act="del" type="button">删除这条批注</button>' +
        '</div>' +
        '<div class="rd-lost" id="rd-lost" hidden>' +
          '<div class="rd-import-head"><div class="rd-import-title">未定位的批注</div>' +
            '<button class="rd-back" id="rd-lost-close" type="button">关闭</button></div>' +
          '<div class="rd-lost-tip">重新导入后，这些批注没能在这本书里找到原来的句子。它们还留着，可以逐条删掉。</div>' +
          '<div class="rd-lost-list" id="rd-lost-list"></div>' +
        '</div>' +
      '</div>';
    const phone = document.querySelector('.phone');
    (phone || document.body).appendChild(page);
    rdApplyPrefs(rdReadPrefs());
    rdApplyBg();
    return page;
  }

  // ===== 阅读设置页（独立整页，入口在书架顶栏）=====
  let settingsPage = null;
  const RD_PREVIEW_TEXT = '书页翻过去的时候，风从窗缝里进来，把桌上的纸吹得轻轻响。\n\n' +
    '你读到这一句，停了停，像是在等谁从下一行走过来。窗外的天色慢慢暗下去，字却还亮着。';
  function buildSettingsPage() {
    if (settingsPage) return settingsPage;
    settingsPage = document.createElement('div');
    settingsPage.className = 'page';
    settingsPage.id = 'page-reading-settings';
    settingsPage.hidden = true;
    settingsPage.innerHTML =
      '<div class="chat-head">' +
        '<button class="ch-back" id="rd-settings-back" type="button" aria-label="返回">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<span class="ch-name">阅读设置</span>' +
      '</div>' +
      '<div class="rd-set-body">' +
        '<button class="rd-live-entry" id="rd-live-adjust" type="button">' +
          '<span class="rd-live-entry-t">' +
            '<span class="rd-live-entry-name">边看边调</span>' +
            '<span class="rd-live-entry-sub">打开调色条：预览在上、控件在下，改哪看哪、即时生效</span>' +
          '</span>' +
          '<span class="rd-live-entry-go">点击开启 ›</span>' +
        '</button>' +
        '<div class="rd-set-preview" id="rd-set-preview">' +
          '<div class="rd-set-preview-h"><span>预览</span><span>即时生效</span></div>' +
          '<div class="rd-set-preview-text" id="rd-set-preview-text">' + RD_PREVIEW_TEXT + '</div>' +
        '</div>' +
        '<div class="gs-title">阅读显示</div>' +
        '<div class="set-group glass">' +
          '<div class="rd-set-row">' +
            '<div class="rd-set-row-h"><span class="rd-set-row-t">字号</span><span class="rd-set-row-v" id="rd-set-fs-val"></span></div>' +
            '<div class="rd-set-slider"><span>小</span><input type="range" id="rd-set-fs-range" min="12" max="30" step="1" aria-label="字号"><span>大</span></div>' +
          '</div>' +
          '<div class="rd-set-row">' +
            '<div class="rd-set-row-h"><span class="rd-set-row-t">行距</span><span class="rd-set-row-v" id="rd-set-lh-val"></span></div>' +
            '<div class="rd-set-slider"><span>紧</span><input type="range" id="rd-set-lh-range" min="1.4" max="2.2" step="0.1" aria-label="行距"><span>松</span></div>' +
          '</div>' +
          '<div class="rd-set-row">' +
            '<div class="rd-set-row-h"><span class="rd-set-row-t">阅读背景</span><span class="rd-set-row-v" id="rd-set-bg-val"></span></div>' +
            '<div class="rd-bg-opts">' +
              '<button class="rd-bg-opt" data-rd-bgopt="auto" type="button"><i class="rd-bg-sw auto"></i><span>跟随主题</span></button>' +
              '<button class="rd-bg-opt" data-rd-bgopt="eye" type="button"><i class="rd-bg-sw eye"></i><span>护眼</span></button>' +
              '<button class="rd-bg-opt" data-rd-bgopt="night" type="button"><i class="rd-bg-sw night"></i><span>夜间</span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="rd-set-note">字号、行距与背景只作用在阅读器。跟随主题会随全站浅色/深色切换；护眼和夜间在阅读器内固定。预览用的是内置样文，打开书后会按同一套偏好重新分页。</div>' +
        '<div class="gs-title">共读</div>' +
        '<div class="set-group glass">' +
          '<div class="rd-set-row rd-set-toggle">' +
            '<div class="rd-set-row-h"><span class="rd-set-row-t">共读功能</span>' +
              '<label class="toggle"><input type="checkbox" id="rd-coop-toggle"><span class="tk"></span></label></div>' +
            '<div class="rd-set-row-desc">关掉后不再生成他的批注、回应和封存纸条，也不再显示他的位置、灯、共读手账和书脊细纹；我的阅读进度和自己的批注不受影响。重新打开从当下继续，不补算关闭期间的阅读。</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    const phone = document.querySelector('.phone');
    (phone || document.body).appendChild(settingsPage);
    const fsRange = settingsPage.querySelector('#rd-set-fs-range');
    if (fsRange) fsRange.addEventListener('input', function () { rdSetPrefs({ fs: Number(this.value) }); });
    const lhRange = settingsPage.querySelector('#rd-set-lh-range');
    if (lhRange) lhRange.addEventListener('input', function () { rdSetPrefs({ lh: Number(this.value) }); });
    const coopToggle = settingsPage.querySelector('#rd-coop-toggle');
    if (coopToggle) coopToggle.addEventListener('change', function () { rdSetCoop(this.checked); });
    rdRenderPrefsActive();
    return settingsPage;
  }
  function rdOpenSettings() {
    buildSettingsPage();
    if (!page || !settingsPage) return;
    rdCloseLiveDrawer();
    page.hidden = true;
    rdApplyChrome();
    settingsPage.hidden = false;
    settingsPage.classList.add('full');
    rdRenderPrefsActive();
    const body = settingsPage.querySelector('.rd-set-body');
    if (body) body.scrollTop = 0;
  }
  function rdCloseSettings() {
    if (!settingsPage) return;
    rdCloseLiveDrawer();
    settingsPage.hidden = true;
    if (page) page.hidden = false;
    rdApplyChrome();
    rdRenderShelf();
  }

  // ===== 边看边调抽屉（挂 body，预览在上、控件在下）=====
  let liveDrawer = null;
  let rdLiveDragBot = 0;
  function rdLiveApplyBottom() {
    if (!liveDrawer) return;
    liveDrawer.style.bottom = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), rdLiveDragBot)) + 'px';
  }
  function bindLiveDrag(handle) {
    if (!handle) return;
    handle.style.touchAction = 'none';
    let sy = 0, sb = 0, drag = false;
    handle.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = true; sy = e.clientY; sb = rdLiveDragBot;
      if (liveDrawer) liveDrawer.style.transition = 'none';
      try { handle.setPointerCapture(e.pointerId); } catch (er) {}
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!drag) return;
      rdLiveDragBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));
      rdLiveApplyBottom();
      e.preventDefault();
    });
    const up = function () {
      if (!drag) return;
      drag = false;
      if (liveDrawer) liveDrawer.style.transition = 'bottom .16s ease';
      if (rdLiveDragBot < 24) rdLiveDragBot = 0;
      rdLiveApplyBottom();
    };
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    handle.style.cursor = 'grab';
  }
  function buildLiveDrawer() {
    if (liveDrawer) return liveDrawer;
    liveDrawer = document.createElement('div');
    liveDrawer.id = 'rd-live-drawer';
    liveDrawer.hidden = true;
    liveDrawer.innerHTML =
      '<div class="rd-live-grip"></div>' +
      '<div class="rd-live-head" id="rd-live-head">' +
        '<span class="rd-live-title">边看边调（即时生效）</span>' +
        '<span class="rd-live-hint">按住标题行上下拖 · 让开看预览</span>' +
        '<button class="rd-live-mini" id="rd-live-fold" type="button">收起</button>' +
        '<button class="rd-live-mini" id="rd-live-close" type="button">✕</button>' +
      '</div>' +
      '<div class="rd-live-body" id="rd-live-body">' +
        '<div class="rd-set-slider rd-live-slider"><span>字号</span><input type="range" id="rd-live-fs-range" min="12" max="30" step="1" aria-label="字号"><span class="rd-live-val" id="rd-live-fs-val"></span></div>' +
        '<div class="rd-set-slider rd-live-slider"><span>行距</span><input type="range" id="rd-live-lh-range" min="1.4" max="2.2" step="0.1" aria-label="行距"><span class="rd-live-val" id="rd-live-lh-val"></span></div>' +
        '<div class="rd-live-bgrow"><span>背景</span><div class="rd-live-bg">' +
          '<button class="rd-live-bgopt" data-rd-bgopt="auto" type="button">跟随</button>' +
          '<button class="rd-live-bgopt" data-rd-bgopt="eye" type="button">护眼</button>' +
          '<button class="rd-live-bgopt" data-rd-bgopt="night" type="button">夜间</button>' +
        '</div></div>' +
        '<div class="rd-live-note">改动即时生效；关掉抽屉后保留。</div>' +
      '</div>';
    document.body.appendChild(liveDrawer);
    const fsRange = liveDrawer.querySelector('#rd-live-fs-range');
    if (fsRange) fsRange.addEventListener('input', function () { rdSetPrefs({ fs: Number(this.value) }); });
    const lhRange = liveDrawer.querySelector('#rd-live-lh-range');
    if (lhRange) lhRange.addEventListener('input', function () { rdSetPrefs({ lh: Number(this.value) }); });
    bindLiveDrag(liveDrawer.querySelector('.rd-live-grip'));
    bindLiveDrag(liveDrawer.querySelector('#rd-live-head'));
    rdApplyBg();
    return liveDrawer;
  }
  function rdOpenLiveDrawer() {
    if (!settingsPage || settingsPage.hidden) return;
    buildLiveDrawer();
    rdLiveDragBot = 0;
    const body = document.getElementById('rd-live-body');
    if (body) body.style.display = 'flex';
    const foldBtn = document.getElementById('rd-live-fold');
    if (foldBtn) foldBtn.textContent = '收起';
    liveDrawer.hidden = false;
    liveDrawer.style.transition = 'bottom .16s ease';
    rdLiveApplyBottom();
    rdApplyBg();
    rdRenderPrefsActive();
    const setBody = settingsPage.querySelector('.rd-set-body');
    if (setBody) {
      setBody.style.overflow = 'hidden';
      const prev = document.getElementById('rd-set-preview');
      if (prev) {
        const top = prev.getBoundingClientRect().top - setBody.getBoundingClientRect().top + setBody.scrollTop;
        setBody.scrollTop = Math.max(0, top - 8);
      }
    }
  }
  function rdCloseLiveDrawer() {
    if (!liveDrawer) return;
    liveDrawer.hidden = true;
    rdLiveDragBot = 0;
    const setBody = settingsPage && settingsPage.querySelector('.rd-set-body');
    if (setBody) setBody.style.overflow = '';
  }
  function rdToggleLiveFold() {
    const body = document.getElementById('rd-live-body');
    const btn = document.getElementById('rd-live-fold');
    if (!body) return;
    const willFold = body.style.display !== 'none';
    body.style.display = willFold ? 'none' : 'flex';
    if (btn) btn.textContent = willFold ? '展开' : '收起';
  }

  function rdOpen() {
    buildPage();
    rdCloseLiveDrawer();
    rdRenderShelf();
    rdRetryPendingDelete();
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
    if (settingsPage) settingsPage.hidden = true;
    page.hidden = false;
    rdApplyChrome();
    // 本页是运行时新建的，不在 tabs.js 启动时登记的 hidden 观察器名单里，翻 hidden 不会自动
    // 触发 syncChrome。照 p2-features 的做法在 rAF 里手动收起 tabbar 并补 .full。
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
    rdBmClearWait();
    rdTogWatchStop();
    rdWriteProgress();
    rdHabitEndSession();
    rdCloseBookMenu();
    rdCloseLiveDrawer();
    if (settingsPage) settingsPage.hidden = true;
    page.classList.remove('full');
    page.hidden = true;
    rdApplyChrome();
    const home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  }
  function rdShowShelf() {
    if (!page) return;
    rdBmClearWait();
    rdTogWatchStop();
    rdWriteProgress();
    rdHabitEndSession();
    closeToc();
    rdClearSel(false);
    rdCloseSheet();
    rdClosePreview();
    rdClosePop();
    rdCloseAnnoOps();
    rdCloseLost();
    rdCloseBuddyCard();
    rdPopPos = -1;
    rdCloseLiveDrawer();
    if (settingsPage) settingsPage.hidden = true;
    const shelf = document.getElementById('rd-shelf');
    const reader = document.getElementById('rd-reader');
    const imp = document.getElementById('rd-import-panel');
    if (shelf) shelf.hidden = false;
    if (reader) reader.hidden = true;
    if (imp) imp.hidden = true;
    rdApplyChrome();
    rdRenderShelf();
  }

  // ===== 打开一本书 =====
  // 换机恢复备份时正文不在包里：明确告知并记 missing，不白屏、不假装书还在。
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
    rdApplyChrome();
    if (title) title.textContent = book.title || '未命名';
    if (body) body.textContent = '正在翻开…';
    let ch = (book.progress && book.progress.ch) || 0;
    let off = (book.progress && book.progress.off) || 0;
    if (ch < 0 || ch >= toc.length) ch = 0;
    // 他第一次翻开这本书：跟随模式从我的位置起步；独立模式保留他自己的位置。
    const bd = rdBuddyGet(book);
    if (!bd.started) {
      bd.started = true;
      if (bd.mode !== 'solo' && bd.mode !== 'skip') { bd.ch = ch; bd.off = off; }
      bd.updatedAt = Date.now();
    }
    rdBuddyAdvance(book);
    saveIndex(list);
    rdBook = {
      id: id, toc: toc, ch: ch, off: off,
      cache: {}, text: '', sents: [], pages: [], pageIdx: 0, anno: [],
      lostAnnos: Array.isArray(book.lostAnnos) ? book.lostAnnos : []
    };
    // 每次打开书重新给折角书签一次机会（只播一次，不随每次翻页重复）
    rdBookmarkPlayed = false;
    rdBmClearWait();
    rdHabitStartSession();
    // 每次重新翻开书，同读计数与计时都从这一刻重新算
    rdTogLogged = false;
    rdTogNoteLogged = false;
    rdTogWatchStart();
    // 翻页节奏也重新开始量：换一本书不该继承上一本的停留时长
    rdPaceReset();
    rdCrossKey = '';
    // 封存一句是异步读写：等本章先加载完，再依次解锁旧纸条、处理回应、折新纸条，
    // 避免三处同时改同一章的批注数组互相覆盖。
    rdEnsureChapter('offset').then(function () {
      return rdUnlockSealed(book).catch(function () {});
    }).then(function () {
      // 下次打开才处理待回应：他越过那句、且当前是「共读中」才会有下文
      return rdBuddyProcessReplies().catch(function () {});
    }).then(function () {
      return rdMaybeSeal(book).catch(function () {});
    }).then(function () {
      // 放满七天我才读到的那句，旧句在这里被划掉
      return rdCrossOldAnnos(book).catch(function () {});
    });
  }

  // ===== 阅读器：章节加载 / 真分页 / 翻页 =====
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
    // 预取下一章，只留在内存；缓存只保留当前章与下一章
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
    b.sents = rdSentenceList(text);
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
    // 页起始偏移天然递增，直接二分定位（不存页码，字号/屏幕变了也能落回同一句话）
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
    return rdPaginateText(b, b.ch, b.text);
  }
  // 分页缓存键带章号：给他算「读到第几页」时也能复用同一套排版结果
  function rdPaginateText(b, ch, text) {
    const body = document.getElementById('rd-body');
    if (!body) return [{ s: 0, e: String(text || '').length }];
    const cs = getComputedStyle(body);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const w = Math.max(80, body.clientWidth - padL - padR);
    // 正文顶部有呼吸位：分页要按内容区高度算，扣掉上下内边距，否则最后一行会被裁掉
    const h = Math.max(80, body.clientHeight - padT - padB);
    const fs = parseFloat(cs.fontSize) || 17;
    let lh = parseFloat(cs.lineHeight);
    if (!lh || isNaN(lh)) lh = fs * 1.8;
    const key = b.id + '|' + ch + '|' + Math.round(w) + '|' + Math.round(h) + '|' + fs + '|' + lh;
    if (RD_PAGE_CACHE[key]) return RD_PAGE_CACHE[key];
    const pages = paginate(text, w, h, fs, lh, cs.fontFamily);
    RD_PAGE_CACHE[key] = pages;
    const keys = Object.keys(RD_PAGE_CACHE);
    if (keys.length > 24) delete RD_PAGE_CACHE[keys[0]];
    return pages;
  }

  // 真分页：用一个不可见的同宽同字号测量块，对每页末尾偏移做二分，
  // 找到「不溢出容器高度」的最大偏移；保证每次至少前进 1 个字符。
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
      // 不要把代理对拆开（emoji 等），否则会切出半个字符
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

  // 分页自检：第 0 页从 0 开始、页与页首尾相接、最后一页覆盖章末。失败只报错不打断阅读。
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
    // 折角书签的 30 秒只等在同一页；一翻页就清零，不在新页继续倒计时
    if (rdBookmarkWaitPage && rdBookmarkWaitPage !== b.ch + ':' + b.pageIdx) rdBmClearWait();
    // 翻页节奏在这里结算：上一页停了多久、最近几页翻得多快
    rdMarkPagePace();
    const body = document.getElementById('rd-body');
    const p = b.pages[b.pageIdx];
    rdPaintPage();
    if (!body) return;
    const no = document.getElementById('rd-page-no');
    if (no) no.textContent = '第 ' + (b.pageIdx + 1) + ' / ' + b.pages.length + ' 页';
    rdUpdateBar();
    rdSaveProgress();
    rdHabitTouchPage();
    // 停一下再考虑他是否在这一页留纸条，避免翻页瞬间闪出新角标
    rdScheduleHisAnno();
  }

  function rdUpdateBar() {
    const b = rdBook;
    if (!b) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    const fill = document.getElementById('rd-bar-fill');
    if (!fill || !book) return;
    const p = b.pages[b.pageIdx] || { s: 0, e: 0 };
    const myPct = rdPosPct(book, b.ch, p.s);
    fill.style.width = myPct + '%';
    // 展示用的推进只算在内存里，真正落盘统一走 rdWriteProgress，避免每次翻页都写索引
    rdBuddyAdvance(book);
    if (!rdCoopOn()) {
      const dot = document.getElementById('rd-buddy-dot');
      if (dot) dot.hidden = true;
      const line = document.getElementById('rd-buddy');
      if (line) {
        line.textContent = '';
        line.classList.remove('rd-buddy-same-text', 'rd-tog', 'rd-pace');
      }
      const lamp = document.getElementById('rd-lamp');
      if (lamp) lamp.hidden = true;
      return;
    }
    const st = rdBuddyState(book);
    const bd = rdBuddyGet(book);
    const dot = document.getElementById('rd-buddy-dot');
    const line = document.getElementById('rd-buddy');
    const same = !!(bd && (st === 'read' || st === 'wait') && bd.ch === b.ch && bd.off >= p.s && bd.off <= p.e);
    if (dot) {
      const show = st === 'read' || st === 'wait' || st === 'done';
      dot.hidden = !show;
      if (show) {
        const behind = !same && rdFlatPos(book, bd.ch, bd.off) < rdFlatPos(book, b.ch, p.s);
        dot.style.left = same ? 'calc(' + myPct + '% + 6px)' : rdPosPct(book, bd.ch, bd.off) + '%';
        dot.classList.toggle('rd-buddy-ahead', !same && !behind);
        dot.classList.toggle('rd-buddy-behind', behind);
        dot.classList.toggle('rd-buddy-same', same);
      }
    }
    if (line) {
      const tog = rdTogetherOn(book);
      const paceNote = tog ? '' : rdPaceNote(book, b);
      line.textContent = tog ? '此刻 · 同读' : (paceNote || rdBuddyLine(book, st));
      line.classList.toggle('rd-buddy-same-text', same);
      line.classList.toggle('rd-tog', tog);
      line.classList.toggle('rd-pace', !!paceNote);
    }
    rdSyncLamp(book, st);
    rdMaybeBookmarkReturn(book, b, bd, st);
  }

  // 折角书签：他领先我一章以上时，进度圆点先停在前面的位置，再慢慢滑回我这一页的
  // 边缘，停一下，然后回到他自己的位置——像把书签从后面挪回来夹好。纯展示，不改进度。
  function rdBmReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function rdBmPauseWait() {
    if (rdBookmarkWaitTimer) { clearTimeout(rdBookmarkWaitTimer); rdBookmarkWaitTimer = 0; }
  }
  function rdBmClearWait() {
    rdBmPauseWait();
    rdBookmarkWaitPage = '';
  }
  function rdBookmarkTake(book) {
    try {
      const list = readIndex();
      const fb = rdFindBook(book.id, list);
      if (!fb) return false;
      const day = rdTodayKey();
      if (fb.bmDay !== day) { fb.bmDay = day; fb.bmCount = 0; }
      if ((Number(fb.bmCount) || 0) >= RD_BOOKMARK_DAILY) return false;
      fb.bmCount = (Number(fb.bmCount) || 0) + 1;
      saveIndex(list);
      return true;
    } catch (e) { return true; }
  }
  function rdBmScheduleWait() {
    rdBmPauseWait();
    if (!rdCoopOn()) { rdBookmarkWaitPage = ''; return; }
    if (!rdBookmarkWaitPage) return;
    rdBookmarkWaitTimer = setTimeout(function () {
      rdBookmarkWaitTimer = 0;
      if (!rdCoopOn()) return;
      const b = rdBook;
      if (!b) return;
      if (b.ch + ':' + b.pageIdx !== rdBookmarkWaitPage) return;
      const reader = document.getElementById('rd-reader');
      if (!reader || reader.hidden) return;
      const book = rdFindBook(b.id, readIndex());
      if (!book) return;
      rdBuddyAdvance(book);
      if (rdBuddyState(book) !== 'wait') return;
      if (rdNightGuard()) return; // 夜间免打扰开着时不在书里说话
      const line = RD_BOOKMARK_LINES[rdBookmarkCopyIdx % RD_BOOKMARK_LINES.length];
      rdBookmarkCopyIdx = (rdBookmarkCopyIdx + 1) % RD_BOOKMARK_LINES.length;
      rdToast(line);
    }, RD_BOOKMARK_WAIT_MS);
  }
  function rdMaybeBookmarkReturn(book, b, bd, st) {
    if (!rdCoopOn() || rdBookmarkPlayed || !b || !bd || st !== 'wait') return;
    if (!(bd.ch > b.ch)) return;
    const dot = document.getElementById('rd-buddy-dot');
    if (!dot || dot.hidden) return;
    rdBookmarkPlayed = true;
    if (!rdBookmarkTake(book)) return; // 每天两次用完就不再播
    const page = b.pages[b.pageIdx] || { s: 0 };
    const minePct = rdPosPct(book, b.ch, page.s);
    const hisPct = rdPosPct(book, bd.ch, bd.off);
    const animKey = b.ch + ':' + b.pageIdx;
    if (rdBmReduced()) {
      // 减少动态效果：不滑动，圆点直接停在我这页边缘亮一下，再回到他的位置
      dot.style.transition = 'none';
      dot.classList.add('rd-buddy-return');
      dot.style.left = 'calc(' + minePct + '% + 6px)';
      setTimeout(function () {
        if (!rdBook || rdBook !== b || b.ch + ':' + b.pageIdx !== animKey) return;
        dot.classList.remove('rd-buddy-return');
        dot.style.left = hisPct + '%';
        setTimeout(function () { if (dot) dot.style.transition = ''; }, 60);
      }, 1500);
    } else {
      dot.style.transition = 'left .55s ease';
      dot.classList.add('rd-buddy-return');
      setTimeout(function () {
        if (!rdBook || rdBook !== b || b.ch + ':' + b.pageIdx !== animKey) return;
        dot.style.left = 'calc(' + minePct + '% + 6px)';
      }, 900);
      setTimeout(function () {
        if (!rdBook || rdBook !== b || b.ch + ':' + b.pageIdx !== animKey) return;
        dot.classList.remove('rd-buddy-return');
        dot.style.left = hisPct + '%';
        setTimeout(function () { if (dot) dot.style.transition = ''; }, 600);
      }, 2100);
    }
    // 停在同一页满 30 秒才说话；翻页清零，切后台暂停，回前台重新计满
    rdBookmarkWaitPage = animKey;
    rdBmScheduleWait();
  }

  // ===== 阅读习惯同步 =====
  // 只记「哪天、读了多久、翻了几页、大约几点」，不记任何正文内容。
  // 存成一个小键（reading-habits），随备份一起走，换机后习惯记录不断。
  let rdHabitSession = null;
  function rdDayTs(key) {
    const p = String(key || '').split('-');
    return new Date(Number(p[0]) || 1970, (Number(p[1]) || 1) - 1, Number(p[2]) || 1).getTime();
  }
  function rdHabitLoad() {
    try {
      const raw = store.get(RD_HABIT_KEY);
      if (!raw) return { v: 1, me: {}, him: {} };
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!o || typeof o !== 'object') return { v: 1, me: {}, him: {} };
      if (!o.me || typeof o.me !== 'object') o.me = {};
      if (!o.him || typeof o.him !== 'object') o.him = {};
      return o;
    } catch (e) { return { v: 1, me: {}, him: {} }; }
  }
  function rdHabitSave(h) {
    try {
      ['me', 'him'].forEach(function (side) {
        const keys = Object.keys(h[side] || {}).sort(function (a, b) { return rdDayTs(a) - rdDayTs(b); });
        while (keys.length > RD_HABIT_DAYS) delete h[side][keys.shift()];
      });
      store.set(RD_HABIT_KEY, JSON.stringify(h));
    } catch (e) {}
  }
  function rdHabitAdd(side, sec, pages, hour, at) {
    const secs = Math.round(Number(sec) || 0);
    if (secs <= 0) return;
    const h = rdHabitLoad();
    const when = Number(at) || Date.now();
    const day = rdTodayKey(when);
    const d = h[side][day] || (h[side][day] = { sec: 0, pages: 0, firstAt: 0, lastAt: 0, hours: {} });
    if (!d.hours || typeof d.hours !== 'object') d.hours = {};
    d.sec += secs;
    d.pages += Math.max(0, Math.round(Number(pages) || 0));
    if (!d.firstAt || when < d.firstAt) d.firstAt = when;
    d.lastAt = Math.max(d.lastAt || 0, when);
    if (hour != null) {
      const k = String(hour);
      d.hours[k] = (d.hours[k] || 0) + 1;
    }
    rdHabitSave(h);
  }
  function rdHabitStartSession() {
    if (rdHabitSession) return;
    rdHabitSession = { start: Date.now(), pages: 0, lastKey: '' };
  }
  function rdHabitTouchPage() {
    const b = rdBook;
    if (!rdHabitSession || !b) return;
    const key = b.ch + ':' + b.pageIdx;
    if (key === rdHabitSession.lastKey) return;
    rdHabitSession.lastKey = key;
    rdHabitSession.pages++;
  }
  function rdHabitEndSession() {
    const s = rdHabitSession;
    if (!s) return;
    rdHabitSession = null;
    const now = Date.now();
    const sec = Math.round((now - s.start) / 1000);
    if (sec < 20) return; // 只翻一下不算一次阅读
    rdHabitAdd('me', sec, s.pages, null, now);
    // 跟随模式：他和我一起读，记同一段；独立推进由 rdBuddyAdvance 自己记
    const b = rdBook;
    if (!b) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    const bd = rdBuddyGet(book);
    if (!bd || !bd.started || bd.mode !== 'follow') return;
    if (!rdCoopOn()) return;
    if (rdBuddyState(book) !== 'read') return;
    rdBuddyAdvance(book);
    rdHabitAdd('him', sec, s.pages, new Date(s.start).getHours(), now);
  }
  // 最近 N 天里他最常出现的整点（至少 3 次才算习惯）；没形成习惯就返回 null
  function rdBuddyCommonHour(h) {
    const today = rdTodayKey();
    const keys = Object.keys(h.him || {}).sort(function (a, b) { return rdDayTs(a) - rdDayTs(b); })
      .filter(function (k) { return k !== today; }).slice(-7);
    if (keys.length < 3) return null;
    const counts = {};
    for (let i = 0; i < keys.length; i++) {
      const hrs = (h.him[keys[i]] && h.him[keys[i]].hours) || {};
      Object.keys(hrs).forEach(function (hr) { counts[hr] = (counts[hr] || 0) + Number(hrs[hr] || 0); });
    }
    let best = null, bestN = 0;
    Object.keys(counts).forEach(function (hr) {
      if (counts[hr] > bestN) { bestN = counts[hr]; best = Number(hr); }
    });
    return bestN >= 3 ? best : null;
  }
  // 我最近几天是不是都在同一个时段来
  function rdMyCommonHour(h) {
    const keys = Object.keys(h.me || {}).sort(function (a, b) { return rdDayTs(a) - rdDayTs(b); }).slice(-5);
    if (keys.length < 3) return null;
    const counts = {};
    for (let i = 0; i < keys.length; i++) {
      const d = h.me[keys[i]];
      if (!d || !d.firstAt) continue;
      const hr = new Date(d.firstAt).getHours();
      counts[hr] = (counts[hr] || 0) + 1;
    }
    let best = null, bestN = 0;
    Object.keys(counts).forEach(function (hr) {
      if (counts[hr] > bestN) { bestN = counts[hr]; best = Number(hr); }
    });
    return bestN >= 3 ? best : null;
  }
  function rdHourPhrase(hr) {
    const h = Number(hr);
    if (h >= 22 || h < 2) return '22 点后';
    if (h >= 5 && h < 9) return '早上';
    if (h >= 12 && h < 14) return '中午';
    if (h >= 18 && h < 22) return '晚上';
    return h + ' 点';
  }
  // 小卡里那行自然观察：优先今天的异常，其次他自己的固定时段，最后是我的
  function rdHabitObs(book) {
    if (!book) return '';
    const st = rdBuddyState(book);
    if (st === 'none' || st === 'skip') return '';
    const h = rdHabitLoad();
    const today = rdTodayKey();
    const ht = h.him[today] || null;
    const keys = Object.keys(h.him || {}).filter(function (k) { return k !== today; })
      .sort(function (a, b) { return rdDayTs(a) - rdDayTs(b); }).slice(-7);
    let avg = 0;
    if (keys.length) {
      let sum = 0;
      for (let i = 0; i < keys.length; i++) sum += (h.him[keys[i]] && h.him[keys[i]].sec) || 0;
      avg = sum / keys.length;
    }
    if (ht && keys.length >= 3 && avg > 60 && ht.sec > avg * 1.4) return '今天他读得比平时久。';
    if (ht && ht.sec > 0 && ht.sec < 120 && keys.length >= 3 && avg > 480) return '他今天只读了一段就合上了。';
    const hs = rdBuddyCommonHour(h);
    if (hs != null) {
      const phrase = rdHourPhrase(hs);
      if (phrase === '早上' || phrase === '中午' || phrase === '晚上') return '他最近总在' + phrase + '翻两页。';
      return '他最近总在 ' + phrase + '，翻两页。';
    }
    const ms = rdMyCommonHour(h);
    if (ms != null) return '你最近都是这个点来。';
    return '';
  }
  // 夜里两盏小灯：我那盏常亮，他那盏按他此刻的状态亮
  function rdSyncLamp(book, st) {
    const lamp = document.getElementById('rd-lamp');
    if (!lamp) return;
    if (!rdCoopOn()) { lamp.hidden = true; return; }
    const now = new Date();
    const hr = now.getHours();
    const night = hr >= 22 || hr < 7;
    const show = night && (st === 'read' || st === 'wait' || st === 'done');
    lamp.hidden = !show;
    if (!show) return;
    const him = lamp.querySelector('.rd-lamp-him');
    if (him) him.classList.add('on');
    if ((hr === 23 && now.getMinutes() >= 30) || hr < 7) rdHabitLateNote(book);
  }
  // 23:30 后还开着书：每本书每夜只留一次灯
  function rdHabitLateNote(book) {
    if (!book) return;
    const day = rdTodayKey();
    if (book.lateNoteDay === day) return;
    book.lateNoteDay = day;
    const list = readIndex();
    const fb = rdFindBook(book.id, list);
    if (fb) { fb.lateNoteDay = day; saveIndex(list); }
    rdToast('灯我留着，明天再读也一样。');
  }

  // ===== 此刻同读 =====
  // 他的阅读时间由我的操作触发（rdBuddyAdvance 只在翻页 / 离开阅读器 / 打开小卡时被调用，
  // 记进小时表的时间也是我的操作时刻），所以「两人最近阅读时间落在同一窗口」这条判定
  // 在这个模型里恒成立，拿时间戳比没有意义。改用会话内计时：这次坐下来读满十分钟、
  // 且他确实处在「共读中」（没在前面等我、没读完、不是今天不读），才算此刻同读。
  const RD_TOG_MIN_MS = 10 * 60 * 1000;
  const RD_TOG_CHAP_MS = 15 * 60 * 1000;
  const RD_TOG_SPINE_STEP = 3;
  const RD_TOG_SPINE_MAX = 5;
  const RD_TOG_LINE = '这一章我们一起翻过去的。';
  let rdTogLogged = false;
  let rdTogNoteLogged = false;
  let rdTogTimer = 0;

  function rdTogetherOn(book) {
    const s = rdHabitSession;
    if (!rdCoopOn() || !s || !book) return false;
    if (Date.now() - s.start < RD_TOG_MIN_MS) return false;
    return rdBuddyState(book) === 'read';
  }
  function rdTogCount(book) {
    return Math.max(0, Number(book && book.togCount) || 0);
  }
  // 每累计三次同读，书脊多一道细纹；封顶五道，不让书脊画花
  function rdTogSpine(book) {
    if (!rdCoopOn()) return 0;
    return Math.min(RD_TOG_SPINE_MAX, Math.floor(rdTogCount(book) / RD_TOG_SPINE_STEP));
  }
  // 一次阅读会话只计一次：按翻页数累加的话，读得快的人一晚上就能把书脊长满
  function rdTogTick(book) {
    if (rdTogLogged || !book) return;
    if (!rdTogetherOn(book)) return;
    rdTogLogged = true;
    book.togCount = rdTogCount(book) + 1;
  }
  // 停在某一页读够十分钟时页脚要自己亮起来，不能只在翻页那一刻才算
  function rdTogWatchStart() {
    rdTogWatchStop();
    if (!rdCoopOn()) return;
    rdTogTimer = setInterval(function () {
      if (!rdBook) { rdTogWatchStop(); return; }
      rdUpdateBar();
    }, 60000);
  }
  function rdTogWatchStop() {
    if (rdTogTimer) { clearInterval(rdTogTimer); rdTogTimer = 0; }
  }
  // 同读满十五分钟再往下翻章：他在刚读完那一章的末尾留一句。
  // 这句说的就是「刚翻过去的那一章」，所以锚在旧章末尾，往回翻才看得到。
  function rdTogChapterNote(b) {
    if (!rdCoopOn() || !b || rdTogNoteLogged) return;
    const s = rdHabitSession;
    if (!s || Date.now() - s.start < RD_TOG_CHAP_MS) return;
    if (rdNightGuard()) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book || !rdTogetherOn(book)) return;
    const ch = b.ch;
    const done = Array.isArray(book.togChaps) ? book.togChaps : [];
    if (done.indexOf(ch) >= 0) return;
    const sents = b.sents || [];
    const last = sents[sents.length - 1];
    if (!last) return;
    // 一次会话最多留一句：连续读五章不该在五章末尾各留一句
    rdTogNoteLogged = true;
    book.togChaps = done.concat([ch]).slice(-40);
    saveIndex(list);
    const item = {
      id: 'tg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      by: 'his',
      s: last.s,
      e: last.e,
      quote: last.quote,
      text: RD_TOG_LINE,
      at: Date.now(),
      rev: 1,
      deviceId: 'local'
    };
    getAnnos(b.id, ch).then(function (arr) {
      const annos = Array.isArray(arr) ? arr : [];
      annos.push(item);
      return putAnnos(b.id, ch, annos);
    }).then(function () {
      const fresh = readIndex();
      const fb = rdFindBook(b.id, fresh);
      if (fb) { fb.annoCount = (Number(fb.annoCount) || 0) + 1; saveIndex(fresh); }
      rdToast('他在上一章的末尾留了一句。');
    }).catch(function () {});
  }

  // ===== 翻页被看见 =====
  // 他记得我读得快还是慢：同一页停很久、或短时间内连翻很多页，各会被他记住一次。
  // 判定只用本地翻页时间戳，不记任何内容；每章各回应一次，回应落在章末与那张纸条上。
  const RD_PACE_SLOW_MS = 90 * 1000;
  const RD_PACE_FAST_MS = 10 * 1000;
  const RD_PACE_FAST_FLIPS = 5;
  const RD_PACE_SLOW_LINE = '这一页你停了很久。';
  const RD_PACE_FAST_LINE = '你翻得好快，是不是在找我？';
  let rdPaceKey = '';
  let rdPaceEnterAt = 0;
  let rdPacePrev = null;
  let rdPaceFlips = [];

  function rdPaceReset() {
    rdPaceKey = '';
    rdPaceEnterAt = Date.now();
    rdPacePrev = null;
    rdPaceFlips = [];
  }
  // 切后台不算「停在这一页」：回前台重新开始计时，和折角书签那 30 秒同一个口径
  function rdPacePause() { rdPaceEnterAt = 0; }
  function rdPaceResume() { if (rdBook) rdPaceEnterAt = Date.now(); }

  // 节奏记录按章各存一份；换到别的章就重开一格，回来重读还能再被看见一次
  function rdPaceSlot(book, ch) {
    const old = book.pace;
    if (old && old.ch === ch) return old;
    return { ch: ch, slow: 0, slowUsed: 0, slowS: 0, slowE: 0, fast: 0, fastUsed: 0 };
  }
  function rdPaceMarkSlow(b, prev) {
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    const slot = rdPaceSlot(book, prev.ch);
    if (slot.slow) return;
    slot.slow = Date.now();
    slot.slowS = prev.s;
    slot.slowE = prev.e;
    book.pace = slot;
    saveIndex(list);
  }
  function rdPaceMarkFast(b) {
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    const slot = rdPaceSlot(book, b.ch);
    if (slot.fast) return;
    slot.fast = Date.now();
    slot.fastUsed = 0;
    book.pace = slot;
    saveIndex(list);
  }
  // 只在真正翻页时结算一次：同一页重绘（换字号、浮层关掉后补画）不算翻页
  function rdMarkPagePace() {
    const b = rdBook;
    if (!b || !b.pages.length) return;
    const now = Date.now();
    const key = b.ch + ':' + b.pageIdx;
    if (key === rdPaceKey) return;
    const prev = rdPacePrev;
    if (prev && prev.ch === b.ch && rdPaceEnterAt && now - rdPaceEnterAt >= RD_PACE_SLOW_MS) {
      rdPaceMarkSlow(b, prev);
    }
    const p = b.pages[b.pageIdx] || { s: 0, e: 0 };
    rdPacePrev = { ch: b.ch, s: p.s, e: p.e };
    rdPaceKey = key;
    rdPaceEnterAt = now;
    rdPaceFlips.push(now);
    while (rdPaceFlips.length > RD_PACE_FAST_FLIPS) rdPaceFlips.shift();
    if (rdPaceFlips.length >= RD_PACE_FAST_FLIPS &&
        rdPaceFlips[rdPaceFlips.length - 1] - rdPaceFlips[0] <= RD_PACE_FAST_MS) {
      rdPaceMarkFast(b);
    }
  }
  // 只在章末那一页给感想；同读优先，这里只管翻页节奏
  function rdPaceNote(book, b) {
    if (!rdCoopOn() || !book || !b || !b.pages.length) return '';
    if (b.pageIdx !== b.pages.length - 1) return '';
    const pace = book.pace;
    if (!pace || pace.ch !== b.ch) return '';
    if (pace.slow) return '这页你停了很久';
    if (pace.fast) return '你翻得好快，是不是在找我？';
    return '';
  }

  // ===== 错过七天：他写下，又划掉了 =====
  // 他某条批注放满七天我还没读到，等我真读到那句时，旧句被划掉、换成他现在的句子。
  // 旧句留成淡字，点一下他有概率回一句「你看到这个了？」。
  const RD_MISS_DAYS = 7;
  const RD_MISS_REPLY_CHANCE = 0.6;
  const RD_MISS_REPLY_LINE = '你看到这个了？';
  let rdCrossKey = '';

  async function rdCrossOldAnnos(book) {
    if (!rdCoopOn()) return;
    const b = rdBook;
    if (!b || !book || !b.pages.length) return;
    if (rdNightGuard()) return;
    const ch = b.ch;
    const key = b.id + '|' + ch + '|' + b.pageIdx;
    if (rdCrossKey === key) return; // 同一页只扫一次，别每翻一页都整章读批注
    rdCrossKey = key;
    let annos = [];
    try { annos = await getAnnos(book.id, ch); } catch (e) { return; }
    if (!rdBook || rdBook !== b) return;
    if (!Array.isArray(annos) || !annos.length) return;
    const now = Date.now();
    const DAY = 86400000;
    const myEnd = (b.pages[b.pageIdx] || {}).e || 0;
    const freshList = [];
    let dirty = false;
    const next = annos.map(function (a) {
      if (!a || a.by === 'me' || a.crossedAt) return a;
      if (!a.at || now - a.at < RD_MISS_DAYS * DAY) return a;
      if ((Number(a.e) || 0) > myEnd) return a; // 我还没读到这一句
      const t = rdHisText(book);
      if (!t || t === a.text) return a;
      freshList.push(t);
      dirty = true;
      return Object.assign({}, a, {
        text: t,
        oldText: a.text,
        oldAt: a.at,
        crossedAt: now
      });
    });
    if (!dirty) return;
    try { await putAnnos(book.id, ch, next); } catch (e) { return; }
    if (!rdBook || rdBook !== b) return;
    b.anno = next;
    const freshIdx = readIndex();
    const fb = rdFindBook(b.id, freshIdx);
    if (fb) {
      const used = Array.isArray(fb.buddyTexts) ? fb.buddyTexts : [];
      for (let i = 0; i < freshList.length; i++) used.push(rdCardKey(freshList[i]));
      fb.buddyTexts = used.slice(-200);
      saveIndex(freshIdx);
    }
    // 正在看这一页就把划掉的旧句画出来
    const pop = document.getElementById('rd-anno-pop');
    if (pop && !pop.hidden) rdDeferPaint = true;
    else rdPaintPage();
  }
  // 点开旧句：他有概率接一句，同一条只回应一次
  async function rdMissReply(id) {
    if (!rdCoopOn()) return;
    const b = rdBook;
    if (!b || !id) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    const seen = Array.isArray(book.missSeen) ? book.missSeen : [];
    if (seen.indexOf(id) >= 0) return;
    book.missSeen = seen.concat([id]).slice(-60);
    saveIndex(list);
    if (Math.random() > RD_MISS_REPLY_CHANCE) return;
    const ch = b.ch;
    const annos = await getAnnos(b.id, ch);
    if (!rdBook || rdBook !== b) return;
    const arr = Array.isArray(annos) ? annos : [];
    const src = arr.filter(function (a) { return a && a.id === id; })[0];
    if (!src) return;
    if (arr.some(function (a) { return a && a.replyTo === id; })) return;
    const item = {
      id: 'mr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      by: 'his',
      s: src.s,
      e: src.e,
      quote: src.quote,
      text: RD_MISS_REPLY_LINE,
      at: Date.now(),
      rev: 1,
      deviceId: 'local',
      replyTo: id
    };
    const next = arr.concat([item]);
    try { await putAnnos(b.id, ch, next); } catch (e) { return; }
    if (!rdBook || rdBook !== b) return;
    b.anno = next;
    const fresh = readIndex();
    const fb = rdFindBook(b.id, fresh);
    if (fb) { fb.annoCount = (Number(fb.annoCount) || 0) + 1; saveIndex(fresh); }
    rdPaintPage();
    if (rdPopPos >= 0) rdOpenPop(rdPopPos, true);
  }

  // 进度真值只存「章 + 章内字符偏移」，页码只是展示值：换字号/换屏幕后仍能落回同一句话。
  // 翻页时 300ms 防抖写入，离开阅读器时立即落盘，避免连翻时反复写索引。
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
    // 他的进度是另一份真值：这里只推进 buddy，绝不用我的 progress 覆盖他的 ch/off
    rdBuddyAdvance(book);
    rdTogTick(book);
    saveIndex(list);
    // 我的进度越过某句封存纸条的句尾时，纸条展开成普通批注
    rdUnlockSealed(book).catch(function () {});
    // 读到哪一页就扫哪一页：放满七天的旧句在这一页被划掉
    rdCrossOldAnnos(book).catch(function () {});
  }

  // ===== 他在哪：两份独立的进度真值 =====
  // 我和他各存一份「章 + 章内偏移」，谁也不覆盖谁。跟随只是他推进的一种规则，
  // 不是把两个人的进度绑成同一个值：
  //   follow：落后就追到我的位置，超到我前面就停下来等；
  //   solo  ：按自己的阅读速度往前走，允许明显超过我，也允许落在我后面；
  //   skip  ：今天不读，第二天自动恢复原模式。
  // 由此得到的展示闸门：他读得比我快时，写在我还没读到那部分页里的批注不会
  // 提前出现在正文中，只有我翻到那一页才浮现（见 rdBuddyAnnoVisible）。
  const RD_CHARS_PER_MIN = 420;
  const RD_CATCHUP_MAX_MS = 30 * 60 * 1000;
  // 折角书签：每次打开书最多播一次的展示状态，不影响任何进度真值。
  // 每天最多两次，跨天按本地 0 点重置；计数随书架索引进备份。
  const RD_BOOKMARK_DAILY = 2;
  const RD_BOOKMARK_WAIT_MS = 30000;
  const RD_BOOKMARK_LINES = [
    '我先往前走了几步，在这儿等你。',
    '书签给你夹回去了。',
    '别急，我在前面慢慢走。'
  ];
  let rdBookmarkPlayed = false;
  let rdBookmarkWaitTimer = 0;
  let rdBookmarkWaitPage = '';
  let rdBookmarkCopyIdx = 0;

  function rdTodayKey(ts) {
    const d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function rdTotalWords(book) {
    const cw = book && Array.isArray(book.chWords) ? book.chWords : null;
    if (!cw || !cw.length) return 0;
    let t = 0;
    for (let i = 0; i < cw.length; i++) t += cw[i] || 0;
    return t;
  }
  // 章 + 章内偏移 ↔ 全书第几个字：只做换算，不改任何状态
  function rdFlatPos(book, ch, off) {
    const cw = book && Array.isArray(book.chWords) ? book.chWords : [];
    let flat = 0;
    for (let i = 0; i < ch && i < cw.length; i++) flat += cw[i] || 0;
    if (ch < cw.length) flat += Math.max(0, Math.min(Number(off) || 0, cw[ch] || 0));
    return flat;
  }
  function rdPosFromFlat(book, flat) {
    const cw = book && Array.isArray(book.chWords) ? book.chWords : [];
    let left = Math.max(0, Number(flat) || 0);
    for (let i = 0; i < cw.length; i++) {
      const n = cw[i] || 0;
      if (left < n || i === cw.length - 1) return { ch: i, off: Math.min(left, n) };
      left -= n;
    }
    return { ch: 0, off: 0 };
  }
  function rdPosPct(book, ch, off) {
    const total = rdTotalWords(book);
    if (!total) return 0;
    return Math.max(0, Math.min(100, (rdFlatPos(book, ch, off) / total) * 100));
  }
  function rdBuddyGet(book) {
    if (!book) return null;
    if (!book.buddy || typeof book.buddy !== 'object') {
      book.buddy = { mode: 'follow', ch: 0, off: 0, started: false, waiting: false, updatedAt: Date.now(), carry: 0 };
    }
    const bd = book.buddy;
    if (!bd.mode) bd.mode = 'follow';
    if (typeof bd.ch !== 'number') bd.ch = 0;
    if (typeof bd.off !== 'number') bd.off = 0;
    if (typeof bd.carry !== 'number') bd.carry = 0;
    return bd;
  }
  // 只推进他和书的状态；调用方负责 saveIndex
  function rdBuddyAdvance(book) {
    const bd = rdBuddyGet(book);
    if (!bd) return null;
    const now = Date.now();
    // 共读关闭时冻结他的位置，只把时间戳拨到现在，重新打开不补算关闭期间的阅读
    if (!rdCoopOn()) { bd.updatedAt = now; return bd; }
    // 今天不读：跨天自动恢复原模式，当天只记更新时间
    if (bd.mode === 'skip') {
      if (bd.skipDay === rdTodayKey(now)) { bd.updatedAt = now; return bd; }
      bd.mode = bd.prevMode === 'solo' ? 'solo' : 'follow';
      bd.skipDay = '';
      bd.updatedAt = now;
    }
    // 他还没翻开：等我第一次打开这本书时再起步
    if (!bd.started) return bd;
    const total = rdTotalWords(book);
    if (!total) return bd;
    const prog = book.progress || {};
    const mine = rdFlatPos(book, Number(prog.ch) || 0, Number(prog.off) || 0);
    let his = rdFlatPos(book, bd.ch, bd.off);
    if (bd.mode === 'solo') {
      // 按离开时长推进，单次最多补 30 分钟，避免隔夜一口气读完整本
      const prevAt = bd.updatedAt || now;
      const dt = Math.max(0, Math.min(now - prevAt, RD_CATCHUP_MAX_MS));
      const ms = (bd.carry || 0) + dt;
      const units = Math.floor(ms / 60000);
      bd.carry = ms - units * 60000;
      const nextHis = Math.min(total, his + units * RD_CHARS_PER_MIN);
      // 他独立读掉的这一段也记进习惯（只记时长与估算页数，不记内容）
      if (units > 0) {
        const words = Math.max(0, nextHis - his);
        const pages = words > 0 ? Math.max(1, Math.round(words / 500)) : 0;
        rdHabitAdd('him', units * 60, pages, new Date(prevAt).getHours(), now);
      }
      his = nextHis;
      bd.waiting = false;
    } else {
      if (his < mine) his = mine; // 跟随：追上来，但不往回退
      bd.waiting = his > mine;    // 超到我前面就停下来等
    }
    const pos = rdPosFromFlat(book, Math.min(his, total));
    bd.ch = pos.ch;
    bd.off = pos.off;
    bd.updatedAt = now;
    book.status = his >= total ? 'done' : 'co';
    return bd;
  }
  function rdBuddyState(book) {
    const bd = rdBuddyGet(book);
    if (!bd) return 'none';
    if (!bd.started) return 'none';
    if (bd.mode === 'skip' && bd.skipDay === rdTodayKey(Date.now())) return 'skip';
    const total = rdTotalWords(book);
    const his = rdFlatPos(book, bd.ch, bd.off);
    if (total && his >= total) return 'done';
    const prog = book.progress || {};
    const mine = rdFlatPos(book, Number(prog.ch) || 0, Number(prog.off) || 0);
    if (his > mine) return 'wait';
    return 'read';
  }
  const RD_BUDDY_STATE_TEXT = {
    none: '还没开始', read: '共读中', wait: '停在这等你', done: '读完了', skip: '今天不读'
  };
  // 文案池按状态分组；同一天内固定取同一条，跨天自然轮换
  const RD_BUDDY_LINES = {
    none: ['还没翻开这本书。', '他把书放在那儿，等你一起。', '书还合着，他也没动。'],
    read: ['他在你旁边一页一页看。', '他刚翻过一页。', '他跟着你的速度往下读。'],
    wait: ['他停在前面等你。', '他先读到前面去了，正等着你。', '他在前面那页等你跟上来。'],
    done: ['他先读完了，在最后一页等你。', '他合上书，等你读完。', '他已经读到最后一页了。'],
    skip: ['他今天不读。', '他说今天先歇着。', '今天不翻书，明天再继续。']
  };
  function rdBuddyLine(book, state) {
    const pool = RD_BUDDY_LINES[state] || RD_BUDDY_LINES.read;
    const seed = String((book && book.id) || '') + '|' + state + '|' + rdTodayKey(Date.now());
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return pool[Math.abs(h) % pool.length];
  }
  // 他的批注只在「我读到的那一页」浮现；我的批注不受这个闸门影响。
  // 封存纸条（sealed）一律先挡住，等 rdUnlockSealed 把我的进度越过后再放行。
  function rdBuddyAnnoVisible(a, pageStart, pageEnd) {
    if (!a) return false;
    if (a.by === 'me') return true;
    if (!rdCoopOn()) return false;
    if (a.sealed) return false;
    return a.e > pageStart && a.e <= pageEnd;
  }
  // 批注归属哪一句：取与批注区间重叠最多的一句；重叠不到批注长度的一半，视为跨句失配。
  // 他的批注锚在整句上，我的批注可能只是句中的半句，所以用「批注自身长度」作分母。
  function rdAnnoSentIdx(sents, a) {
    if (!a || !sents || !sents.length) return -1;
    const s = Math.max(0, Number(a.s) || 0);
    const e = Math.max(s + 1, Number(a.e) || (s + 1));
    let best = -1;
    let bestOv = 0;
    for (let i = 0; i < sents.length; i++) {
      const sn = sents[i];
      if (!sn || sn.e <= s) continue;
      if (sn.s >= e) break;
      const ov = Math.min(e, sn.e) - Math.max(s, sn.s);
      if (ov > bestOv) { bestOv = ov; best = i; }
    }
    if (best < 0) return -1;
    return bestOv >= (e - s) / 2 ? best : -1;
  }
  // 同一句里两人都留过批注的组：绘制时合并成一个句尾双圈；其余批注仍各占自己的结尾偏移。
  function rdAnnoGroups(sents, annos) {
    const map = {};
    (annos || []).forEach(function (a) {
      if (!a) return;
      const idx = rdAnnoSentIdx(sents, a);
      if (idx < 0) return;
      const g = map[idx] || (map[idx] = { idx: idx, mine: false, his: false, list: [] });
      g.list.push(a);
      if (a.by === 'me') g.mine = true;
      else g.his = true;
    });
    return map;
  }
  // 点角标时该位置要展示的批注：双圈组按整句取，其余按结尾偏移取。
  function rdAnnosAtPos(b, pos) {
    const out = [];
    const seen = new Set();
    const sents = (b && b.sents) || [];
    const all = (b && b.anno) || [];
    const annos = rdCoopOn() ? all : all.filter(function (a) { return a && a.by === 'me'; });
    const groups = rdAnnoGroups(sents, annos);
    Object.keys(groups).forEach(function (k) {
      const g = groups[k];
      const sn = sents[g.idx];
      if (!sn || !(g.mine && g.his) || sn.e !== pos) return;
      g.list.forEach(function (a) {
        if (!a || seen.has(a)) return;
        seen.add(a);
        out.push(a);
      });
    });
    annos.forEach(function (a) {
      if (!a || a.e !== pos || seen.has(a)) return;
      seen.add(a);
      out.push(a);
    });
    return out.sort(function (x, y) { return (x.at || 0) - (y.at || 0); });
  }

  // ===== 读过的痕迹（淡痕 + 同句双圈）=====
  // 总开关跟随字卡库「共读批注」分类：整组停用、逐张关光、二级密码锁或概率 0% 时，
  // 淡痕与双圈一起关闭，不另设入口。
  function rdTraceEnabled() {
    if (!rdCoopOn()) return false;
    if (rdDcfRatio() <= 0) return false;
    const pool = rdLibPool('anno');
    return pool === null ? true : pool.length > 0;
  }
  // 他在这一章读到第几个字：返回 -1 表示还没读到这一章
  function rdBuddyReadOff(book, ch, textLen) {
    const bd = rdBuddyGet(book);
    if (!bd || !bd.started) return -1;
    if (bd.mode === 'skip' && bd.skipDay === rdTodayKey(Date.now())) return -1;
    if (bd.ch > ch) return textLen;
    if (bd.ch === ch) return Math.max(0, Math.min(bd.off, textLen));
    return -1;
  }

  function rdCloseBuddyCard() {
    const el = document.getElementById('rd-buddy-card');
    if (el) el.hidden = true;
  }
  // 他在那一章读到第几页：不同章按需读正文再分页，不复用我当前页的页码
  async function rdBuddyPageText(book, bd) {
    const b = rdBook;
    if (!b) return '';
    let text = b.cache[bd.ch];
    if (text == null) text = await getBody(b.id, bd.ch);
    if (!rdBook || rdBook !== b || !text) return '';
    const pages = rdPaginateText(b, bd.ch, text);
    return '第 ' + (rdPageForOffset(pages, bd.off) + 1) + ' 页';
  }
  async function rdOpenBuddyCard() {
    if (!rdCoopOn()) { rdToast('共读已关闭'); return; }
    const b = rdBook;
    if (!b) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    rdBuddyAdvance(book);
    saveIndex(list);
    // 小卡里的位置是按当前时间算出来的新真值，进度条上的圆点要同步重画，
    // 否则会出现「卡片说他往前走了，圆点还停在原处」的错位。
    rdUpdateBar();
    const bd = rdBuddyGet(book);
    const st = rdBuddyState(book);
    const card = document.getElementById('rd-buddy-card');
    const avEl = document.getElementById('rd-buddy-av');
    const stateEl = document.getElementById('rd-buddy-state');
    const posEl = document.getElementById('rd-buddy-pos');
    const nearEl = document.getElementById('rd-buddy-near');
    const modes = document.getElementById('rd-buddy-modes');
    const jump = document.getElementById('rd-buddy-jump');
    const myOff = (b.pages[b.pageIdx] || { s: 0 }).s;
    const mine = rdFlatPos(book, b.ch, myOff);
    const his = rdFlatPos(book, bd.ch, bd.off);
    const chName = (b.toc[bd.ch] && b.toc[bd.ch].t) || ('第 ' + (bd.ch + 1) + ' 章');
    if (stateEl) stateEl.textContent = RD_BUDDY_STATE_TEXT[st] + ' · ' + rdBuddyLine(book, st);
    if (avEl) avEl.classList.toggle('on', rdTogetherOn(book));
    if (posEl) {
      const pageTxt = st === 'none' || st === 'skip' ? '' : await rdBuddyPageText(book, bd);
      posEl.textContent = st === 'none' ? '' :
        (his > mine ? '他在前面，读到 ' : '他在 ') + chName + (pageTxt ? ' · ' + pageTxt : '');
    }
    if (modes) {
      modes.querySelectorAll('[data-bmode]').forEach(function (btn) {
        const m = btn.getAttribute('data-bmode');
        const cur = bd.mode === 'skip' && bd.skipDay === rdTodayKey(Date.now()) ? 'skip' : bd.mode;
        btn.classList.toggle('on', m === cur);
      });
    }
    if (jump) {
      // 防剧透硬规则：他在我前面时只显示位置，不给跳转入口
      jump.hidden = !(st === 'read' || st === 'wait' || st === 'done') || his >= mine;
    }
    if (nearEl) {
      nearEl.textContent = '';
      let arr = bd.ch === b.ch ? (b.anno || []) : await getAnnos(b.id, bd.ch);
      if (!rdBook || rdBook !== b) return;
      const n = (arr || []).filter(function (a) {
        return a && a.by !== 'me' && Math.abs((a.e || 0) - bd.off) <= 5000;
      }).length;
      if (n) nearEl.textContent = '这附近他留了 ' + n + ' 条批注';
    }
    const habitEl = document.getElementById('rd-buddy-habit');
    if (habitEl) habitEl.textContent = rdHabitObs(book);
    if (!rdBook || rdBook !== b) return;
    if (card) card.hidden = false;
  }
  function rdBuddySetMode(mode) {
    if (!rdCoopOn()) return;
    const b = rdBook;
    if (!b) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    const bd = rdBuddyGet(book);
    if (mode === 'skip') {
      if (bd.mode !== 'skip') bd.prevMode = bd.mode;
      bd.mode = 'skip';
      bd.skipDay = rdTodayKey(Date.now());
    } else {
      bd.mode = mode === 'solo' ? 'solo' : 'follow';
      bd.skipDay = '';
      bd.prevMode = '';
    }
    bd.updatedAt = Date.now();
    bd.carry = 0;
    if (bd.mode !== 'solo') rdBuddyAdvance(book);
    if (saveIndex(list)) {
      rdUpdateBar();
      rdOpenBuddyCard();
      rdRenderShelf();
    }
  }
  function rdJumpToBuddy() {
    if (!rdCoopOn()) { rdToast('共读已关闭'); return; }
    const b = rdBook;
    if (!b) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    rdBuddyAdvance(book);
    const bd = rdBuddyGet(book);
    const myOff = (b.pages[b.pageIdx] || { s: 0 }).s;
    if (rdFlatPos(book, bd.ch, bd.off) >= rdFlatPos(book, b.ch, myOff)) {
      rdToast('他在前面，不跳过去');
      return;
    }
    rdCloseBuddyCard();
    saveIndex(list);
    if (bd.ch !== b.ch) {
      b.ch = bd.ch;
      b.off = bd.off;
      b.pageIdx = 0;
      rdEnsureChapter('offset');
    } else {
      b.pageIdx = rdPageForOffset(b.pages, bd.off);
      rdRenderPage();
    }
  }

  // ===== 他的批注：按需生成 / 待回应队列 =====
  // 两条硬前提：
  //   1. 不预生成全书。只有「他自己那份进度确实读到了这一句」时，才可能在那一页留一张纸条；
  //      独立推进时他读得比我快，纸条会先落在还没读到的章节里，由 rdBuddyAnnoVisible 挡住，
  //      等我翻到那一页才浮现。
  //   2. 回应不是即时的。我写下的批注进 book.replyQueue，下次打开且他的位置越过那句时才掷一次骰子，
  //      没中就一直安静留着；他未开始、今天不读、停在这等你时都不回应。
  const RD_HIS_PER_CH = 3;      // 每章最多 3 条
  const RD_HIS_GAP = 8;         // 同章两条之间至少隔 8 句
  const RD_HIS_CHANCE = 0.45;   // 翻到一页时他留下新批注的概率
  const RD_REPLY_CHANCE = 0.62; // 越过那句之后真正回应的概率（允许一部分永远安静）
  const RD_REPLY_MAX = 2;       // 每次打开最多回应 2 条
  // 封存一句：他先读到、折起来，等我读到才展开。只在他独立推进时生成。
  const RD_SEAL_PER_BOOK = 3;   // 每本同时最多 3 条
  const RD_SEAL_CHANCE = 0.55;  // 每天最多一条，但不是每天都有
  const RD_SEAL_WAIT_DAYS = 7;  // 七天没解锁，手账改口「他还在等」
  const RD_SEAL_DROP_DAYS = 14; // 十四天收回
  let rdSealBusy = false;
  let rdUnlockBusy = false;

  const RD_HIS_ANNO_POOL = [
    '这里我停了一下。',
    '读到这句的时候，周围正好安静下来。',
    '我也想过一样的事。',
    '这句我想抄下来。',
    '原来你也会被这种句子留住。',
    '这一句读得很慢。',
    '这里让人想起很旧的一个下午。',
    '我把这句又读了一遍。',
    '写这句话的人，大概也在犹豫。',
    '这里适合合上书想一会儿。',
    '读到这儿，忽然不想往下翻了。',
    '这句轻，但落得很深。',
    '我喜欢这里的停顿。',
    '这一句有光。',
    '像是有人替我把话说完了。',
    '这里我先记住了。',
    '读完这句，安静了一会儿。',
    '这句让我想起你之前说过的话。',
    '读到这里，心里空了一下。',
    '这一段值得慢一点。'
  ];
  const RD_HIS_REPLY_POOL = [
    '嗯，我也这么想。',
    '你标在这里的这句，我也停下来看了。',
    '原来你注意的是这里。',
    '这句被你圈出来之后，更好看了。',
    '我读到这里的时候，想的是同一件事。',
    '你写的这句，我收下了。',
    '是这个感觉。',
    '我也在这句旁边待了一会儿。',
    '被你这么一说，我又回头看了一遍。',
    '嗯，这里确实值得留一张纸条。'
  ];
  // 候选句偏向有情绪或有画面的句子：标点、引号、以及常见的感受词各加一点分
  const RD_HIS_WORDS = ('突然 忽然 眼泪 哭 笑 心跳 声音 安静 温柔 孤独 等待 记得 想起 喜欢 害怕 ' +
    '离开 回来 风 光 夜 雨 雪 窗 路 名字 再见 后来 原来 终于 轻轻 慢慢').split(' ');

  // 夜间免打扰开着时，他不在书里新留纸条，也不回应（已有批注照常显示）
  function rdNightGuard() {
    try { return !!(window.nightModeActive && window.nightModeActive()); } catch (e) { return false; }
  }
  // 字卡库「共读批注」分类的概率闸（默认 100% = 保持原节奏，0% = 他不再留纸条/回应）。
  // dcfGet 已套「系统预设字卡总档」与总开关，与其余功能字卡的取数口径一致。
  function rdDcfRatio() {
    try {
      if (window.dcfGet) {
        const v = Number(window.dcfGet('reading'));
        if (!isNaN(v)) return Math.max(0, Math.min(100, v)) / 100;
      }
    } catch (e) {}
    return 1;
  }

  // 章内断句：与选句共用同一套句末字符，保证「他锚定的句子」和我长按选到的是同一句
  function rdSentenceList(text) {
    const src = String(text || '');
    const out = [];
    const n = src.length;
    let s = 0;
    while (s < n) {
      let e = s;
      while (e < n && RD_SENT_END.indexOf(src[e]) < 0) e++;
      if (e < n) {
        e++;
        while (e < n && RD_SENT_TAIL.indexOf(src[e]) >= 0) e++;
      }
      let a = s;
      let z = e;
      while (a < z && /\s/.test(src[a])) a++;
      while (z > a && /\s/.test(src[z - 1])) z--;
      if (z > a) out.push({ s: a, e: z, quote: src.slice(a, z) });
      s = e > s ? e : s + 1;
    }
    return out;
  }
  // 偏移落在第几句：返回最后一句满足 e <= off 的下标
  function rdSentIndexAt(sents, off) {
    let lo = 0;
    let hi = sents.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sents[mid].e <= off) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }
  // 一句的「可做批注」分值；0 表示太短太长或太素，不选
  function rdHisScore(q) {
    const t = String(q || '');
    if (t.length < 8 || t.length > 80) return 0;
    let sc = 0;
    if (/[！？…]/.test(t)) sc += 2;
    if (/[“”「」『』]/.test(t)) sc += 1;
    if (/[，、；：]/.test(t)) sc += 1;
    for (let i = 0; i < RD_HIS_WORDS.length; i++) if (t.indexOf(RD_HIS_WORDS[i]) >= 0) sc += 1;
    return sc;
  }
  // 取字卡库「共读批注」分类的组内容。只要数据文件里确有 reading 分类，就完全信任
  // getLibPool 的结果——逐张关光 / 整组停用 / 二级密码锁时它返回空数组，此时不能回落内置池
  // （否则刚关掉的句子又会被它捡回来）。只有数据文件缺这一分类时才返回 null，由调用方用内置池。
  function rdLibPool(kind) {
    let hasData = false;
    try { hasData = !!(window.DEFAULT_CARD_DATA && Array.isArray(window.DEFAULT_CARD_DATA.reading)); } catch (e) {}
    if (!hasData || !window.getReadingAnnoCards) return null;
    try {
      const a = window.getReadingAnnoCards(kind);
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  // 他的批注文案：优先取字卡库的共读批注类，否则用内置池；
  // 同一本书里不重复同一条文案（只存短哈希，索引不会涨大）。
  function rdHisText(book) {
    let pool = rdLibPool('anno');
    if (pool === null) pool = RD_HIS_ANNO_POOL.slice();
    pool = pool.filter(function (t) {
      return typeof t === 'string' && t.trim() && t.trim().length <= 120;
    }).map(function (t) { return t.trim(); });
    if (!pool.length) return ''; // 全部关闭/锁定＝他不再留纸条
    const used = Array.isArray(book.buddyTexts) ? book.buddyTexts : [];
    let avail = pool.filter(function (t) { return used.indexOf(rdCardKey(t)) < 0; });
    if (!avail.length) avail = pool; // 池子用尽就允许复用，不因此断掉批注
    return avail[Math.floor(Math.random() * avail.length)];
  }
  function rdHisReplyText(book) {
    let pool = rdLibPool('reply');
    if (pool === null) pool = RD_HIS_REPLY_POOL.slice();
    pool = pool.filter(function (t) {
      return typeof t === 'string' && t.trim() && t.trim().length <= 500;
    }).map(function (t) { return t.trim(); });
    if (!pool.length) return '';
    const used = Array.isArray(book.buddyTexts) ? book.buddyTexts : [];
    let avail = pool.filter(function (t) { return used.indexOf(rdCardKey(t)) < 0; });
    if (!avail.length) avail = pool;
    return avail[Math.floor(Math.random() * avail.length)];
  }

  // 他此刻真正读到的位置：跟随模式下他就在我这一页旁边，按当前页末算；
  // 独立模式下只认他自己那份进度，允许落在我还没读到的章节里。
  function rdBuddyFrontier(book, b) {
    const bd = rdBuddyGet(book);
    let flat = rdFlatPos(book, bd.ch, bd.off);
    if (bd.mode !== 'solo') {
      const p = b.pages[b.pageIdx] || { e: 0 };
      const mineEnd = rdFlatPos(book, b.ch, p.e);
      if (mineEnd > flat) flat = mineEnd;
    }
    return flat;
  }

  let rdHisTryKey = '';
  let rdHisTimer = 0;
  // 翻到一页后静一下再决定要不要留纸条：不打断阅读，也不在每页都必然出现
  function rdScheduleHisAnno() {
    clearTimeout(rdHisTimer);
    if (!rdCoopOn()) return;
    rdHisTimer = setTimeout(rdMaybeHisAnno, 850);
  }
  async function rdMaybeHisAnno(force) {
    if (!rdCoopOn()) return;
    const b = rdBook;
    if (!b || !b.pages.length) return;
    if (rdNightGuard()) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    rdBuddyAdvance(book);
    const bd = rdBuddyGet(book);
    const st = rdBuddyState(book);
    if (!bd.started || bd.mode === 'skip' || st === 'none' || st === 'done') return;
    const frontier = rdBuddyFrontier(book, b);
    if (frontier <= 0) return;
    // 翻页被看见：这一章里我停很久 / 翻太快，各给一次回应
    const pace = book.pace && book.pace.ch === b.ch ? book.pace : null;
    let paceKind = '';
    if (pace) {
      if (pace.slow && !pace.slowUsed) paceKind = 'slow';
      else if (pace.fast && !pace.fastUsed) paceKind = 'fast';
    }
    let at = rdPosFromFlat(book, frontier);
    // 正好停在章末时，换算会落到下一章第 0 字；按「刚读完上一章」处理，
    // 否则他永远没法在上一章结尾留纸条。
    if (at.off === 0 && at.ch > 0 && book.chWords && book.chWords[at.ch - 1]) {
      at = { ch: at.ch - 1, off: book.chWords[at.ch - 1] };
    }
    const key = b.id + '|' + b.ch + '|' + b.pageIdx + '|' + at.ch + '|' + at.off;
    if (!force) {
      if (key === rdHisTryKey) return;
      rdHisTryKey = key;
      // 回应翻页节奏不走概率：这是他看见我之后主动留的，不是随机掉落
      if (!paceKind && Math.random() > RD_HIS_CHANCE * rdDcfRatio()) return;
    }

    // 目标章可能是他读到的那一章，不一定是屏幕上这一章
    const targetCh = at.ch;
    const cur = targetCh === b.ch;
    let annos = cur ? (b.anno || []).slice() : null;
    if (!annos) annos = await getAnnos(b.id, targetCh);
    if (!rdBook || rdBook !== b) return;
    const hisArr = (annos || []).filter(function (a) { return a && a.by !== 'me'; });
    if (hisArr.length >= RD_HIS_PER_CH) return;

    let text = b.cache[targetCh];
    if (text == null) { text = await getBody(b.id, targetCh); }
    if (!rdBook || rdBook !== b) return;
    if (!text) return;
    if (cur) b.cache[targetCh] = text; // 只缓存当前章，别把整本都留在内存里
    const sents = rdSentenceList(text);
    if (!sents.length) return;
    // 轮到回应翻页节奏时不受他的前沿限制：慢读那页是我停过的，章尾也不会剧透到我还没读的地方
    const limit = paceKind ? text.length : Math.min(at.off, text.length);
    const occupied = hisArr.map(function (a) { return rdSentIndexAt(sents, a.e); });
    const taken = {};
    (annos || []).forEach(function (a) {
      if (a) taken[a.e] = 1; // 同一句不再叠第二张纸条
    });
    const pool = [];
    for (let i = 0; i < sents.length; i++) {
      const q = sents[i];
      if (q.e > limit) break;
      if (taken[q.e]) continue;
      // 快翻：把这张纸条藏到章尾，等我翻到最后才看见
      if (paceKind === 'fast' && i !== sents.length - 1) continue;
      // 慢读：只在我停过的那一页里挑
      if (paceKind === 'slow' && !(q.e > pace.slowS && q.s < pace.slowE)) continue;
      // 回应翻页节奏时不隔句：那一页可能只有两三句，隔八句就永远挑不到
      if (!paceKind) {
        let near = false;
        for (let k = 0; k < occupied.length; k++) {
          if (Math.abs(occupied[k] - i) < RD_HIS_GAP) { near = true; break; }
        }
        if (near) continue;
      }
      // 节奏回应用的是固定那句话，不依赖字卡场景，任何句子都能落
      const sc = paceKind ? 1 : rdHisScore(q.quote);
      if (sc > 0) pool.push({ idx: i, sc: sc, q: q });
    }
    if (!pool.length) return;
    pool.sort(function (x, y) { return y.sc - x.sc; });
    const top = pool.slice(0, 6);
    const pick = top[Math.floor(Math.random() * top.length)].q;
    const txt = rdHisText(book);
    if (!txt) return;
    const paceLine = paceKind === 'slow' ? RD_PACE_SLOW_LINE : (paceKind === 'fast' ? RD_PACE_FAST_LINE : '');
    const item = {
      id: 'an_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      by: 'his',
      s: pick.s,
      e: pick.e,
      quote: pick.quote,
      text: String(paceLine ? paceLine + '\n' + txt : txt).slice(0, 500),
      at: Date.now(),
      rev: 1,
      deviceId: 'local'
    };
    const next = (annos || []).slice();
    next.push(item);
    try { await putAnnos(b.id, targetCh, next); }
    catch (e) { return; } // 被动生成失败就静默跳过，下一页再试，不弹提示打断阅读
    if (!rdBook || rdBook !== b) return;
    if (cur) b.anno = next;
    const fresh = readIndex();
    const fb = rdFindBook(b.id, fresh);
    if (fb) {
      fb.annoCount = (Number(fb.annoCount) || 0) + 1;
      const used = Array.isArray(fb.buddyTexts) ? fb.buddyTexts : [];
      used.push(rdCardKey(item.text));
      fb.buddyTexts = used.slice(-200);
      // 这一章对这次翻页节奏的回应已经落地，不再重复
      if (paceKind && fb.pace && fb.pace.ch === b.ch) {
        if (paceKind === 'slow') fb.pace.slowUsed = 1;
        else fb.pace.fastUsed = 1;
      }
      saveIndex(fresh);
    }
    if (cur) {
      // 浮层正开着时不重绘，避免把正在看的纸条打断；记下来，等浮层关掉再补
      const pop = document.getElementById('rd-anno-pop');
      if (pop && !pop.hidden) rdDeferPaint = true;
      else rdPaintPage(); // 落在当前页才会被闸门放出来
    }
  }

  // ===== 封存一句：他先读到、折起来，等我读到才展开 =====
  // 只在独立推进下生成；纸条本身 sealed:true，展示闸门永远不放行，直到我的进度越过句尾。
  // 索引里只留 { id, ch, e, at } 给书架手账用，正文与批注仍走原来的分章键。
  async function rdSealText(book, ch) {
    const b = rdBook;
    if (b && b.id === book.id && b.ch === ch && b.text) return b.text;
    try { return String(await getBody(book.id, ch) || ''); } catch (e) { return ''; }
  }
  async function rdSealCandidate(book, bd) {
    const myCh = Number(book.progress && book.progress.ch) || 0;
    const myOff = Number(book.progress && book.progress.off) || 0;
    const hisCh = Number(bd.ch) || 0;
    const hisOff = Number(bd.off) || 0;
    if (!(hisCh > myCh || (hisCh === myCh && hisOff > myOff))) return null;
    // 从我的当前章开始找，最多往后看两章：太远的句子没有「等你读到」的实感
    const last = Math.min(hisCh, myCh + 2);
    for (let ch = myCh; ch <= last; ch++) {
      const text = await rdSealText(book, ch);
      if (!text) continue;
      const sents = rdSentenceList(text);
      if (!sents.length) continue;
      const limit = ch < hisCh ? text.length : Math.min(hisOff, text.length);
      const mineFrom = ch === myCh ? myOff : 0;
      let annos = [];
      try { annos = await getAnnos(book.id, ch); } catch (e) { annos = []; }
      const groups = rdAnnoGroups(sents, annos);
      const occupied = {};
      Object.keys(groups).forEach(function (k) { occupied[k] = true; });
      const pool = [];
      for (let i = 0; i < sents.length; i++) {
        const sn = sents[i];
        if (!sn) continue;
        if (sn.e <= mineFrom) continue;
        if (sn.e > limit) break;
        if (occupied[i]) continue;
        const sc = rdHisScore(sn.quote);
        if (sc > 0) pool.push({ ch: ch, sn: sn, sc: sc });
      }
      if (!pool.length) continue;
      pool.sort(function (x, y) { return y.sc - x.sc; });
      const top = pool.slice(0, 6);
      return top[Math.floor(Math.random() * top.length)];
    }
    return null;
  }
  async function rdMaybeSeal(book) {
    if (!rdCoopOn() || rdSealBusy || rdUnlockBusy || !book) return;
    if (rdNightGuard()) return;
    const bd = rdBuddyGet(book);
    if (!bd || !bd.started || bd.mode !== 'solo') return;
    if (rdDcfRatio() <= 0) return;
    const today = rdTodayKey();
    if (book.sealDay === today) return;
    if ((Array.isArray(book.sealed) ? book.sealed : []).length >= RD_SEAL_PER_BOOK) return;
    if (Math.random() > RD_SEAL_CHANCE) return; // 不是每天都有
    rdSealBusy = true;
    try {
      const cand = await rdSealCandidate(book, bd);
      if (!cand) return;
      const txt = rdHisText(book);
      if (!txt) return;
      const fresh0 = readIndex();
      if (!rdFindBook(book.id, fresh0)) return;
      const annos = await getAnnos(book.id, cand.ch);
      const item = {
        id: 'se_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        by: 'his',
        s: cand.sn.s,
        e: cand.sn.e,
        quote: cand.sn.quote,
        text: String(txt).slice(0, 500),
        at: Date.now(),
        rev: 1,
        deviceId: 'local',
        sealed: true
      };
      annos.push(item);
      try { await putAnnos(book.id, cand.ch, annos); } catch (e) { return; }
      const fresh = readIndex();
      const fb = rdFindBook(book.id, fresh);
      if (!fb) return;
      fb.sealDay = today;
      if (!Array.isArray(fb.sealed)) fb.sealed = [];
      fb.sealed.push({ id: item.id, ch: cand.ch, e: item.e, at: item.at });
      if (fb.sealed.length > RD_SEAL_PER_BOOK) fb.sealed = fb.sealed.slice(-RD_SEAL_PER_BOOK);
      const used = Array.isArray(fb.buddyTexts) ? fb.buddyTexts : [];
      used.push(rdCardKey(item.text));
      fb.buddyTexts = used.slice(-200);
      saveIndex(fresh);
      // 书架正开着就刷新手账；阅读器里不显示封存纸条，等我读到才展开
      const shelf = document.getElementById('rd-shelf');
      if (shelf && !shelf.hidden) rdRenderShelf();
    } finally {
      rdSealBusy = false;
    }
  }
  function rdRemoveSealedMeta(bookId, sealId) {
    try {
      const list = readIndex();
      const fb = rdFindBook(bookId, list);
      if (!fb || !Array.isArray(fb.sealed)) return;
      const before = fb.sealed.length;
      fb.sealed = fb.sealed.filter(function (x) { return x && x.id !== sealId; });
      if (fb.sealed.length !== before) saveIndex(list);
    } catch (e) {}
  }
  async function rdUnlockSealed(book) {
    if (!rdCoopOn() || rdUnlockBusy || rdSealBusy || !book || !Array.isArray(book.sealed) || !book.sealed.length) return;
    const myCh = Number(book.progress && book.progress.ch) || 0;
    const myOff = Number(book.progress && book.progress.off) || 0;
    const pending = book.sealed.filter(function (s) {
      if (!s) return false;
      const ch = Number(s.ch) || 0;
      return ch < myCh || (ch === myCh && Number(s.e) <= myOff);
    });
    if (!pending.length) return;
    rdUnlockBusy = true;
    try {
      for (let i = 0; i < pending.length; i++) {
        const s = pending[i];
        let annos = [];
        try { annos = await getAnnos(book.id, s.ch); } catch (e) { continue; }
        let hit = null;
        for (let j = 0; j < annos.length; j++) {
          if (annos[j] && annos[j].id === s.id && annos[j].sealed) { hit = annos[j]; break; }
        }
        if (!hit) { rdRemoveSealedMeta(book.id, s.id); continue; }
        hit.sealed = false;
        hit.unlockedAt = Date.now();
        try { await putAnnos(book.id, s.ch, annos); } catch (e) { continue; }
        rdRemoveSealedMeta(book.id, s.id);
        if (rdBook && rdBook.id === book.id && rdBook.ch === s.ch) {
          // 当前章内存里的批注可能是封存版本，也可能是纸条写入之前读的旧数组：
          // 两种都要补成已展开的版本，否则重绘拿不到它。
          let found = false;
          for (let k = 0; k < rdBook.anno.length; k++) {
            if (rdBook.anno[k] && rdBook.anno[k].id === hit.id) { rdBook.anno[k] = hit; found = true; break; }
          }
          if (!found) rdBook.anno = rdBook.anno.concat([hit]);
          rdPaintPage();
        }
      }
    } finally {
      rdUnlockBusy = false;
    }
  }
  // 十四天收回：索引条目与正文里的封存纸条一起清掉，避免永远占着章内条数
  async function rdDropSealedAnno(bookId, s) {
    if (!s) return;
    try {
      const annos = await getAnnos(bookId, s.ch);
      const next = annos.filter(function (a) { return !(a && a.id === s.id && a.sealed); });
      if (next.length !== annos.length) await putAnnos(bookId, s.ch, next);
    } catch (e) {}
  }

  // 下次打开这本书时才处理待回应：他的位置越过那句 + 状态是「共读中」才掷骰子
  async function rdBuddyProcessReplies(force) {
    if (!rdCoopOn()) return;
    const b = rdBook;
    if (!b) return;
    if (rdNightGuard()) return;
    const list = readIndex();
    const book = rdFindBook(b.id, list);
    if (!book) return;
    rdBuddyAdvance(book);
    const bd = rdBuddyGet(book);
    if (!bd.started) return;
    if (rdBuddyState(book) !== 'read') return; // 未开始 / 停在这等你 / 今天不读 / 读完了 都不回应
    const queue = Array.isArray(book.replyQueue) ? book.replyQueue.slice() : [];
    if (!queue.length) return;
    queue.sort(function (x, y) { return (x.at || 0) - (y.at || 0); });
    const hisFlat = rdFlatPos(book, bd.ch, bd.off);
    const cache = {};
    let replied = 0;
    let added = 0;
    let curDirty = false;
    const addedTexts = [];
    const rest = [];
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      if (!q || !q.id) continue;
      if (replied >= RD_REPLY_MAX) { rest.push(q); continue; }
      if (q.quiet) continue; // 已经决定一直安静留着，不再尝试
      if (rdFlatPos(book, q.ch, q.e) > hisFlat) { rest.push(q); continue; } // 他还没读到那句
      if (!cache[q.ch]) {
        cache[q.ch] = q.ch === b.ch ? (b.anno || []).slice() : await getAnnos(b.id, q.ch);
      }
      const arr = cache[q.ch];
      const mine = arr.filter(function (x) { return x && x.id === q.id; })[0];
      if (!mine) continue; // 我那条已经删了，队列作废
      if (arr.some(function (x) { return x && x.replyTo === q.id; })) continue; // 已经回过
      // 每句只掷一次：没中就一直安静留着，不再整轮重试
      if (!force && Math.random() > RD_REPLY_CHANCE * rdDcfRatio()) continue;
      const repTxt = rdHisReplyText(book);
      if (!repTxt) continue; // 回应字卡被逐张关光/整组停用/锁定＝这一句就安静留着
      const item = {
        id: 'an_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        by: 'his',
        s: mine.s,
        e: mine.e,
        quote: mine.quote,
        text: repTxt.slice(0, 500),
        at: Date.now(),
        replyTo: q.id,
        rev: 1,
        deviceId: 'local'
      };
      arr.push(item);
      try { await putAnnos(b.id, q.ch, arr); }
      catch (e) { arr.pop(); rest.push(q); continue; }
      if (!rdBook || rdBook !== b) return;
      addedTexts.push(rdCardKey(item.text));
      replied++;
      added++;
      if (q.ch === b.ch) { b.anno = arr; curDirty = true; }
    }
    if (!added && rest.length === queue.length) return;
    const fresh = readIndex();
    const fb = rdFindBook(b.id, fresh);
    if (fb) {
      fb.replyQueue = rest;
      if (added) {
        fb.annoCount = (Number(fb.annoCount) || 0) + added;
        const used = Array.isArray(fb.buddyTexts) ? fb.buddyTexts : [];
        for (let i = 0; i < addedTexts.length; i++) used.push(addedTexts[i]);
        fb.buddyTexts = used.slice(-200);
      }
      saveIndex(fresh);
    }
    if (curDirty) rdPaintPage();
  }
  // ===== 批注：选句 → 字卡 → 预览 → 落库 → 句尾角标 =====
  // 锚点只记「章 + 章内起止偏移 + 原文快照」：换字号、换屏幕、重开都不会漂。
  let rdSel = null;
  let rdDraft = null;
  let rdAnnoPool = [];
  let rdSuppressTap = false;
  // 批注浮层当前定位（展开后仍要按这个落点重开）、自己批注的操作菜单
  let rdPopPos = -1;
  // 他新写的纸条落在当前页、但浮层正开着时，先记下，等浮层关掉再重绘补双圈
  let rdDeferPaint = false;
  let rdOpsId = '';
  let rdOpsAt = 0;

  function rdDeviceId() {
    let id = '';
    try { id = store.get('reading-device-id') || ''; } catch (e) {}
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { store.set('reading-device-id', id); } catch (e) {}
    }
    return id;
  }

  // 画整页正文：句尾角标 + 选中的高亮都在这一层完成。
  // 角标本身是空 span，文字节点索引会跳过它，保证「点到哪个字」在有无角标时偏移一致。
  function rdPaintPage() {
    const b = rdBook;
    const body = document.getElementById('rd-body');
    if (!b || !body || !b.pages.length) return;
    const p = b.pages[b.pageIdx] || { s: 0, e: b.text.length };
    const start = p.s;
    const end = p.e;
    // 读过的痕迹：他读过的句子句尾有极淡的铅笔竖线；同一句两人都留了批注时角标变双圈。
    // 两者共用「共读批注」分类的总开关，关掉整组或概率归零时一起消失。
    const traceOn = rdTraceEnabled();
    let hisOff = -1;
    if (traceOn) {
      const idx = readIndex();
      const book = rdFindBook(b.id, idx);
      if (book) hisOff = rdBuddyReadOff(book, b.ch, b.text.length);
    }
    const sents = b.sents || [];
    const traces = {};
    if (hisOff > start) {
      const from = Math.max(0, rdSentIndexAt(sents, start) + 1);
      for (let si = from; si < sents.length; si++) {
        const sn = sents[si];
        if (!sn || sn.e <= start) continue;
        if (sn.e > end) break;
        if (sn.e <= hisOff) traces[sn.e] = true;
      }
    }
    // 同一句里两人都留过批注：合并成一个句尾双圈，双圈优先、不再显示数字。
    // 他若还在未读区间，这个合并不成立，先按单圈显示，等我读到再补。
    const allAnnos = b.anno || [];
    const annos = rdCoopOn() ? allAnnos : allAnnos.filter(function (a) { return a && a.by === 'me'; });
    const groups = rdAnnoGroups(sents, annos);
    const consumed = new Set();
    const merged = {};
    Object.keys(groups).forEach(function (k) {
      const g = groups[k];
      if (!(g.mine && g.his)) return;
      const sn = sents[g.idx];
      if (!sn || !(sn.e > start && sn.e <= end)) return;
      merged[sn.e] = g.list;
      g.list.forEach(function (a) { consumed.add(a); });
    });
    const marks = {};
    annos.forEach(function (a) {
      if (consumed.has(a)) return;
      // 他的批注走「我读到才浮现」的闸门；我的批注照常显示
      if (!rdBuddyAnnoVisible(a, start, end)) return;
      const m = marks[a.e] || (marks[a.e] = { n: 0, mine: false, his: false });
      m.n++;
      if (a.by === 'me') m.mine = true;
      else if (traceOn) m.his = true;
    });
    Object.keys(merged).forEach(function (k) {
      const m = marks[k] || (marks[k] = { n: 0, mine: false, his: false });
      m.n += merged[k].length;
      m.mine = true;
      m.his = true;
    });
    // 批注所在句已经有更明确的记号，不再叠淡痕，避免同一处挤两个标记
    Object.keys(traces).forEach(function (k) { if (marks[k]) delete traces[k]; });
    const cutMap = {};
    Object.keys(marks).forEach(function (k) { cutMap[k] = 1; });
    Object.keys(traces).forEach(function (k) { cutMap[k] = 1; });
    const cuts = Object.keys(cutMap).map(Number).sort(function (x, y) { return x - y; });
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
      if (traces[m]) html += '<span class="rd-trace" aria-hidden="true"></span>';
      const mk = marks[m];
      if (mk) {
        const both = traceOn && mk.mine && mk.his;
        const cls = 'rd-mark' + (both ? ' rd-mark-both' : (mk.mine ? '' : ' rd-mark-his'));
        // 双圈优先：两人同句时不显示数字，条数进浮层里看；只有单人多条才显示数字
        html += '<span class="' + cls + '" data-pos="' + m + '" role="button">' +
          (mk.n > 1 && !both ? '<b>' + mk.n + '</b>' : '') + '</span>';
      }
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

  // 点按处 → 章内字符偏移（只认正文文字节点里的位置）
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

  // 复制：优先剪贴板 API，失败退回临时 textarea + execCommand
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

  // 字卡没有稳定 id，用文本算一个短哈希作溯源标识（不参与展示）
  function rdCardKey(text) {
    const s = String(text || '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'c_' + (h >>> 0).toString(36);
  }

  // 字卡池：只取纯文字卡，媒体卡拼进批注里会变成一串令牌
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
    rdCloseBuddyCard();
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
    // 他新写的纸条落在当前页、刚才因为浮层开着没重绘：关掉浮层后补上双圈
    if (rdDeferPaint) {
      rdDeferPaint = false;
      const reader = document.getElementById('rd-reader');
      if (reader && !reader.hidden) rdPaintPage();
    }
  }

  // 预览：原句 + 批注全文，必须经过这一步，不做点了就发
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
    // 落库期间可能刚写过进度，重新读一次索引再写计数，避免把页码写回旧值
    const fresh = readIndex();
    const freshBook = rdFindBook(b.id, fresh);
    if (freshBook) {
      freshBook.annoCount = used + 1;
      // 我写下的批注进待回应队列：下次打开、他越过这句时才可能回应
      if (!Array.isArray(freshBook.replyQueue)) freshBook.replyQueue = [];
      freshBook.replyQueue.push({ id: item.id, ch: b.ch, s: item.s, e: item.e, quote: item.quote, at: item.at });
      if (freshBook.replyQueue.length > 200) freshBook.replyQueue = freshBook.replyQueue.slice(-200);
      saveIndex(fresh);
    }
    rdDraft = null;
    rdClosePreview();
    rdClearSel(false);
    rdPaintPage();
    rdToast('已贴上');
  }

  // 浮层：按时间排列；他的回应缩进一层；默认最多 8 条，超出折叠。
  const RD_POP_MAX = 8;
  function rdOpenPop(pos, expand) {
    const b = rdBook;
    const list = document.getElementById('rd-pop-list');
    const pop = document.getElementById('rd-anno-pop');
    if (!b || !list || !pop) return;
    const items = rdAnnosAtPos(b, pos);
    if (!items.length) { pop.hidden = true; return; }
    rdClearSel(true);
    rdCloseAnnoOps();
    rdCloseBuddyCard();
    rdPopPos = pos;
    const all = !!expand || items.length <= RD_POP_MAX;
    const show = all ? items : items.slice(0, RD_POP_MAX);
    // 同句双圈：这一句两人都留了批注。每本书第一次撞上时给一句提示，之后只保留双圈。
    let sameFirst = false;
    if (rdTraceEnabled()) {
      const hasMine = items.some(function (a) { return a && a.by === 'me'; });
      const hasHis = items.some(function (a) { return a && a.by !== 'me'; });
      if (hasMine && hasHis) {
        const idx = readIndex();
        const book = rdFindBook(b.id, idx);
        if (book && !book.sameLineSeen) {
          book.sameLineSeen = 1;
          saveIndex(idx);
          sameFirst = true;
        }
      }
    }
    let html = sameFirst ? '<div class="rd-pop-same">你们停在了同一句</div>' : '';
    const nowTs = Date.now();
    html += show.map(function (a) {
      const mine = a.by === 'me';
      // 错过七天：旧句被划掉，正文换成他现在写的那句
      const old = !mine && a.crossedAt && a.oldText ? a.oldText : '';
      const oldDays = old ? Math.max(RD_MISS_DAYS, Math.floor((nowTs - (a.oldAt || a.at || nowTs)) / 86400000)) : 0;
      return '<div class="rd-pop-item ' + (mine ? 'rd-pop-mine' : 'rd-pop-his') +
        (a.replyTo ? ' rd-pop-reply' : '') + '"' +
        ' data-id="' + rdEsc(a.id || '') + '"' + (mine ? ' data-mine="1"' : '') + '>' +
        '<div class="rd-pop-who">' + (mine ? '我' : '他') + '</div>' +
        (old
          ? '<div class="rd-pop-cross">' + oldDays + ' 天前写下这句，后来划掉了</div>' +
            '<div class="rd-pop-old" data-old="' + rdEsc(a.id || '') + '">' + rdEsc(old) + '</div>'
          : '') +
        '<div class="rd-pop-text">' + rdEsc(a.text || '') + '</div>' +
        (a.unlockedAt && !a.replyTo ? '<div class="rd-pop-unsealed">你终于读到这了</div>' : '') +
        '</div>';
    }).join('');
    if (!all) {
      html += '<button class="rd-pop-more" type="button">还有 ' +
        (items.length - RD_POP_MAX) + ' 条，展开</button>';
    }
    list.innerHTML = html;
    pop.hidden = false;
  }

  // ===== 自己的批注：长按修改 / 删除（他的批注没有操作入口） =====
  function rdCloseAnnoOps() {
    const el = document.getElementById('rd-anno-ops');
    if (el) el.hidden = true;
    rdOpsId = '';
  }
  function rdOpenAnnoOps(id) {
    if (!id) return;
    rdOpsId = id;
    rdOpsAt = Date.now();
    const el = document.getElementById('rd-anno-ops');
    if (el) el.hidden = false;
  }
  function rdFindAnno(id) {
    const b = rdBook;
    if (!b || !id) return null;
    const arr = b.anno || [];
    for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }
  // 统一落库：写成功才替换内存并重画；写失败保持原样，不让界面撒谎。
  async function rdSaveAnnos(next, after) {
    const b = rdBook;
    if (!b) return false;
    try { await putAnnos(b.id, b.ch, next); }
    catch (e) { rdToast((e && e.message) || '批注没保存上：磁盘写入没有完成，请重试'); return false; }
    b.anno = next;
    rdPaintPage();
    if (after) after();
    return true;
  }
  function rdEditAnno(id) {
    const a = rdFindAnno(id);
    if (!a) return;
    rdCloseAnnoOps();
    if (!window.openModal) { rdToast('编辑框没有加载上，请重新打开页面'); return; }
    window.openModal('修改这条批注', a.text || '', function (v) {
      const t = String(v == null ? '' : v).trim();
      if (!t) { rdToast('批注不能是空的'); return; }
      const next = (rdBook.anno || []).map(function (x) {
        if (!x || x.id !== id) return x;
        return Object.assign({}, x, {
          text: t.slice(0, 500),
          editedAt: Date.now(),
          rev: (Number(x.rev) || 1) + 1
        });
      });
      const pos = a.e;
      rdSaveAnnos(next, function () { rdOpenPop(pos, true); rdToast('已改好'); });
    }, { textarea: true, textareaPlaceholder: '批注内容' });
  }
  function rdDeleteAnno(id) {
    const a = rdFindAnno(id);
    if (!a) return;
    rdCloseAnnoOps();
    if (!window.openModal) return;
    const tip = '「' + String(a.text || '').slice(0, 40) + '」删掉之后不能恢复。';
    window.openModal('删除这条批注？', '', function () {
      if (!rdBook) return;
      const pos = a.e;
      // 他对我这条的回应一起删掉，否则会留下一条没有上下文的回复
      const before = rdBook.anno || [];
      const removedN = before.filter(function (x) { return x && (x.id === id || x.replyTo === id); }).length;
      const next = before.filter(function (x) { return !x || (x.id !== id && x.replyTo !== id); });
      rdSaveAnnos(next, function () {
        // 计数与待回应队列都在书架索引里：重新读一次再改，避免覆盖期间写过的页码
        const list = readIndex();
        const fb = rdFindBook(rdBook.id, list);
        if (fb) {
          fb.annoCount = Math.max(0, (Number(fb.annoCount) || 0) - removedN);
          if (Array.isArray(fb.replyQueue)) {
            fb.replyQueue = fb.replyQueue.filter(function (q) { return q && q.id !== id; });
          }
          saveIndex(list);
        }
        rdOpenPop(pos, true);
        rdToast('已删除');
      });
    }, { noInput: true, staticText: tip, warn: true });
  }

  // ===== 重新导入后没能定位的批注 =====
  // 这些条目留在书架索引的 lostAnnos 里，正文可能已经对不上，只提供逐条删除。
  function rdRenderLost() {
    const list = document.getElementById('rd-lost-list');
    if (!list) return;
    const lost = (rdBook && Array.isArray(rdBook.lostAnnos)) ? rdBook.lostAnnos : [];
    if (!lost.length) {
      list.innerHTML = '<div class="rd-empty">没有未定位的批注</div>';
      return;
    }
    list.innerHTML = lost.map(function (a) {
      return '<div class="rd-lost-item">' +
        '<div class="rd-lost-quote">' + rdEsc(a.quote || '') + '</div>' +
        '<div class="rd-lost-text">' + rdEsc(a.text || '') + '</div>' +
        '<button class="rd-back" data-del="' + rdEsc(a.id || '') + '" type="button">删除</button></div>';
    }).join('');
  }
  function rdOpenLost() {
    closeToc();
    rdRenderLost();
    const el = document.getElementById('rd-lost');
    if (el) el.hidden = false;
  }
  function rdCloseLost() {
    const el = document.getElementById('rd-lost');
    if (el) el.hidden = true;
  }
  function rdDeleteLost(id) {
    if (!rdBook || !id) return;
    const lost = rdBook.lostAnnos || [];
    let target = null;
    for (let i = 0; i < lost.length; i++) if (lost[i] && lost[i].id === id) { target = lost[i]; break; }
    if (!target || !window.openModal) return;
    const tip = '「' + String(target.text || '').slice(0, 40) + '」删掉之后不能恢复。';
    window.openModal('删除这条批注？', '', function () {
      if (!rdBook) return;
      const next = (rdBook.lostAnnos || []).filter(function (x) { return !x || x.id !== id; });
      rdBook.lostAnnos = next;
      const list = readIndex();
      const fb = rdFindBook(rdBook.id, list);
      if (fb) { fb.lostAnnos = next; saveIndex(list); }
      rdRenderLost();
      rdToast('已删除');
    }, { noInput: true, staticText: tip, warn: true });
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
      // 先把旧章末尾那句留下来，再翻到下一章（b.ch / b.sents 都是旧章的）
      if (b.ch < b.toc.length - 1) { rdTogChapterNote(b); b.ch++; rdEnsureChapter('first'); return; }
      rdBounce(1);
    } else {
      if (b.pageIdx > 0) { b.pageIdx--; rdRenderPage(); return; }
      if (b.ch > 0) { b.ch--; rdEnsureChapter('last'); return; }
      rdBounce(-1);
    }
  }

  // 左右滑动翻页；轻点左右三分之一也能翻。滑动阈值 30px，竖向位移优先时当滚动处理。
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
    // 长按选句刚结束：这一下抬起不算翻页
    if (rdSuppressTap) { rdSuppressTap = false; return; }
    // 点角标只开批注浮层，不翻页
    if (e.target && e.target.closest && e.target.closest('.rd-mark')) return;
    // 有选中句子时，点一下先取消选中
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

  // 阅读习惯：切后台/关页时把这一段收尾；回前台仍在阅读器里就重新开一段
  // 折角书签的 30 秒也在这里暂停：切后台停表，回前台同一页重新计满
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      rdBmPauseWait();
      rdPacePause();
      rdHabitEndSession();
      return;
    }
    const reader = document.getElementById('rd-reader');
    if (reader && !reader.hidden) {
      rdHabitStartSession();
      rdPaceResume();
      if (rdBookmarkWaitPage && rdBook && rdBook.ch + ':' + rdBook.pageIdx === rdBookmarkWaitPage) rdBmScheduleWait();
    }
  });
  window.addEventListener('pagehide', function () { rdHabitEndSession(); });

  // 长按选句：520ms 内位移不超过 10px 才算长按；点到角标不选句
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

  // ===== 字号 / 行距 =====
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
  // ===== 阅读背景：auto 跟随全局主题，eye / night 只在阅读器内覆盖 =====
  const RD_BG_LABEL = { auto: '跟随主题', eye: '护眼', night: '夜间' };
  function rdReadBg() {
    try {
      const v = store.get(RD_BG_KEY);
      return (v === 'eye' || v === 'night') ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function rdApplyBg() {
    const mode = rdReadBg();
    const reader = document.getElementById('rd-reader');
    if (reader) reader.setAttribute('data-rd-bg', mode);
    const prev = document.getElementById('rd-set-preview');
    if (prev) prev.setAttribute('data-rd-bg', mode);
    const drawer = document.getElementById('rd-live-drawer');
    if (drawer) drawer.setAttribute('data-rd-bg', mode);
    rdApplyChrome();
  }
  function rdApplyChrome() {
    const phone = document.querySelector('.phone');
    if (!phone) return;
    const reader = document.getElementById('rd-reader');
    const mode = rdReadBg();
    const on = reader && !reader.hidden && (mode === 'eye' || mode === 'night');
    phone.classList.toggle('rd-chrome-eye', !!on && mode === 'eye');
    phone.classList.toggle('rd-chrome-night', !!on && mode === 'night');
  }
  function rdSetBg(mode) {
    if (mode !== 'eye' && mode !== 'night') mode = 'auto';
    try { store.set(RD_BG_KEY, mode); }
    catch (e) {}
    rdRenderPrefsActive();
  }
  function rdCoopOn() {
    try { return store.get(RD_COOP_KEY) !== 'off'; }
    catch (e) { return true; }
  }
  function rdSetCoop(on) {
    try { store.set(RD_COOP_KEY, on ? 'on' : 'off'); }
    catch (e) {}
    if (on) {
      // 重新打开从当下继续：把所有书的更新时间拨到现在，关闭期间不补算他的阅读
      const list = readIndex();
      const now = Date.now();
      for (let i = 0; i < list.length; i++) {
        const bd = rdBuddyGet(list[i]);
        if (bd) bd.updatedAt = now;
      }
      saveIndex(list);
    } else {
      rdTogWatchStop();
      rdBmClearWait();
      rdCloseBuddyCard();
      rdClosePop();
    }
    rdRenderPrefsActive();
    if (rdBook) {
      const reader = document.getElementById('rd-reader');
      if (reader && !reader.hidden) {
        rdRenderPage();
        rdUpdateBar();
      }
    }
    rdRenderShelf();
    if (on) rdTogWatchStart();
    rdToast(on ? '共读已打开' : '共读已关闭');
  }
  function rdSetPrefs(patch) {
    const p = rdReadPrefs();
    if (patch && patch.fs) p.fs = patch.fs;
    if (patch && patch.lh) p.lh = patch.lh;
    try { store.set(RD_PREFS_KEY, JSON.stringify(p)); }
    catch (e) { rdToast('字号设置没保存上'); }
    rdApplyPrefs(p);
    const b = rdBook;
    const reader = document.getElementById('rd-reader');
    const body = document.getElementById('rd-body');
    // 设置页从书架进入时阅读页是 hidden 的，此时 clientHeight 为 0。
    // 只改字号不重排，等下次翻开书时由 rdOpenBook 按可见尺寸重新分页，避免写坏页缓存与进度。
    if (b && b.text && reader && !reader.hidden && body && body.clientHeight > 0) {
      const off = b.pages[b.pageIdx] ? b.pages[b.pageIdx].s : 0;
      // 换字号/行距会重新分页，页码跟着变——这次重绘不算翻页，
      // 否则停留时长会被当成「翻走了一页」而误记一次翻页节奏
      rdPaceReset(); // 重新分页不算翻页
      b.pages = rdPaginateChapter(b);
      rdCheckPagination(b.pages, b.text.length);
      b.pageIdx = rdPageForOffset(b.pages, off);
      rdRenderPage();
    }
    rdRenderPrefsActive();
  }
  function rdRenderPrefsActive() {
    const p = rdReadPrefs();
    const fsPct = Math.max(0, Math.min(100, (p.fs - 12) / 18 * 100)) + '%';
    const lhPct = Math.max(0, Math.min(100, (p.lh - 1.4) / 0.8 * 100)) + '%';
    const fsRange = document.getElementById('rd-set-fs-range');
    if (fsRange) {
      fsRange.value = String(p.fs);
      fsRange.style.setProperty('--rd-pct', fsPct);
    }
    const lhRange = document.getElementById('rd-set-lh-range');
    if (lhRange) {
      lhRange.value = String(p.lh);
      lhRange.style.setProperty('--rd-pct', lhPct);
    }
    const liveFs = document.getElementById('rd-live-fs-range');
    if (liveFs) {
      liveFs.value = String(p.fs);
      liveFs.style.setProperty('--rd-pct', fsPct);
    }
    const liveLh = document.getElementById('rd-live-lh-range');
    if (liveLh) {
      liveLh.value = String(p.lh);
      liveLh.style.setProperty('--rd-pct', lhPct);
    }
    const prev = document.getElementById('rd-set-preview-text');
    if (prev) {
      prev.style.fontSize = p.fs + 'px';
      prev.style.lineHeight = String(p.lh);
    }
    const fsVal = document.getElementById('rd-set-fs-val');
    if (fsVal) fsVal.textContent = p.fs + 'px';
    const lhVal = document.getElementById('rd-set-lh-val');
    if (lhVal) lhVal.textContent = p.lh.toFixed(1);
    const liveFsVal = document.getElementById('rd-live-fs-val');
    if (liveFsVal) liveFsVal.textContent = p.fs + 'px';
    const liveLhVal = document.getElementById('rd-live-lh-val');
    if (liveLhVal) liveLhVal.textContent = p.lh.toFixed(1);
    const bg = rdReadBg();
    document.querySelectorAll('[data-rd-bgopt]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-rd-bgopt') === bg);
    });
    const bgVal = document.getElementById('rd-set-bg-val');
    if (bgVal) bgVal.textContent = RD_BG_LABEL[bg] || RD_BG_LABEL.auto;
    const coopToggle = document.getElementById('rd-coop-toggle');
    if (coopToggle) coopToggle.checked = rdCoopOn();
    rdApplyBg();
  }

  // ===== 目录 =====
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
    rdCloseBuddyCard();
    rdRenderToc();
    toc.hidden = false;
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

  // ===== 书架渲染 =====
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
  // 全书进度：优先用索引里的 chWords（章字数表）精确算；缺表时退回按章数估。
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
    if (!rdCoopOn()) return '';
    const st = rdBuddyState(b);
    if (st === 'done') return '他读完了';
    if (st === 'wait') return '等你';
    if (st === 'skip') return '今天不读';
    if (st === 'none') return '未开始';
    return '共读中';
  }
  function rdRenderShelf() {
    const grid = document.getElementById('rd-grid');
    const empty = document.getElementById('rd-empty');
    if (!grid) return;
    // 顶栏收放跟着导入面板的开关走：从阅读器返回、重开本页时也靠这里同步回来
    const shelfEl = document.getElementById('rd-shelf');
    const impPanel = document.getElementById('rd-import-panel');
    if (shelfEl) shelfEl.classList.toggle('rd-importing', !!(impPanel && !impPanel.hidden));
    const list = readIndex().slice();
    list.sort(function (a, b) { return ((b && b.lastOpenAt) || 0) - ((a && a.lastOpenAt) || 0); });
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || !b.id) continue;
      const title = b.title || '未命名';
      const badge = rdBadgeText(b);
      // 累计同读每满三次，书脊上多一道细纹
      const spine = rdTogSpine(b);
      let ribs = '';
      for (let k = 0; k < spine; k++) ribs += '<i></i>';
      html += '<div class="rd-book" data-id="' + rdEsc(b.id) + '">' +
        '<div class="rd-cover" style="background:' + rdCoverColor(title) + '">' + rdEsc(title.slice(0, 1) || '书') +
          (ribs ? '<span class="rd-spine">' + ribs + '</span>' : '') + '</div>' +
        '<div class="rd-line"><i style="width:' + rdProgressPct(b) + '%"></i></div>' +
        '<div class="rd-book-title">' + rdEsc(title) + '</div>' +
        (badge ? '<span class="rd-badge">' + rdEsc(badge) + '</span>' : '') +
      '</div>';
    }
    grid.innerHTML = html;
    if (empty) empty.hidden = list.length > 0;
    // 共读手账：只给章序号，不给内容；七天没读到改口「他还在等」，十四天收回
    const ledger = document.getElementById('rd-ledger');
    if (ledger) {
      if (!rdCoopOn()) {
        ledger.innerHTML = '';
        ledger.hidden = true;
      } else {
      const now = Date.now();
      const DAY = 86400000;
      let led = '';
      let dirty = false;
      const drops = [];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b || !Array.isArray(b.sealed) || !b.sealed.length) continue;
        const keep = [];
        for (let j = 0; j < b.sealed.length; j++) {
          const s = b.sealed[j];
          if (!s || !s.at) continue;
          const age = now - s.at;
          if (age >= RD_SEAL_DROP_DAYS * DAY) { drops.push({ id: b.id, s: s }); dirty = true; continue; }
          keep.push(s);
          const chNo = (Number(s.ch) || 0) + 1;
          const days = Math.floor(age / DAY);
          const sameDay = rdTodayKey(s.at) === rdTodayKey();
          const line = days >= RD_SEAL_WAIT_DAYS
            ? '他还在等'
            : (sameDay ? '他今天折了一句' : '他 ' + Math.max(1, days) + ' 天前折了一句');
          led += '<div class="rd-ledger-row"><span class="t">《' + rdEsc(b.title || '未命名') + '》' + rdEsc(line) +
            '</span><span class="a">第 ' + chNo + ' 章</span></div>';
        }
        if (keep.length !== b.sealed.length) b.sealed = keep;
      }
      if (dirty) saveIndex(list);
      for (let i = 0; i < drops.length; i++) rdDropSealedAnno(drops[i].id, drops[i].s).catch(function () {});
      ledger.innerHTML = led ? '<div class="rd-ledger-t">共读手账</div>' + led : '';
      ledger.hidden = !led;
      }
    }
    const usage = document.getElementById('rd-usage');
    if (usage) {
      let bytes = 0;
      for (let i = 0; i < list.length; i++) bytes += ((list[i] && list[i].size) || 0);
      usage.textContent = '已用 ' + (bytes / 1024 / 1024).toFixed(1) + ' MB · ' + list.length + ' 本';
    }
  }

  // ===== 书目长按：改名 / 删除 =====
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
  // 删书：先删正文/批注/目录，全成功才从索引移除。删不干净就记 pendingDelete，
  // 保留书卡（而不是假装删掉），下次打开书架再试一次。
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

  // ===== 导入面板 =====
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
    const nameEl = document.getElementById('rd-imp-name');
    if (file) { try { file.value = ''; } catch (e) {} }
    if (paste) paste.value = '';
    if (nameEl) nameEl.value = '';
    rdSetFileInfo('');
    const gbk = document.getElementById('rd-gbk-row');
    if (gbk) gbk.hidden = true;
    if (main) main.hidden = false;
    if (cf) cf.hidden = true;
    if (panel) panel.hidden = false;
    // 收起书架顶栏：导入面板自己有标题和关闭按钮，顶栏留着会压住面板头部
    const shelf = document.getElementById('rd-shelf');
    if (shelf) shelf.classList.add('rd-importing');
  }
  function rdCloseImport() {
    const panel = document.getElementById('rd-import-panel');
    const main = document.getElementById('rd-import-main');
    const cf = document.getElementById('rd-confirm');
    const shelf = document.getElementById('rd-shelf');
    if (shelf) shelf.classList.remove('rd-importing');
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
    // 手机上输入框会被 mobile-adapt 换成 contenteditable 代理，打字/粘贴产生的
    // 换行可能翻倍（正文段落之间多出一个空行）。统一换行符后，把 3 个以上连续
    // 换行压回「1 个空行」（正常段落间距不变），分章与写库都用归一后的文本。
    const text = String(rdImp.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
    rdImp.text = text;
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

  // 写入导入结果：先写目录与各章正文，全成功才写书架索引；中途失败回滚。
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
      // 书名优先用导入面板里手填的；留空才回落到文件名 / 「粘贴的书」
      const nameEl = document.getElementById('rd-imp-name');
      const typed = nameEl ? String(nameEl.value || '').trim().slice(0, 40) : '';
      const title = typed || (rdImp.name ? rdImp.name.replace(/\.txt$/i, '') : '粘贴的书');
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
        buddy: { mode: 'follow', ch: 0, off: 0, updatedAt: Date.now(), waiting: false, started: false, carry: 0 },
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

  // ===== 长按书架卡片 =====
  // 450ms 长按弹菜单；pointer 移动超过 10px 或抬起就取消，避免和滚动抢手势。
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
  // 安卓长按会弹系统文本菜单/选中：书架卡片与正文都由我们自己的长按接管
  document.addEventListener('contextmenu', function (e) {
    const el = e.target;
    if (el && el.closest && (el.closest('#rd-grid .rd-book') || el.closest('#rd-body') ||
      el.closest('#rd-pop-list .rd-pop-item'))) e.preventDefault();
  }, true);

  // 长按自己的批注（浮层里）→ 修改 / 删除；他的批注不给入口
  let rdPopTimer = 0, rdPopX = 0, rdPopY = 0;
  function rdCancelPopPress() { if (rdPopTimer) { clearTimeout(rdPopTimer); rdPopTimer = 0; } }
  document.addEventListener('pointerdown', function (e) {
    const el = e.target;
    if (!el || !el.closest) return;
    const item = el.closest('#rd-pop-list .rd-pop-item[data-mine]');
    if (!item) return;
    rdCancelPopPress();
    rdPopX = e.clientX; rdPopY = e.clientY;
    const id = item.getAttribute('data-id');
    rdPopTimer = setTimeout(function () {
      rdPopTimer = 0;
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
      rdOpenAnnoOps(id);
    }, 450);
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!rdPopTimer) return;
    if (Math.abs(e.clientX - rdPopX) > 10 || Math.abs(e.clientY - rdPopY) > 10) rdCancelPopPress();
  }, true);
  document.addEventListener('pointerup', rdCancelPopPress, true);
  document.addEventListener('pointercancel', rdCancelPopPress, true);

  // ===== 事件委托 =====
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
    // 菜单开着时点空白处只关菜单，不再顺手打开下面那张书卡
    if (document.getElementById('rd-book-menu') && !el.closest('#rd-book-menu')) {
      e.preventDefault();
      rdCloseBookMenu();
      return;
    }
    // 自己批注的长按菜单
    const opBtn = el.closest('#rd-anno-ops [data-act]');
    if (opBtn) {
      e.preventDefault();
      const act = opBtn.getAttribute('data-act');
      const id = rdOpsId;
      if (act === 'edit') rdEditAnno(id);
      else if (act === 'del') rdDeleteAnno(id);
      return;
    }
    // 长按后这一下抬起会补一个 click：350ms 内不把它当成「点空白关菜单」
    if (rdOpsId && Date.now() - rdOpsAt > 350 && !el.closest('#rd-anno-ops')) rdCloseAnnoOps();
    // 角标：点开这句旁边的批注
    const mk = el.closest('.rd-mark');
    if (mk) { e.preventDefault(); rdOpenPop(Number(mk.getAttribute('data-pos'))); return; }
    // 浮层里那条被划掉的旧句：点一下他有概率接一句
    const oldEl = el.closest('#rd-pop-list .rd-pop-old');
    if (oldEl) { e.preventDefault(); rdMissReply(oldEl.getAttribute('data-old')); return; }
    // 浮层里「还有 N 条」展开
    if (el.closest('#rd-pop-more')) { e.preventDefault(); rdOpenPop(rdPopPos, true); return; }
    // 选句浮条
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
    // 聊天「更多 → 互动」里的入口：先收起面板再开页，和桌面图标走同一条路径
    if (el.closest('#more-reading')) {
      e.preventDefault();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      rdOpen();
      return;
    }
    if (el.closest('#rd-shelf-back')) { rdClose(); return; }
    if (el.closest('#rd-shelf-settings')) { e.preventDefault(); rdOpenSettings(); return; }
    if (el.closest('#rd-settings-back')) { e.preventDefault(); rdCloseSettings(); return; }
    if (el.closest('#rd-live-adjust')) { e.preventDefault(); rdOpenLiveDrawer(); return; }
    if (el.closest('#rd-live-close')) { e.preventDefault(); rdCloseLiveDrawer(); return; }
    if (el.closest('#rd-live-fold')) { e.preventDefault(); rdToggleLiveFold(); return; }
    const bgOpt = el.closest('[data-rd-bgopt]');
    if (bgOpt) { e.preventDefault(); rdSetBg(bgOpt.getAttribute('data-rd-bgopt')); return; }
    if (el.closest('#rd-reader-back')) { rdShowShelf(); return; }
    if (el.closest('#rd-retry')) { e.preventDefault(); rdEnsureChapter('first'); return; }
    // 底部「他在哪」：整行都是热区
    if (el.closest('#rd-foot-row')) { e.preventDefault(); rdOpenBuddyCard(); return; }
    if (el.closest('#rd-buddy-close')) { e.preventDefault(); rdCloseBuddyCard(); return; }
    const bMode = el.closest('#rd-buddy-modes [data-bmode]');
    if (bMode) { e.preventDefault(); rdBuddySetMode(bMode.getAttribute('data-bmode')); return; }
    if (el.closest('#rd-buddy-jump')) { e.preventDefault(); rdJumpToBuddy(); return; }
    if (el.closest('#rd-toc-btn')) { e.preventDefault(); openToc(); return; }
    if (el.closest('#rd-toc-close')) { e.preventDefault(); closeToc(); return; }
    const tocRow = el.closest('#rd-toc-list [data-ch]');
    if (tocRow) { e.preventDefault(); rdJumpChapter(tocRow.getAttribute('data-ch')); return; }
    if (el.closest('#rd-toc-list [data-lost]')) { e.preventDefault(); rdOpenLost(); return; }
    if (el.closest('#rd-lost-close')) { e.preventDefault(); rdCloseLost(); return; }
    const lostDel = el.closest('#rd-lost-list [data-del]');
    if (lostDel) { e.preventDefault(); rdDeleteLost(lostDel.getAttribute('data-del')); return; }
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

  // 选文件：arrayBuffer 后探测编码
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

  // 粘贴：直接是字符串，不探测编码
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

  // 字卡搜索
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
    openBook: rdOpenBook,
    close: rdClose,
    hisAnno: rdMaybeHisAnno,
    replies: rdBuddyProcessReplies,
    sentences: rdSentenceList
  };
})();
