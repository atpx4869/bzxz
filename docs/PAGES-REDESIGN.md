# 全站页面 UI 重构方案（PAGES-REDESIGN）

> 续 `docs/SETTINGS-REDESIGN.md`。设置页已用 `.set-*` 组件系统重构完毕；本方案把
> **同一套词汇 + 同一套纪律** 推广到其余 9 个菜单页面。
>
> **目标**：消除「每页各自造卡片/表格/工具条/标题」导致的拼凑感，让 9 个页面
> 共享一套 token-only、三主题自适应的组件，同时**顺手修掉沿途暴露的逻辑毛病**
> （用户明确要求：重做时把"逻辑不完善"的地方一并捎上）。
>
> **纪律（与设置页一致，强制）**：
> - 只用 `var(--*)` token，禁止裸 `oklch()`（除非配 sRGB fallback）、禁止 `color-mix()`
>   （Win7 Chrome ≤109 不支持）。`.set-*` 系统天生满足，所以**零 glass.css override、零 oklch fallback**。
> - `public/styles.css`（legacy 入口）与 `web/src/styles/*`（Vite 入口）**双写镜像**，
>   cascade 等价。每次改一处必须镜像另一处。
> - 构建只在 GitHub Actions 跑（`web:typecheck → web:test → web:build → backend build → test`），
>   本机不验证；Claude 侧只做静态核查。
> - `announcement.css` / `admin.css` 的**亮色调色板**（`#fff/#333/#eee/#2563eb`）是有意为之，不动。
> - 分期落地、零构建风险优先：先建组件（纯新增 CSS，不破坏现状），再逐页替换。

---

## 一、现状诊断：拼凑感从哪来

把 9 个页面的 HTML（`public/index.html` 113–510 行）、页面级 CSS
（`web/src/styles/pages/*.css`）、渲染 JS（`public/js/app-*.js`）摊开看，
拼凑感有 7 个具体来源：

### 1. 两套页头约定并存

- **规范派**（批量下载 / 标准补全 / 本地文件库 / 下载历史）：用 `.page-heading > div > h2 + p`，
  标题下带一句副说明，右侧可放操作按钮。结构统一、好看。
- **裸标题派**（资质查询 / Labr / 使用统计 / 用户管理 / 系统设置）：直接写
  `<h2 style="font-size:20px;font-weight:600;margin-bottom:18px">`，**内联样式硬编码**，
  无副说明，无操作位。设置页已经在重构里改掉，其余 4 页仍是裸 h2。

→ **同一个产品，标题忽大忽小、忽有副标题忽没有。**

### 2. 每页各自造「卡片」

一个语义相同的「带边框、圆角、半透明深色背景的容器」，被复制成 6 个名字：

| 类名 | 出处 | 视觉 |
|---|---|---|
| `.batch-card` | 批量下载 | `border + radius + oklch(17%…/.46)` 背景 |
| `.complete-card` | 标准补全 | 同上，padding 16px |
| `.library-card` | 下载历史 | 同上，padding 16px |
| `.qual-visual-card` | 资质-可视化 | 同上，padding 12px |
| `.qual-lab-card` / `.qual-preset-item` | 资质-订阅 | 同上变体 |
| `.stats-chart-box` / `.stat-card` | 使用统计 | 同上，裸 `oklch()` + sRGB fallback |

→ 6 套卡片，padding、背景 alpha、圆角都有细微出入；`.set-card` 本可一统。

### 3. 「kicker / 小标题」也复制成多份

`.batch-kicker`（批量）被资质-可视化、标准补全直接借用 →
**一个事实上的共享原子，却挂着 "batch" 的名字**。
此外还有 `.qual-section-title`（带 `::after` 横线）、`.library-head h3`、
`.complete-card-head h3` 三种「区块标题」写法。

### 4. 三套「工具条」

- 搜索页 `.toolbar`（左右分区，`.toolbar-left/.toolbar-right`）
- 本地库 `.local-toolbar`（搜索框 + actions）
- 统计页 `.stats-controls`（日期区间 + 刷新）

→ 三种实现，间距/对齐各写各的。

### 5. 两套「表格」+ 一堆「卡片列表」

- `.local-table`（本地库，sticky thead）
- `.users-table`（用户管理，uppercase th）
- 资质 / 历史 / 可视化用的是各自的卡片列表（`.qual-result-item` / `.library-item` /
  `.qual-visual-*`）。

→ 表格两套样式不统一；"列表"在不同页又是另一套语言。

### 6. 两套「Tab 控件」

- 资质查询页 `.qual-tab`（下划线式），**整段内联样式**写在 HTML 里
  （`index.html` 318–320 行，每个 button 一长串 `style="…border-bottom:2px solid…"`）。
- 设置页 `.set-tab`（已重构）。资质-订阅区块是 `.qual-settings-tab.set-tab` 混用过渡态。

→ 同样是 tab，一处内联硬编码、一处组件化。

### 7. 内联样式泛滥（最大的"脏"源）

`grep style=|.style.` 命中分布（`public/js/`）：

| 文件 | 命中数 | 说明 |
|---|---|---|
| `app-qual.js` | 85 | 资质页渲染，重灾区 |
| `app-settings.js` | 77 | 多数已重构，剩资质-订阅区块未清 |
| `app-auth-admin.js` | 42 | 含用户管理表格渲染 |
| `app-download.js` | 35 | 历史/收藏/下载中心渲染 |
| `app-detail-utils.js` | 24 | 结果详情 |
| `app-search.js` | 19 | 搜索结果卡 |
| `app-labr.js` | 5 | Labr 结果 |

外加 HTML 里页面级内联样式：资质页 tab/容器、用户管理整条筛选栏
（`index.html` 398–415 行十余处 `style="font-size:13px;color:var(--text-2)…"`）、
统计/Labr 的裸 h2。

→ 内联样式 = 无法被主题统一接管、无法复用、改一处要满文件找。

