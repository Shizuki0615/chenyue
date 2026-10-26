# 读书模块交接文档（2026-10-25）

> 面向下一个接手开发的人 / 新账号。先读第 0 节恢复现场，再读第 1–3 节了解规矩；
> 第 7 节是下一批要做的事，第 9 节是这一路踩过的坑。

---

## 0. 先做这 5 件事（恢复现场）

```bash
cd /workspace
git branch --show-current     # 不是 main 就先 git checkout main
git checkout main
git log --oneline -3
git status -sb                # 工作区应为干净
node build.mjs --allow-revert # 应看到：哨兵 4483/4483、sw 16/16、哑哨兵 0
```

### 当前状态（2026-10-26 更新）

main 与 origin/main 一致，最新提交 `ffb44d4`。
预览分支 `trae/agent-r2g0AV` 已同步成同一份内容（`4bd0eb9`）。

三个必须先知道的警告：

1. 工作区可能停在旧分支。平台会在会话中断后把工作区切到 `trae/agent-r2g0AV`，
   那个分支曾经停在很旧的版本上（书签位置、渐变、分组管理全都没有）。
   动代码前先确认 `git branch --show-current` 是 `main`，不是就 `git checkout main` 并重新构建。

2. main 的提交历史被平台压过一次。`b80ae54 chore: pre-termination backup` 是重建的孤儿提交，
   之前那批提交（`b7df2c1` … `6de7036`）在 main 上已经查不到，但文件内容都在。
   不要试图去 git 里找那些 hash，直接以当前工作区为准。

3. 不要直接改构建产物。`index.html`、`js/reading.js`、`sw.js`、`version.json`
   都是 `node build.mjs --allow-revert` 生成的。改 `src/`，再构建。

### 真机测试约定（2026-10-26 起）

平台内置浏览器工具会崩（报 P30009）。用户已明确要求：
不再调用浏览器自动化测试，写完直接构建 + push，由用户在真机
`https://shizuki0615.github.io/chenyue/` 验证。

所以交付前必须自查三件事：

- `node --check src/js/reading.js`
- `node build.mjs --allow-revert`（哨兵 4483/4483、sw 16/16、哑哨兵 0）
- 逐项核对 DOM 里的 id 和 `getElementById` 调用是否对得上。这类静默失效已经踩过两次：
  `rd-dd-feat` / `rd-dd-pills` 漏 id 导致整块不渲染且不报错。

---

## 0.1 待办清单（2026-10-26）

### 已完成

设计稿三份（`shelf_rework_upper_half_v2` / `lower_half_v2` / `home_groups_v2`）已全部落地：

- 书架首页：hero 卡（三层高光渐变、书签贴顶、日期两行、标签胶囊、进度条、右下按钮）、
  阅读记录（标签 + 大标题 + 数字行，叙事句已按用户要求删除）、
  共读手账（粉边、标题前短横线、书名+备注两行、章号胶囊）、
  分组卡（阴影、错落、暖色书脊、副标题三态）、页脚
- 分组详情页：书库头、全部/在读/读完 胶囊、特征大卡、02/03 列表、错落网格（可滚动 + 底部渐隐不拦点击）
- 顶栏：恢复全局 chat-head 风格，字体跟随系统，不做局部覆盖
- 分组管理：长按分组卡改名/删除、长按书卡移进移出/改书名/删书
- 分组排序：分组头「排序」进编辑模式，拖动落位，松手保存
- 美化：设置页「书架首页」区块 + 边看边调抽屉（hero / 手账底色预设 + 自定义 CSS 白名单过滤）

### 待用户真机确认

1. hero 渐变是否够明显（三层高光，左上主光强度 .18）
2. 书签是否贴合卡片顶沿、不再悬在标题上方
3. 边看边调：点开后会跳到读书页，抽屉浮在书架上，改色块能实时看到效果。
   确认这个交互是否顺手
4. 顶栏「读书」字体是否和桌面其它应用一致
5. 分组「排序」的拖动是否顺手。这是本轮新加的手势，未经自动化验证，
   和三套既有手势（点进详情、长按菜单、页面滚动）共存，需要真机手感确认

### 沿用的历史待办（来自第 8 节，2026-10-26 全部处理完）

1. 批注浮层署名行与文案：已改。署名不再独占一行，收进正文首行做行内前缀
   （`<span class="rd-pop-who">` 放在 `.rd-pop-text` 里），每条批注少一行。
2. 阅读器顶栏统一 chat-head：已完成。
3. 细节精修：已逐项处理。
   - 书脊细纹：宽 4px，线改成两端淡的渐变，去掉硬白线感（哨兵 #1553g 已重锚）
   - 小卡头像：径向渐变球 + 内高光，不再是单色圆点
   - 页脚三种状态文案层级：本来就有（普通 .68 / 同位置 .88 + 红 / 此刻同读 1 + 红 + 字距），
     这次给「此刻 · 同读」加了 600 字重
   - 封存/解锁提示：前面加一道 12px 短横线，和共读手账标题同一套语言
   - 错过七天划痕：删除线改成 1.5px、带红色调，更像被划掉而不是普通删除线
   - 角标密度：`.rd-badge` padding 1px 5px → 2px 6px，圆角 6 → 7
4. 导入面板与确认分章屏：已完成。
5. 共读手账视觉层级：已按设计稿完成（粉边、标题前短横线、书名+备注两行、章号胶囊）。
6. 书架空态：已改。线稿摊开书页 + 主副两行（「书架还是空的」+ 引导语），
   不再是单行提示。
