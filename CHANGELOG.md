# Changelog

## [Unreleased]

### Fixed
- 标准检索结果上的资质徽章漏显（典型现象：`GB/T 3325-2024` 在「标准检索」只显示 CMA 徽章，但「资质查询」搜同一关键词显示 CMA + CNAS 双资质）：
  - **Layer 1**：`src/services/qualification-service.ts:queryByStdCodes()` 第二阶段模糊兜底原先用 `stdCodes.filter(code => !result[code]?.length)` 筛选输入码，意图是"还没拿到结果的才走模糊匹配"。但当 CMA 表精确命中（`std_code` 干净，如 `'GB/T 3325-2024'`）、CNAS 表却因 scraper 历史写入带杂散空白（`'GB/T 3325 -2024'`）而精确匹配漏掉时，这个过滤会把该输入码整个跳过，CNAS 再也轮不到模糊兜底。改为 `stdCodes.slice()` 让每个输入码都走一次 Phase 2；下游 `addMatch` 按 `source+labNo` 去重，重复执行安全无副作用。
  - **Layer 2**：`extractBaseCode()` 用 `/\/[A-Z]+(?=\s)/i` lookahead 剥类别标识符（`/T` / `/Z` 等），对 `'GB/T 3325-2024'`（`/T` 后面是空格 ✓）能剥掉，但对 `'GB/T 3325 -2024'` 走过 step1 剥年份后变成 `'GB/T 3325'`（`/T` 后跟空格 ✓ 能剥），看似 OK；可一旦输入是 `'GB/T3325-2024'`（无空格变体）就会漏剥。统一改成 `/\/[A-Z]+/gi`，并把年份正则末尾补 `\s*$` 容忍尾随空白。两源 `extractBaseCode` 输出现在保证等价，Phase 2 才能真正搭桥。
  - 新增 `src/services/qualification-service.test.ts` 覆盖干净 / 杂散空白 / 尾随空白 / 不同类别标识符 / 小写 / 无标识符 等变体；`package.json` 的 `test` 与 `test:dev` 把 `src/services` 加入测试范围，CI 红绿挂得住
  - 治本（Layer 3）留到下次：CNAS scraper 写库前规范化 `std_code`（折叠多余空白、去 dash 两侧空白）+ 一次性迁移洗历史数据

### Added
- 手机端响应式骨架 + URL 路由（Phase 0+1 of 手机适配；详见 `docs/MOBILE_ADAPTATION.md`）：
  - **URL 路由**：`switchTab(tab)` 现在写回 `?tab=…`（保留 `?desktop=1` 等其他参数）并 dispatch `tabchange` 自定义事件；`initRouter()` 从 stub 升级到读 URL 进路由（白名单校验，缺省 `search`）；`popstate` 监听让浏览器前进/后退按 URL 进路由。可分享形如 `http://<lan-ip>:5937/?tab=qual` 的深链。`public/js/app-core.js`
  - **手机布局**：`@media (max-width:640px)` 块重写 —— sidebar 完全隐藏（不再用 60px 折叠），底部新增 `<nav class="mobile-tabbar">` 三 tab（标准 / 资质 / 我），content 留出 72px 底部 + safe-area-inset；结果卡片单列、批量勾选/快捷键禁用、按钮 ≥44×44px 触控热区；input 字号 ≥16px 防 iOS 自动缩放。`public/styles.css` + `public/index.html` + 新增 `public/js/app-mobile.js`
  - **"我"页**：手机端专属 tab，登录态显示用户名 + 角色，按权限露出"使用统计 / 用户管理 / 下载历史"行；底部"切换到完整版"开关写 `localStorage['bzxz.layout']`，配合 `?desktop=1` URL 参数构成桌面布局逃生口。新增 `<div id="page-me">` + `me-*` 样式
  - **Legacy guard**：`app-search.js` 全局 keydown（j/k/g/G/x/d/s）入口加 `if (window.isMobile()) return;`；`app-qual.js` `switchQualTab` 在手机模式强制走可视化页（搜索子标签 UI 隐藏）
  - **不变**：桌面端视觉零回归（所有 `≤640px` 规则用 `body:not(.force-desktop)` 包裹，PC 端 specificity 不变）；后端、Electron 主进程、端口逻辑均未改动
