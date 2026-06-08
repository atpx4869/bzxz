# public/styles.css — 分区映射

> 1179 行单文件的逻辑分区索引。物理拆分推到 P1（拆完会把 `index.css`
> 的 `@import '../../../public/styles.css'` 替换成下表里这些子文件）。
>
> 之所以现在不动：legacy `public/index.html` 仍直接 `<link>` 这份文件，
> 一旦拆分需要同时切两套入口，回归风险大。先以本表锁定边界，迁移到
> Vite 入口稳定后再做真正的物理拆分。

## 拟定文件树

```
web/src/styles/
├── base.css            # ✅ 已落地：:root tokens + reset
├── theme/
│   ├── tokens.css      # :root 变量（已在 base.css）
│   ├── glass.css       # frosted/glass overrides
│   └── legacy.css      # ⬅ 新增（Win7/Chrome ≤109 兜底主题；纯 hex；
│                       #    不写 oklch；由 :root[data-theme="legacy"] scope）
├── layout/
│   ├── topbar.css
│   ├── sidebar.css
│   ├── content.css
│   └── log-panel.css
├── components/
│   ├── buttons.css
│   ├── search-bar.css
│   ├── filter-bar.css
│   ├── result-card.css
│   ├── modal.css
│   ├── toast.css
│   ├── spinner.css
│   ├── toggle-switch.css
│   ├── context-menu.css
│   ├── progress-strip.css
│   ├── search-history.css
│   ├── batch-card.css
│   ├── skeleton.css
│   ├── shortcuts-overlay.css
│   ├── auth-overlay.css
│   ├── user-dropdown.css
│   ├── download-center.css
│   └── env-warning.css
├── pages/
│   ├── stats.css
│   ├── users.css
│   ├── qualifications.css
│   ├── completion.css
│   ├── announcement.css
│   ├── admin.css
│   └── settings.css      # ⬅ 新增（设置面板重设计，非拆分自 styles.css）
└── index.css           # 汇总 @import
```

## styles.css 当前分区（行号近似）

| 行 | 分区 | 目标文件 |
|----|------|---------|
| 1     | reset                         | base.css |
| 3–27  | :root tokens                  | base.css / theme/tokens.css |
| 29–30 | html/body                     | base.css |
| 32–55 | Topbar                        | layout/topbar.css |
| 57–85 | Sidebar + collapsed           | layout/sidebar.css |
| 86–90 | Content                       | layout/content.css |
| 91–105 | Search area                  | components/search-bar.css |
| 106–115 | Buttons                     | components/buttons.css |
| 116–118 | "load more" sentinel        | components/result-card.css |
| 119–144 | Env warning banner          | components/env-warning.css |
| 145–156 | Confirm modal               | components/modal.css |
| 157–167 | Summary + toolbar           | components/result-card.css |
| 168–181 | Filter bar                  | components/filter-bar.css |
| 182–251 | Result list                 | components/result-card.css |
| 252–265 | Status group sections       | components/result-card.css |
| 266–275 | Right-click context menu    | components/context-menu.css |
| 276–292 | Per-source progress strip   | components/progress-strip.css |
| 293–303 | Search history dropdown     | components/search-history.css |
| 304–336 | Batch result cards          | components/batch-card.css |
| 337–382 | Standard completion         | pages/completion.css |
| 383–410 | Log panel                   | layout/log-panel.css |
| 411–465 | Modal                       | components/modal.css |
| 466–469 | Spinner                     | components/spinner.css |
| 470–478 | Scrollbar                   | base.css（全局） |
| 479–548 | Toggle switch               | components/toggle-switch.css |
| 549–573 | Download center             | components/download-center.css |
| 574–586 | Toast                       | components/toast.css |
| 587–590 | Card entrance               | components/result-card.css |
| 591–600 | Skeleton loading            | components/skeleton.css |
| 601–621 | Layout-mirroring skeleton   | components/skeleton.css |
| 622–631 | Shortcuts overlay           | components/shortcuts-overlay.css |
| 632–685 | Auth overlay (glass)        | components/auth-overlay.css |
| 686–697 | Brand tokens (topbar)       | layout/topbar.css |
| 698–706 | User dropdown               | components/user-dropdown.css |
| 707–719 | Stats                       | pages/stats.css |
| 720–732 | Users table                 | pages/users.css |
| 733–964 | Qualification badges 等大段  | pages/qualifications.css |
| 965–991 | Ambient gradient + orbs     | theme/glass.css |
| 992–1013 | Frosted topbar override    | theme/glass.css |
| 1014–1035 | Frosted sidebar override  | theme/glass.css |
| 1036–1048 | Primary button gradient   | theme/glass.css |
| 1049–1070 | Glass card overrides      | theme/glass.css |
| 1071–1088 | Result cards frosted      | theme/glass.css |
| 1089–1095 | Source/filter chips       | theme/glass.css |
| 1096–1113 | Topbar brand z-index fix  | theme/glass.css |
| 1114–1150 | Announcement modal        | pages/announcement.css；主题覆盖见 theme/glass.css Phase 6 / legacy.css |
| 1151–1161 | Admin announcement mgr    | pages/admin.css |
| 1162–1179 | Qualification flatter     | pages/qualifications.css |

