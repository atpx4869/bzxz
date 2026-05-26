# CLAUDE.md — Claude 协作约定

> 这个文件给 Claude 看的、跨会话生效的工程约定。每条规则都解释了 **为什么** —
> 边缘情况判断要靠 why，不要机械执行。

## 文档与代码同步（**强制**）

**每次有代码修改，必须同步修改对应的 README**。

**Why:** 用户用 GitHub Actions 自动打包（不在本地跑构建），文档与代码脱节意味着
新拉到仓库的人（包括下一次会话的 Claude）会按过时信息行动 —— 重复造轮子或踩
已修过的坑。README 是项目的单一真相源。

**How to apply:**

- 改了任何文件后，回看以下文档判断是否需要同步：
  - 仓库根 `README.md` —— 项目总览、目录结构、API 表、功能清单、近期更新
  - `web/README.md` —— 前端结构与目录速览
  - `DEVELOPMENT.md` —— 开发流程、快捷键、调试指南
  - `docs/MIGRATION.md` —— 前端迁移路线（动到 `web/` 时必看）
  - `web/src/styles/SECTIONS.md` —— CSS 分区索引（动到 styles 时必看）
  - `docs/ARCHITECTURE.md` —— 架构图、模块边界
  - `CHANGELOG.md` —— 用户可见的变更（特性 / bug / 性能）
- 判断口径：**"新拉仓库的人按这份 README 操作，会不会被误导？"** 会 → 必须改。
- 不只是写新内容，也包括删除已不存在的功能 / 接口描述。
- 大改告一段落时把 README 顶部"近期重点"列表也更新一下。

## 构建与验证

- 用户用 **GitHub Actions** 自动打包，本机不跑 `npm run build` / `web:build` 验证。
  - Claude 应通过 Glob/Read 静态核查（import 路径、引用、文件存在性），列出"需要盯的失败点"，让用户 push 后看 Action 结果。
  - 在 Linux 沙箱可用时可以本地跑 build 自检；不可用（HYPERVISOR_VIRT_DISABLED）就跳过、说明原因。
- CI 卡口已就位（`.github/workflows/build.yml` + `pr-check.yml`）：
  `web:typecheck → web:test → web:build → backend build → backend test`。
  改 TS / CSS / 测试任何一处坏了都会在 PR 检查里直接红。

## 提交与推送

- Linux 沙箱常态化挂掉，Claude 一般跑不了 `git`。**生成 `git add / commit / push` 命令块** 让用户复制到本机执行。
- commit message 用中文、第一行扼要描述、空行后展开 why + how，每点列清楚改了哪些文件 / 解决了什么。

## OKLCh fallback 约定（**强制**）

任何新写的 `oklch(...)` 都必须有 sRGB fallback。直接写 `xxx: oklch(...)` 在 Win7
Chrome ≤109 上整条 declaration 解析失败，主题崩。

**How to apply:**

- 写完新 oklch 后跑 `npm run oklch:fix`，脚本会在前面注入一条 `xxx: #RRGGBB` 或
  `xxx: rgba(R,G,B,a)` fallback（脚本幂等，可反复跑）
- CI 用 `npm run oklch:check` 守门
- 算法：OKLab → sRGB + gamut mapping（保 L、保 h、二分搜 sRGB 内最大 C），不偏色
- 脚本只看 value 里的 oklch — 注释里写 `oklch()` 是文档说明、不会被误处理

## CSS 迁移期约定（**重要**）

`public/styles.css` 与 `web/src/styles/*` **同时存在**，是有意为之的过渡态：

- `public/styles.css` 仍被 legacy `public/index.html` 直接 `<link>`，删除会让 legacy 入口失主题
- `web/src/styles/index.css` 同时 `@import '../../../public/styles.css'` + 31 个新文件
- 新文件与原段落"重复加载、cascade 等价"（选择器、specificity 一致；按 `@import` 顺序新文件后赢）

两步切换契约（**仅在 legacy `public/index.html` 入口废弃时执行，未执行前不要单独动**）：

1. 从 `public/styles.css` 删除已抽出段落（每个新文件头部都标注了原行号）
2. 删除 `index.css` 里的 `@import '../../../public/styles.css'`

跨文件 `@keyframes` 依赖（动这些文件时要意识到上下游）：

- `btn-spin` 定义于 `components/buttons.css`，被 `progress-strip.css` `.src-prog-spin`、`result-card.css` `.btn-spinner` 复用
- `panelIn` 定义于 `components/modal.css`，被 `user-dropdown.css` 复用 → user-dropdown 必须排在 modal 之后
- `toastIn` 定义于 `components/toast.css`，被 `shortcuts-overlay.css` 复用 → shortcuts-overlay 排在 toast 之后
- `text-badge-pulse` / `cardIn` 局限于 `result-card.css` 内部
- `countIn` 上提到 `base.css` 作为全局 utility `.count-anim`

## 调色板隔离

`web/src/styles/pages/announcement.css` 与 `pages/admin.css` 用 **亮色调色板**
（`#fff / #333 / #eee / #2563eb`），独立于全局暗色玻璃主题。改这两个文件时
**保持具体色值而非 `var(--*)`**，否则会被 `theme/glass.css` 覆写成暗色。

## 记忆系统

跨会话的项目状态、未做项、风险点记在 auto-memory（不在仓库里）。Claude 会自己维护，
但**用户要求的"持久工程约定"全写到这份 `CLAUDE.md`**，确保所有人都能看到。