- 资质可视化手机版（Phase 2 of 手机适配，部分）：
  - 统计 4 卡改 2×2 网格、字号增到 20px、单卡 ≥56px 触控热区。`public/styles.css`
  - 查询成功后输入框自动折叠成一行摘要（仅手机），点折叠态标题 → 展开回 textarea 并 focus，结果占满视野。`public/index.html` + `public/js/app-qual.js`（`expandQualVisualInput()`）
  - `qual-visual-lab-head` 改 sticky，方便长结果列表浏览；cap 行加大到 44px 触控热区
  - 推迟：统计卡点击下钻、管理员同步进度 banner —— 留到 Phase 2.1/2.2
- PWA manifest-only（Phase 3 of 手机适配）：HTTP 内网无 SW（详见 `docs/MOBILE_ADAPTATION.md §6`），只做 manifest + 图标 + apple meta，三件套支持手机「添加到主屏」独立窗口：
  - `public/manifest.webmanifest`：name/short_name=标准盒子、`start_url=/?from=pwa`、`display=standalone`、`theme_color=#0f1117`、三个 icon（192/512/maskable-512）
  - `public/icon-{192,512,maskable-512}.png` + `apple-touch-icon.png`：从 `logo.png` 衍生，maskable 走 PWA 80% 安全区 + 深色画布兜底
  - `public/index.html <head>`：加 `<link rel="manifest">` + theme-color + 4 个 `apple-mobile-web-app-*` meta + apple-touch-icon
- 设置页「手机访问」可见性增强（Phase 4 of 手机适配）：
  - 内网 URL 行追加「📱 手机版」蓝色徽章，第一眼能看出哪条是给手机用的；卡片底部新增灰提示框：同网 Wi-Fi + 「添加到主屏」指引 + HTTP 暂未启用离线缓存的说明。`public/js/app-settings.js:renderWebAccessCard()` + `public/styles.css` `.web-access-phone-{hint,tip}`
  - URL/复制/打开/`webServiceEnabled` 开关/端口 fallback 红字提示在 prior commits 已实装，本次未动
  - **不做二维码**：手动输入 IP 或点复制按钮足够，避免引入 ~20KB vendored QR 库 + 复杂加密器

## [1.15.0] - 2026-05-23