---

## 二、设计原则（沿用设置页五条）

1. **一套组件，三主题自适应。** 所有页面共用 `.set-*` 体系（必要时扩展新成员），
   只用 token，零主题 override。新主题/调色只改 `:root` 变量即可全站生效。
2. **只有两级"浮起"。** 页面背景（纯 `var(--bg)` 平铺）+ 一级卡片（`.set-card`）。
   不要卡中卡中卡的多层叠背景（资质-可视化现在最多叠了 4 层）。
3. **"行"是列表原子。** 列表统一用 `.set-row`（带 label/value/actions 槽位），
   表格统一用一套 `.set-table`。不再每页各造 item。
4. **页头统一。** 所有页面用同一个 `.set-page-head`（标题 + 副说明 + 右侧操作位），
   消灭裸 `<h2 style=…>`。
5. **统一标题层级。** 页标题 / 卡标题 / kicker 三级，分别对应
   `.set-page-head h1`、`.set-card-title`、`.set-kicker`，全站同字号同字重。

---

## 三、统一组件系统：在 `.set-*` 基础上扩展

设置页已有：`.set-layout` / `.set-nav` / `.set-content` / `.set-card` / `.set-row` /
`.set-actions` / `.set-head-row` / `.set-section` / `.set-tab` / `.set-tabs`。

本方案**新增**以下成员（仍是 token-only，放进 `settings.css` 改名为通用层、
或新建 `components/set-kit.css`，二选一见 §六）：

| 新成员 | 作用 | 取代谁 |
|---|---|---|
| `.set-page-head` (`+ h1 + p + 右侧 slot`) | 统一页头 | `.page-heading`、所有裸 `<h2 style>` |
| `.set-kicker` | 卡内小标签 | `.batch-kicker`、`.complete` 里复用的 kicker |
| `.set-card-title` | 卡标题（15px/650） | `.batch-card-head h3`、`.library-head h3`、`.complete-card-head h3`、`.qual-visual-card h3` |
| `.set-toolbar` (`+ -left / -right`) | 统一工具条 | `.toolbar`、`.local-toolbar`、`.stats-controls` |
| `.set-table` (`thead/td/sticky/hover`) | 统一表格 | `.local-table`、`.users-table`、`.qual-lab-tasks-table` |
| `.set-search` (glass shell + input) | 统一搜索框壳 | `.search-row` + `.qual-search-row` + `.labr-search-row` 三处覆写 |
| `.set-chip` (`+ .active`) | 胶囊筛选/标签 | `.qual-filter-btn`、`.source-tag`、`.normalize-chip` |
| `.set-stat` (grid + value + label) | 数字概览卡 | `.stat-card`、`.qual-visual-stats`、`.complete-result-stats` |
| `.set-empty` | 空状态占位 | `.qual-empty`、`.library-empty`、`.batch-results-empty`、`.local-empty` |
| `.set-stepper` (`+ .active/.done/.error`) | 步骤指示 | `.complete-steps`（目前唯一，提为通用） |
| `.set-badge` (`+ 语义色变体`) | 状态徽章 | `.badge-admin/-user/-active/-inactive`、资质 scope badge |

**命名收口**：业务专属、视觉独特、且只此一处的，保留原名（如资质 `.qual-badge`
徽章、`.qual-visual-bars` 能力条形图、PDF 预览 `.preview-*`）。**只统一"通用容器/
列表/工具条/标题/空态"这些反复出现的骨架**，不强行把所有特化视觉塞进 `.set-*`。

---

## 四、逐页方案

每页给三样：**① 旧 class → `.set-*` 替换映射**、**② 逻辑待修**（用户要求重做时一并捎上）、
**③ 落地阶段**。可视化原型见 `docs/pages-redesign-prototype.html`。

### 4.1 标准检索（search）

页面 `#page-search`，渲染 `app-search.js`（19 处内联 style）。这是最复杂、改动风险最高的页
（结果卡 / 三态文本徽章 / 分源 loading strip / 右键菜单 / j-k 导航都在此），**放最后一期**。

> **⚠ 用户明确要求：标准检索的结果排版「还是老的排版来」。**
> 即保留原有的 **工具条 + 多组筛选 chip + 网格表头 + 可折叠状态分组 + 网格行卡** 整体形态
> （`.toolbar` / `.filter-chip` / `.results-table-head` / `.status-group` / `.result-card` /
> `.source-badge` / `.text-badge-*`）。本页**不重做布局**，只做三件轻活：
> ① 页头统一成 `.set-page-head`；② 搜索框外壳统一成 `.set-search`；③ 配色/间距收口到 token。
> 结果网格表、分组、徽章语义、列宽、列定义**一律不动**。原型 `#page-search` 即此形态。

**① 替换映射（仅外壳，结果区不动）**

| 旧 | 新 | 备注 |
|---|---|---|
| 裸 `<h2>` / 无副说明 | `.set-page-head`（h1 + p） | 仅页头 |
| `.search-area` + `.search-row` | `.set-search`（与 Labr/资质共用搜索壳） | 仅搜索框外壳 |
| `.toolbar` / `.toolbar-left` / `.toolbar-right` | **保留原类**（已是 token，仅核对配色） | 不动 |
| `.filter-chip` / `.chip-count` | **保留原类** | 不动 |
| `.results-table-head`（7 列网格） | **保留原类**（列定义不变） | 不动 |
| `.status-group` / `-header` / `-body` | **保留原类**（折叠交互不变） | 不动 |
| `.result-card`（网格行） | **保留原类** | 不动 |
| `.source-badge` / `.text-badge-*` / `.qual-badge` | **保留原类**（语义色不变） | 不动 |

**② 逻辑待修**

- `app-search.js` 19 处内联 style（多为 `display` 切换与状态色）尽量迁到 class + `data-*` 状态，
  但**不得改动结果网格结构与列定义**——只把"靠内联写死的颜色/显隐"换成 class，视觉零变化。