7. 书籍分组与置顶：都已完成。分组含新建/改名/删除/移进移出/拖动排序；
   置顶实现为 `book.pinned` 字段 + 详情页排序优先 + 书卡菜单「置顶这本书 / 取消置顶」
   + 封面左上角小粉点标记。置顶只影响分组详情页的排序，不动首页 hero
   （hero 始终是最近在读那本）。

### 明确不做（用户已否）

- 详情页胶囊记住上次筛选
- 点顶栏标题区返回

---

## 1. 项目速览

- 项目：**辰光玥影 / Mochi**，一个手机优先的单页应用（聊天、桌面、读书等模块）。
- 仓库：`/workspace`，远端 `https://github.com/Shizuki0615/chenyue`。
- 构建：`node build.mjs --allow-revert`
  - 内联 CSS 与核心 JS 生成 `index.html`
  - 其余 JS 外置到 `js/*.js`
  - 同时生成 `sw.js`、`version.json`、PWA 图标副本
- 部署：GitHub Pages 直接 serve `main` 的产物，没有 CI。
- 读书模块的页面骨架由 JS 动态创建，不在 `src/template.html` 里：
  - `src/js/reading.js` 里的 `buildPage()` 创建 `#page-reading`（书架 + 阅读器 + 各种浮层）
  - `buildSettingsPage()` 创建 `#page-reading-settings`
- 样式：`src/css/reading.css`（读书模块），全局组件样式在 `src/css/chat-main.css`、
  `src/css/setting.css` 等。

### 当前成果一览

| 批次 | 提交 | 内容 |
| --- | --- | --- |
| 上一轮 | `a112dd4` | 护眼/夜间状态栏、书架留白、共读总开关与三个子开关、页脚与批注浮层精修 |
| 这一轮 A | `14ab4cc` | 导入页 + 确认分章页视觉重做；卷标误切修复 |
| 这一轮 B | `14dec36` | 目录右侧抽屉、进度头、他在章节、批注气泡、搜索、已读弱化、回到当前章、书签 |
| 下一轮 | 未开工 | 阅读设置页改「美化 / 功能 / 数据」三栏 + 主按钮颜色 + 只读数据概览 |

---

## 2. 用户偏好与协作方式（很重要）

用户对细节敏感，以下是这几轮反复确认过的口径：

- **先读开工文档，再动手**：`docs/plans/2026-10-24-ui-polish.md`。
- **先说方案再写代码**：尤其改结构、加按钮、加页面时，先列改动点让用户确认。
- **只动该动的**：不做顺手重构，不引入与当前任务无关的抽象。
- **视觉口径**：
  - 主站顶栏 / 底部状态栏保持极简清爽，读书模块内部可以有一点纸感。
  - 纸感只用 CSS 渐变、极细纹理、淡底色，**不要大面积真实图片**。
  - 粉色是点缀色：`#f4b6c2`；正文墨色 `#111111`；夜间米白 `#f0f0f0`。
  - 顶栏统一用全局 `.chat-head` / `.ch-back` / `.ch-name` / `.ch-settings`。
  - 手机优先，注意安全区变量 `--mochi-safe-top`、`--mochi-safe-bottom`。
  - 用户不喜欢卡片/书本死贴顶栏，需要呼吸位（书架 `.rd-grid` 顶留白 28px）。
- **交互口径**：
  - 字号、行距用滑块；背景三档：跟随主题 / 护眼 / 夜间。
  - 护眼、夜间的状态栏颜色要一致，不能黑状态栏配浅顶栏。
  - 导入、设置入口：导入在左，设置在右（方案 A）。
  - 目录要右侧抽屉，不要整页遮死；点遮罩可关。
  - 书签入口：阅读器顶栏图标 + 抽屉「目录 / 书签」两页签。
  - 目录批注气泡：共读开时含他的，关时只算我的。
  - 目录附加项：章节搜索、已读弱化、「回到当前章」浮标；不做章节字数/预计时间。
- **交付习惯**：
  - 每批做完给简短总结，不写长篇大论。
  - 提交信息用中文/英文混合的 `feat(reading): ...` 风格。
  - 不在仓库里留测试截图、临时文件。
  - 合并 / 推送都要用户明确说；不要擅自 push。
  - 用户现在要换号，交接文档要能让下一个账号独立接手。

---

## 3. 工作流、构建与测试

### 3.1 构建与哨兵

```bash
node build.mjs --allow-revert
```

正常输出应包含：

```text
✅ 哑哨兵体检 0 条
✅ 关键修复哨兵 4483/4483 全部在位
✅ sw.js 哨兵 16/16 在位
```

规则（详见 `docs/plans/2026-10-24-ui-polish.md` 第二节）：

- 哨兵表在 `build.mjs` 的 `const FIX_SENTINELS = [...]`。
- 每条 `{ name, file, needle }` 的 `needle` 必须在登记的源文件里唯一存在，
  且不能只落在注释里。
- **只是改锚点文本 = 重锚，允许**；删掉整条哨兵 = 缩尺，构建会中止。
- 重锚那一轮会报一次「打回体检少了 N 条」，这是预期；确认只改了锚点后
  用 `node build.mjs --allow-revert` 放行。提交后 HEAD 更新，下一轮不再报。
- 改 `src/css/reading.css` 里被哨兵锚定的行时，要同步改 `build.mjs` 的 needle。
  当前被锚定的样式行（截至 `14dec36`）：
  - `#1551m .rd-ledger[hidden]{display:none!important}`
  - `#1553g .rd-spine{position:absolute;right:3px;`
  - `#1553i @media (prefers-reduced-motion: reduce){...}`
  - `#1554a min-height:0;padding:0 0 24px}`
  - `#1554b .rd-grid{...padding:28px 16px 0}`
  - `#1554c .rd-shelf.rd-importing > .chat-head{display:none}`
  - `#1554d .rd-import{...}`
  - 另外 `#1557a–d` 锚在 `src/js/reading.js` 的新逻辑上。