### Changed
- 标准检索结果的资质徽章去掉日期后缀：原 CMA 徽章显示 `CMA 2026-03-12`，CNAS 徽章显示 `CNAS`（因 CNAS effectiveDate 在 DB 为空，看起来两源不对齐）。现在统一只显示纯 `CNAS` / `CMA` 三字简称，证书有效期、机构数等明细仍在 hover tooltip 里。`public/js/app-qual.js:qualBadgeHtml()` 单点改动。
- 内置 Web 服务默认端口固定为 **5937**（原先 `preferredPort: null` 走随机端口）：局域网多用户场景需要稳定 URL 才能书签，随机端口每次启动都换地址用户体验差。`electron/main.ts:getDefaultSettings()` 默认改为 `preferredPort: DEFAULT_PREFERRED_PORT (5937)`，已有用户的 `bzxz-settings.json` 不受影响（loadSettings 的 `{...defaults, ...saved}` 合并保留用户旧值）。5937 被占用时仍走 fallback 到随机端口，tray UI 同时显示 preferredPort 与 actualPort。
- Electron 打包路径预防：`package.json` 的 `build.asarUnpack` 加入 `dist/src/shared/pdf-merge-worker.js`，`src/shared/pdf-merge.ts:getWorkerEntry()` 自动把 `app.asar` 路径改写成 `app.asar.unpacked`。worker_threads 不能从 asar 内加载 `.js`，本地 `npm run dev` 看不出来，上 NSIS / portable 打包后才会炸——提前堵住。
- 进程退出钩子补 PDF worker 池清理：`src/api/app.ts:shutdown()` 现在会 `closePdfMergePool()`，避免 Electron 关窗时 worker 线程悬挂导致主进程多挂几秒。
- `docs/ARCHITECTURE.md` 新增「九、并发架构」章节：CnasScraper page pool / PDF merge worker pool / Tesseract pool / undici per-origin / ddddocr 多路复用 一处汇总，含总览表。新加耗时操作前应先翻这一节。
- BZ 标准 PDF 合成移到 worker_threads 池：原本 `embedJpg` + `addPage` + `drawImage` + `pdfDoc.save()` 全跑在 Express 主线程上，单次合成 0.5-3s 纯 CPU 会卡住其他 API。新模块 `src/shared/pdf-merge.ts` + `src/shared/pdf-merge-worker.ts` 用 2 个常驻 worker 承接所有 BZ 导出，JPEG bytes 通过 `transferList` 零拷贝转移；主线程在合成期间继续响应搜索/详情/订阅同步请求。多用户同时下载同一标准的体感卡顿基本消除。
- GBW captcha tesseract fallback 从单 worker 串行链改成 worker pool=2：原 `tesseractChain` 让所有 OCR 请求排队等同一个 `tesseract.js` worker，在 ddddocr 不可用时多用户 GBW 搜索 captcha 阶段会逐人 +500ms-1s。pool 至少能并行处理 2 路，剩余排队走 `tesseractWaiters` FIFO。ddddocr 主路径本来就靠 UUID 多路复用支持并发，所以这层只在降级时显效。
- `undici` Agent `connections` 16 → 32：注释补充说明 connections/pipelining 都是 *per origin* 的额度（undici 内部按 origin 维护独立 Pool），所以 16 是单源在多用户并发下的瓶颈而非全局上限。BZ 单次导出能并发 12 路下载页面，4-6 用户同时导出就吃满。32 仍远低于上游服务器限流。
- CNAS 同步从「串行 mutex」改为「page pool 真并行」：`CnasScraper` 内部维护共享 browser + per-job context/page + 信号量 `maxConcurrent=3`。同时同步 N 个机构不再排队，整体耗时从 `N × 单机构时间` 压到 `ceil(N/3) × 单机构时间`，N=3-6 时快 3-5x。`navigateToLab` 签名由 `(labInfo) => Promise<Page>` 改为 `(page, labInfo) => Promise<void>`，不再每次 close+relaunch 整个浏览器。`QualificationService` 上一版加的 `cnasSyncChain` Promise 串行链同步移除（page pool 已承接并发安全）
- 资质订阅与同步日志从「资质查询」整体迁入「系统设置 → 资质订阅」，资质查询页面只保留「搜索」和「可视化」两个子标签，专注查询场景；订阅管理在系统设置中以独立 section 渲染（含 订阅管理 / 同步日志 子标签 + 推荐订阅 + CNAS/CMA 添加表单 + 同步全部）
- 设置页「桌面程序 · 内置服务端口」卡片内容左偏：原先复用了「开机自启」的 `.desktop-setting-card`（`padding: 0`），但本身没用 `.desktop-setting-row` 把 padding 补回来，内容贴边导致与上方标准卡片不齐。改为不挂 `desktop-setting-card` 类，回到 `.settings-card` 标准 14px 内边距
- 资质「可视化」标签的「全部展开 / 全部折叠」改为整张机构卡片维度：现在折叠会真的把每张 lab-card 的内容区收起、只留标题（带 ▾/▸ 箭头），点标题也能单卡片折叠。旧实现只切换"展开剩余 N 条"溢出区，默认本来就是收起的，按"全部折叠"看起来毫无效果
- 退出登录改为"停在登录页 + toast 提示"：免登录 + loopback 模式下，退出登录不再立刻被后端兜底成新 guest 会话（看起来像退不掉），现在停在登录卡片并显示 toast『已退出登录』；登录卡片下方新增「继续以访客身份使用」链接，一键回到访客态（仅当 `loginRequired=false` 时露出）。Vite 入口 `web/src/modules/auth/session.ts` 与 legacy `public/js/app-auth-admin.js` 同步改动
- 资质「可视化」关键词输入框支持行内分隔：原本只支持换行 / 逗号 `, ，` / 分号 `; ；`，现在加上顿号 `、` / 中文句号 `。` / 制表符，可以直接粘贴形如 `GB 5009.9、淀粉、食品安全国家标准` 这种顿号串。注意没切英文句号 `.`，避免 `GB 5009.9` 这类标准号被切坏。`public/index.html` + `web/index.html` 的 textarea placeholder 同步更新