- `.source-tag` 源筛选与 `.search-templates`（GB/T 等前缀模板）两类胶囊视觉一样、语义不同
  （前者筛选、后者改输入框值）。若顺手修，仅给模板胶囊加 outline 态做区分，**不改交互逻辑**。
- 结果区空/载入/错误态统一走 `.set-empty` + 骨架（这部分不属于"老排版"，可收口）。

**③ 阶段**：Phase D（最后）。因为是"保留排版、仅换外壳"，风险被压到最低——
先把 `.set-page-head` + `.set-search` 套上、跑通三主题，再清内联色，结果网格全程不动。

---

### 4.2 Labr 库检索（labr）

页面 `#page-labr`（`index.html` 358–371），渲染 `app-labr.js`（5 处内联 style）。
页内**大量内联样式写在 HTML 里**：裸 `<h2 style=…>`、容器 `style="display:flex;flex-direction:column;height:calc(...)"`、
`#labrResults style="flex:1;overflow-y:auto"`、`#labrPager style="display:flex;..."`。

**① 替换映射**

| 旧 | 新 |
|---|---|
| 裸 `<h2 style="font-size:20px…">` + `<p style=…>` | `.set-page-head`（h1 + p） |
| `.search-row.qual-search-row.labr-search-row` + 内联 | `.set-search` |
| `#labrResults` 内联 flex | `.set-results`（容器类，token 化） |
| `#labrPager` 内联 flex | `.set-pager`（新成员） |
| 结果项（`app-labr.js`） | `.set-row` + 文件类型 `.set-badge` |

**② 逻辑待修**

- 页内 `height:calc(100vh - var(--topbar-h) - 140px)` 这种魔数高度三处复用（搜索/资质/labr），
  应收成一个布局类 `.set-scroll-pane`，别让 140px 散落。
- 批量下载选中按钮 `#labrBatchBtn` 的 disabled 态切换逻辑确认与选中计数同步。

**③ 阶段**：~~Phase B~~ → **Phase F**（与资质同因重新排期，见 §4.7 ③ 的耦合说明）。
Labr 的 `.labr-search-row` / 裸 `<h2>`/`<p>` 同样被移动端 search-stage 选择器吃住
（`search-stage.css` 27/47–48/58/93 行），桌面单改会断移动端。页头/搜索壳/分页器改名挪到
Phase F 与移动选择器同改；本页 Phase B 无独立可做项（无内联 tab 之类），整体后移。

---

### 4.3 批量下载（batch）

页面 `#page-batch`（已是"规范派"页头），渲染 `doBatchResolve` / `renderBatchResults`（`app-download.js:459/485`）。

**① 替换映射**

| 旧 | 新 |
|---|---|
| `.page-heading > div > h2 + p` | `.set-page-head` |
| `.batch-workspace`（二列 grid） | `.set-split` |
| `.batch-card` / `.batch-input-card` / `.batch-output-card` | `.set-card` |
| `.batch-card-head` + `.batch-kicker` + `h3` | `.set-card-head` + `.set-kicker` + `.set-card-title` |
| `.batch-mode-pill` / `.batch-summary` | `.set-badge`（muted / accent） |
| `.batch-textarea` | `.set-textarea` |
| `.batch-actions` | `.set-toolbar`（margin 收口） |
| `.batch-results-empty` | `.set-empty` |
| 解析结果项（`renderBatchResults`） | `.set-row` + 状态 `.set-badge` |

**② 逻辑待修**

- 页头/HTML 里写死 `级联顺序：BW → BY → BZ（超时 15s）`，同时 `updateBatchSourceHint()`
  （`switchTab` 第 196 行调用）又会动态刷新 `#batchSourceHint` —— **静态写死值与动态值并存**，
  首屏可能闪一下旧顺序。重做时去掉 HTML 写死文案，统一由 `updateBatchSourceHint()` 产出，
  并确认它读的是真实的当前来源优先级（与系统设置里的源排序一致）。
- `renderBatchResults` 的"匹配/未匹配/仅文本"三态目前各写各的样式，统一成 `.set-badge`
  三语义色（ok / warn / bad），与搜索页三态徽章共享语义。
- 进度条 `.progress-wrap`（与全局下载日志面板同款）确认复用同一组件，不要再造。

**③ 阶段**：Phase C（页头规范、结构清晰，是把 `.set-split`/`.set-card`/`.set-row` 跑通的好样板）。

---

### 4.4 标准补全（complete）

页面 `#page-complete`，渲染 `app-complete.js`。已是规范派页头 + 已有 `.complete-step` 步骤条
（提为通用 `.set-stepper` 的来源）。

**① 替换映射**

| 旧 | 新 |
|---|---|
| `.page-heading` | `.set-page-head` |
| `.complete-workspace` | `.set-split` |
| `.complete-card` / `.complete-card-head` / `h3` | `.set-card` / `.set-card-head` / `.set-card-title` |
| `.complete-steps` / `.complete-step`（.active/.done/.error） | `.set-stepper` / `.set-step`（同态） |
| `.complete-dropzone` | `.set-row`（dashed 变体）或保留为 `.set-dropzone` |
| `.complete-options` / `.check-option` | `.set-card` 内 grid + `.set-chip`（开关项胶囊化，见原型） |
| `.complete-status`（idle/ready/working/success/fail） | `.set-card` + 状态边框工具类 `.is-ok/.is-warn/.is-bad` |
| `.complete-result-stats` | `.set-stats` / `.set-stat` |
| `.complete-download-card` | `.set-row`（success 变体） |

**② 逻辑待修**

- 步骤条状态推进目前由 JS 手动加 `.active/.done`，确认每个失败分支都会把 step 标 `.error`
  （现在 `.complete-step.error` 样式有定义，但要核对 JS 是否真在所有 catch 里打上）。
- 输入/输出列 `A` / `B` 校验：`maxlength=3` 但无格式校验，乱填（如中文）时的失败提示要走
  统一 `.set-empty`/toast，不要静默。