## 状态总览（2026-05-23）

**P1 全量拆分已落地**。`web/src/styles/` 下的 31 个 css 文件覆盖了 `public/styles.css`
的所有分区（base / 4 个 layout / 18 个 components / 6 个 pages / responsive / theme）。
`index.css` 重写为目标导入顺序，所有文件与 `public/styles.css` 对应段落
"重复加载、cascade 等价"，整体视觉零变化。

剩余工作（不在 P1 范围内）：
- 待 legacy `public/index.html` 入口废弃时，执行两步切换：
  1. 删除 `public/styles.css` 中已抽出的所有段落
  2. 删除 `index.css` 里的 `@import '../../../public/styles.css'`
- 把 `pages/*.css` 拆到对应 page 的 entry chunk（Vite code split）—— 见执行顺序第 5 条。

## Legacy 主题（2026-06，第四主题，独立 cascade）

`theme/legacy.css` 是为 Win7 / Chrome ≤109 用户提供的第四主题，**与 P1 拆分方向无关**：

- 整文件全 hex 调色板，**禁止** oklch / color-mix / backdrop-filter / mask-image /
  Google Fonts / SMP 区彩色 emoji（详细禁用清单见 `CLAUDE.md`「Legacy 主题契约」段）
- 由 `:root[data-theme="legacy"]` scope 化，与 dark/light/paper 三个现代主题
  **完全隔离**，零侵入。`index.css` 中加载顺序在 `glass.css` 之后 → 最后赢
- 自动触发：`public/index.html` + `web/index.html` `<head>` 顶部 FOUC 内联 script
  检测 UA，Chrome ≤109 / Windows NT 5.x|6.x 自动写入 `localStorage 'bzxz.theme'='legacy'`
- 手动触发：topbar picker + 我页 chip 第 4 项 `◆ 经典`
- 镜像追加：`public/styles.css` 末尾同段（沿用迁移期双轨契约）
- `scripts/css-oklch-fallback.mjs` 的 `SKIP_FILES` 白名单跳过此文件

## 设置面板重设计（2026-05-29，与 P1 拆分方向相反）

`pages/settings.css` 是**新增文件**，不是从 `public/styles.css` 抽出的段落 ——
方向相反：先在 `web/` 写好，再**镜像追加**到 `public/styles.css` 末尾（维持两份并存
契约）。它定义一套 `.set-*` 统一元件（layout / nav / section / card / row / seg /
toggle 复用 / status / field / tabs / chip / progress / inline-add / head-row /
actions / subsection / versions），取代旧设置页的
`.settings-card` / `.desktop-setting-card` / `.web-access-card` / `.setting-choice` /
`.qual-settings-tabs` 等多种方言。

**主题纪律（与其它文件不同）**：本文件只用 `var(--*)` token，无裸 oklch、无 `color-mix`，
故**无需** `theme/glass.css` 的 light/paper override，也无需 oklch fallback。新增 `.set-*`
样式务必延续此纪律。详见 `docs/SETTINGS-REDESIGN.md` 的分期路径：
- **Phase A 已落地**（纯样式，暂无 HTML 引用）
- **Phase B 已落地**（资质订阅区块接 `.set-section-head`/`.set-tabs`）
- **Phase C 已落地**（`app-settings.js` 内 `renderSettings` 整体重排为 `.set-layout` 左导航
  + 右内容；四张卡片渲染函数统一为 `.set-card`/`.set-row`；两个 `index.html` 的
  `#page-settings` 包裹为 `.set-layout`，资质块 `id=set-sec-qual` 折入同一两栏。新增辅助类
  `.set-head-row`/`.set-actions`/`.set-subsection`/`.set-versions`）
- **Phase D 待办**（有可用构建环境后，把 legacy `app-settings.js` 真正抽成
  `web/src/modules/settings/` TS 组件并删除旧文件）

### 全站组件层外扩（2026-05-30，PAGES-REDESIGN.md Phase A）

`pages/settings.css` 末尾追加一段「全站统一组件层」，把设置页验证过的 `.set-*`
体系外扩到其余 8 页用。新增成员：`.set-page-head`/`.set-kicker`/`.set-card-head`/
`.set-card-title`/`.set-toolbar`(`-left/-right`)/`.set-table`(`-wrap` + `.col-check/
.col-actions/.col-num`)/`.set-search`(`.thin`)/`.set-chips` + `button.set-chip`
交互态/`.set-stats`/`.set-stat`(语义色)/`.set-empty`/`.set-stepper`/`.set-step`(态)/
`.set-badge`(语义色)/`.set-split`(`-wide`)/`.set-switch-danger`/`.set-scroll-pane`/
`.set-pager`/`.set-modal`(`-backdrop/-head/-body/-foot`，`.is-danger`)。
**纯新增、暂无 HTML 引用**（CI 必绿），Phase B–E 各页逐步接上。同段**镜像追加**到
`public/styles.css` 末尾（维持双入口 cascade 等价）。延续本文件主题纪律：只用 token、
无裸 oklch、无 `color-mix`；唯一例外是 `.set-modal` 阴影沿用 `components/modal.css`
的 rgba 字面量（`--shadow-lg` 仅 light/paper 定义，dark `:root` 无）。