### Fixed
- 修改密码输错原密码时 `apiFetch` 将 401 误判为会话过期，把用户踢回登录页：现在 `/api/auth/*` 上的 401 统一由调用方处理，不再触发 overlay
- 资质订阅多账号同步并发会互相 close() 掉 CnasScraper 单例浏览器实例（报 `page.evaluate: Target page, context or browser has been closed`）：
  `QualificationService` 新增 `cnasSyncChain` Promise 串行链 + `runCnasSerially()` 包裹，`syncCnasLab` 改成入口转发，
  实际工作放到 `_syncCnasLabImpl`。链上的失败不污染下一个任务（`.then(fn, fn)` + `.catch(()=>undefined)`）。
  CMA 走纯 HTTP scraper，不受影响。
- 退出登录按钮"按了没反应"：旧 `doLogout` 在 DELETE /session 后立刻 `checkAuthStatus`，免登录模式下后端会马上派一个新 guest 会话，UI 一闪即恢复，看起来像退不掉。改为停在登录页并提供「继续以访客身份使用」入口
- 登录 overlay 在登出 / 会话过期时残留 register-mode 文案与上次输入的密码：新增 `resetAuthFormToLogin()`，每次显示 overlay 前先回到 login 默认态并清空密码框；登录/注册切换时也清空密码
- 登录表单可双击重复提交：提交期间禁用按钮，并校验用户名/密码非空

---

## [1.14.1] - 2026-05-18

### Changed
- GBW 文本检测轮询节奏：首次 poll 延迟 2000ms → 300ms，命中持久缓存的搜索现在"瞬时"返回结果，不再亮 2s 的"检测中"徽章；命中后下一轮 1000ms → 500ms，未命中退避 3000ms → 2000ms。配合 1.13.0 的持久 hcno 缓存，重复搜索的体感延迟基本归零

---

## [1.14.0] - 2026-05-18

### Added
- 搜索骨架卡片重做：数量按选中源数自适应（4–6，原先固定 4），骨架结构镜像 `.result-card` 的 7 列网格（check / 标准号 / 标题+副标 / 状态+文本徽章 / 来源 / 日期 / 操作），每行 80ms 阶梯式入场动画；从骨架到真卡片的过渡不再"塌方"
- 检测中三态文本徽章：搜索结果卡片右侧新增脉冲动画的「检测中」徽章，替代原本「无文本→有文本」乐观渲染的闪烁；废止标准跳过检测态直接显示「无文本」（其永远无预览）。卡片新增 `.checking-text` 修饰类，下载按钮在检测态保持 disabled
- 每源检索进度条：搜索框下方新增 `source-progress-strip`，逐源显示 `BZ ⟳ 检索中` / `BZ ✓ 12 条` / `BZ ✗ 超时` 圆角芯片，颜色按状态分（蓝/绿/红），失败时显示错误原因
- 结果卡片右键菜单：复制标准号 / 复制名称 / 复制标准号+名称 / 查看详情 / 下载该标准 / 加入收藏 / 复制为 JSON。位置自动 viewport-clamp，Esc / 滚动 / 点击外部均关闭
- 状态分组折叠：结果按 `现行 / 即将实施 / 其它 / 废止` 分组（≥2 类且 >5 条时启用），废止默认折叠，状态在 `localStorage[bzxz_collapsed_status_groups]`；展示「已渲染 / 总数」计数，"显示更多" 增量分发到对应分组
- vim 风格键盘导航：`j` / `k` 上下移动当前行，`g` / `G` 跳首尾，`x` / 空格 切换选中，`Enter` 查看详情，`d` 下载该标准，`s` 收藏。输入框、模态框打开时自动让位

### Changed
- source-badge 描边强化：三个数据源（BZ 蓝 / BW 绿 / BY 黄）加 1px 同色低透明边框，hover 时 brightness 1.08