- 新增重要修复时，按惯例在哨兵表末尾加一条 `#15xx`；不是每个功能都必须加。

### 3.2 Git 与分支（重点）

- 本次工作全部提交在 `main` 上，工作区干净。
- 提交身份（本机需要显式指定）：

```bash
git -c user.name="Shizuki0615" \
    -c user.email="Shizuki0615@users.noreply.github.com" \
    commit -m "feat(reading): ..."
```

- **推荐做法**：从 `main` 开一个新分支做下一批，做完快进合并回 `main`：

```bash
git checkout main
git checkout -b feat/reading-settings
# ...改动、构建、测试...
git add <具体文件>
git commit -m "feat(reading): 设置页分栏"
git checkout main
git merge --ff-only feat/reading-settings
```

- 仓库历史里 `main` 与 `trae/agent-HyW2zB` 曾被 shallow 边界切成两段无共同祖先。
  旧流程用过：
  `git merge --allow-unrelated-histories --no-edit -X theirs trae/agent-HyW2zB`。
  **慎用 `-X theirs`**：它会让代理分支的旧文件覆盖 main 的新成果。
  现在能直接 `--ff-only` 就优先 `--ff-only`。
- 不跑 `git push --force`，不擅自推 main。

### 3.3 本地测试手法（沿用开工文档第六节）

- 每次换一个端口，避免 Service Worker 缓存：

```bash
cd /workspace && python3 -m http.server 16451 --bind 127.0.0.1
```

- 同一端口刷新时带新的查询串：`http://127.0.0.1:16451/?t=tag2`。
- 测试环境里 `navigator.serviceWorker` 可能是 undefined，不能靠清 SW；
  换端口或换 `?t=` 最稳。
- 用浏览器工具（`Exec` 里的 `tools.browser_*`）操作，流程：
  1. `browser_navigate` 到本地地址，等 2s
  2. 首页点「读书」图标：`.app[data-app="reading"]`
  3. 书架点「导入」`#rd-import`，或点书本卡片打开阅读器
  4. 阅读器点「目录」`#rd-toc-btn`
  5. 用 `browser_evaluate` 读状态：

```js
JSON.stringify({
  errs: (window.__jsErrors || []).length,
  books: window.__readingProbe.readIndex(),
  toc: document.querySelector('#rd-toc')?.hidden,
  marks: document.querySelectorAll('.rd-mark-row').length
})
```

- `window.__readingProbe` 暴露：
  `readIndex`、`splitChapters`、`paginate`、`open`、`openBook`、`close`、
  `hisAnno`、`replies`、`sentences`。
- 任何交互后 `window.__jsErrors` 必须为 0。
- 测试截图保存到工具默认目录（仓库外），**不要**落到仓库的 `.screenshots/`。
- 测试中可能弹出的遮挡层：
  - `#mem-warn-bar`（内存提示，点 `#mem-warn-x` 关闭）
  - `#qa-mask`（他的好奇，点 `#qa-mask-close`）
  - `#call-mask`（模拟来电，点「拒绝」）
- 测试用的书会留在浏览器 profile 里，不是仓库数据，不用清理。
- 测试结束用 `StopCommand` 停掉本地服务。

---

## 4. 已完成 A：导入页 + 确认分章页（14ab4cc）

### 4.1 导入页

- 顶栏：圆形返回 `.ch-back#rd-import-close` + `ch-name 导入一本书`。
- 表单区 `#rd-import-form`（flex 纵向、可滚动）：
  - 「书名 可选」标签 + `#rd-imp-name`（44px 高）
  - 「从 TXT 文件导入」标题 + 虚线卡片 `.rd-file-label`
    （上传图标 / 选择 TXT 文件 / 支持 .txt，单本 20MB 以内）
  - 原生文件输入 `#rd-file.rd-file-native`（视觉隐藏）
  - 文件信息卡 `#rd-file-info`
  - GBK 提示条 `#rd-gbk-row` + `#rd-gbk`
  - 「或者」分隔 `.rd-import-or`
  - 「粘贴正文」标签 `#rd-paste-label`（粘贴后显示「粘贴正文 · N 字」）
  - `#rd-paste` textarea（`rows="5"`，flex 自适应长高）
- 底部 `#rd-import-go`：整宽 `.rd-btn-primary.rd-btn-block`，用 `--rd-primary`。
- 关键行为：
  - `rdSetPasteCount(n)` 把字数写在标签上，不再借用文件信息卡（避免看起来像文件信息）。
  - 选文件后会清空粘贴框（两份内容同时在场只会用文件）。
  - GBK 解码后会刷新文件信息与提示条。

### 4.2 确认分章页

- 顶栏：圆形返回 `#rd-confirm-back` + `ch-name 确认分章`。
- `#rd-confirm-sum-t`：「共 N 章 · M 字」。
- 「恢复自动分章」`#rd-confirm-reset`、「全部合并」`#rd-confirm-merge-all`
  改为两端文字按钮。
- `#rd-confirm-list`：每行
  - `rd-cf-top`：序号 `rd-cf-idx` + 标题按钮 `rd-cf-title`（点击改名）+ 字数 `rd-cf-n`
  - `rd-cf-ops`：「合并到下一章」「在此拆分」（最后一章不显示合并）
