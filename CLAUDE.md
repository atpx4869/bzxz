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
- **`web/src/styles/theme/legacy.css` 已在 `SKIP_FILES` 白名单**（见 `scripts/css-oklch-fallback.mjs`）—
  这是 Win7 兜底主题，必须保持纯 hex 调色，**禁止写 oklch**。即便误写也不会被注入兜底
  （让 CI 的 oklch:check 红线暴露问题而非掩盖）。

## Legacy 主题契约（**强制**）

`web/src/styles/theme/legacy.css` 是 Win7 / Chrome ≤109 兜底主题，作为四主题中的
第四态（`dark` / `light` / `paper` / `legacy`），由 `:root[data-theme="legacy"]`
scope 化，**不污染**其他三个主题。

**触发路径（双轨）：**

1. **自动**：`public/index.html` + `web/index.html` 顶部 FOUC 内联 script 检测 UA
   （`Chrome ≤109` 或 `Windows NT 5.x / 6.x` 即 XP/Vista/7/8/8.1）→ 强制写入
   `localStorage 'bzxz.theme' = 'legacy'`。下次开机生效。
2. **手动**：`bzxzTheme.set('legacy')`，topbar picker + 我页 chip 都有第 4 项 `◆ 经典`。

**禁用清单（写 legacy.css 时**绝对不能**用的现代特性）：**

- `oklch()` / `oklab()` / `color(display-p3 ...)` / `color-mix()` — Chrome 109 不支持
- `backdrop-filter` / `-webkit-backdrop-filter` — Win7 DirectComposition 路径残缺，会卡顿/撕裂/黑屏
- `mask-image` 大区域 — Win7 旧 GPU 路径掉帧
- `@layer` / CSS Nesting `&` / `:has()`(谨慎) / `@container` — Chrome 109 不支持或刚出
- Google Fonts（DM Sans / Source Serif 4 / DM Mono）— 已通过 `<head>` 内联 script
  条件加载（legacy 时跳过），内网超时不阻塞
- SMP 区彩色 emoji（U+1F300+，如 🌙☀️📜🔍📊📥📋📑）— Win7 系统无字形显示方框，
  legacy.css 用 `::before` / `::after` 注入 BMP 区几何符号（◎▤◐▣▦▥▩◈◇⚙⚐ 等）覆盖

**Why:**

- 第四主题而非全局降级：99% 用户用现代浏览器看到 frosted glass / DM Sans 设计资产，
  削平所有 backdrop-filter 等于陪 1% Win7 用户吃亏。隔离切面才对。
- 纯 hex 而非双声明：legacy 用户根本看不到 oklch，写它徒增维护；同时让 oklch:fix
  脚本通过 `SKIP_FILES` 白名单忽略此文件，强制纪律。
- UA 自动 + 手动并存：UA 嗅探不可靠（Edge IE 模式 / 公司魔改 chromium），手动入口
  是兜底；反过来开发自测也方便。
- 同步两个 HTML 入口 + `public/styles.css` 末尾追加重复段：维持 legacy `public/index.html`
  入口可用，与 `theme/glass.css` 沿用同样的「迁移期重复加载、cascade 等价」契约。

**改 legacy.css 后必须**：跑一遍 `npm run oklch:check`（已自动跳过 legacy.css），
push 后 GitHub Actions 出包，理想情况下用 Win7 + Chrome 109 portable 实测一次
（无 Win7 环境时至少用 Chrome devtools 改 UA 模拟触发 `data-theme="legacy"` 自测）。

**入口侵入清单（动 legacy 主题必同步的 7 处）：**

