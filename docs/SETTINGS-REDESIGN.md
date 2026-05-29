# 系统设置面板重设计方案

> 目标：消除"拼凑感"，把设置页从「两套渲染 + 满屏内联样式 + 多种卡片方言」收敛成
> 一套**统一组件系统 + 清晰信息架构**，并彻底重构 legacy `app-settings.js` 的
> innerHTML 整体重渲染。
>
> 配套可点击原型：[`settings-redesign-prototype.html`](./settings-redesign-prototype.html)
> （浏览器直接打开，右上角可切 暗 / Arctic Blue / Claude Linen 三主题预览）。

---

## 一、现状诊断：拼凑感从哪来

读 `web/index.html#page-settings` + `public/styles.css` 设置段 + `theme/glass.css`
override 段后，定位到 **6 个具体来源**，全部是"局部各自合理、合起来不成体系"：

1. **一页两套渲染机制对撞**
   `#settingsBody` 由 legacy `app-settings.js` 用 `innerHTML` 整块重渲染（代码注释
   自己标注为"innerHTML 重渲染根因"），而紧贴其下的「资质订阅」区块是 `index.html`
   里**手写的静态 HTML**。两种构造方式上下堆叠，节奏、缩进、控件风格都对不齐。

2. **满屏内联样式**
   资质订阅区块用了几十处 `style="padding:8px 16px;font-size:13px;border-bottom:2px solid var(--accent)…"`。
   这些样式不走设计 token，不能主题化，每一处都是当时手调的"一次性"数值 —— 这是
   视觉拼凑最直接的来源。

3. **卡片方言过多**
   容器至少有 `.settings-card` / `.settings-card.wide` / `.desktop-setting-card` /
   `.web-access-card` / `.update-card` / `.setting-section` 6 种，背景透明度各异
   （`0.58` / `0.38` / `0.35` / `0.32`），圆角、padding 也不统一。

4. **两套 Tab 控件**
   `.qual-settings-tabs`（内联样式、底部 2px accent 下划线）与 `.qual-filter-btn`
   （胶囊按钮）风格完全不同，却出现在同一区块相邻位置。

5. **标题层级三种写法**
   页头 `<h2 style="font-size:20px">系统设置`、分区 `.field-label`（11px 大写字距）、
   资质区 `.qual-section-title` —— 三种字号/字重/大小写规则，读者抓不到统一的层级感。

6. **间距全凭手感**
   `margin-top:24px`、`margin:12px 0 14px`、`gap:0/8/10/12` 混用，没有统一的纵向节奏。

> 结论：问题**不是**配色（三主题 token 体系其实很完整），而是**结构与组件语汇**。
> 单纯再调色救不了拼凑感，必须统一组件 + 重排信息架构。

---

## 二、设计原则

1. **一套元件，三种主题** —— 所有面板只用 `var(--*)` token，绝不内联颜色/边框；
   暗 / Arctic Blue / Claude Linen 由 token 自动适配（沿用现有 `data-theme` 机制）。
2. **两级高度，别再有第三种** —— 页面背景为底，卡片为一级浮层（`--surface` + `--border`），
   卡片内的行/输入为二级凹陷（`--surface-h`）。废掉 `0.58/0.38/0.35/0.32` 这套透明度方言。
3. **行(row)是设置的原子** —— 每条设置 = 一行：左「标题 + 说明」，右「控件」。控件类型
   收敛为 4 种：开关 / 分段选择器 / 下拉 / 行内按钮。可拖拽排序行额外带把手列。
4. **左导航 + 右内容** —— 设置项按域分组（外观、数据源、访问、资质数据、更新、关于），
   左侧细分类导航，右侧滚动到对应分区。零散卡片合并进所属分区，消除"平铺一大片"。
5. **统一的标题层级** —— 页头 H1、分区 section-title（带可选副标题）、卡片内不再单设标题，
   一种规则贯穿。

---

## 三、信息架构（重排后）

当前所有设置项按语义重新归类到 6 个分区（左侧导航）：

| 分区 | 包含项 | 控件 |
|------|--------|------|
| **外观** | 主题（暗/亮/纸张）、结果密度（紧凑/标准/舒适） | 分段选择器 |
| **数据源** | 多源优先级（可拖拽排序 + 启停）、各源在线状态 | 拖拽行 + 开关 + 状态徽章 |
| **访问方式** | 本机 / 内网 / 手机版 访问地址、手机访问提示 | 只读地址行 + 复制按钮 |
| **资质数据** | CNAS / CMA 订阅管理（推荐订阅、实验室增删、同步全部）、同步日志 | 子 Tab + 列表行 |
| **更新** | 当前版本、检查更新、可下载资产、下载进度 | 行内按钮 + 进度条 |
| **关于 / 高级** | 标准库目录、其它桌面端开关 | 路径行 + 开关 |

左导航在窄屏（移动端）退化为顶部横向滚动 chip；分区锚点点击平滑滚动。

---

## 四、统一组件系统（命名 + 规格）

把现有六七种方言收敛为下面这套，全部进 `web/src/styles/pages/settings.css`（新文件）：

```
.set-layout          左导航 + 右内容的两栏 grid（左 200px / 右 1fr，窄屏单列）
.set-nav             左侧分类导航；.set-nav-item / .set-nav-item.active
.set-section         一个分区（锚点目标），含 .set-section-head（标题+副标题）
.set-card            统一卡片：bg=var(--surface) border=var(--border) radius=var(--radius)
.set-row             一条设置行：grid [主体 1fr | 控件 auto]，padding 14px 16px
  .set-row-main        左侧；.set-row-title（14/600）+ .set-row-note（12/text-3）
  .set-row-control     右侧控件容器
.set-row + .set-row    相邻行之间 1px var(--border) 分隔（卡片内列表感）
.set-seg             分段选择器（替代 .setting-choice 大卡 + .qual-filter-btn 胶囊）
  .set-seg-item / .set-seg-item.active（active 用 --accent 填充）
.set-toggle          开关（复用现有 toggle-switch.css）
.set-field           输入/只读地址行：bg=var(--surface-h) border=var(--border)
.set-tabs            子 Tab（资质订阅用）：统一成一种，底部 2px --accent 指示条
.set-status          状态徽章：.is-ok=success / .is-down=danger / .is-idle=text-3
.set-drag-handle     拖拽把手列（数据源优先级）
```