- 底部 `#rd-confirm-go`：整宽 `.rd-btn-primary.rd-btn-block`。
- 列表内部滚动，底部按钮固定。
- 分章操作的语义：合并 / 拆分 / 全部合并 / 恢复自动分章只影响本次导入。

### 4.3 卷标误切修复

`src/js/reading.js` 顶部：

```js
const RD_CH_TITLE_RE = /^\s*(?:(?:上|中|下)(?:卷|部|篇)(?=$|[\s：:·、，,—-]|第[0-9零一二三四五六七八九十百千万]+[章回卷节])|第[0-9零一二三四五六七八九十百千万]+[章回节卷](?!的)|卷[0-9零一二三四五六七八九十百千]+|序章|楔子|番外[一二三四五六七八九十]*|Chapter\s+\d+)/i;
```

- 卷标必须自成一段或以分隔符收尾，避免「下卷这一章…」这种正文行被当成标题。
- `第X章` 后紧跟「的」按正文处理，避免「第二章的正文…」被误切。
- 实测 GBK 文件 3 章识别正确。

### 4.4 移动端代理的坑（必读）

手机端 `src/js/mobile-adapt.js` 会把 input / textarea 替换成
`.ce-box[data-for="原 id"]` 的 contenteditable 代理：

- 原生控件加 `ce-ghost` 隐藏，`.value` 读写被代理，事件也转发。
- **textarea 的 `.ce-box` 会拿到内联 `min-height`**：
  `rows * 1.5 * 16`。`rows` 缺省是 3 → 72px，会把粘贴框压瘪。
  现在 `#rd-paste` 写了 `rows="5"`（120px），并配合 flex 长高。
- 新加输入框时，样式要同时覆盖原生控件和 `.ce-box`：
  `.rd-xxx` 和 `.ce-box[data-for="xxx"]`。
- 原生控件 `hidden` 会被 MutationObserver 同步到代理；隐藏搜索框可以直接
  `input.hidden = true`。
- 视觉验证时注意：`getBoundingClientRect` 量到的可能是隐藏的原生控件，
  真正可见的是代理 `.ce-box`。

---

## 5. 已完成 B：目录抽屉与书签（14dec36）

### 5.1 目录抽屉

DOM（在 `.rd-reader` 内，`src/js/reading.js` 约 378–405 行）：

```html
<div class="rd-toc-mask" id="rd-toc-mask" hidden></div>
<aside class="rd-toc" id="rd-toc" role="dialog" aria-label="目录" hidden>
  <div class="rd-toc-head">
    <div class="rd-toc-head-row">
      <span class="rd-toc-title">目录</span>
      <button class="rd-toc-x" id="rd-toc-close">✕</button>
    </div>
    <div class="rd-toc-prog">
      <div class="rd-toc-cur" id="rd-toc-cur"></div>
      <div class="rd-toc-meta"><span id="rd-toc-pos"></span><span id="rd-toc-pct"></span></div>
      <div class="rd-toc-bar"><span id="rd-toc-bar-fill"></span></div>
    </div>
    <div class="rd-toc-tabs" id="rd-toc-tabs">
      <button class="rd-toc-tab on" data-rtab="toc">目录</button>
      <button class="rd-toc-tab" data-rtab="marks">书签<span id="rd-mark-tab-n" hidden></span></button>
    </div>
    <input class="rd-toc-search" id="rd-toc-search" placeholder="搜索章节标题">
  </div>
  <div class="rd-toc-pane" id="rd-toc-pane-toc">
    <div class="rd-toc-list" id="rd-toc-list"></div>
    <button class="rd-toc-now" id="rd-toc-now" hidden>回到当前章</button>
  </div>
  <div class="rd-toc-pane" id="rd-toc-pane-marks" hidden>
    <div class="rd-mark-list" id="rd-mark-list"></div>
  </div>
</aside>
```

样式：`src/css/reading.css` 约 236–283 行。

- 抽屉宽 `min(80%, 328px)`，右侧贴边，圆角 16px 0 0 16px。
- 遮罩 `rgba(0,0,0,.34)`，点遮罩或 ✕ 关闭。
- 打开：`rdTocIn` 220ms 滑入；关闭：`rdTocOut` 160ms + 170ms 后 `hidden`。
- `prefers-reduced-motion` 下关闭动画。
- 夜间/护眼：靠 `var(--bg)` / `var(--line)` / `var(--ink)`，
  额外覆盖了进度卡、气泡、他、浮标、搜索框的配色。
- 新增带 `display:flex` 的面板必须加进 `reading.css` 第 3 行的
  `[hidden]{display:none!important}` 名单，否则关不掉。

### 5.2 顶部阅读进度

- `rdTocPaintProgress(book)`：
  - 当前章名（过长省略）
  - 「第 ch / 总章 章」
  - 全书百分比：`rdPosPct(book, b.ch, page.s)`（用索引里的 `chWords`）
  - 细进度条宽度 = 百分比
- 数据来源是书架索引里的书，而不是内存里的 `rdBook`（`rdBook` 没有 chWords）。

### 5.3 他在哪一章

- `rdTocHisCh(book)`：读索引里的 `book.buddy.ch`。
- 显示条件：
  - 共读总开关开
  - `buddy.started`
  - 不是「今天不读」（`mode==='skip'` 且 `skipDay` 是今天）
  - 章号在目录范围内
- 行右侧显示 16px 小圆标「他」。
- 与我的当前章 `.rd-toc-row.on` 可以共存（截图里同一行会同时有红字和「他」）。
- 他位置的真值由 `rdWriteProgress` 落盘；刚翻页后 300ms 内可能落后一页，可接受。

### 5.4 章批注气泡（懒加载）