- "保留原表样式 / 状态 / 来源 / 链接 / 是否有文本" 五个 checkbox 在原型里胶囊化成 `.set-chip`，
  逻辑不变，仅视觉收口。

**③ 阶段**：Phase C（与批量同期，结构同构）。

---

### 4.5 本地文件库（local）

页面 `#page-local`（`index.html` 257–290），渲染 `app-local.js`。已是规范派页头，
本体是 `.local-toolbar`（搜索 + 计数 + 全选/统一命名/批量删除）+ `.local-table`
（sticky thead，7 列：勾选/标准号/标准名称/来源/大小/时间/操作）。另带
`.normalize-*`、`.rename-*` 两套 modal（命名格式预览 / 单文件改名）。

**① 替换映射**

| 旧 | 新 |
|---|---|
| `.page-heading > h2 + p` | `.set-page-head`（右侧"刷新"进操作位） |
| `.local-toolbar` / `.local-toolbar-actions` | `.set-toolbar` / `.set-toolbar-right` |
| `.library-search`（本地库专用搜索 input） | `.set-search`（薄变体，无源 chip） |
| `.badge-count` | `.set-badge muted`（计数 + 已选） |
| `.local-table` / `.local-table-wrap` | `.set-table` / `.set-table-wrap`（sticky thead 收进通用层） |
| `.local-col-check` / `.local-col-actions` | `.set-table` 列宽工具类（`.col-check` / `.col-actions`） |
| `.btn-xs` / `.btn-danger`（行内操作） | 保留（已 token），仅核对三主题色 |
| `.normalize-*` / `.rename-*` modal | 保留专属类（modal 走通用 `.set-modal` 外壳，内部表单不动） |

**② 逻辑待修**

- "统一命名"`batchNormalizeLibraryFiles()` 读的是 admin 设置的内置命名格式 —— 该格式由
  `standardsLibraryDir` 同侧设置项决定。重做时确认 modal 预览里展示的"目标文件名"用的是
  **当前实际生效的命名模板**（别用写死示例），避免用户改过模板后预览仍是旧格式。
- 全选/批量删除按钮 disabled 态依赖 `fileLibrarySelectedCount`，确认 `onLocalCheckAll` 与
  单行勾选都同步刷新计数与按钮态（设置页有过"计数不同步"的同类坑）。
- 批量删除是**不可逆**操作 —— 必须走二次确认（`.set-modal` confirm），文案明确"将从磁盘移除 N 个 PDF"。
  （安全约定：永久删除不能静默执行。）
- 表格"时间/大小"列在 light/paper 主题下文字对比度核对（`.local-table` 原用裸 oklch + fallback，
  迁 `.set-table` 后天然 token，少一处 fallback 维护点）。

**③ 阶段**：Phase C（与批量/补全同期，是把 `.set-table` 跑通的样板页之一）。

---

### 4.6 下载历史（history）

页面 `#page-history`（`index.html` 293–313），渲染 `renderDownloadHistory()` /
收藏渲染（`app-download.js`）。已是规范派页头，本体是 `.library-grid`（二列）下
两张 `.library-card`：左"收藏标准"（含计数）、右"下载历史"（`.wide`，含"清空历史"）。

**① 替换映射**

| 旧 | 新 |
|---|---|
| `.page-heading > h2 + p` | `.set-page-head` |
| `.library-grid`（二列 grid） | `.set-split`（与批量/补全共用二列布局） |
| `.library-card` / `.library-card.wide` | `.set-card`（`.wide` → `.set-split` 列跨度工具类） |
| `.library-head` + `h3` + 计数/按钮 | `.set-card-head` + `.set-card-title` + `.set-badge` / `.set-actions` |
| 收藏项 / 历史项（JS 内联渲染） | `.set-row`（label=标准号 + value=名称/时间 + actions） |
| `.library-empty` | `.set-empty` |

**② 逻辑待修**

- "清空历史"`clearDownloadHistory()` 是**批量不可逆删除** —— 走 `.set-modal` 二次确认，
  不要点一下就清空（当前若是直接清，重做时补确认）。
- 收藏列表的语义是"监控收藏标准是否有新版本"，但目前只是静态列表 —— 重做时若收藏项已有
  "有新版本"标记数据，用 `.set-badge`（warn 语义色）显式标出来；无该数据则保持现状、不臆造。
- 收藏项与历史项的"行"结构目前各写各的内联样式，统一成 `.set-row` 后两列复用同一渲染原子。
- 历史项时间用相对/绝对混排时，确认 light/paper 下次要信息（`var(--text-3)`）对比度达标。

**③ 阶段**：Phase C（结构简单，`.set-split` + `.set-row` 的轻量样板）。

---

### 4.7 资质查询（qual）

页面 `#page-qual`（`index.html` 316–354），渲染 `app-qual.js`（85 处内联 style，全站最脏）。
裸 `<h2 style>` + `.qual-tab-bar`（整段内联）两 tab：搜索 / 可视化。搜索 tab 是
`.search-row.qual-search-row` + `.qual-filters`（全部/CNAS/CMA 胶囊）+ `#qualResults`；
可视化 tab 是 `.qual-visual-workspace`（输入卡 + 概览卡）+ `#qualVisualResults`。

> **⚠ 用户明确要求：资质查询的展示方式「还是参考原有的来」。**
> 即结果区保留原有的 **分组统一列表** 呈现：`.qual-unified-list` / `.qual-result-group` /
> `.qual-result-std` + **CNAS 蓝 / CMA 橙来源色片**（`.qual-source-chip-cnas/-cma`）+
> **scope 标记**（全部=绿 `.scope-all` / 部分=橙 `.scope-partial`）+ **能力条形图**
> （`.qual-visual-bars`）。这些是业务专属、信息密度高的视觉，**不泛化成 `.set-card`/`.set-row`**。
> 本页只统一：① 页头 `.set-page-head`；② tab 控件 `.set-tab`（去内联）；③ 搜索壳 `.set-search`；
> ④ 筛选胶囊 `.set-chip`；⑤ 输入/概览卡外壳 `.set-card`。**结果列表呈现与配色保持原样。**