---

## [1.13.0] - 2026-05-18

### Changed
- BZ 源预览/下载提速：新增 `read-pages` API 调用（SPA 真实使用的总页数接口，返回 58 字节 JSON），首次下载从「1 串 + 4 轮 8 并发 + 1 轮哨兵」(~6 串行阶段) 压到「1 次 API + 12 并发 worker 池」(~2 串行阶段)；写回 page-cache 后下次连这一次 HTTP 都省。原 sentinel hash 边界检测保留为兜底
- BZ 导出 PDF 嵌入：`embedJpg` 全部用 `Promise.all` 并发解析 JPEG 元数据，`addPage`/`drawImage` 仍按顺序保证页面顺序
- GBW "正在检测本文" 提速：`batchCheckTextAvailability` 并发 3 → 8（两个端点不同 host，连接池互不挤）；预筛新增持久缓存命中跳过

### Added
- GBW text-availability 持久缓存 `data/.text-availability-cache.json`：`sourceId → {hcno, hasText}`，30 天 TTL，重启不丢；`getStandardDetail` 的 hasText 兜底链也吃这层
- hcno 永久缓存（独立于 hasText TTL）：`getCachedHcno` 忽略 TTL 返回 hcno，TTL 过期复搜只剩 1 次 HTTP（跳过 gbDetailed step 1）；`setCachedHcno` 在 step 1 成功后立刻落盘，避免 step 2 失败时丢失发现成果

---

## [1.12.0] - 2026-05-17

### Fixed
- 启动脚本端口硬编码：3000 被占时静默崩溃。改为自动 fallback 到随机端口；start.bat / start.vbs 轮询 `data/.server-port` 文件读真实端口再开浏览器
- 桌面端窗口默认宽度 1280px 时下载按钮被挤出可视区。Electron 默认尺寸提到 1360×860，topbar 三栏布局加 flex-shrink:0 / min-width:0 防压缩；source-health-strip 在 ≤1100px 直接隐藏

---

## [1.11.0] - 2026-05-17

### Added
- 上游 HTTP 延迟统计：诊断面板新增"上游延迟统计"区，每个 host 显示 avg/max/last/失败计数，>2s 警告色 >5s 危险色
- undici Agent 加 pipelining:4，单 TCP 连接复用多请求，减少 GBW 验证码相关突发的 TCP/TLS 握手成本

### Fixed
- BY 内网 isAvailable 检测在外网环境每次搜索都 3 秒纯浪费 + 日志噪音。加 60 秒负缓存

---

## [1.10.0] - 2026-05-17

### Added
- 启动时环境自检：BW/BZ/BY 三源连通性 + OCR worker 预热，并发跑、异步不阻塞 server 启动
- 顶部红色警示条：自检发现异常时点击展开诊断面板，定位"为什么慢"
- 诊断面板：设置页加"🩺 诊断"按钮，显示 OCR 引擎、worker PID、Python 命令、PATH 环境变量、最近 100 条服务端日志

### Fixed
- trySpawnPython 同步 immediateError 检测无效（spawn error 是异步事件），导致 python3 / py 候选永远不会被尝试。改为 await 'spawn'/'error' 竞速
- OCR worker 启动失败时永久标记 unavailable，不再每次 OCR 重新 spawn 浪费启动超时
- OCR worker 启动超时 20s → 5s，没装 python 的机器第一次下载不再卡 20 秒

---

## [1.9.0] - 2026-05-17

### Added
- Python OCR 守护进程（常驻）：一次启动后所有验证码复用同进程，ddddocr 平均 OCR 耗时从 1-3 秒（每次 import）降到 ~50-200ms
- tesseract.js 也用单例常驻 worker + 串行链，没装 python 的用户单次 OCR 从 1-2s 降到 200-500ms
- 前端 default download concurrency 3 → 5，可选范围扩到 1-8

### Changed
- OCR `execFileSync` → 异步 `execFile`：多 worker 不再被同步阻塞事件循环

