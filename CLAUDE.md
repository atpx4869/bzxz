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

## NSIS 升级保留契约（**强制**）

`build/installer.nsh` 在升级 / 卸载时必须保留两个目录，方案是「同卷 Rename 到 `$INSTDIR\..` 临时占位 → `RMDir /r $INSTDIR` → Rename 回来」：

- `$INSTDIR\data` —— 资质数据库 / CNAS·CMA 缓存（交互卸载弹窗确认，默认保留；升级静默路径直接保留）
- `$INSTDIR\standards` —— 本地标准 PDF 库（默认库路径 `<exe 同级>\standards`，**始终保留、不弹窗、不接受 IDNO**）

**Why:** 用户报告过升级把几十 GB 已下载 PDF 全删的事故。`data/` 体量小、丢了能重新订阅；`standards/` 是用户花时间积累的资产、误操作代价高，要走资源管理器显式手删才合理。同卷 Rename 是元数据操作、瞬时完成，不会复制 PDF 内容。

**How to apply:**

- 新增「需要跨升级保留」的目录按 backup-rename-restore 模板加，不要让 NSIS 直接 RMDir 覆盖
- 库路径变量从前端可改（admin 设置 `standardsLibraryDir`），但 NSIS 看不到该设置 —— **始终按默认路径 `$INSTDIR\standards` 处理**。改过路径的用户库本就不在 `$INSTDIR` 下、升级本来就不会动到，无需特殊保护
- 改 `installer.nsh` 后跑一遍打包（GitHub Actions `electron:build:nsis`）测一次升级流程，确保 Rename 临时占位（`$INSTDIR\..`）有写权限（Program Files 装机时会踩 UAC）

## 资质表 std_code 归一化契约（**强制**）

`cnas_qualifications` / `cma_qualifications` 任何 INSERT 都必须三层防御一起做：

1. **`cleanStdCode(raw)`** — 抓取入库前折叠年份连字符附近的多空格（不动前缀大小写）。让 DB 里 `std_code` 字段本身干净，保证 `LIKE '%3325-%'` 这种子串查询不漏命中
2. **`std_code_norm = extractFullCode(std_code)`** — 保留年份的归一化（精确同号同年匹配用,**主搜索资质徽章 `queryByStdCodes` 只用这层**）
3. **`std_code_base = extractBaseCode(std_code)`** — 剥年份的归一化（跨年模糊兜底,**仅「资质查询」页关键词搜 `searchQualifications` 在用**,UI 列表展示完整带年 stdCode 让用户看见命中年版）

`src/shared/std-code.ts` 是单一真相源，db.ts 启动时检测列空自动回填 + 检测脏空格自动 fixup。

**Why:** 三层各管一类问题。cleanStdCode 解决 CNAS 抓取写"年份连字符附近脏空格"导致 `LIKE` 子串漏命中；`std_code_norm` 解决全角/无空格/ISO 冒号变体 + 让批量徽章走索引等值查询；`std_code_base` 解决跨年版本兜底,但要避免污染主搜索徽章 —— 同号不同年视作不同资质(实验室持有 2013 版能力不等于持有 2025 版能力),由"资质查询"页用户主动跨年搜索时才呈现。漏写任何一层 → 新写入的行某类查询路径会漏（已经踩过"诊断接口显示能拉到、用户搜片段匹不上"的坑、以及"搜 2025 版徽章亮但实际只有 2013 版资质"的语义坑）。

**How to apply:**

- 新增 INSERT 资质数据的位置：先 `import { cleanStdCode, extractFullCode, extractBaseCode } from '../shared/std-code'`，对原始 stdCode 先 `cleanStdCode`，再把清洗后的值传给 `extractFullCode` / `extractBaseCode`
- 新增数据源（除 CNAS/CMA 外）想沾资质徽章 → schema 也加这两列 + 索引，沿用同样的三层防御
- 改 `cleanStdCode` / `extractFullCode` / `extractBaseCode` 逻辑（覆盖新的脏数据变体）后必须删 DB 强制下次启动回填 —— 或者临时跑 `UPDATE cnas_qualifications SET std_code_norm=''` 触发 backfill + fixup。新加 case 的单测放 `qualification-service.test.ts` 防回归

## 凭据配置（**强制**）

源 adapter 的账号密码**必须**通过 `.env.local`（仓库根，gitignored）注入，**绝不允许**写进任何 `.ts` / `.md` / commit message / auto-memory。

**键名约定：** `<SOURCE>_USERNAME` / `<SOURCE>_PASSWORD`（参考 `LABR_USERNAME` / `BY_USERNAME`）。

**Why:** `.env.local` 被 git 忽略，凭据不会泄漏到 PR、issue、CI 日志。dotenv 用 `override: false` 加载，所以真实环境变量（CI/pm2）依旧能覆盖本地默认值。把账号写进代码 / 文档 / 记忆 → 一旦仓库公开或被 share，账号绑定的水印追溯权益全暴露。

**How to apply:**
- 新增源接入流程多一步：在 `.env.example` 加占位 + 注释；用户拷成 `.env.local` 填真值
- adapter 读凭据走 `process.env.XXX_USERNAME`，未配置时报错信息要明确指向 `.env.local`（仿 `labr-service.ts:130-134`）
- 加载入口：`src/index.ts` + `electron/main.ts` 顶部 `loadDotEnvLocal()`；勘察脚本（`scripts/sources/**/inspect-*.ts`）自行加载
- 改 `src/shared/env-loader.ts` 的加载顺序时务必保持「真实 env > .env.local」的优先级

## 记忆系统

跨会话的项目状态、未做项、风险点记在 auto-memory（不在仓库里）。Claude 会自己维护，
但**用户要求的"持久工程约定"全写到这份 `CLAUDE.md`**，确保所有人都能看到。