**① 替换映射（外壳统一，结果区按原版保留）**

| 旧 | 新 | 备注 |
|---|---|---|
| 裸 `<h2 style="font-size:20px…">` | `.set-page-head`（h1 + p） | 页头 |
| `.qual-tab-bar` + `.qual-tab`（**整段内联**） | `.set-tabs` + `.set-tab`（已组件化） | 去内联，交互不变 |
| `.search-row.qual-search-row` + 内联 | `.set-search` | 搜索壳 |
| `.qual-filters` / `.qual-filter-btn` | `.set-chips` / `.set-chip` | 筛选胶囊 |
| `#qualSearchTab` 内联 `height:calc(...)` | `.set-scroll-pane`（收魔数高度，见 §4.2 逻辑待修） | 布局 |
| `.qual-visual-card` + `.batch-kicker` + `h3` | `.set-card` + `.set-kicker` + `.set-card-title` | 输入/概览卡外壳 |
| `.batch-textarea`（资质借用） | `.set-textarea` | 输入 |
| `.qual-visual-stats` | `.set-stats` / `.set-stat` | 概览数字 |
| **`.qual-unified-list` / `.qual-result-group` / `.qual-result-std`** | **保留原类** | 结果分组列表，不动 |
| **`.qual-source-chip-cnas`（蓝）/ `-cma`（橙）/ `.qual-source-divider`** | **保留原类** | 来源色片，不动 |
| **`.qual-scope-badge.scope-all`（绿）/ `.scope-partial`（橙）** | **保留原类** | scope 标记，不动 |
| **`.qual-result-item` / `-scope` / `.qual-scope-limit-row`** | **保留原类** | 行级明细，不动 |
| **`.qual-visual-bars` / `.qual-visual-lab-card`** | **保留原类** | 能力条形图，不动 |
| **`.qual-badge` / `-cnas` / `-cma`**（搜索结果行内徽章） | **保留原类** | 不动 |

**② 逻辑待修**

- `switchQualTab('search'|'visual')`（`app-qual.js:8`）目前用内联 `t.style.color` /
  `t.style.borderBottomColor` 切 tab 高亮（21–22 行）—— 改成 `.set-tab.active` CSS 接管，
  只切 class（参照同文件 `switchQualSettingsTab` 已是 CSS 驱动的写法，注释也写明了）。
  **这是 85 处内联的一个大头，优先清。**
- 85 处内联 style 分批迁 class + `data-*`；结果分组列表的**结构与配色不变**，只把
  "靠内联写死的色/显隐"换成既有 `.qual-*` class（很多 `.qual-*` 类已在 CSS 里定义，
  渲染时却又内联覆写了一遍 —— 去掉内联即可，视觉零变化）。
- `doQualBatchVisual` 的输入分隔符 `/[\n\r,，;；、。\t]+/` 与标准补全、批量下载各写各的
  分隔逻辑 —— 收成一个 `splitTokens()` 工具，三页共用（防止"这页支持顿号、那页不支持"的不一致）。
- 搜索 tab 与可视化 tab 的空态（`.qual-empty`）统一走 `.set-empty`。

**③ 阶段**：Phase B（先清 tab 内联 + 页头/搜索壳/筛选胶囊外壳；结果列表保留，风险低）。
**注意**：结果区是"保留"，不是"重做"——本页工作量主要在清 85 处内联，不在改版式。

> **⚠ 落地时发现的耦合（2026-05-30，已据此重新排期）：**
> `.qual-search-row` / `.qual-filters` / `#page-qual > h2` / `.qual-tab-bar` 以及 `.search-row`
> 玻璃壳，全部被**移动端 search-stage 动画**按精确类名/标签选择器吃住
> （`search-stage.css` / `responsive.css` / `glass.css`：sticky 吸顶 + landing/active 分阶段 +
> 窄屏隐藏），且 `.search-row` 还**与标准检索共用**（标准检索是保留原版、Phase D）。
> 单在桌面把这些改名/换标签会**静默打断移动端**，而重写那些移动选择器本就是 **Phase F** 的活。
> 故重新排期：
> - **Phase B 已落地**：`switchQualTab` 去内联（只切 `.qual-tab.active`，外观移入 CSS）+
>   两个 `index.html` tab 按钮去内联 style。**零移动端风险**，是 85 处内联里最扎眼、最独立的一刀。
> - **页头 `.set-page-head` / 搜索壳 `.set-search` / 筛选胶囊 `.set-chip` 改名** → **挪到 Phase F**
>   与移动 search-stage 选择器一并改，避免中间态破。
> - 结果区分组列表（保留原版）始终不动。

---

### 4.8 使用统计（stats）

页面 `#page-stats`（`index.html` 373–393），渲染 `loadStats()`（`app-stats.js`，Chart.js）。
裸 `<h2 style>` + `.stats-controls`（日期区间 + 刷新）+ `.stats-grid`（概览数字）+
`.stats-charts`（两张 `.stats-chart-box`：趋势 / 来源分布）。CSS 仅 13 行，用裸 `oklch()` + fallback。

**① 替换映射**

| 旧 | 新 |
|---|---|
| 裸 `<h2 style="font-size:20px…">` | `.set-page-head`（h1 + p） |
| `.stats-controls`（日期 + 刷新） | `.set-toolbar`（左日期区间、右刷新） |
| `"至"` 的内联 `<span style>` | `.set-toolbar` 内的 token 文本（去内联） |
| `.stats-grid` / `.stat-card` | `.set-stats` / `.set-stat`（grid + value + label） |
| `.stats-charts` / `.stats-chart-box` + `h4` | `.set-card`（grid 二列）+ `.set-card-title` |