### Fixed
- GBW autoDownload 每次重试都重新 getStandardDetail（2 次 HTTP 请求）。加 10 分钟 LRU 缓存
- GBW autoDownload 重试只取新 captcha 图，不再重建整个 session（cookie 复用，省 showGb 请求）
- by-adapter ensureLogin 不去重：多 worker 并发会重复登录 N 次。加 in-flight Promise 共享
- GBW 多 pooledFetch 显式 retries:1 / 2，避免盲目重试 3 倍时间；verifyCode 一码一用绝不重试
- autoDownload maxRetries 5 → 3

---

## [1.8.0] - 2026-05-17

### Removed
- 整源删除 BZVIP：删 `src/sources/bz-vip/`、register-bot / capture-order-* scripts、`data/accounts.json` 不再打入 release，前端 source-tag / 筛选 / 优先级等 30+ 处一并清理

### Added
- API 统一 Result 壳 `{ data, error }`：所有 JSON 端点 + SSE 事件统一格式
- service 出口 `toCamelCase()` 转换：DB 行 snake_case 统一转 API camelCase
- 路由前缀重组：CNAS/CMA labs 全归 `/api/qualifications/labs/{cnas,cma}/*`，旧路径 alias 中间件兜底
- 中央错误处理：respond/respondError + AppError 子类，移除"业务失败塞进 HTTP 200"反模式
- 前端统一 `readApiResponse()` / `parseSseEvent()` 解 Result 壳
- 文档 `docs/ARCHITECTURE.md`：响应壳/命名/路由前缀/三层配置/源能力差异等约定

### Fixed
- 下载端点 `/api/downloads/:filename` 缺 requireAuth：LAN 部署下任何人都能拉走导出文件
- by 源默认硬编码密码 + 多处 `rejectUnauthorized: false` 跟随 bzvip 删除自然消失
- db.ts schema 迁移 14 行 `try { ALTER } catch {}` 改为 `PRAGMA table_info` 列存在性检测
- standards search cache 加 200 条 LRU 上限
- cnas-routes 批量同步走 `qual_sync_concurrency` 设置（之前形同虚设）
- electron 自动更新加最小校验：下载主机白名单 + asset.size 严格比对
- 兜底模糊查询全表 `.all()` 改 SQL LIKE + LIMIT 500
- 前端 8 个 `app-*.js` 加 `window._tabCleanup` 注册表，switchTab 切换时清理 GBW 文本轮询、资质同步轮询
- Chart.js 4.5.1 本地化到 `public/vendor/`，离线/内网环境不再依赖 CDN

### Changed
- by-adapter 与 bz/gbw 实现风格统一：复用 searchCache、pooledFetch、增加诊断日志
- showConfirm() 模态化替换 5 处原生 confirm()，按钮禁用态加灰底
- 搜索结果分批渲染：首批 100 条 + "显示更多"，避免 1000+ 卡顿
- 快捷键加 input/textarea 上下文保护，在文本框内不触发 Ctrl+D 等
- 批量下载失败 modal 展示具体错误原因（之前只有标准号）

---

## [1.7.0] - 2026-05-15

### Added
- BW 源搜索结果后台文本可用性检测：搜索完成后异步批量检测文本状态，自动刷新下载按钮
- 搜索状态指示器（右下角浮窗）：实时显示搜索进度（正在搜索 → 搜索中 N/M 源 → 正在检测文本 → 文本检测完成）
- 乐观 UI 策略：非废止标准默认显示有文本，检测确认无文本后才禁用下载按钮

### Fixed
- GBW 搜索 API 返回 JSON 带前导空白/BOM 导致解析失败
- BW 源文本检测轮询在首次空响应后立即停止，改为连续 20 次空响应才超时
- 批量文本检测请求超时后缓存错误结果，导致 5 分钟内无法重试；改为超时不缓存、下次搜索自动重检
- 批量检测并发过高导致请求超时，降低并发数并调整超时参数

### Changed
- 文本可用性轮询改为递归 setTimeout：有新数据时 1 秒后再查，无变化时 3 秒，提高刷新效率
- 即使搜索结果命中缓存，仍对缺失文本状态的项触发批量检测

---

## [1.6.0] - 2026-05-15