- 每行右侧预留 `.rd-toc-badge`，默认 `hidden`。
- 打开抽屉后，`IntersectionObserver`（root 是 `#rd-toc-list`，
  `rootMargin:120px`）只对**可视行**调用 `getAnnos(book.id, ch)`。
- 缓存：
  - `rdTocBadgeBook`：当前缓存属于哪本书
  - `rdTocBadgeCache[ch] = { me, all }`
  - `rdTocBadgePending[ch]`：防重复请求
- 显示口径：
  - 共读开 → `all`
  - 共读关 → `me`（`a.by === 'me'`）
  - `>99` 显示 `99+`
- 缓存失效：`putAnnos()` 成功后调用 `rdTocBadgeDirty(id, ch)`；
  如果抽屉正开着，会立刻重新取这一章。
- 切书时 `openToc` 会清空缓存。
- 没有 `IntersectionObserver` 的旧内核不显示气泡（可接受降级）。

### 5.5 已读弱化 / 搜索 / 回到当前章

- 已读：`i < b.ch` 的行加 `is-read`，标题 opacity .38、序号 .22。
- 搜索：
  - `#rd-toc-search` 输入即过滤（标题或章序号包含查询串）
  - 无结果时显示「没有匹配的章节」
  - 搜索时隐藏「未定位批注」入口与「回到当前章」浮标
  - 每次打开抽屉会清空搜索串
- 「回到当前章」：
  - `rdTocUpdateNow()` 比较当前行与列表可视区域；当前行完全滚出才显示
  - 点击 `scrollIntoView({block:'center', behavior:'smooth'})`
  - **滚动监听在 `openToc` 里补绑**（页面骨架首次构建前元素不存在，
    早期在脚本尾部绑定会拿到 null；这是 `#1557a` 锚定的修复）

### 5.6 书签（我的，不是共读的折角书签）

- 数据存在书架索引的 `book.marks`：

```js
{ ch: 7, off: 120, q: "第一页开头的一段原文", at: 1792900104797 }
```

- 按「章 + 章内字符偏移」存，不存页码；换字号/换屏不会落错。
- 上限 `RD_MARK_MAX = 100` 条/本。
- 入口：
  - 阅读器顶栏 `#rd-mark-btn`（书签图标），当前页已收藏时实心 + `aria-pressed=true`
  - 抽屉页签「书签」+ 数量角标 `#rd-mark-tab-n`
- `rdMarkToggle()`：
  - 当前页范围 `[p.s, p.e)` 内已有 mark → 删除并提示「已取消这个书签」
  - 否则新增（`q` 取当前页开头 36 字，若以章节标题开头会去掉标题）
- 书签页 `rdMarkRenderList()`：
  - 章名 + 首句（两行截断）+ 百分比 + 时间（今天 HH:MM，否则 M/D）
  - 点行 → `rdMarkJump(i)`：关抽屉、设 `b.ch/b.off`、`rdEnsureChapter('offset')`
  - ✕ → `rdMarkDelete(i)`：用 `window.openModal` 的 `{noInput, staticText, warn}`
    做确认，确认后按 `ch/off/at` 三元组删除
- 空态：「还没有书签 / 阅读时点右上角的书签图标，收下当前这页」
- 书签在索引里，会随备份走；正文不在备份里（见第 6 节）。

### 5.7 关键函数索引（`src/js/reading.js`）

| 功能 | 函数 |
| --- | --- |
| 抽屉渲染 | `rdRenderToc(scrollCur)` |
| 进度头 | `rdTocPaintProgress(book)` |
| 他的章节 | `rdTocHisCh(book)` |
| 气泡 | `rdTocBadgePaint` / `rdTocBadgeFetch` / `rdTocBadgesBind` / `rdTocBadgeDirty` |
| 抽屉开关 | `openToc` / `closeToc(instant)` |
| 页签 | `rdTocShowTab(name)` |
| 浮标 | `rdTocUpdateNow()` |
| 书签 | `rdMarkSnippet` / `rdMarkCurPageHit` / `rdMarkUpdateBtn` / `rdMarkToggle` / `rdMarkRenderList` / `rdMarkJump` / `rdMarkDelete` |
| 跳章 | `rdJumpChapter(i)` |

事件委托在文件末尾的 `document.addEventListener('click', ...)`；
搜索输入在 `document.addEventListener('input', ...)` 里。

---

## 6. 数据模型与存储（必读）

### 6.1 localStorage（`window.xyStore('xy-home-v2')`）

| 键 | 内容 | 备注 |
| --- | --- | --- |
| `reading-prefs` | `{ fs: 17, lh: 1.8 }` | 字号/行距；源文件注释写「不进备份」，但当前 `data-backup.js` 的完整备份实际会带上所有小键（只额外跳过正文），以实际导出为准 |
| `reading-bg` | `'auto' \| 'eye' \| 'night'` | 阅读背景 |
| `reading-coop` | 共读总开关 | 关闭后冻结他的推进 |
| `reading-lamp` | 夜间留灯子开关 | 仅共读开时可用 |
| `reading-bookmark` | 折角书签子开关（他的提醒） | 注意和「我的书签」不是一回事 |
| `reading-habit-sync` | 阅读习惯同步子开关 |  |
| `reading-habits` | 阅读习惯小键 | 随备份走；只记时间/时长/页数 |
| `reading-books` | 书架索引数组 | 见下 |

### 6.2 IndexedDB（`window.idbGet / idbSet / idbGetAllKeys`）