1. `web/src/styles/index.css` — 末尾 `@import './theme/legacy.css'`（在 glass.css 之后）
2. `web/src/styles/theme/legacy.css` — 主文件
3. `public/styles.css` — 末尾追加同内容（迁移期双轨）
4. `public/index.html` — FOUC 内联 script UA 嗅探 + 字体 link 条件化 + picker 第 4 项 + 「我」页 chip 第 4 项
5. `web/index.html` — 同 ④
6. `public/js/app-theme.js` — `VALID = [...,'legacy']`、`THEME_META.legacy`
7. `scripts/css-oklch-fallback.mjs` — `SKIP_FILES` 白名单

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
- 改 `cleanStdCode` / `extractFullCode` / `extractBaseCode` 逻辑（覆盖新的脏数据变体）后**必须 +1 `db.ts` 的 `STD_CODE_ALGO_VERSION` 常量** —— 启动时 `renormalizeOnAlgoBump` 会按版本号 gate 对 cnas/cma 资质 + cma_capability_lib 三张表已有行**全量重算 std_code_norm/std_code_base**（幂等，版本不变不跑）。不再需要手动删 DB / 跑 `UPDATE ... SET std_code_norm=''`。新加 case 的单测放 `qualification-service.test.ts` 防回归
- **年份是天然终止符**：`extractFullCode` 匹配第一个 `-YYYY` 后**截断其后全部内容**——年份后挂的条款（`第8.3.1.3条`/`4.2条`）、附录（`附录A`）、章节等引用修饰一律丢弃，让同一标准的不同条款归一为同号（去重聚合前提）。新脏后缀形态无需再加专用正则。全角/半角问号 `？?` 在 `preNormalize` 当噪声删除

## 功能权限（tab）契约（**强制**）

每个 sidebar「功能页」对应一个 tab key，权限模型靠 `users.allowed_tabs`（JSON 数组，`null`=全部允许）。**新增 / 删除一个 tab 必须四处同步**：

1. `public/index.html` sidebar 的 `data-tab` 按钮
2. 后端 `src/api/admin-routes.ts` 的 `ALL_TABS` 常量 **+ 三处 `z.enum([...])`**（PUT /settings、POST /users、PUT /users/:id —— zod 无法 spread const tuple，字面量重复）
3. 前端 `public/js/app-auth-admin.js` 的 `TAB_ITEMS`（权限勾选 UI 真相源）+ `TAB_LABELS`
4. **服务端守卫**：该 tab 对应路由挂上 `requireTab('<key>')`

**服务端强制（`requireTab`）：** `allowed_tabs` 不能只在前端 `switchTab` 隐藏入口 —— 那是纯装饰，手敲 URL 仍越权。`createAuthMiddleware` 返回的 `requireTab(...tabKeys)` 仿 `requireAdmin`：内部先跑 `requireAuth`，admin 放行，`allowed_tabs===null` 全放行，否则与 `tabKeys` 取交集（OR 语义），否则 403「没有访问该功能的权限」。

**Why：** 之前 `allowed_tabs` 只做前端隐藏，任何人 `curl /api/check/...` 可越权。requireTab 把同一套名单落到服务端闭环。

**How to apply：**

- **路由挂载方式决定守卫写法**：`app.use('/api/stats', router)` 这种**带 mount path** 的可以 `router.use(requireTab('stats'))` 整 router 守卫；但 `check`/`labr`/`qual` 是 `app.use(router)` **挂在根上无 mount path** —— `router.use()` 会命中**全站每个请求**（router 的无 path 中间件对所有进入它的请求生效），必须改 **per-route guard**（`const requireX = requireTab('x')` 逐路由替换 `requireAuth`）。踩过这个坑，务必注意
- **一端点多 tab 复用走 OR**：`POST /api/qualifications/batch-query` 既服务资质查询页、也给标准检索结果点资质徽章，用 `requireTab('qual','search')`，否则只有搜索权限的用户徽章全灭。同款套路：`POST /api/cma-diff/batch-status`（国家库徽章）走 `requireTab('cma-diff','qual','search')` —— 徽章注入到三个页面，权限路径要一致
- `requireTab` 内部已含 `requireAuth`，替换后原 per-route `requireAuth` 可留作冗余兜底（不影响行为）或删除
- `settings`/`logs` 的数据接口本身是 `requireAdmin`（admin-only），即便授予普通用户该 tab，页面数据仍 403 —— 这是有意的（与 `users` tab 同理），名单里保留它们只是为了权限 UI 完整

## `bzxz://` 协议联动（deep-link）契约（**重要**）

桌面端注册了 `bzxz://` 自定义协议，供 Listary 等外部启动器「打开 URL」唤起本应用直达结果页。协议格式 **`bzxz://<host>?q=<词>`**：`host` = tab key（目前 `search` / `qual`），`q` = 搜索词。资质查询**合并为单一 `qual` 入口**——「按关键词」模式（`searchQualifications`）的 SQL 本就同时匹配标准号字段（`std_code_norm`/`std_code`）与关键词字段（`std_name`/`test_object`/`test_param` 等），不需要为「按标准号」单独开 host。