### Fixed
- CNAS 同步传递完整 URL 参数（id、labType、scopeStr、orgEnOrCh 等），修复因参数缺失导致 CNAS 网站反爬拦截同步失败的问题
- 可视化搜索中同一标准号的 CMA/CMAS 记录被拆成两行显示，改为按标准号聚合

### Added
- CNAS 同步实时进度显示（如 `2541/6521 (39%)`），前端每 2 秒自动轮询刷新
- CNAS 订阅详情展示：注册编号、报告/证书其他名称、单位地址、认可有效期限、证书附件任务列表（任务编号、评审类型、签发日期、公布状态）
- 仅订阅一个检验机构时，可视化搜索结果中弱化机构名称显示（小号灰色）

### Changed
- 可视化布局全面紧凑化，缩小间距、字号、内边距，信息密度提升约 30%
- 统计栏从 2 列改为 4 列，更紧凑

---

## [1.5.0] - 2026-05-14

### Added
- Electron 桌面端启动时自动检查 GitHub Release 新版本
- 支持下载 NSIS 安装包并自动启动安装流程
- 设置页显示本机地址和局域网地址，可复制或用浏览器打开
- 托盘菜单集成 Web 服务开关控制

### Fixed
- BZ 源预览导出页面检测逻辑修复

---

## [1.4.0] - 2026-05-13

### Added
- 标准补全工作流：Excel 上传 → 标准号自动识别 → 多源搜索补全 → 结果回写原表
- 下载中心集中管理批量下载任务，支持 SSE 实时进度推送
- 本地文件库：标准收藏管理、下载历史查看
- 前端模块拆分：app.js 拆分为 app-core / app-search / app-download / app-complete / app-settings 等独立模块

---

## [1.3.0] - 2026-05-12

### Changed
- 改进标准补全工作流，支持自定义输入输出列
- 分离实时数据源测试与默认单元测试

---

## [1.2.0] - 2026-05-11

### Changed
- 改进免登录模式用户体验
- 优化下载操作的 UI 反馈

---

## [1.1.0] - 2026-05-09

### Added
- 免登录模式：默认开启，未登录用户以 `_guest` 身份使用，无需注册
- 后端自动切源下载：批量下载时按优先级依次尝试多个源（BZVIP → BW → BY → BZ），失败自动切换

### Fixed
- GBW 源验证码有文本时的识别问题

---

## [1.0.0] - 2026-05-08

### Added
- CNAS/CMA 资质能力验证功能
  - Playwright 自动采集 CNAS/CMA 官方系统数据
  - 搜索结果自动标注具备检测能力的实验室（绿色徽章）
  - 实验室订阅/取消订阅，后台定时同步（默认每周日凌晨 3 点）
  - 同步日志：记录每次同步的时间、状态、抓取记录数
  - 机构关联：同一物理机构的 CNAS/CMA 资质合并显示
- 前端 UI 重设计
  - 深色毛玻璃主题（oklch 色彩空间 + backdrop-filter）
  - 侧栏导航 + 多标签页布局
  - Chart.js 可视化仪表盘

---

## [0.9.0] - 2026-05-07

### Added
- 用户账号体系（SQLite 本地数据库，无需外部服务）
  - 注册 / 登录 / 登出 / 修改密码
  - 首个注册用户自动成为管理员
  - Session Cookie（HttpOnly，30 天滑动续期）
- 管理员功能
  - 开启/关闭公开注册
  - 开启/关闭登录验证
  - 用户增删改查（角色、启用/禁用）
  - 用户级功能权限控制（按 Tab 配置可访问功能）
  - 查看用户使用明细（搜索/下载次数、来源分布、事件列表）
- 使用统计仪表盘
  - 汇总卡片（按事件类型计数）
  - 趋势折线图（按日期）
  - 来源分布饼图
  - 管理员可按用户维度查看明细
- GBW 显示名改为 BW

### Fixed
- 测试用唯一用户名避免污染生产数据库
- 统一所有浮动面板 header 格式
- 修复"使用统计"和"用户管理"面板无法显示

---

## [0.8.0] - 2026-05-06