| 键前缀 | 内容 |
| --- | --- |
| `xy-home-v2:reading-body:<bookId>:<ch>` | 单章正文 |
| `xy-home-v2:reading-toc:<bookId>` | 目录数组 `[{t, n}]` |
| `xy-home-v2:reading-anno:<bookId>:<ch>` | 该章批注数组 |

正文、目录、批注都在本机 IndexedDB；备份时只跳过正文
（`src/js/data-backup.js` 里的 `reading-body` 整键跳过），目录与批注会随备份走。
换机恢复后正文缺失，书本显示「待重新导入」；重新导入同一个 TXT 可按原文重新定位批注。

### 6.3 书架索引 `reading-books` 单本字段

| 字段 | 含义 |
| --- | --- |
| `id` | `bk_...`，正文/目录/批注的键都用它 |
| `title` | 书名 |
| `addedAt` | 导入时间 |
| `chapterCount` | 章数（部分旧数据可能只有 toc 长度） |
| `chWords` | 每章字数数组，进度百分比靠它 |
| `progress` | `{ ch, off }`，我的进度真值 |
| `buddy` | `{ mode:'follow'\|'solo'\|'skip', ch, off, started, waiting, updatedAt, skipDay, carry, prevMode }` |
| `status` | `'co' \| 'done' \| ...`（展示用） |
| `annoCount` | 累计批注数（展示用，不是每章精确数） |
| `lostAnnos` | 未定位批注 |
| `marks` | 我的书签数组（见 5.6） |
| `missing` | 正文不在本机（换机恢复后） |
| `pendingDelete` | 删除失败待重试 |

### 6.4 批注条目

```js
{
  id: "an_...", by: "me" | "his",
  s: 起始字符偏移, e: 结束字符偏移,
  quote: "原文", text: "字卡或批注内容",
  at: 时间戳, rev: 1, deviceId: "local",
  sealed: true?   // 共读封存纸条，读到才解锁
}
```

- `by === 'me'` 是我的；`his` 是他的。
- 章批注数组整体读写：`getAnnos` / `putAnnos`。
- 任何写入都会触发目录气泡缓存失效。

### 6.5 共读开关语义（不要破坏）

- 关闭共读：冻结他的推进与新内容生成；隐藏他的角标、淡痕、双圈、页脚位置、
  灯、共读手账、书脊细纹；**我的进度和自己的批注不受影响**。
- 数据不删；重新打开从当下继续（把书 `updatedAt` 拨到现在，不补算关闭期间）。
- 子开关只在总开关开时可操作，`rdRenderPrefsActive()` 里会置灰 `.rd-set-sub.is-off`。

---

## 7. 设置页「美化 / 功能 / 数据」（已于 2026-10-26 完成，保留作参考）

这是用户已经确认过的下一批，按下面做即可。

### 7.1 目标

把 `#page-reading-settings` 从一条长列表改成三栏：

- **美化**：边看边调入口、预览、字号、行距、阅读背景、**主按钮颜色**
- **功能**：共读总开关 + 夜间留灯 / 折角书签 / 阅读习惯同步
- **数据**：只读概览（本书架 N 本、正文约多少、存储与备份说明）

### 7.2 参考实现

- 聊天设置页结构：`src/template.html` 约 6759 行
  （`.them-tabs#cs-tabs` + `.them-sec[data-sec="beautify|function|data"]`）
- 切换逻辑：`src/js/chat-settings.js` 的 `initChatSettingsTabs()`（约 2526 行）
- 样式：`src/css/setting.css` 的 `.them-tabs` / `.them-tab` / `.them-sec`
- 读书设置现有结构：`src/js/reading.js` 的 `buildSettingsPage()`（约 398 行）
- 现有样式：`src/css/reading.css` 的 `#page-reading-settings` 与 `.rd-set-*`

### 7.3 建议结构

```html
<div class="chat-head">...</div>
<div class="rd-set-body">
  <div class="them-tabs" id="rd-set-tabs">
    <button class="them-tab active" data-tab="beautify" type="button">美化</button>
    <button class="them-tab" data-tab="function" type="button">功能</button>
    <button class="them-tab" data-tab="data" type="button">数据</button>
  </div>
  <div class="them-sec" data-sec="beautify">...</div>
  <div class="them-sec" data-sec="function" hidden>...</div>
  <div class="them-sec" data-sec="data" hidden>...</div>
</div>
```

- 页签放在 `.rd-set-body` 内，利用 `.them-tabs` 的 sticky 吸顶。
- 默认选中「美化」。
- 自己写一个 `initReadingSettingsTabs()`，参考聊天的 `show(name)`；
  不要去改聊天的 `initChatSettingsTabs()`（它是按 `#page-chat-settings` 绑定的）。
- 现有所有 ID 不要改：`#rd-set-fs-range`、`#rd-set-lh-range`、
  `#rd-set-bg-val`、`#rd-coop-toggle`、`#rd-lamp-toggle`、
  `#rd-bookmark-toggle`、`#rd-habit-sync-toggle`、`#rd-live-adjust`、
  `#rd-set-preview`，以及 `[data-rd-bgopt]`。
  `rdRenderPrefsActive()` / `buildSettingsPage()` 都按这些 ID 取元素。
- `#rd-live-adjust` 放在「美化」最上面，不要弄丢边看边调入口。

### 7.4 主按钮颜色

已确认的口径：

- 四档预设：墨黑（默认）、阅读粉、雾蓝、暖棕。
- 存 `reading-primary` 小键（`window.xyStore('xy-home-v2')`）。
- 通过 CSS 变量生效：

```css
.rd-btn-primary {
  background: var(--rd-primary, var(--ink, #111));
  color: var(--rd-primary-ink, var(--bg, #fff));
}
```