**② 逻辑待修**

- 日期 `<input type="date">` 无范围校验：`statsFrom > statsTo` 时直接发请求 ——
  重做时加轻校验（前端拦一下，提示走 toast），别让后端返回空图表用户摸不着头脑。
- 首屏 `statsFrom/statsTo` 默认值确认有兜底（如默认近 30 天），否则空区间首次加载是空图。
- 两张 Chart.js 图的配色目前可能写死了系列色 —— 重做时让图表色读 CSS token
  （`--accent` / `--success` / `--warning`），保证三主题切换时图也跟着变（这是 stats 页
  现在最容易"暗主题好看、亮主题刺眼"的点）。
- `.stat-card` 数字入场动画若用了全局 `.count-anim`（`base.css` 的 `countIn`），迁 `.set-stat`
  时记得保留该 hook。

**③ 阶段**：Phase C（轻量，`.set-stats` + `.set-toolbar` 样板；Chart.js token 化单独留意）。

---

### 4.9 用户管理（users）

页面 `#page-users`（`index.html` 396–421），渲染 `app-auth-admin.js`（42 处内联，含表格）。
裸 `<h2 style>` + **整条筛选/操作栏全是内联**（新建/默认权限按钮 + 允许注册/需要登录/允许局域网游客
三个内联 label + 批量操作 bar）+ `.users-table`（uppercase th，8 列）。

**① 替换映射**

| 旧 | 新 |
|---|---|
| 裸 `<h2 style="font-size:20px…">` | `.set-page-head` |
| 顶部内联 `<div style="display:flex…">` 操作栏 | `.set-toolbar`（左主操作、右批量栏） |
| 三个内联 `<label style="font-size:13px…">` 开关 | `.set-switch`（开关项原子，token 化）或 `.set-row` 内联开关 |
| `#usersBatchBar` 内联 `<span style="display:none…">` | `.set-toolbar-right`（`hidden` 属性切显隐，去内联） |
| `.users-table` | `.set-table`（与本地库共用） |
| 行内 `.badge-admin/-user/-active/-inactive` | `.set-badge`（语义色变体：accent / muted / ok / off） |
| `.users-actions` 行内按钮 | `.set-actions`（已组件化） |

**② 逻辑待修**

- "允许局域网游客"开关带 `⚠` 高危提示（开启后内网可匿名访客访问）—— 重做时这个开关用
  `.set-switch` 的 **danger 变体**（边框/标签用 `var(--danger)`），并保留 title 说明，
  让"危险开关"视觉上和普通开关区分（现在只靠一个小 `⚠` emoji，容易误开）。
- 批量"删除用户"`batchDeleteUsers()` 是**不可逆** —— 走 `.set-modal` 二次确认，文案带人数。
- 三个全局开关（注册/登录/局域网游客）的 `onchange` 直接打后端 ——确认失败时（如无权限）
  会把 checkbox 态**回滚**到实际值，别让 UI 与后端不一致（设置页踩过同类"乐观更新没回滚"坑）。
- 表格 8 列在窄屏会挤 —— 确认 `responsive.css` 对 `.set-table` 有降级（横向滚动或列折叠），
  避免迁移后窄屏比原来更糟。

**③ 阶段**：Phase B（与资质同期，主要工作是清内联 + 套 `.set-toolbar`/`.set-table`/`.set-badge`）。

---

## 五、分期落地

沿用设置页 Phase A–E 的"先建组件、再逐页替换、零构建风险优先"打法。每一期都是
**独立可合并、可回滚**的小步；组件层（Phase A）是纯新增 CSS，不碰任何现有页面，
所以即使后续页面替换没跟上，也不会破坏现状。

### Phase A —— 扩展 `.set-*` 组件层（纯新增，零风险）

把 §三 的新成员落地：`.set-page-head` / `.set-kicker` / `.set-card-title` / `.set-toolbar` /
`.set-table` / `.set-search` / `.set-chip` / `.set-stat(s)` / `.set-empty` / `.set-stepper` /
`.set-badge` / `.set-split` / `.set-switch` / `.set-scroll-pane` / `.set-modal`。

- 全部 token-only，禁裸 `oklch()` / `color-mix()`。
- **双写镜像**：`web/src/styles/pages/settings.css`（或新建 `components/set-kit.css`，见 §六）
  与 `public/styles.css` 同步，cascade 等价。
- 只新增、不删除、不改任何现有页面 class —— 这一期合并后页面**零变化**，纯铺路。
- 更新 `web/src/styles/SECTIONS.md`、`CHANGELOG.md`。

### Phase B —— 内联重灾页（资质 / 用户管理 / Labr）

挑"内联最脏、但布局保留/简单"的三页先清内联：

- **资质（4.7）**：清 tab 内联 + 套页头/搜索壳/筛选胶囊；**结果分组列表保留原版**。
- **用户管理（4.9）**：清整条操作栏内联 + 套 `.set-toolbar`/`.set-table`/`.set-badge`/`.set-switch`。
- **Labr（4.2）**：套 `.set-page-head` + `.set-search` + `.set-scroll-pane`，收魔数高度。
- 每页改完同步 `CHANGELOG`，给一份提交块；逐页合并、逐页可回滚。

### Phase C —— 规范派结构页（批量 / 补全 / 本地库 / 历史 / 统计）

这五页页头已规范、结构清晰，是把骨架组件跑通的样板：

- **批量（4.3）/ 补全（4.4）**：`.set-split` + `.set-card` + `.set-row` + `.set-stepper`。
- **本地库（4.5）/ 历史（4.6）**：`.set-table` / `.set-split` + `.set-row`。
- **统计（4.8）**：`.set-stats` + `.set-toolbar`；Chart.js 系列色 token 化单独验。
- 这一期把"卡片/行/表格/工具条/数字卡"五个高频原子全部验证到位。

### Phase D —— 标准检索（保留排版，仅换外壳，放最后）