**热路径 / 冷路径双轨（动协议逻辑时要意识到两条都走通才算对）：**

- **冷启动**（应用未运行被协议拉起）：`electron/main.ts` 的 `whenReady` 里扫 `process.argv` 取出 `bzxz://` URL → `parseDeepLink` → 暂存 `pendingDeepLink` → `createWindow()` 把它拼进**首个 `loadURL`** 的 `?tab=&q=` → 前端 `initRouter` 读 `?q=` 消费。
- **热路径**（应用已在跑）：单实例锁（`requestSingleInstanceLock`）把第二实例的 argv 交给主实例 → `second-instance`（Windows）/ `open-url`（macOS）解析 → `dispatchDeepLink` 聚焦窗口 + `webContents.send('bzxz:deeplink', …)` → preload 的 `onDeepLink` → 前端 `applyDeepLink` 填框触发。

**改协议相关功能必须同步的 5 处（漏一处某条路径就断）：**

1. `electron/main.ts` — `DEEPLINK_SCHEME` 常量、`parseDeepLink`（host→tab 映射 + 已知 tab 白名单）、`dispatchDeepLink`、单实例锁 + `second-instance`/`open-url` 事件、`whenReady` 冷启动 argv 扫描、`createWindow` 里 `pendingDeepLink` 拼进 `loadURL`、运行时 `setAsDefaultProtocolClient`（portable 兜底）
2. `electron/preload.ts` — `onDeepLink` 暴露（订阅 `bzxz:deeplink`，仿 `onUpdateDownloadProgress` 返回 unsubscribe）
3. `public/js/app-core.js` — `initRouter` 读 `?q=`（消费后从 URL 抹掉，避免刷新重搜）+ `applyDeepLink({tab,q})`（host→输入框 id + 触发函数映射：`search`→`#searchInput`+`doSearch`，`qual`→`#qualSearchInput`+`doQualSearch`）+ `initPanels` 里 `window.bzxz.onDeepLink` 订阅
4. `package.json` build 段 `protocols` 字段（`schemes:['bzxz']`）— **NSIS 安装时写注册表，是正式版协议生效的唯一途径**
5. README「Listary / 外部启动器联动」+ CHANGELOG

**Why 关键决策：**

- **单实例锁是前提**：没有它，协议每次唤起都开新 Electron 实例 + 新 express 端口（端口默认 5937 占用会回退随机），词送不进运行中的窗口，已有窗口也不聚焦。
- **运行时注册 + builder `protocols` 双保险**：NSIS 安装版靠 `protocols` 写注册表；portable 版无安装步骤，靠运行时 `setAsDefaultProtocolClient` 兜底。
- **协议不依赖固定端口**：`main.ts` 自己持有真实 `serverPort`，`loadURL` 用它，绕开「5937 被回退成随机端口」的坑——所以新增 host 时**不要**让前端去猜端口，词的载体始终是 main 进程已知的那个 URL。
- **新增 host = 新增 tab 联动**：要让 `bzxz://<新tab>?q=` 生效，先确认该 tab 已走完上面的「功能权限（tab）契约」，再在 `parseDeepLink` 的 host 映射 + `applyDeepLink` 的输入框/触发函数映射各加一条。

**改后验证**：本机跑不了打包，至少跑 `npx tsc -p tsconfig.electron.json --noEmit`（electron 目录不在主 `tsconfig.json` include 内，主 build 测不到 main.ts/preload.ts）。协议注册**必须重新打包 NSIS 安装一次**系统才认识 `bzxz://`，push 后看 Action 出包实测。

**网页版联动复用同一套 `?tab=&q=`**：`bzxz://` 只在装了桌面版的机器生效；无桌面版的用户（常态：仅 admin 装桌面版，其余走网页版）改用 http 深链 `http://<admin内网IP>:5937/?tab=<tab>&q=<词>`，**前端 `initRouter` 读 `?q=` 是桌面 / 浏览器共用代码、零额外实现**。所以改 `applyDeepLink` 的 host→输入框映射时，桌面冷启动和 web 深链**同时受影响**，验证两条都要顾。登录态不丢参：LAN 用户登录成功后 `onAuthReady → initPanels → initRouter` 才读地址栏并触发，不会提前空打。分流**按机器**（装没装桌面版）而非按账号，固定绑定、不做运行时协议探测——普通用户机器没 `bzxz://`，给他们配协议链接会弹"无法打开"框。