- 现有 `.rd-btn-primary` 已用这两个变量；只需在页面根节点设置变量。
- 设置范围：`#page-reading` 和 `#page-reading-settings` 都要设，
  因为设置页是 `.phone` 的兄弟页面，不在 `#page-reading` 里。
- 建议色值（可按对比度微调）：
  - 墨黑：`#111111` / 字 `#ffffff`
  - 阅读粉：`#d97a8c` / 字 `#ffffff`（不要用浅粉 `#f4b6c2` 配白字，对比不够）
  - 雾蓝：`#7893ad` / 字 `#ffffff`
  - 暖棕：`#8b6a4b` / 字 `#ffffff`
- 美化页加一行「主按钮颜色」，四个小圆/色块，选中项加描边；
  保存后立即应用到导入/确认/他的小卡等所有 `.rd-btn-primary`。
- 补一个 `rdApplyPrimary()`，在以下时机调用：
  - 页面初始化
  - 设置页打开
  - 用户点选颜色
- 注意 `reading-prefs` 的源文件注释写「不进备份」，但当前
  `data-backup.js` 的完整备份实际会导出所有小键（只额外跳过 `reading-body`）。
  主按钮颜色如果独立存 `reading-primary`，也会随完整备份走。
  改「换机保留」相关文案前，先复核 `data-backup.js` 的 skip 逻辑。

### 7.5 数据栏（只读，不做删除）

用户明确说「数据栏先只读」。建议内容：

- `书架 N 本`
- `正文约 X 万字`（`chWords` 求和，最省事且准确）
- 可选：`书签 M 条`、`批注 K 条`（`book.marks.length` / `book.annoCount` 求和）
- 存储说明：
  - 「正文只存在本机 IndexedDB，不随备份走；目录、批注、书架索引、书签会随备份走。」
  - 「换机恢复后正文需要重新导入，批注会按原文重新定位。」
- 不要做「清空 / 删除 / 导出」按钮（本批不做）。
- 如需显示 MB：不要为了统计把所有正文读一遍。
  推荐在导入时把 `rdUtf8Size` 的结果存进 `book.bytes`（`rdStartImport` 里已经算过
  字节数，只是目前没写进索引），旧书回退用 `chWords * 3` 估算；
  或只显示字数，不显示 MB。
- 数据在每次打开设置页时刷新。

### 7.6 验收清单（下一批）

- 三个页签互斥显示，默认美化；切页不丢控件状态。
- 字号/行距/背景/共读四个开关仍即时生效。
- 选主按钮颜色后：
  - 设置页内色块选中态正确
  - 返回书架 → 导入页「开始导入」「确认导入」、阅读器「去他那里」、
    批注「贴上」等主按钮颜色都变
  - 重新打开页面后设置仍在
- 数据栏数字与 `window.__readingProbe.readIndex()` 对得上。
- 护眼/夜间下设置页仍可读（设置页本身跟随全局主题，不跟阅读器背景）。
- `window.__jsErrors` 为 0。
- 构建 4483+ 条哨兵、sw 16/16 通过。

---

## 8. 仍在待办里的视觉项（非下一批强制）

来自 `docs/plans/2026-10-24-ui-polish.md` 第五节，按现状更新：

1. 批注浮层主语与文案：署名行已弱化为 10px / .42；是否去掉署名行或让文案自带主语，
   仍可再问用户。
2. 阅读器顶栏统一 `chat-head`：已完成（返回 + 书名 + 书签 + 目录）。
3. 细节精修：
   - 书脊细纹
   - 小卡头像
   - 页脚三种状态文案层级
   - 封存 / 解锁提示
   - 错过七天的划痕质感
   - 角标密度
4. 导入面板与确认分章屏：已完成（本批 A）。
5. 共读手账视觉层级：未做。
6. 书架空态：未做。
7. 书籍分组与置顶：**仍然搁置**。用户说过不着急。
   动手前需要单独设计：
   - 书架索引字段（分组 id / 置顶顺序）
   - 分组管理入口
   - 长按 / 拖拽交互
   - 备份迁移
   不要顺手做。

---

## 9. 已知坑与排错

### 9.1 分支 / 文件回退

- 症状：`.rd-grid` 的 padding 变回 `0 16px`；导入页变回旧的
  `rd-import-title` / `rd-back`；`putAnnos` 里没有气泡失效代码。
  → 你在 `trae/agent-HyW2zB` 或更旧的分支。`git checkout main`。
- 症状：构建报 `#1554b` / `#1554d` / `#1557a` 缺失。
  → 先确认在 main；如果确实改了锚点文本，同步改 `build.mjs` 的 needle；
    不要删哨兵。用一次 `--allow-revert` 放行。

### 9.2 面板关不掉

- 任何新面板只要 CSS 写了 `display:flex/block`，`[hidden]` 就会被作者样式盖过。
  必须把选择器加进 `src/css/reading.css` 第 3 行的
  `... [hidden]{display:none!important}` 名单。
- 现有名单包括：`.rd-toc`、`.rd-toc-mask`、`.rd-toc-pane`、
  `.rd-toc-search`、`.rd-toc-badge`、`.rd-toc-now`、`.rd-toc-tab-n` 等。

### 9.3 顶栏共用类

- `.rd-import-head` 不只导入页在用：`他在哪`、`目录`（旧的已换掉）、
  `选一张字卡`、`预览批注`、`这句旁边的批注`、`未定位的批注` 都在用。
  它默认 `justify-content:space-between`。
  导入页 / 确认页的左对齐是靠
  `.rd-import-main > .rd-import-head, .rd-confirm > .rd-import-head` 作用域规则，
  **不要**把全局 `.rd-import-head` 改成 `flex-start`，否则其他浮层的「关闭」
  会跑到标题旁边。