### Changed
- HTTP 连接池优化网络请求
- 搜索结果缓存 + 页数缓存减少重复请求
- 并行 JPEG 下载提升 BZ 源导出速度
- 懒加载重型依赖优化 Electron 启动速度
- asar 启用 maximum 压缩减小包体积

### Added
- GitHub Actions 自动构建
  - 同时生成 portable 便携版 + NSIS 安装包
  - 版本号自动设置为 `1.0.<run_number>`
  - 自动发布 GitHub Release（tag 形如 `v1.0.123`）

### Fixed
- 移除不兼容的 asar compression 配置
- 修复 Node.js 20 弃用警告
- portable 和 nsis 拆分为两个独立 artifact

---

## [0.7.0] - 2026-04-29

### Added
- 搜索历史记录（可配置条数 3~20，localStorage 持久化）
- Toast 通知组件
- 搜索结果卡片进场动画
- 键盘快捷键（`Ctrl+K` 搜索 / `Ctrl+Enter` 确认 / `Esc` 关闭 / `?` 查看）
- 下载按钮即时反馈：spinner、行高亮、成功/失败闪烁
- BZ 源页级实时下载进度、文件大小、批量进度文字
- 统一下载文件命名：`标准号 标准名称.pdf`，四个适配器共用 buildFileName
- 搜索日志显示关键词，如 "搜索 bz(GB/T 1.1) 完成 (+5 条)"
- 下载模式设置（顺序/竞速）、并发数和超时时间（持久化）
- 数据源健康检测（设置页手动检测 + 单源重试）
- 设置面板源标签改为通用名称 GB/BZ/BY/BZvip

### Fixed
- 多源下载使用各源专属 ID，避免 BZ/BY 错误调用 GBW 适配器
- 网页版入口也清除代理环境变量，bz/gbw 不再走 Clash
- 增加 `%LOCALAPPDATA%\nodejs\node-v*` 路径检测
- 修复搜索记录层级被遮挡（z-index 50→350）
- 修复 getHistoryLimit 嵌套作用域导致 ReferenceError
- 修复设置面板加载中 + 搜索记录显示

---

## [0.6.0] - 2026-04-28

### Added
- Electron 桌面端
  - 系统托盘驻留（右键菜单 / 双击恢复窗口）
  - 关闭窗口不退出，最小化到托盘
  - 自动选择随机端口
  - 绕过系统代理直连（Clash 等不影响）
  - 隐藏默认菜单栏
  - 下载文件保存到 `用户目录/downloads/bzxz`

---

## [0.5.0] - 2026-04-27

### Added
- 后端自动切源下载（BZVIP → BW → BY → BZ）
- 下载优先级设置面板
- 并发数和超时配置

---

## [0.4.0] - 2026-04-26

### Added
- BZVIP 账号池管理
  - 从 `data/accounts.json` 加载账号列表
  - 令牌刷新机制（refresh_token 优先，失败则重新登录）
  - 每月 15 次下载配额限制
  - 串行化获取防止竞态条件
  - 登录时自动 OCR 识别验证码
- BZVIP 注册机器人脚本（scripts/register-bot.ts）

---

## [0.3.0] - 2026-04-25

### Added
- GBW 源验证码自动识别
  - 首选：Python ddddocr 库
  - 回退：sharp 预处理 + tesseract.js
  - 自动重试最多 5 次
  - 每次 OCR 尝试记录日志

---

## [0.2.0] - 2026-04-24

### Added
- BY 内网数据源（172.16.100.72）
  - HTML 解析搜索结果
  - 直接 PDF 下载（需内网登录态）
- SourceAdapter 适配器模式统一四个数据源接口
- 标准 ID 编解码（格式：`source:sourceId`）

---

## [0.1.0] - 2026-04-23

### Added
- 项目初始化
- BZ 标准在线（bz.gxzl.org.cn）搜索 + JPEG 逐页导出 → pdf-lib 合并 PDF
- GBW 国标网（openstd.samr.gov.cn）搜索 + 验证码 + 直接 PDF 下载
- Express REST API 服务
- 原生 HTML/CSS/JS 前端 SPA
- SQLite 本地数据库（better-sqlite3, WAL 模式）
- Windows 一键启动脚本（start.bat / start.vbs）