最复杂、风险最高，但因"保留原网格表 + 状态分组"，实际只做：
套 `.set-page-head` + `.set-search`、清 19 处内联色。**结果网格全程不动**，
改完逐项对照原型核对三态徽章 / 分源 strip / 右键菜单 / j-k 导航无回归。

### Phase E —— 收尾与一致性校验

- 全站三主题（dark / light=极地蓝 / paper=Claude Linen）逐页过一遍，重点核对
  原"裸 oklch + fallback"迁 token 后是否还有遗漏的硬编码色。
- `oklch:check` / `web:typecheck` / `web:test` 全绿（CI 卡口）。
- 更新 `README.md`（功能清单/近期重点）、`docs/MIGRATION.md`、`SECTIONS.md`、`CHANGELOG.md`。
- 旧 class（`.batch-card` / `.local-toolbar` / `.users-table` 等）确认已无引用后，
  按 CSS 迁移期两步契约决定是否删除（见 §六）。

---

## 六、风险与回滚

### 组件放哪：`settings.css` 升格 vs 新建 `set-kit.css`

`.set-*` 现住在 `pages/settings.css`，名义是"设置页"。推广到全站后名实不符。两个选择：

- **A. 原地升格**：把 `settings.css` 里 `.set-*` 通用部分留下、改注释为"全站组件层"，
  设置页专属（`.set-section` 资质订阅那段）留在原文件。改动小，但文件名仍叫 settings 易误解。
- **B. 抽到 `components/set-kit.css`**：语义最干净，但要动 `index.css` 导入顺序 + 镜像
  `public/styles.css`，且 `@keyframes` 跨文件依赖（`panelIn`/`toastIn` 等，见 CLAUDE.md）要重新排序。

**建议 A**（原地升格 + 改注释），理由：迁移期 `public/styles.css` 与 `web/src/styles/*` 双写，
新建文件会多一处镜像点和导入顺序风险；升格只改注释、零 cascade 变化。等 legacy 入口废弃、
单入口后再考虑物理拆分。

### 双写镜像漏改

最大的常态风险。每改一处 `.set-*` 必须 `public/styles.css` + `web/src/styles/*` 同步，
否则 legacy `public/index.html` 入口与 Vite 入口视觉分叉。
**缓解**：每期提交块里两个文件成对出现；CI 无法测视觉一致性，靠 review 对照 + 原型回归。

### 旧 class 删除时机

§五 Phase E 提到删旧 class，但**受 CSS 迁移期两步契约约束**（CLAUDE.md）：
只有当 legacy `public/index.html` 入口正式废弃，才能 ① 从 `public/styles.css` 删段落
② 删 `index.css` 的 `@import '../../../public/styles.css'`。**在此之前，旧 class 即使没人用也先留着**，
避免 legacy 入口失样式。重构期内"新旧 class 并存、重复加载、cascade 等价"是有意为之的过渡态。

### "保留原版"两页的红线

标准检索（4.1）结果网格、资质查询（4.7）分组列表是用户点名"保留"的。这两页的红线：
**不重做布局、不改列定义、不改分组/折叠交互、不改业务徽章配色**——只换页头、搜索壳、清内联色。
任何改动若会让结果区视觉变化，都要先回原型核对、再确认。

### 不可逆操作的二次确认

本地库批量删除、历史清空、用户批量删除三处是不可逆。重构顺手补 `.set-modal` 二次确认，
**绝不能在换皮过程中把原有确认弹窗弄丢**（换 class 时容易误删确认逻辑）。
（与全局安全约定一致：永久删除不静默执行。）

### 构建验证

本机不跑 build（`HYPERVISOR_VIRT_DISABLED`）。每期靠静态核查（import 路径 / class 引用 /
文件存在性）列"需盯的失败点"，push 后看 GitHub Actions
（`web:typecheck → web:test → web:build → backend build → test` + `oklch:check`）结果。

---

## 七、移动端重设计（分角色）

桌面端是"全功能工作台"，手机端定位是 **「查阅而非管理」**（现有约定，沿用）。本节把手机端
也纳入统一重构，并按用户角色分两套导航。可视化原型见 `docs/mobile-redesign-prototype.html`
（顶部可切角色 / 三主题，手机框内即底部 Tab 真实形态）。

### 7.1 已确认的决策

1. **主导航 = 底部 Tab 栏**，取代现有的 60px 左侧图标竖栏（`responsive.css` 640px 段
   把 `--sidebar-w` 收成 60px 的做法）。底部栏更符合单手拇指可达区。
2. **角色分两套 Tab**：
   - **普通用户**：`检索 / 资质 / 我`（3 项）。Labr 作为第 4 个**源 chip** 折进标准检索，
     不单独占 tab。
   - **管理员**：`检索 / 资质 / 管理 / 我`（4 项）。中间多出的「管理」页聚合
     **用户管理 + 系统设置**两个入口。
3. **使用统计不进手机端**：图表在窄屏密度优势不大，需要时回桌面端看。
4. **沿用现有"查阅而非管理"收口**：手机端继续隐掉下载中心、结果卡的下载/收藏按钮、
   "只看收藏"筛选、下载历史入口（`responsive.css` 360–375 行已有），只保留预览/详情查阅。

### 7.2 导航形态：左竖栏 → 底部 Tab

**① 替换映射**

| 旧（responsive.css 640px 段） | 新 |
|---|---|
| `--sidebar-w: 60px` 左侧竖排图标栏 | `.set-tabbar`（底部固定，`env(safe-area-inset-bottom)` 留白） |
| `.sidebar-item`（居中图标 + 隐文字） | `.set-tab-btn`（图标 + 短文字，竖排，active 用 accent） |
| `.content { margin-left: 60px; padding-bottom: 96px }` | `.content { margin:0; padding-bottom: calc(tabbar 高 + safe-area) }` |
| `.sidebar-user`（底部账号块） | 移入「我」页（`#s-me` 账号头卡） |
| `.log-panel { left: 60px }` 等依赖侧栏宽的定位 | 改成全宽 / 底部 sheet，去掉 `--sidebar-w` 依赖 |