### 9.4 手机端输入

- 见 4.4。新输入框必须同时写原生和 `.ce-box[data-for]` 两套样式；
  textarea 记得给 `rows`。
- `.rd-toc-search` 的隐藏依赖原生 `hidden` 同步到代理；已验证可用。

### 9.5 测试环境

- 预览代理可能 401；用本地 `python3 -m http.server` + 浏览器工具。
- 500×598 的测试 viewport 比真机矮，导入页可能只差十几像素出现滚动条；
  真机 390×844 不会。不要为测试 viewport 过度压缩。
- 浏览器 profile 里可能有测试书（`粘贴的书`、`gbk测试` 等）和夜间背景；
  这是测试数据，不是仓库内容。
- 内存提示条、他的好奇、模拟来电可能挡住点击；按第 3.3 节关闭。
- 截图不要放进 `/workspace/.screenshots/`，更不要提交。

### 9.6 书签 / 折角书签命名

- `reading-bookmark`、`rdBookmark*`、`.rd-bookmark-toggle` 是**共读的折角书签**
  （他的提醒）。
- 本批新增的是**我的书签**：`book.marks`、`rdMark*`、`#rd-mark-btn`。
- 改代码/文案时不要混。

### 9.7 数据与备份

- 正文只在本机 IDB，不进备份。
- 书签在 `reading-books` 索引里，随备份走；目录、批注也在备份里。
- `reading-prefs` 的注释与 `data-backup.js` 实际行为不一致（完整备份会带上小键）；
  写数据页文案时以 `data-backup.js` 的 skip 逻辑为准。主按钮颜色如果独立存
  `reading-primary`，也会随完整备份走。
- 删除书时会按前缀清正文/目录/批注；书签随索引条目一起删。

---

## 10. 参考路径与关键选择器

### 源文件

- `src/js/reading.js`：读书模块全部行为（约 4300 行）
- `src/css/reading.css`：读书模块样式（约 380 行）
- `build.mjs`：构建 + `FIX_SENTINELS`
- `src/js/mobile-adapt.js`：手机输入代理
- `src/js/chat-settings.js`：设置页页签参考
- `src/css/setting.css`：`.them-tabs` / `.them-tab` / `.set-group` / `.toggle`
- `src/template.html`：聊天设置页结构参考（约 6759 行）
- `docs/plans/2026-10-24-ui-polish.md`：开工文档、测试手法

### 常用选择器

| 选择器 | 用途 |
| --- | --- |
| `.app[data-app="reading"]` | 首页读书入口 |
| `#page-reading` | 书架 + 阅读器页 |
| `#rd-shelf` / `#rd-grid` | 书架 / 书卡网格 |
| `#rd-import` / `#rd-import-panel` | 书架右上导入 |
| `#rd-import-go` / `#rd-confirm-go` | 导入 / 确认主按钮 |
| `#rd-reader` / `#rd-body` | 阅读器 |
| `#rd-mark-btn` / `#rd-toc-btn` | 阅读器顶栏书签 / 目录 |
| `#rd-toc` / `#rd-toc-mask` | 目录抽屉 / 遮罩 |
| `#rd-toc-list` / `.rd-toc-row.on` | 目录列表 / 当前章 |
| `.rd-toc-him` / `.rd-toc-badge` | 他在章节 / 批注气泡 |
| `#rd-toc-now` | 回到当前章 |
| `#rd-toc-tabs .rd-toc-tab` | 目录 / 书签页签 |
| `#rd-mark-list` / `.rd-mark-row` | 书签页 |
| `#rd-shelf-settings` | 书架右上设置 |
| `#page-reading-settings` | 阅读设置页 |
| `#rd-set-fs-range` / `#rd-set-lh-range` | 字号 / 行距滑块 |
| `[data-rd-bgopt]` | 背景选项（auto/eye/night） |
| `#rd-coop-toggle` 等 | 共读开关 |
| `#rd-live-adjust` / `#rd-live-drawer` | 边看边调入口 / 抽屉 |

---

## 11. 提交记录

```text
4491a68 ...                     Merge branch 'trae/agent-HyW2zB'（-s ours：只同步分支，测试截图不进 main）
14dec36 2026-10-25 11:51 +0800  feat(reading): 目录改右侧抽屉，加进度/他在章节/批注气泡/搜索/书签
14ab4cc 2026-10-25 10:51 +0800  feat(reading): 重做导入页与确认分章页，修卷标误切
a112dd4 2026-10-25 09:48 +0800  Merge branch 'trae/agent-HyW2zB'
db02a22 ...                     feat: update workspace（旧分支 tip，不含最近两批）
...                             docs: 读书模块交接文档（分支/构建/已完成/下一批/排错）
```

- `main` 的最新提交可能是交接文档或同步分支的 merge；功能代码停在 `14dec36`，工作区干净。
- 合并用了 `-s ours`：代理分支唯一的新提交只加了两张测试截图，没有进 main。
- `origin/main` = `a112dd4`；`main` 本地领先 3 个以上提交。
- 换号/部署前如需推送：先征得用户同意，再用原账号 `git push origin main`。

---

## 12. 建议的恢复顺序（一句话版）

1. `git checkout main`，确认工作区里有本文档。
2. `node build.mjs --allow-revert`，确认 4483/4483、16/16。
3. 起本地服务，打开读书 → 导入一本短书，过一遍导入/确认/目录/书签。
4. 按第 7 节做设置页三栏。
5. 构建、实测、提交；需要发布时先问用户再 push。