## 拆分执行顺序（P1）

1. ~~切出 `theme/glass.css`（最后两百行，整段贴）——
   边界清晰、且按 cascade 顺序必须最后加载。~~ **已落地（2026-05-23）**：
   `web/src/styles/theme/glass.css` 创建并在 `index.css` 里接到
   `public/styles.css` 之后。过渡期与原文件**重复加载**（cascade 等价）；
   待 legacy `public/index.html` 入口废弃时再从 `public/styles.css` 删
   行 965–1112 并去掉 `@import '../../../public/styles.css'`。
2. ~~切出 `components/auth-overlay.css`（632–685）—— 独立组件，与登录改造同步。~~
   **已落地（2026-05-23）**：实际抽出 632–684 + 691–695（含 `@media max-width:520px`
   的响应式 override），写入 `web/src/styles/components/auth-overlay.css`，在 index.css 里
   `glass.css` 之前接入。同样的过渡期"重复加载、cascade 等价"模式，待 legacy
   入口废弃时统一两步切换。
3. 按表逐个切出 `components/*` 文件，每切一个跑 `npm run web:build` +
   人工对比关键页（搜索/批量/资质/统计/用户/设置）。

   **小件批次已落地（2026-05-23）**：
   - `components/spinner.css`             行 466–468
   - `components/toast.css`               行 574–585（定义全局 `@keyframes toastIn`）
   - `components/shortcuts-overlay.css`   行 622–630（复用 toastIn，排在 toast.css 之后）

   **第二批小件已落地（2026-05-23）**：
   - `components/env-warning.css`         行 119–143
   - `components/context-menu.css`        行 266–274
   - `components/progress-strip.css`      行 276–291（含 `.source-badge` 与 `.source-{bz,gbw,by}`）
   - `components/search-history.css`      行 293–302

   **layout 已落地（2026-05-23）**：
   - `layout/topbar.css`                  行 32–55 + 686–689（brand tokens）
   - `layout/sidebar.css`                 行 57–85
   - `layout/content.css`                 行 86–90
   - `layout/log-panel.css`               行 383–410 + 571–572（.log-export-btn 孤儿行）

   **components 全部已落地（2026-05-23）**：
   - `components/buttons.css`             行 106–115 + `@keyframes btn-spin`（从行 216 抽出，
     被 progress-strip 的 `.src-prog-spin`、result-card 的 `.btn-spinner` 共用）
   - `components/search-bar.css`          行 91–105
   - `components/filter-bar.css`          行 168–181
   - `components/modal.css`               行 145–156 + 411–465（定义 `@keyframes panelIn`）
   - `components/toggle-switch.css`       行 479–548
   - `components/download-center.css`     行 549–570（不含 571–572）
   - `components/skeleton.css`            行 591–600 + 601–621（含内嵌 `@media max-width:1100px`，
     紧耦合，没分散到 responsive.css）
   - `components/user-dropdown.css`       行 698–706（复用 modal.css 的 panelIn）
   - `components/batch-card.css`          行 304–336
   - `components/result-card.css`         行 116–118 + 157–167 + 182–265 + 587–590
     （含 `@keyframes text-badge-pulse`、`@keyframes cardIn`、`.status-indicator`、
     `.has-text-badge`、`.status-group` 全套）

   **pages 全部已落地（2026-05-23）**：
   - `pages/stats.css`                    行 707–719
   - `pages/users.css`                    行 720–732
   - `pages/qualifications.css`           行 733–887 + 1162–1179
   - `pages/completion.css`               行 337–382
   - `pages/announcement.css`             行 1114–1150（基础亮色调色板；实际主题弹窗由 `theme/glass.css` Phase 6 / `theme/legacy.css` 覆盖）
   - `pages/admin.css`                    行 1151–1161（亮色管理表单基线；公告 popup 本体走主题覆盖）

   **responsive 已落地（2026-05-23）**：
   - `responsive.css`                     行 889–963（三个 `@media`：1100 / 900 / 640px）
     设计决策：保留单一汇总文件而非分散到 15 个 component。每个 `@media` 块内按
     选择器所属 component 加分段注释，未来若需要可按注释 inline。
     cascade 位置：在 pages/* 之后、theme/glass.css 之前 —— 窄屏覆盖压过基线，主题最后赢。

   **base.css 增补 (2026-05-23)**：
   - `::-webkit-scrollbar` 全套           行 470–474
   - `@keyframes countIn` + `.count-anim` 行 476–477（全局 utility）

4. 全部切完后删除 `index.css` 里对 `public/styles.css` 的 `@import`，
   同步把 legacy `public/index.html` 切走（或保留双链路一段时间）。**待执行**。
5. 最后把 `pages/*.css` 拆到对应 page 的 entry chunk（Vite code split）。**待执行**。