**关键替换关系（旧 → 新）**

- `.setting-choice`（大卡选择）+ `.qual-filter-btn`（胶囊）→ 统一 `.set-seg` 分段选择器
- `.qual-settings-tabs`（内联）+ 其它内联 tab → 统一 `.set-tabs`
- `.settings-card / desktop-setting-card / web-access-card / update-card` → 统一 `.set-card`
- 满屏 `style="..."` → 全部进 `.set-*` class
- `.field-label / .qual-section-title / 内联 h2` → 统一 `.set-section-head`

---

## 五、彻底重构：app-settings.js → TS 组件化

这是消除拼凑感的**技术根治**（你选了"彻底重构"）。思路是把 innerHTML 整体重渲染
换成**声明式数据 + 小渲染函数**，与项目正在进行的 `web/src/` TS 迁移同方向。

### 5.1 目标结构

```
web/src/modules/settings/
  settings.types.ts      SettingSection / SettingRow / ControlSpec 类型
  settings.config.ts     声明式配置：每个分区有哪些行、控件类型、数据源 key
  settings.render.ts     纯渲染：config → DOM（用 dom-utils，不再 innerHTML 整页重刷）
  settings.actions.ts    控件事件 → API 调用 → 局部更新（只重渲染受影响的 row）
  qual/                   资质订阅子模块（订阅管理 + 同步日志），从 index.html 静态块迁入
  index.ts               挂载入口，替代 legacy app-settings.js
```

### 5.2 核心改动点

- **从「整页 innerHTML」到「按 row 局部更新」**：每个 `.set-row` 绑定一个 key，
  状态变化只 patch 那一行（如某个源切在线/离线、更新进度推进），不再整块重建 ——
  顺带修掉重渲染导致的滚动位置丢失、输入框失焦等老问题。
- **资质订阅区块迁出 index.html**：把那段手写静态 HTML + 内联样式删除，改由
  `settings/qual/` 渲染成统一 `.set-card` + `.set-tabs` + `.set-row`。
- **声明式配置**：新增一个设置项 = 在 `settings.config.ts` 加一条记录，不再手写 HTML。

### 5.3 与现有迁移约束的衔接

- legacy `app-settings.js` 在 `web/index.html` 末尾的 `<script src="/legacy/app-settings.js">`
  迁移完成后移除；同步更新该处迁移注释（注释已把它列为 P1 排期）。
- 新样式落 `web/src/styles/pages/settings.css`，**必须镜像到 `public/styles.css`**
  （迁移期两份并存契约），并在 `web/src/styles/SECTIONS.md` 登记新分区。
- 所有新 `oklch()` 配 sRGB fallback，跑 `npm run oklch:fix`，CI `oklch:check` 守门。
- 三主题 override：新 `.set-*` 选择器若有硬编码深色，需在 `theme/glass.css` 加
  `[data-theme="light"]` / `[data-theme="paper"]` 块 —— 但若严格只用 `var(--*)`
  就**几乎不需要** override（这正是新体系的好处）。

---

## 六、分期落地路径（低风险 → 根治）

按"每步都能独立 push、CI 绿"切分，避免一次性大改：

**Phase A — 组件系统骨架（纯 CSS，零行为改动）**
新建 `pages/settings.css` 定义 `.set-*` 全套元件 + 三主题适配；镜像到 `public/styles.css`；
更新 SECTIONS.md。此时还没人用这些 class，CI 必绿。

**Phase B — 资质订阅区块换皮**
把 `index.html` 资质区块的内联样式逐条换成 `.set-*` class（HTML 结构基本不动），
统一 Tab / 列表 / 按钮。这步去掉最扎眼的内联样式拼凑感，风险低。

**Phase C — 信息架构重排（左导航 + 分区）**
引入 `.set-layout` 两栏布局，把 settingsBody 各卡片归到 6 个 `.set-section`；
窄屏 chip 退化。仍可暂时保留 app-settings.js 渲染，只是套上新容器。

**Phase D — TS 组件化（根治）**
按第五节落 `web/src/modules/settings/`，声明式配置 + 局部更新，删除 legacy
`app-settings.js` 与 index.html 静态资质块。更新 index.html 迁移注释、MIGRATION.md。

**Phase E — 文档与验证**
更新 README 设置页描述、CHANGELOG；GitHub Actions 跑 typecheck/test/build/oklch:check。

> 想最快见效就先做 A+B；要彻底根治排到 D。每个 Phase 都给独立 commit 块。

---

## 七、风险与注意

- **可拖拽排序**：数据源优先级用了 Sortable（`.sortable-ghost/.drag-handle`），重构时
  把拖拽逻辑一并迁入 `settings.actions.ts`，别在换皮时弄丢。
- **资质订阅 API**：迁移子模块时沿用现有 `/api/qualifications/labs/*` 路由（含 legacy
  alias），不要改后端契约。
- **announcement.css / admin.css 独立亮色调色板**：公告/管理界面在亮色 modal 内，
  保持其具体色值，不要被本次 `.set-*` 体系或 glass 暗主题覆写。
- **本地不构建**：所有验证交给 GitHub Actions；Claude 侧用静态核查列"需盯失败点"。