**② 逻辑待修**

- `switchTab()`（`app-core.js:165`）目前按桌面侧栏 tab 列表切页。移动端要按**角色过滤可见 tab**：
  非管理员根本不渲染「管理」入口（不能只靠 CSS 隐藏 —— 后端鉴权才是真闸，前端 tab 仅是体验）。
  确认 `manage` 相关页在普通用户会话里即使被手动导航也会被后端 403 兜住。
- 现有 `body:not(.force-desktop)` 这个开关（用户可强制桌面视图）要保留：底部 Tab 只在
  非 force-desktop 时生效，force-desktop 仍走桌面侧栏。
- `--sidebar-w` 被 `.log-panel` / `.download-center` / `.content` 多处依赖（见 responsive.css
  184–185、72 行）。改底部栏时这些定位要一起改，别留"按 60px 偏移但侧栏已不存在"的悬空布局。

**③ 阶段**：Phase F（移动端独立一期，见 7.6）。

### 7.3 标准检索（移动）

沿用现有结果卡 v2 堆叠形态（`responsive.css` 222–358 行，已是成熟设计），本次只把外壳
token 化、并入底部 Tab 框架。

**① 替换映射**

| 旧 | 新 |
|---|---|
| `.search-row`（两行布局） | `.set-search`（移动变体，input + 搜索按钮一行） |
| `.source-tags` / `.source-tag`（第二行） | `.set-chips` / `.set-chip`（含 Labr 第 4 源 chip） |
| `.filter-bar` 折叠（`.filter-collapse` "筛选 ▾"） | `.set-filter-collapse`（保留折叠交互，token 化） |
| 结果卡 v2（`.result-card` 640 段重写） | 保留形态，class 收口到 `.set-result-card`（移动堆叠变体） |
| `.card-meta-line`（· 分隔扁平文本） | 保留（这是移动专属精排，不动语义） |

**② 逻辑待修**

- `.search-templates`（GB/T 等前缀模板）手机端已 `display:none`（143 行），保持。
- 把 Labr 从"独立页"降级为标准检索里的**源 chip**：选中 Labr 源时走 labr 检索通道。
  确认 `app-labr.js` 的检索能被搜索页统一入口调用（或保留 Labr 仍可从「我 / 更多」进，二选一，
  原型取"折进源 chip"）。

**③ 阶段**：Phase F。

### 7.4 资质查询（移动）

**沿用原有分组统一列表**（与 §4.7 桌面同一红线：CNAS 蓝 / CMA 橙色片、scope 绿/橙、能力条形图
不动）。移动端只做：搜索壳 `.set-search`、筛选胶囊 `.set-chip`、单列堆叠（`responsive.css` 49 行
已把 `.qual-visual-workspace` 折成单列）。

**① 替换映射**：同 §4.7，外加「可视化 tab 手机端已隐」（`responsive.css` 156–157 行），
移动端资质页只剩搜索 + 分组结果列表。

**② 逻辑待修**：`switchQualTab` 的内联高亮清理（同 §4.7）；移动端因只有搜索 tab，
确认 tab-bar 隐藏后页面顶部不留空 chrome（现有 157 行已处理）。

**③ 阶段**：Phase F（与桌面资质 Phase B 共享 class，移动只是布局收口）。

### 7.5 「我」页 + 「管理」页（移动新增）

桌面端没有独立"我"页（账号在侧栏底部），移动端把账号 / 最近 / 外观 / 退出聚到一页。

**① 结构**

| 页 | 内容 | 复用组件 |
|---|---|---|
| `#s-me`（两角色都有） | 账号头卡 + 最近搜索 + 外观三主题切换 + 公告/关于 + 退出登录 | `.set-card` / `.set-row` / 主题切换段 |
| `#s-manage`（仅管理员） | 用户管理入口 + 系统设置入口；下钻用户管理 = 移动卡片视图 + 全局开关 | `.set-card` / `.set-row` / `.u-card` / `.set-switch` |

**② 逻辑待修**

- 「我」页的"最近搜索"数据源：确认是已有的搜索历史（`search-history` 组件），不是新造数据。
- 用户管理移动卡片视图：桌面是 `.users-table`（§4.9），移动端转**卡片列表**（每用户一卡：
  角色/状态徽章 + 计数 + 编辑/禁用/删除）。这是移动专属呈现，桌面仍用表。
- 「允许局域网游客」开关在移动端同样用 **danger 变体**（红色 toggle），高危项视觉区分（同 §4.9）。
- 退出登录、批量删除用户走二次确认 + 后端鉴权，不可逆操作不静默。

**③ 阶段**：Phase F。

### 7.6 移动端落地阶段（Phase F）

放在桌面 Phase A–E 之后（依赖 `.set-*` 组件层已就绪）：

1. **底部 Tab 框架**：新增 `.set-tabbar` + `.set-tab-btn`，改 `body:not(.force-desktop)` 下的
   布局（去 `--sidebar-w` 依赖），按角色渲染 tab。纯移动段，桌面零影响。
2. **检索 / 资质移动收口**：复用桌面同名 class，只补移动布局变体（多数已在 responsive.css）。
3. **新增「我」/「管理」页**：account 头卡、用户管理卡片视图、全局开关、危险开关变体。
4. **角色鉴权核对**：前端 tab 过滤 + 后端 403 兜底双保险。
5. **三主题 × 两角色矩阵回归**：对照 `mobile-redesign-prototype.html` 逐屏核对。

**风险**：`responsive.css` 是 cross-cutting 单一汇总点（见文件头注释），移动端大改时
**集中在该文件**改、别散到各 page；底部 Tab 的 safe-area、键盘弹起时输入框遮挡、
force-desktop 回退三处要专门测真机。
