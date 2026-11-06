// ===== 功能：系统预设字卡文案编辑公共层 =====
// #1644 默认聊天/功能/词典/跨桌面查岗四个主列表先接入；#1645 起「聊天情绪字卡」「他的心情」
// 「聊天回应字卡」「寻踪日常」「今日情话」「位置卡」「他的询问/小问题/好奇/调侃/查岗/邀请」
// 等独立预设页共用这一份覆盖表与编辑弹窗，避免各页各写一套存储/恢复/重名逻辑。
// 存储：全局 xy-home-v2:default-card-edits（所有联系人桌面共用），结构
//   { 来源键: { 原文案: 新文案 } }
// 原文案永远作为稳定身份：列表显示新文案，关闭键/反向映射/「恢复原文」都认原文案。
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
  // 来源键 -> { 新文案 : 原文案 }
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
    // 把某来源的覆盖逐条交给调用方（fn(新文案, 原文案)），用于启动/重建后套回数据
    apply: function (key, fn) {
      const m = EDITS[key];
      if (!m) return;
      Object.keys(m).forEach(function (orig) {
        try { fn(m[orig], orig); } catch (e) {}
      });
    },
    // 注册「覆盖表整体重载后」的重放回调（LS 不可用设备靠 IDB 回填拿到覆盖时用）
    onRebuild: function (fn) {
      if (typeof fn !== 'function') return;
      api.__rebuildFns.push(fn);
    },
    __rebuildFns: [],
    // 编辑弹窗：key＝来源键，shown＝当前显示文案；exists(next)＝同池重名判断（须排除当前这张）
    // onChanged(next, orig)＝把数据里的 shown 换成 next 并刷新列表；恢复时 next＝orig
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
          // 恢复：原文案可能已被另一张卡改成同名，先挡这一种，提示才说得清
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
        const next = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
        if (!finish(next)) {
          // 重名/恢复被占用：把刚输入的内容带回编辑框（外层弹窗按打开序号跳过关闭）
          if (next) api.open(Object.assign({}, o, { draft: next }));
        }
      }, {
        maxlength: o.maxlength || 120,
        staticText: o.staticText || '只改这一张系统预设字卡：保存后列表和回复都立即用新文案，原文案仍保留，可随时「恢复原文」。改动保存在本机，所有联系人桌面共用。',
        extraBtn: edited ? {
          label: '恢复原文',
          fn: function (ctl) { if (finish(orig)) ctl.close(); }
        } : null
      });
    }
  };
  window.presetTextEdit = api;
  // LS 不可用设备（localStorage 读空/写不进）启动时覆盖只在 IndexedDB 里：回填完成后重读一次。
  // 仅当启动时一条覆盖都没读到才整表重放（此时各页 DATA 仍是原始文案，重放安全）；
  // 启动已有覆盖时各页数据已是新文案，再重放会把链式改名二次套用。
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