## CMA 一单一库（cma-diff）契约（**重要**）

`cma_capability_lib` 是市场监管总局《检验检测机构资质认定能力项目库》的本地镜像，给 `cma-diff` tab + 搜索/资质查询徽章用。数据语义**不同于** `cma_qualifications`（机构持有的资质行）—— **本表是"政策范围内的合法标准号清单"**，两表正交不重叠。

### 同步契约

- 远端 `https://cma.caqit.org.cn/cma-admin/system/standardData/list` **只接 11 个顶层 `domain` 名**（实测 `domainId` / 子领域名都返回 0 行），按 11 个领域分桶同步。领域常量在 [`src/shared/cap-lib-domains.ts`](./src/shared/cap-lib-domains.ts) **硬编码**且与 `src/services/db.ts` 的 `CAP_LIB_DOMAIN_INIT` 数组**手动保持一致**（11 个名相同顺序无关）。新增/删除领域需两处同改
- **分页拉取**：单领域按 `pageSize=2000` **逐页拉**（`pageNum` 递增到拉满 `total` 或末页），不带任何 header（无鉴权）。**Why 不再一次拉 60000**：远端按行数线性变慢（~277 行/秒），产品质量检验 41k 行一次拉全要 5-7 分钟、超任何合理超时 → 卡 0%/失败（已踩坑）。分页后单页 ~36s（远低于 90s 单页超时）+ 能边拉边报「拉取中 X/total」进度。RuoYi `pageNum/pageSize` 实测生效。改 `REMOTE_PAGE_SIZE` 时注意单页耗时随行数线性涨
- **同步串行化（防假死）**：所有 `runSync` 串到模块级 `syncChain`（并发 1），入库按 2000 行分块事务、批次间 `setImmediate` 让出事件循环。**Why**：better-sqlite3 事务同步阻塞主线程，旧版「全部更新」一次性启动全部领域 → 多个大事务连环锁死事件循环 → 进度轮询排队 → 页面假死（已踩坑）
- **入库三层归一化必须落齐**：`cleanStdCode → extractFullCode (std_code_norm) → extractBaseCode (std_code_base)`，沿用现有契约。漏写任何一层徽章批量查询会漏命中
- **hash diff**：每行 `sha1(domain|method|stdCode|remark|libStatus|rawStatus)`，与现存 `row_hash` 相同时只 `UPDATE last_seen_at`、不写主字段（索引压力 ↓）。`row_hash` 列的字段集合变化时（如新增 raw 字段）必须升级 hash 算法 + 强制全量重 hash —— 否则 diff 永远算"未变"
- **soft delete**：远端本次没出现的行**不立即 DELETE**，仅 `last_seen_at` 不更新。`POST /api/cma-diff/cleanup` admin 手动按钮才真删（默认 30 天阈值）。**为什么**：远端慢/单页超时/RuoYi 分页抽风可能局部丢数据，硬删会让订阅机构资质徽章瞬间全变 ⛔，30 天窗口够覆盖所有临时丢失再决策

### 5 档比对状态

`parseLibStatus(remark)`（[`src/shared/cap-lib-status.ts`](./src/shared/cap-lib-status.ts)）解析远端 remark → `active / cite_only / abolished`。`diffByLab(certNumber)` 双子查询：
- `std_code_norm` 等值（**保年命中**，唯一答案） → 给出 in_lib / cite_only / abolished
- `std_code_base` 等值 + 只看 active 且 `std_code_norm <> q.std_code_norm` 排除已命中那条（**剥年兜底**） → 给出 series_only 时的 `seriesNewCode`

**不要让 series_only 当作"等价替代"宣传**：算法只指认"标准号系列在库"，机构当前 `test_item` 是否在新年版里能继续做，要用户自行核查。文案口径要谨慎。

### 徽章注入

`app-cap-lib-badge.js` 是单一徽章源，由 `app-search.js`（搜索结果卡）+ `app-qual.js`（资质查询页）+ `app-cma-diff.js`（比对页）三处共用。同步完成后必须 `window.capLibInvalidateCache()` 失效一次否则徽章是旧数据。

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
