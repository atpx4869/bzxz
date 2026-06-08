# Changelog

## [Unreleased]

### Added / Changed
- **fix(batch): 批量解析支持裸数字标准号** —
  `StandardResolver` 新增裸号解析分支，接受 `3324-2024` / `3325` / `18584` / `17657`
  这类不带 `GB/T` 前缀的输入；查询时按原文数字号搜索各源，挑选时仍用同基础号过滤，
  带年份要求精确年版，不带年份优先现行最新版本。批量下载和标准补全共用 resolver，
  不会再在前置校验阶段返回「无法识别为标准号格式」。页面 placeholder/hint 同步说明可直接粘裸号。
- **feat(complete/batch): 标准补全预览 + 批量下载真实多源回退** —
  `POST /api/standards/complete/preview` 新增 Excel/CSV 轻量预览，上传后先校验输入/输出列、
  表头跳过、唯一/重复数和前 8 条标准号，前端列配置变更会自动刷新预览；正式补全摘要增加
  `unique/duplicates/skippedHeader/inputColumn/outputColumn/sheetName`。`StandardResolver.resolve`
  支持 `collectSourceIds`，批量解析返回每条标准在各来源的真实 `sourceIds/sources`，
  批量下载据此调用 `/api/standards/multi-download` 切源，不再只知道首个命中来源；结果卡片同步显示
  下载中/成功/失败状态，并提供失败项重试入口。
- **perf(cma-diff): 产品质量检验拉取提速 + 领域订阅批量化** —
  `runSync` 不再整条进入全局串行队列，改为远端页请求限流并发、SQLite 入库单独走
  `dbWriteChain` 串行分块事务。产品质量检验仍按 `pageSize=2000` 分页，但首页拿到 `total`
  后同领域最多 4 页并发、全进程最多 4 个远端请求，进度新增 `queued` 表示已拉完等待入库。
  前端「更新勾选」改为一次 `POST /api/cma-diff/sync-selected` 启动所有勾选领域；领域复选框
  350ms 防抖后批量 `PUT /api/cma-diff/domains/subscriptions` 保存，点击同步前会先 flush。
  同一个 job 被多个按钮监听时现在支持追加完成回调，避免批量按钮卡在等待态。
- **fix(theme): 弹窗灰底残留继续收口** — 公告弹窗不再固定使用 `#fff/#eee/#f4f4f5`
  亮色 popup，dark/light/paper/legacy 主题下卡片、页眉/页脚边线、正文、代码块、链接和关闭按钮都走对应
  theme token；本地文件统一命名/批量补全里的 normalize 预览区补齐 chip/list 边框和 active 态主题色。
  `public/styles.css` 与 `web/src/styles/theme/*` 双轨同步，`pages/announcement.css` 保留基础亮色基线。
- **polish(ui): 本地文件库加载态 + 搜索结果防跳动 + 源检测分层提示** —
  本地文件库刷新/筛选/加载更多加入 loading 状态、重复点击防护和请求序号保护，旧请求晚回来不会覆盖新关键词结果；
  空态区分「文件库为空」与「暂无匹配」。搜索结果默认分组从「资质×状态」8 组收敛为纯状态 4 组，
  默认智能排序不再把异步资质徽章作为最高优先级，徽章回来只更新视觉和筛选计数，避免用户阅读时卡片跳动。
  数据源状态胶囊与设置页检测结果区分「未配置」「超时」「异常」，BY 缺 `.env.local` 时更直观。
- **perf(local-library): 本地文件库改 indexed basename + 服务端分页筛选** —
  `standard_files` 新增 `file_name` 列与索引，启动迁移自动从 `abs_path` 回填；扫描、下载入库、
  watcher、重命名都会同步维护。`GET /api/downloads/:filename` 从 `abs_path LIKE '%name'`
  改为 `file_name = ?`，避免库文件多时全表后缀扫描；`GET /api/downloads` 新增
  `q/limit/offset`（默认 200）并返回 `total/libraryTotal/exportTotal`。本地文件库前端搜索改为
  250ms 防抖请求服务端，计数显示「已加载/总数」，大库可继续「加载更多」。
- **perf(qual/cma-diff/search): 收敛高频查询与渲染** — 「按标准查」资质搜索改为两阶段：
  SQL 先按标准号分组计数并限制分组数，再只为入围组取最多 500 行明细，避免关键词命中大表时先全量拉平。
  CMA 一单一库 `labsCounts()` / `exportDiff()` 复用同一个黑名单与手动映射 context，减少多机构统计/导出时的重复 SQL。
  搜索结果页把源返回、资质徽章、GBW 文本状态轮询触发的 `renderResults()` 合并到下一帧，降低渐进加载抖动。
- **fix(sources/ci/docs): 源检测取消链路、BY 凭据与 CI 卡口补齐** —
  `SearchStandardsInput` 增加 `signal/timeoutMs`，BZ/GBW/BY 搜索把 AbortController 传到 `pooledFetch`；
  `/api/standards/check-sources` 的 5 秒超时现在会真实取消请求并在 `finally` 清 timer。BY 源凭据不再写死，
  必须通过 `.env.local` 的 `BY_USERNAME/BY_PASSWORD/BY_DEPT_ID` 注入，缺失时报明确错误。新增
  `.github/workflows/pr-check.yml`，打包 workflow 也加入 `npm run oklch:check`；补 `docs/MIGRATION.md`
  并校正 web 迁移文档中不存在的 `web:*` 脚本。
- **fix(preview): `/api/preview/files` 兼容 `items` 响应字段** — 本地预览源选择器读取
  `data.items || data.files`；后端返回 `{ files, items: files }`，没有标准号归一化结果时也返回空数组别名。
- **feat(deeplink): `bzxz://` 自定义协议 — Listary 等启动器快捷唤起标准搜索 / 资质查询** —
  注册 `bzxz://` 协议，外部工具构造 `bzxz://search?q={query}`（标准搜索）/
  `bzxz://qual?q={query}`（资质查询）即可唤起桌面端并直达对应结果页。资质查询合并为单一关键词
  入口（「按关键词」模式的 SQL 本就同时匹配标准号与关键词字段，无需区分子模式）。
  **实现**：`electron/main.ts` 加 ① 单实例锁（`requestSingleInstanceLock`，防协议每次唤起开新实例/新端口）+
  `second-instance`/`open-url` 解析 argv 里的 `bzxz://` URL → `parseDeepLink` → 聚焦窗口 + IPC 推词；
  ② 冷启动扫 `process.argv`，把词拼进首个 `loadURL` 的 `?tab=&q=`；③ 运行时 `setAsDefaultProtocolClient`
  兜底 portable 版。`preload.ts` 暴露 `onDeepLink`；`app-core.js` 的 `initRouter` 读 `?q=` + 新增
  `applyDeepLink`（切 tab → 填 `#searchInput`/`#qualSearchInput` → 触发搜索，消费后从 URL 抹掉 q）。
  `package.json` build 段加 `protocols` 字段让 NSIS 安装时写注册表。**需重新打包安装后系统才认识协议**。
  Listary 配置见 README「Listary / 外部启动器联动」。
- **fix(std-code): 标准号归一化剥年份后缀 + 问号噪声，修脏数据漏命中/重复** — 用户报多类脏标准号
  误判未入库且同号重复：`？QB/T？4566-2025`（全角问号噪声）、`GB/T 24977-2024第8.3.1.3条`（条款后缀）、
  `GB 20950-2020 附录A`（附录后缀）、`GB 26753-2011 4.2条`（无"第"条款）。根因：归一化没剥这些后缀/噪声，
  norm 不等于库内干净号 → 漏命中；且同标准不同条款各成独立行不去重。
  **修复（通用规则，非逐个正则）**：`extractFullCode` 改为匹配第一个 `-YYYY` 年份后**截断其后全部内容**
  （年份是天然终止符，后挂的条款/附录/章节都是引用修饰），一举覆盖所有"年份后缀"脏形态；`preNormalize`
  加剥全角/半角问号 `？?`。同标准多条款现归一为同号、参与去重聚合。
  **DB 迁移**：新增版本 gated `renormalizeOnAlgoBump`（`STD_CODE_ALGO_VERSION`），启动时对 cnas/cma 资质 +
  cma_capability_lib 三表已有行全量重算 norm/base（幂等）。加 2 条单测（39 全过）。
- **feat(qual): 资质查询加「按标准查」tab** — 关键词查本地缓存 CNAS/CMA 资质，**按标准号聚合**返回：
  产品标准（同一 std_code 下挂多个检测对象/参数）折叠一行、点击展开看该标准下全部资质行；方法标准
  （基本 1 对 1 单参数）直接显示参数。产品/方法靠组内「检测对象×参数」去重组合数 >1 自动判定（数据无显式标记）。
  搜索字段：标准号/标准名/检测对象/参数/类别（不含机构名）。后端新增 `searchByStandard` +
  `GET /api/qualifications/search-by-standard`（按标准聚合 + 分组级 limit，避免旧 `search` 行级 LIMIT 50
  截断产品标准）。前端复用 qual tab 切换 + `escapeHtml`/`cleanStdNameForQual`，懒渲染展开。CSS 双文件镜像全 token 化。
  **机构弱化**：实际常态只有一家机构（CNAS/CMA 同属一家），故折叠头「· M 家」与展开表「机构」列在
  `labCount<=1` 时自动隐藏（>1 才显，向后兼容多机构）。
- **fix(cma-diff): 导出文件名加时分，避免同名冲突** — 原文件名只到日期 `…-{YYYYMMDD}.xlsx`，
  同一天多次导出同机构文件名完全相同，下载到同目录时第二次会覆盖/加(1)失败。改为带时分
  `…-{YYYYMMDDHHmm}.xlsx`（如 `CMA一单一库比对-湖北省产品质量监督检验研究院-202606012326.xlsx`）。
- **refactor(cma-diff): 删除「汇总」卡** — 该卡（订阅机构 × 5 档统计）实用价值低、与机构维度比对信息重复，整块移除：
  前端 `renderSummary` + `#capLibSummaryCard` HTML、后端 `GET /api/cma-diff/summary` 路由 + `summary()` 方法 +
  `DiffSummary` 接口、专用 CSS（`cap-lib-summary-head`/`stat-grid`/`stat-tile`/`stat-num`/`stat-lab`/`warn`，双文件镜像）全清。
  cma-diff 端点 19→18。`STATUS_ORDER` 常量保留（机构列表徽章点仍用）。
- **fix(ui): 搜索历史下拉被标准前缀标签行压住** — `.search-history` z-index 350 < `.search-templates`（GB/T/ISO 那行）的 360，历史下拉弹出时被模板行盖住一截。改 `.search-history` z-index 350 → 380（> 360）盖过模板行。`.search-row` 仅 position:relative + box-shadow、未建 stacking context，子元素层级可正常比较。双文件镜像 `web/src/styles/components/search-history.css` + `public/styles.css`
- **feat(cma-diff): 机构维度比对每页数量可选** — 状态档表格黑名单条上加「每页 N 条」选择器，
  可选 50/100/200/300/500/1000，**默认 100**（原写死 50），记 localStorage `capLib.pageSize`；
  改值把本机构所有已展开的状态档表从第 1 页重渲。纯前端（`getPageSize`/`setPageSize`/`capLibSetPageSize`）。
- **feat(cma-diff): 机构维度比对行多选加表头全选** — 每个状态档表格表头加全选复选框，一键勾中/取消
  本页（筛选/分档后的当前页可见）所有行，配合「勾选项加入黑名单」批量操作；行勾选变动时表头框
  回写全选/半选/不选状态。纯前端（`capLibToggleCheckAll`/`capLibSyncCheckAll`）。
- **fix(cma-diff): 汇总卡空态引导（解释「为什么全 0」）** — 汇总统计的是「已同步的 CMA 机构持有资质 × 国家库」的比对分布，不是国家库总行数。此前无机构数据时只冷显一排 0，易误解。
  现区分两种 0：① `labCount=0`（未同步任何 CMA 机构）→ 提示去「资质查询」页订阅同步目标机构；
  ② 有机构有资质但「在库类」档全 0（国家库未同步/未拉全，全判未入库）→ 提示去「领域订阅与同步」勾选并同步。纯前端 `renderSummary` 改动。
- **feat(cma-diff): 标准号诊断（误判自查）** — 未入库/在库行加「诊断」按钮 + 顶部「诊断标准号」入口。
  `GET /api/cma-diff/diagnose?stdCode=` 本地查询秒回：显示该号的归一化值（清洗/保年/剥年）、本地库
  保年命中 + 剥年(新年版)命中明细（领域/状态/remark/见于时间）、黑名单与手动映射是否生效、各订阅领域
  同步状态（本地/远端行数，标「从未同步」「本地少于远端」），并给判定结论。
  **Why**：排查「显示未入库但网页有」（多半是该领域 4w+ 行曾超时未拉全）/「显示在库但网页查不到」
  （多半是网页搜法不同，归一化已正确处理空格）等困惑，不用每次抓远端对比。纯本地、不打远端。
- **feat(cma-diff): 机构维度对比增加机构内搜索** — 展开机构后顶部加搜索框，按
  标准号 / 标准名 / 检测项目跨 5 档过滤该机构缓存行（防抖 200ms），命中档全展开 + 显示过滤后计数，
  无命中显提示；清空恢复默认（只展开最严重档）。搜索态下翻页/展开懒渲染取过滤后的集合
  （`renderStatusGroups` 把当前展示分组挂到 `.cap-lib-lab-groups` 容器，`viewGroupsFor` 优先取它，
  否则回退全量 `_capLibGroups`）。纯前端，复用现有分组/分页渲染。
- **fix(cma-diff): 同步改分页拉取 + 实时进度（修「产品质量检验」拉取卡 0%）** —
  - **根因**：远端「产品质量检验」领域已从 README 记录的 41s **劣化到一次拉 41k 行需 5-7 分钟**
    （实测 curl 400s 截断仍未拿全，远端按 ~277 行/秒线性传输），超过后端 180s 超时 → 拉取失败；
    且 `fetching` 阶段 `total=0`，前端 `pct=0` → **死显「拉取中 0%」长达数分钟** → 用户误判假死。
  - **修复**：`runSync` 远端拉取从「一次 `pageSize=60000` 拉全」改为 **`pageSize=2000` 逐页拉**
    （`pageNum` 递增到拉满 `total` 或末页，`REMOTE_MAX_PAGES=100` 防死循环）。单页 ~36s 远低于
    新单页超时 90s；每页 `setProgress(fetching, current=已拉行数, total)` 实时报。RuoYi 分页实测有效。
  - **进度文案**：前端新增 `progressText`，fetching 显示「拉取中 X/total (pct%)」，首页未拿到
    total 时显「拉取中…（数据较大，首页约需半分钟）」，不再死显 0%；upserting 同样显行数进度。
  - 文件：`src/services/cap-lib-service.ts`（分页循环 + 常量 `REMOTE_PAGE_SIZE=2000`/`REMOTE_TIMEOUT_MS=90s`/`REMOTE_MAX_PAGES`）/
    `public/js/app-cma-diff.js`（`progressText` + 两处轮询渲染）。文档同步 README / ARCHITECTURE / CLAUDE.md 同步契约。
- **fix(cma-diff): 修「全部更新」假死 + diffByLab 去重提速 + 黑名单 / 手动匹配 / 重试** —
  - **假死根因**：「全部更新」→ `/sync-all` 一次性 `startSync` 全部订阅领域，每个 `runSync`
    的入库是 **better-sqlite3 同步事务**（41k 行的产品质量检验单事务就锁主线程数秒~数十秒），
    多领域并发返回后争抢主线程 → 所有 HTTP（含进度轮询）排队 → 页面假死。
  - **修复**：① 同步走**全局串行队列**（模块级 `syncChain`，并发 1，任意时刻最多 1 个入库事务）；
    ② `runSync` 入库改**分块事务**（每 2000 行一个 `transaction`，批次间 `await setImmediate` 让出
    事件循环，进度轮询/其它请求可插入）；③ 前端「全部更新」用计数器**收敛重渲**（旧版每领域 done
    各调一次 `loadCapLibPage` = 重渲风暴，改最后一个完成才刷一次）。
  - **diffByLab 去重提速**：旧实现对机构**每条**资质行跑 6 个相关子查询且不去重。改为先按
    `std_code_norm` **去重**（同号多检测项目聚合到 `testItems[]` 一行）→ 对去重集合用
    `std_code_norm IN` + `std_code_base IN` 两句批量查库（复用 `batchStatus` 的 `exactMap`/
    `seriesMap`/`priority` 写法）。`summary` / `labsCounts` / 详情 / 导出全部受益。UI 同号合并一行、
    导出 testItem 列 `、` 连接。
  - **标准号黑名单**（新表 `cma_diff_blacklist`）：屏蔽表格合并产生的非标准号脏行，按 `std_code_norm`
    命中（norm 空回退原始 `std_code` 精确）—— **既不显示也不参与匹配**。机构对比表每行多选 +
    「勾选项加入黑名单」；顶部「黑名单管理」卡多选移除。`GET/POST/DELETE /api/cma-diff/blacklist`。
  - **手动映射 + 重试**（新表 `cma_diff_manual_map`）：未入库行「指定」库内标准号 →
    写 `src_norm → lib_norm` 映射（机构级优先全局）覆盖自动判定；「重试」单标准号局部重匹配
    （`POST /api/cma-diff/rematch` 返回最新行）；机构头「重新对比」清缓存整机构重拉。
    `GET/POST/DELETE /api/cma-diff/manual-map`。
  - 文件：`src/services/cap-lib-service.ts`（队列 + 分块 + diffByLab 去重 + 黑名单/映射/rematch）/
    `src/api/cap-lib-routes.ts`（5 个新端点）/ `src/services/db.ts`（两张新表）/
    `public/js/app-cma-diff.js`（收敛重渲 + 行多选/操作 + 黑名单面板）/ `public/index.html`
    （黑名单卡 + 入口）/ `public/styles.css` + `web/src/styles/pages/cap-lib.css`（行操作/黑名单样式，
    双文件镜像全 token 化）。
- **refactor(cma-diff): 领域卡折叠+批量同步 / 机构 5 档分类折叠分页 / 三级导出** —
  - **领域订阅卡整卡折叠**（默认收起）：标题栏点击折叠，收起态显示摘要「已订阅 N 个领域 · 最近同步 {最新一次}」，折叠态记 `localStorage('capLib.domCollapsed')`；展开后两列 grid 布局（窄屏 ≤900px 塌回单列），长领域名 `ellipsis + title` 兜底、进度条改弹性宽 `flex:1;max-width:90px`，高度砍半把空间还给下方机构对比
  - **批量同步**（admin）：领域卡内加「更新勾选 / 全部更新」。更新勾选 = **串行**同步勾中领域（逐个 await 完成再发下一个，避免 N 个 `pageSize=60000` 长请求并发轰上游）；全部更新 = 复用现有 `capLibSyncAll`（sync-all 端点）
  - **机构维度 5 档分类折叠 + 分页**：机构展开不再是一张几百行大表，按 `not_in_lib → series_only → abolished → cite_only → in_lib`（单一 `GROUP_ORDER` 常量，worst→best）二级折叠，每档 50 条/页分页（≤50 不出翻页器）；进机构自动展开第一个非空的最严重档，其余档懒渲染；翻页/收起只重渲表，收起机构清 `_capLibGroups` 引用让 GC 回收。删旧的状态筛选 chip（`capLibApplyFilter`）—— 折叠本身即筛选
  - **三级导出**：状态档头「导出」(单机构单档) / 机构头「导出此机构」(单机构整表) / 顶部「导出全部机构」(全订阅合并表)，三处统一 `POST /api/cma-diff/export`（body `{certNumbers:[], statuses?, keyword?}`，空 certNumbers=全部）。档头/机构头是折叠触发区，导出按钮 `onclick` 必须 `event.stopPropagation()`。后端 `CapLibService.exportDiff()` 摊平 + 按最差状态在前排序（同状态 labName+stdCode），路由生成 Excel：状态列 emoji 前缀（⛔🔴🟠⚠✅，零依赖不走 cellStyles）+ 首行 AutoFilter + 列宽自适应（中文按 2 宽估算），**流式 `res.send(buffer)` 不落临时文件**；文件名 `CMA一单一库比对-{机构名|全部|N家机构}-{YYYYMMDD}.xlsx`，机构名 sanitize 非法字符
  - 文件清单：修改 `public/js/app-cma-diff.js`（折叠/分页/导出全套）/ `public/index.html`（领域卡折叠头 + 顶部导出按钮）/ `src/services/cap-lib-service.ts`（`ExportFilter`/`ExportRow`/`exportDiff`）/ `src/api/cap-lib-routes.ts`（`POST /export` + xlsx 辅助）/ `public/styles.css` + `web/src/styles/pages/cap-lib.css`（两列 grid / 折叠头 / 状态分组 / 翻页器，全 token 化主题安全）
- **feat(theme): 第四主题 `legacy` — Win7 / Chrome ≤109 完整兜底主题** —
  - **背景**：Windows 7 系统中 Chrome 官方支持上限为 109（2023-01 起停更）。现仓库
    大量使用 `oklch()`（Chrome 111+）/ `backdrop-filter blur` / Google Fonts 远端 /
    SMP 区彩色 emoji（Win7 无字形显方框）等特性 —— 即便 oklch 已有 `xxx: #hex` 双声明
    fallback，单 Win7 渲染层 frosted glass 仍会卡顿撕裂。新增专用主题彻底兜底
  - **设计哲学**：第四主题而非全局降级 —— dark/light/paper 是给现代浏览器用户的
    视觉资产，削平所有 backdrop-filter 等于让 99% 用户陪 1% Win7 用户吃亏。
    `:root[data-theme="legacy"]` scope 化，与三个现代主题 **完全隔离**，零侵入
  - **自动触发**：`public/index.html` + `web/index.html` `<head>` 顶部 FOUC 内联
    script UA 嗅探（`/Chrom(?:e|ium)\/(\d+)/ ≤ 109` 或 `/Windows NT (5\.|6\.[0-3])/`
    即 XP/Vista/7/8/8.1），命中即 `localStorage 'bzxz.theme'='legacy'` 持久化
  - **手动触发**：topbar 主题 picker 第 4 项 `◆ 经典`、我页 chip 行第 4 项。
    `app-theme.js` `VALID/THEME_META` 加 legacy 分支
  - **禁用清单**（写 `theme/legacy.css` 严守纪律）：
    - `oklch() / oklab() / color-mix() / color(display-p3 ...)` — Chrome 109 不支持。
      纯 hex 调色板（`--bg #1a1d24` / `--surface #252934` / `--accent #4f6df0` 等）
    - `backdrop-filter / -webkit-backdrop-filter` — Win7 DirectComposition 路径
      残缺，blur(20px+) 卡顿/撕裂/低端机黑屏。所有 frosted 表面（topbar / sidebar /
      download-center / toast / ctx-menu / modal / auth-card / qual-tooltip /
      env-warning / preview-overlay / stage-card / user-dropdown / search-history）
      统一退场，换不透明 surface
    - `mask-image` 大区域径向晕染 — Win7 旧 GPU 路径掉帧，`body::before` 直接关掉
    - Google Fonts（DM Sans / Source Serif 4 / DM Mono）— `<head>` 内联 script
      检测 `data-theme="legacy"` 跳过整段 link 注入，内网超时不阻塞。CSS 系统字体
      回退到 `Microsoft YaHei / Consolas`
    - SMP 区彩色 emoji（U+1F300+，🌙☀️📜🔍📊📥📋📑🔔📦📚🗂🛡👥👤 等）—
      Win7 无字形显示为 □ 方框。CSS `font-size: 0` 隐藏原 emoji + `::before` / `::after`
      注入 BMP 区几何符号覆盖（sidebar icon 按 `data-tab` 映射：search→◎ / labr→▤ /
      check→◑ / batch→▣ / complete→▦ / local→▩ / history→↓ / qual→◈ / cma-diff→◇ /
      logs→▥ / stats→▥ / users→⚇ / settings→⚙；topbar 主题图标→◐◎▤◆；统计→▥ /
      用户→⚐ / sidebar-user-avatar→⚐ / env-warning-icon→⚠ / me-row-icon 等同步）
    - 弹性 spring 动画（`cubic-bezier(0.34, 1.56, ...)` 回弹）— 低帧率下抖，统一
      `ease-out`；多数关键 `auth-card / modal / ctx-menu / toast / user-dropdown` `animation: none`
    - 复杂 `box-shadow` 多层叠加 / 强渐变 `linear-gradient` — `btn-primary` 改纯色 +
      浅阴影、`.qual-badge / .cap-lib-badge` `box-shadow: none`、全局 `filter: none`
  - **JS API 兼容性扫描**：仓库未用 `Array.prototype.toSorted/toReversed/toSpliced`
    （Chrome 110+）/ `Promise.withResolvers`（119+）/ `Object.groupBy`/`Map.groupBy`（117+）/
    `structuredClone`（98 OK）/ `findLast/findLastIndex`（97 OK）等危险 API。`:has()`
    仅 `toggle-switch.css` 一处（Chrome 105 起支持，109 ✅）。无需 polyfill
  - **入口侵入 7 处**：
    1. **新建** `web/src/styles/theme/legacy.css`（~530 行，完整 scoped 主题）
    2. `web/src/styles/index.css` — 末尾 `@import './theme/legacy.css'`（必须在
       `glass.css` 之后，确保最后赢）
    3. `public/styles.css` — 末尾追加同内容（迁移期双轨契约，沿用 `glass.css` 重复
       加载、cascade 等价模式）
    4. `public/index.html` — FOUC 内联 script UA 嗅探 + Google Fonts 条件 script
       加载 + topbar picker 第 4 项 + 我页 chip 第 4 项
    5. `web/index.html` — 同 ④
    6. `public/js/app-theme.js` — `VALID = [...,'legacy']`、`THEME_META.legacy =
       { icon: '◆', label: '经典' }`、`toggleTheme` 兜底分支
    7. `scripts/css-oklch-fallback.mjs` — 新增 `SKIP_FILES` 白名单跳过 `legacy.css`
       （强制纪律：legacy.css 误写 oklch 时 `oklch:check` 直接红，不掩盖）
  - **同步文档**：`CLAUDE.md` 新增「Legacy 主题契约」段（触发路径 / 禁用清单 /
    维护提示 / 入口侵入清单）+ OKLCh 段补「legacy.css 已加白名单」/ `README.md`
    顶部「近期重点」/ `web/src/styles/SECTIONS.md` 加「Legacy 主题」段

- **feat(cma-diff): 新增「CMA 一单一库」tab — 订阅机构 CMA 资质 vs 国家能力项目库比对** —
  - **数据源**：市场监管总局《检验检测机构资质认定能力项目库》[cma.caqit.org.cn](https://cma.caqit.org.cn/)。实测：`GET /cma-admin/system/standardData/list?pageNum=1&pageSize=60000&domain=<顶层领域名>` 无鉴权、无 Referer/UA 校验、单接口可一次拉 5w+ 行；远端总量 51,910 条（2026-06）、按 11 个顶层领域分布（产品质量检验占 80%）；`domainId` / 子领域名传入返回 0 行，故只接顶层名（参考 [src/shared/cap-lib-domains.ts](./src/shared/cap-lib-domains.ts) 硬编码常量）
  - **新表**：`cma_capability_lib`（`source_id PK / domain / standard_method / std_code / std_code_norm / std_code_base / remark / lib_status / raw_status / row_hash / last_seen_at / fetched_at`，4 个索引）+ `cma_capability_lib_meta`（每领域 `subscribed / last_synced_at / remote_total / local_total / last_sync_stats(JSON)`）。归一化沿用现有 `cleanStdCode + extractFullCode + extractBaseCode` 三层契约，与 `cnas_qualifications` / `cma_qualifications` 完全正交
  - **抓取策略**：按领域分桶 + 手动同步（无 cron）。`POST /api/cma-diff/sync/:name` fire-and-forget 返回 jobId、前端 1.5s 轮询 `/sync/progress/:jobId`。**hash diff**：每行算 `sha1(domain|method|stdCode|remark|libStatus|rawStatus)`，与 DB 现存 `row_hash` 相同则只 UPDATE `last_seen_at`，不动主字段（索引写入压力 ↓）；不同才 upsert。同步统计：`{added, changed, unchanged, removedSoft, durationMs}` 落 meta.last_sync_stats
  - **soft delete 防误删**：远端某次没返回的本地行不立删，标 `last_seen_at` 不更新；UI 上加灰色标签。admin 在比对页点「清理 30 天未见」走 `POST /api/cma-diff/cleanup`（默认 30 天阈值）真删 + 重算 meta.local_total。**为什么**：远端 41s 请求可能中途超时返回 4w 行（少 1k）、或 RuoYi 分页抽风局部丢数据 —— 若硬删会让订阅机构资质徽章瞬间全变 ⛔，30 天窗口足够覆盖所有"临时丢失"再决策
  - **5 档比对状态**：`parseLibStatus(remark)` 解析远端 remark 为 `active / cite_only / abolished`（`'废止…仅限…'` → cite_only；`'废止 / 作废 / 被X替代'` → abolished），`diffByLab(certNumber)` 用 `std_code_norm` 等值（保年命中）+ `std_code_base` 等值（剥年兜底，只看 active 最新年版）双子查询算出 `in_lib / cite_only / abolished / series_only / not_in_lib`
  - **共享徽章 `app-cap-lib-badge.js`**：搜索结果卡（`app-search.js` `.card-number-row` 注入）+ 资质查询页（`app-qual.js` `.qual-std-code` 后注入）+ 比对页三处共用；4 档简洁字符徽章 + tooltip 详情；`window.__capLibStatusCache` 缓存、同步完成后 `window.capLibInvalidateCache()` 失效一次。`POST /api/cma-diff/batch-status` 端点权限 OR `cma-diff / qual / search` 三 tab 任一
  - **路由 8 个**：`/api/cma-diff/{domains, domains/:name/subscribe, sync/:name, sync-all, sync/progress/:jobId, summary, labs, labs/:certNumber, batch-status, cleanup}`，全 `requireTab('cma-diff')` per-route guard（router 挂在根上、无 mount path，走 `cnas-routes.ts` 同款 per-route 模式避免 `router.use()` 命中全站）；写操作再叠 `requireAdmin`
  - **新 tab `cma-diff`**：sidebar 紧跟「资质查询」之下、`logs` 之上；按 [`CLAUDE.md` tab 契约](./CLAUDE.md) 同步 4 处（`ALL_TABS` + 三处 `z.enum`）+ 前端 3 处（`TAB_LABELS` + `TAB_ITEMS` + `KNOWN_TABS`）。文件清单：新增 `src/shared/cap-lib-{domains,status}.ts` / `src/services/cap-lib-service.ts` / `src/api/cap-lib-routes.ts` / `public/js/app-{cap-lib-badge,cma-diff}.js` / `web/src/styles/pages/cap-lib.css`；修改 `src/services/db.ts` / `src/api/{app,admin-routes}.ts` / `public/index.html` / `public/js/app-{auth-admin,core,search,qual}.js` / `public/styles.css` / `web/src/styles/index.css`

- **feat(auth): 功能权限服务端强制 `requireTab` + 权限名单补齐 check/logs + 用户明细配色** —
  - **`requireTab(...tabKeys)` 中间件**（`src/api/auth-middleware.ts`）：仿 `requireAdmin`，内部先跑 `requireAuth`（拿 `req.user` / 处理 guest / 续期），再校验 tab。admin 永远放行；`allowed_tabs===null`=全部允许；否则 user 的 `allowed_tabs` 与传入 `tabKeys` 有交集才放行（OR 语义），都不满足 → 403「没有访问该功能的权限」。导出 `RequireTab` 类型供路由工厂注入
  - **落地路由**：`stats`（`router.use(requireTab('stats'))`，该 router 有 mount path `/api/stats`）、`check`/`labr`/`qual`（这三个 `app.use(router)` 挂根上**无 mount path**，用 `router.use()` 会命中全站每个请求，故改 **per-route guard**：`const requireCheck = requireTab('check')` 逐路由替换原 `requireAuth`）
  - **batch-query 例外**：`POST /api/qualifications/batch-query` 既服务资质查询页、也给标准检索结果点资质徽章，放行 `requireTab('qual','search')`，否则只开搜索权限的用户徽章全灭
  - **修复的洞**：`allowed_tabs` 此前只在前端 `switchTab` 隐藏入口（纯装饰），任何人手敲 `/api/check/...` 等仍可越权访问；现服务端闭环
  - **权限名单补齐 check/logs**：sidebar 早先加了「标准查新 check」「运行日志 logs」两 tab，权限名单没同步。补进 `ALL_TABS`（`admin-routes.ts`）+ 三处 zod enum（PUT /settings、POST /users、PUT /users/:id）+ 前端 `TAB_ITEMS`（`app-auth-admin.js`，11 项与 sidebar/后端对齐）
  - **用户明细统计卡片配色**：去掉死板灰底 `oklch(25% 0.01 250 / 0.5)`，改主题变量（`var(--surface-h)` 底 + `var(--border)` 边 + 顶部 3px 主题色条 + 同色数字），dark/light/paper 三主题自适应；顺带修 `typeColors` 失效的 `var(--warn)` → `var(--warning)`
- **feat(update): 软件更新增加 GitHub 下载加速代理（设置→软件更新）** — 国内网络直连 GitHub Releases 慢，新增可编辑的加速代理列表（默认 3 条：`https://gh-proxy.org`[默认生效] / `https://v4.gh-proxy.org` / `https://cdn.gh-proxy.org`[备用]），保存即生效。
  - `electron/main.ts`：`DesktopSettings.githubProxies` + `DEFAULT_GITHUB_PROXIES`；`activeGithubProxy()`（取第一条 https 代理）+ `applyGithubProxy(url)`（仅对 `TRUSTED_UPDATE_HOSTS` 命中的 GitHub 资产 URL 套 `<proxy>/<原url>` 前缀，其它原样）；`assertTrustedUpdateHost` 放行代理域；`downloadAndInstallUpdate` 在校验后改用 `applyGithubProxy(asset.url)` 再 fetch（仅作用于"下载并安装"内置路径，"打开下载页"仍跳浏览器原页）。IPC `bzxz:get-github-proxies`/`set-github-proxies`（trim+去尾斜杠+仅留 http(s)+最多 10 条）
  - `electron/preload.ts`：暴露 `getGithubProxies`/`setGithubProxies`
  - `public/js/app-settings.js`：更新卡片底部加「GitHub 下载加速」编辑区（3 条输入框，默认/备用 chip 标识），保存调 `setGithubProxies` + toast「保存即生效」；进设置时 `loadGithubProxies` 回填。legacy JS 两入口共用、无需镜像
- **feat(check): 收藏整合进查新 + 已废止徽章按有无替代区分** —
  - **收藏即关注更新**：用户收藏标准 → 自动进入内置「我的收藏」查新清单（`check_watchlists.is_saved=1`，每用户一条、置顶、不可删）。`toggleSaved` 加入时查一次 BZ 存基线、再点取消。`POST /api/check/saved/toggle` + `GET /api/check/saved/codes`。`toggleSavedStandard` 在更新本地收藏态后 fire-and-forget 调后端（本地 star 仍即时、不卡 UI）
  - **下载历史去掉「收藏标准」区块**：收藏已并入查新，历史页只剩下载历史（`renderSavedLibrary` 元素缺失时早返回、安全）
  - **徽章修正**：已废止/即将废止等非现行状态，**有 insteadStd（被代替）或新版本** → 标"…·有新版本"，无任何替代才"…·无变动"（之前一律"无变动"，已废止且被 3324-2024 代替也误标无变动）
  - 决策：内置收藏清单(A)、收藏即查一次、手机端保持隐藏收藏入口、无历史数据迁移
- **feat(check): 查新结果勾选导出 Excel** — 结果区加勾选导出条：分类快选（全部/有变动/需关注/现行·无变动/清空）+ 每条复选框（卡片勾选框 stopPropagation 不触发展开），导出按钮带选中计数。后端新增 `POST /api/check/watchlists/:id/export`（body.ids 选中子集，空=全部），按 id 过滤 getItems → 生成 .xlsx（列：标准号/名称/当前状态/变动类型/新版本/被代替/实施日期/废止日期）写 `data/exports/` 返回 downloadUrl，前端触发下载。复用补全页同款 XLSX 懒加载 + exports 目录。`createCheckRoutes` 加 `baseDir` 参数；`CHANGE_FLAG_LABELS` 提为导出复用
- **fix(check): 修「被代替」方向反了 — 用 detail-dm 的 insteadStd（被谁取代）** — 实测发现 `3324-2017` 显示"被 3324-2008 代替"（2008 是更老的前身，方向反了）。根因：BZ 的 `replacedStd` 是"本标准代替的旧标准（前身）"，真正"被谁取代"是 `insteadStd`，且 `insteadStd` 只在 `detail-dm` 接口有（list/detail 没有）。修：
  - check-service 对**非现行状态**标准补查 `detail-dm`（`pooledFetch`，现行有效不补、省请求），取 `insteadStd`（被谁代替）+ `replacedStd`（前身）+ `endData`（废止日期）+ 中文 status（更准）
  - `check_items` 加列 `instead_std`/`abolish_date`（建表 + 幂等迁移）；diff 的「被代替」改比 `insteadStd`（前身 replacedStd 是历史事实、不参与 diff）
  - 前端"需关注"/"有变动"卡：被代替=`本标准已被 X 代替`（insteadStd）、代替前身=`本标准代替了 X`（replacedStd，灰）、加废止日期；insteadStd 空且已废止时显示"BZ 暂未登记代替标准"
  - 新增 `docs/BZ-API.md` 沉淀实测字段（list/detail/detail-dm 字段表 + replacedStd vs insteadStd 方向、状态码 vs 中文差异）
- **fix(check): 已废止等非现行状态单列「需关注」组、可展开看替换信息** — 旧归类只看有无变动，已废止但无变动的标准被埋进绿色「无变动」折叠组、看不到废止态也点不开替换信息。新增「需关注」组：本次无变动但状态非「现行有效」（已废止/即将废止/即将实施/部分有效）的单列出来、每条可展开看 当前状态 / 实施日期 / 被代替（`本标准已被 X 代替`，空则注明 BZ 未提供）/ 新版本；已废止=红、其它非现行=橙；真·现行有效才折叠进「现行·无变动」绿组。概览卡改「需关注/现行·无变动」。纯前端 `app-check.js`
- **fix(check): 查新改 BZ 原文直查（修纯数字号全部"无法核验"）+ 强制年代号** — 实测发现 `3324-2017`/`3325` 等纯数字标准号全部落到"无法核验"。根因：查新复用的 `StandardResolver` 正则要求 `[A-Z]{2,4}` 字母前缀，纯数字号被判"无法识别"、压根没查 BZ。改法（方案 B）：
  - `check-service` 不再走 StandardResolver，改用 `StandardService(bz)` **原文直查 BZ search**（像标准检索那样，搜啥查啥）+ `pickBzMatch`（同基础号/数字子串匹配、带年号优先精确年版、否则取最新年版）。不动 resolver、不影响下载/补全
  - **导入强制年代号**：`hasYearCode()` 校验，无年号的行剔除并回报 `skippedNoYear`；前端预校验 + 提示"标准号必须带年代号，如 3324-2017"
  - 文案：页头/hint 从"三源"改"BZ 源"+ 年号要求；toast 增"N 项无年代号已跳过"
  - 清理：删 `StandardResolver`/`ResolvedItem` 依赖，统一用 `CheckMatch`；`source_used` 固定 'bz'
- **feat(check): 标准查新 Step 2 — 每清单自动查新（默认/下限 15 天）** —
  - `check_watchlists` 加 `auto_enabled`/`auto_interval_days`(默认 15)/`next_run_at`（建表 + 幂等迁移）
  - `check-service`：`setAuto(id, enabled, days)`（周期硬下限 15，开启时算 next_run_at）+ `runDueAutoChecks()`（找到期清单串行 recheck、跳过手动防抖、跑完重排下次时间、返回有变动清单摘要）；`getWatchlists` 带出 auto 字段
  - `check-routes`：`PUT /api/check/watchlists/:id/auto`（zod 校验 intervalDays ≥15）
  - `app.ts`：启动 30s 后补跑一次到期清单 + 每 6 小时扫一次（定时器进程存活时跑，应用关着错过的靠启动补跑兜底）；有变动的清单 `console.warn` 一条 → 被 log-buffer 截获、运行日志页可见
  - 前端：清单结果区工具条加「自动查新」开关 + "每 N 天"输入（默认 15、下限 15），开关状态从 `getWatchlists` 回填；`check.css` 双文件镜像
  - README API 表补 `PUT /:id/auto`
- **fix(check): 修构建（req.params.id 类型断言）+ 查新限流 Step 1** —
  - **修构建**：`check-routes.ts` 三处 `parseInt(req.params.id)` 报 `string|string[]`，加 `as string`（同 standards-routes 写法）
  - **限流硬上限**（用户改不了，安全第一）：单清单/单次查新最多 **200** 标准（导入超出截断 + 提示 truncated）；分批 **50/批 + 批间 sleep 2s**；全局**串行锁**（同一时刻只 1 个清单在查，其余清单导入时只登记不立即查、标 `pending`，待手动查新）；出站并发由 BZ source-semaphore(=2) 收口
  - **手动防抖**：同清单两次「重新查新」最小间隔 **20 分钟**，违反返回 429 + "请 X 分钟后再试"，前端 toast 提示；自动查新（Step 2）传 `manual=false` 跳过防抖
  - 前端：导入提示分批查询、截断提示；`pending`/`not_found` 单独分组展示
  - 自动查新（每清单可配、默认/硬下限 **15 天**）是 **Step 2**，本次未做
- **refactor(check): 标准查新改 BZ 单源 + 精确状态比对** — 按用户反馈把查新从三源收敛到 **BZ 单源**（BZ 状态元数据最全：状态码 1-9 + 发布/实施/废止日期 + replacedStd，GBW/BY 字段不全且文案不一致）。省 2/3 请求、逻辑更聚焦。`check-service.ts` 默认 sources 改 `['bz']`；diff 的状态比对从"是否废止"布尔改**精确文案比对**（现行有效→即将废止 逐级预警）；新版本检出从布尔改为**记下具体版本号**（`check_items` 加 `new_version` 列），前端展示 "GB/T 1.1-2020（据 BZ 源）"。变动卡默认收起、文案贴近预览图（被代替写"本标准已被 X 代替"）。详见 `docs/CHECK-UPDATE-AND-STATS.md` §2
- **feat(check): 标准查新 Phase 1 — 导入清单查三源 + 变动 diff（独立菜单）** — 全新功能，方案见 `docs/CHECK-UPDATE-AND-STATS.md`：
  - **地基核查**：确认 `StandardSummary` 统一契约含 `status`/`implementDate`/`abolishedDate`，BZ 另有 `meta.replacedStd`（被代替）；GBW 也填 status/implementDate。四维度有数据源支撑
  - **后端**：新增表 `check_watchlists`/`check_items`（含基线快照 + 最近查新结果 + change_flags）；`check-service.ts` 复用 `StandardResolver`（三源 + 并发限流）导入存基线 + `recheck` diff（状态按"是否废止"归一、实施日期、被代替、年版用 `extractBaseCode` 剥年比对）；`ResolvedItem` 补 `abolishedDate`/`replacedStd`；`check-routes.ts` 提供 watchlists CRUD + recheck（归属校验非本人 404），挂进 app.ts
  - **前端**：侧栏「标准查新」独立菜单（与标准检索同级）+ `#page-check` + `app-check.js`：导入并查新、重新查新、有变动高亮展开（旧→新对照）/ 无变动整组折叠 / 无法核验单列 / 概览统计。`pages/check.css` 双文件镜像，纯 token；`TAB_LABELS.check`；两个 index.html + 脚本引用同步
  - **本期范围**：导入即建清单并首查；单清单展示。清单持久化列表 / Excel 导入 / 查新进度条 / 定时自动查新是 Phase 2-3
- **feat(stats): 使用统计增强 Phase 2 — 操作明细表 + 折叠 + 结果/失败展开** — 把 Phase 1 采集的数据展示出来：
  - 后端 `GET /api/stats/activity`：返回操作明细（含 ip/hostname/client/result/error + 用户名）；`collapse=5m` 时服务端把"同用户 + 同 event_type + 间隔≤5min"的连续记录折叠成组（带 successCount/failCount/children）；querySchema 加 `result`/`client` 过滤；`/summary` 增 `failCount`
  - 前端统计页加「操作明细」区：工具条（操作类型 / 结果筛选 chip）+ 明细表。折叠组显示 `操作 ×N` + 成功/失败计数、点击展开子项；含失败的行/组左侧标红条，失败子项展开显示 error（与运行日志同源）；客户端徽章（web 蓝 / 桌面 绿 / 手机 橙）；主机名 / IP 列（桌面端有值、web/手机端显示 "—"）。summary 多一张「失败」卡（danger 色）
  - CSS 双文件镜像（`pages/stats.css` + `public/styles.css`），纯 token
  - 待办：`open` 事件埋点（启动/切页）；Phase 3 导出明细 csv / 失败率趋势
- **feat(stats): 使用统计增强 Phase 1（后端采集层）— 记录 IP/主机名/客户端/结果/失败原因** — 在现有 `usage_events` 上增量，方案见 `docs/CHECK-UPDATE-AND-STATS.md`：
  - `usage_events` 加 5 列 `ip` / `hostname` / `client` / `result` / `error`，走 `addColumnIfMissing` 幂等迁移（旧行新列 NULL，安全）
  - `usage-tracker.ts`：`trackEvent` 加第 7 参 `ctx`；新增 `extractUsageCtx(req)` —— hostname 取 `X-Client-Host` 头（仅桌面端能给）、client 取 `X-Client-Type` 头或 UA 粗判（electron→desktop / 移动 UA→mobile / 其余→web）、ip 取 `req.ip` 并剥 `::ffff:`
  - 各 trackEvent 调用点透传 ctx + result：search / batch_resolve / download(×4) / complete / qual_search 成功路径标 `result:'success'`，**catch 分支补记 `result:'fail'`+error**（关键：以前失败操作根本不进统计，这次补齐）；multi-download 全源失败记一条 fail 汇总各源原因
  - 新增 `qual_search` 事件类型（资质查询页此前未进统计）
  - **桌面端头注入**：`electron/main.ts` 用 `onBeforeSendHeaders` 给本地后端请求（localhost/127.0.0.1）注入 `X-Client-Host`(os.hostname()) + `X-Client-Type: desktop`，只对本地后端、不污染外部源站。桌面端主机名自此有真值、客户端类型准确判为 desktop
  - **待办**：`open` 事件（启动/切页埋点）；统计页 UI（明细表/折叠/结果列）是 Phase 2
- **feat(logs): 运行日志系统 Phase 3 — 详情展开 + 后端日志按天落文件** —
  - **详情展开**：多行（堆栈）或长正文的日志行可点击展开完整内容（`.log-full` 等宽 pre 块、可滚动），解决后端 error 堆栈被单行 `nowrap` 截断看不全的问题。`logExpanded` 记展开态，行点击事件委托绑定一次（前端 id 与后端 `be_n` id 统一按字符串比对）。`app-detail-utils.js` + `log-panel.css`/`public` 镜像
  - **后端按天落文件**：`log-buffer.ts` 在内存环形 buffer 之外，按天追加 `<userData>/bzxz-logs/app-YYYYMMDD.log`（tab 分隔 ts/level/module/message），保留最近 14 天、超期自动清理。全程 best-effort、任何 I/O 失败静默不影响 console/业务；目录取 `BZXZ_USER_DATA_DIR`（与 db-backup/library-paths 同约定），非 Electron（开发/测试）无该变量时不落文件、避免往 cwd 乱写
  - **导出** CSV 含来源列（Phase 2 已落）
  - **跳过 `app_logs` 入库**：按天文件已提供磁盘持久化，再建 DB 表属重复能力 + schema 迁移风险，本期不做（见 `docs/LOG-SYSTEM-REDESIGN.md` Phase 3）
- **feat(logs): 运行日志系统 Phase 2 — 汇入后端运行日志** — 把后端 `log-buffer`（拦截 console 的环形缓冲）的运行日志接入「运行日志」页，与前端操作日志统一展示：
  - **后端**：`log-buffer.ts` 的 `LogEntry` 加 `module` 字段，按消息里的 `[前缀]`/关键词（`[ocr-worker]`/`[by-adapter]`/`[gbw]`/`[resolver]`/`[cnas]`/`[library]`/`[db-backup]` 等）推断归到前端同一套模块分类；`/api/diagnostics/logs` 随之返回 module（接口签名不变，仍 requireAdmin）
  - **前端**：新增 `loadBackendLogs()`，切到日志页或点页头「刷新」时拉 `/api/diagnostics/logs?limit=500`，映射 level（error→失败、warn→警告、log→信息且标 verbose 归调试档）后与本地前端段 `getMergedLogs()` 按时间戳归并倒序。概览数字 / 模块计数 / 列表 / 导出全部基于合并集
  - **权限优雅降级**：非管理员请求 403 → 静默，只显前端日志（后端段对管理员可见，与现有权限一致）
  - **清空语义**：仅清前端本地段，后端 buffer 不归前端清（重启服务才滚动覆盖），confirm 文案已说明
  - 导出 CSV 增「来源」列（前端/后端）；页头加「刷新」按钮（两个 index.html 同步）
- **feat(logs): 运行日志系统重做 Phase 1 — 独立菜单 + 持久化 + 四维筛选** — 把原悬浮在所有页面底部的「下载日志」可折叠面板，重做成与标准检索/系统设置同级的独立「运行日志」页。方案见 `docs/LOG-SYSTEM-REDESIGN.md`，预览 `docs/log-system-prototype.html`：
  - **数据模型扩字段**：`addLog` 从 `(msg,status)` 扩为 `(msg,{module,level,detail,verbose})`，**兼容旧两参调用**（旧 status 归一到 level，module 按文本推断）；时间戳从"时:分"升到完整日期+时:分:秒。模块：搜索/下载/补全/资质同步/验证码 OCR/本地库/系统
  - **localStorage 持久化**：关客户端重启仍可查史，滚动保留最近 10000 条 / 30 天，配额超限静默不打断业务
  - **独立页 `#page-logs`**：`.set-page-head` + 左筛选栏（概览数字 + 模块/级别 chip 竖列，带计数）+ 右列表（时间/模块徽章/正文/级别色条）。四维筛选可叠加：模块 ∩ 级别 ∩ 时间(全部/今天/近7天) ∩ 关键词
  - **详细模式开关**：默认只显示业务事件，打开后连同 `verbose` 调试条目（HTTP 步骤、worker 输出等）一并显示，灰一档+等宽字
  - **侧栏入口**：「运行日志」菜单项 + 失败数角标；`switchTab('logs')` + `TAB_LABELS.logs`
  - **底部面板退役**：删 `#logPanel`（日志头/体/折叠/导出），仅保留下载实时进度 `.progress-strip`（取代原 `.progress-wrap`，`app-download.js` 进度逻辑不变）。导出改为页头按钮、清空走二次确认
  - 两个 `index.html`（侧栏 + `#page-logs` + 进度 strip）同步；CSS 重写 `layout/log-panel.css` + 镜像 `public/styles.css`
  - **遗留待清**（无害死规则，元素已不存在）：`responsive.css` 183–187 与 `glass.css` 的 `.log-panel`/`.log-header`/`.log-export-btn` 主题覆盖，待后续清理
- **fix(mobile): 修复输入框聚焦放大不还原 + 资质页多余"搜索"tab 露出** —
  - **聚焦放大**:iOS Safari 聚焦 `font-size<16px` 的输入框会自动放大页面、且无 `maximum-scale` 时不还原（退出输入后仍放大 → 又溢出）。手机端搜索 input(`.search-row input` / `.qual-search-row .qual-search-input`)字号 15px→16px；两个 `index.html` 的 viewport 补 `maximum-scale=1.0, user-scalable=no` 兜底其它小字号输入框
  - **多余"搜索"tab**:`.qual-tab-bar` 容器带内联 `display:flex`，优先级高于 `responsive.css` 的 `.qual-tab-bar{display:none}`，导致手机端隐藏失效——可视化 tab 被 class 规则藏了、只剩"搜索"孤零零露出。把容器内联移进 CSS(`qualifications.css` + `public/styles.css` 镜像)，两个 `index.html` 去内联，窄屏 `display:none` 恢复生效
- **fix(ui): 修复连续弹窗导致界面卡在高斯模糊（关联流程连开两个 showPrompt）** — `showConfirmHtml` 在 `finish()` 里 `setTimeout(200ms)` 清空 `overlay.innerHTML`，而 `.confirm-overlay` 自带 `backdrop-filter:blur(4px)`。关联流程连开两次 showPrompt 复用同一 `#confirmOverlay`，第一个的清空 timer 在第二个渲染后才触发，把第二个卡片内容清掉 → 只剩带模糊的空遮罩、界面卡死。加"代际守卫"（递增 `_gen` token，只有仍是最新一次的弹窗才收起/清空），被新弹窗接管的旧 timer 不再误清。`app-detail-utils.js`
- **fix(qual): 修复资质订阅"编辑/关联"报错 + win 客户端点击无效（两个叠加 bug）** —
  - **空 id**:`renderQualLabs` 的 `idField`/`nameField` 误写 snake_case(`lab_no`/`lab_name`),但 API 返回的是 camelCase(`labNo`/`labName`/`certNumber`,同函数 471/477/487/519 行都在用)。导致 CNAS 卡的"编辑/关联CMA"按钮 `lab[idField]` 取到 `undefined`→空 id→`PUT /api/qualifications/labs/cnas/`(尾部空)、关联 body `cnas_lab_no` 为空→后端 invalid request。改回 `labNo`/`labName`/`certNumber`。(CMA 卡另走分支、直接用 `lab.certNumber`,故幸免)
  - **win 端点击无效**:编辑/关联依赖 `window.prompt`,而 Electron 默认禁用原生 prompt（返回空 + 控制台报 "prompt() is not supported"），故 web 能用、win 点了没反应。新增 `showPrompt()`（基于 `showConfirmHtml` 的 `onMount` 钩子塞 input，返回 `Promise<string|null>`，单行 Enter 提交），替换 `editQualLabName`/`linkQualLab` 的 3 处 `prompt()`。`app-detail-utils.js`(新增)+ `app-qual.js`(替换)，两入口经 `/legacy/` 共用同一份、无需镜像
  - 报错提示灰难看由上一条 toast 主题修复一并解决
- **fix(mobile): 修复移动端默认横向溢出(右侧被挡、需双指缩小才看全)** — 两处:
  - **根因兜底**:`html` 补 `overflow-x: hidden`(原先只有 `body` 有)。移动端 iOS Safari / 部分安卓会把 `body` 的横向滚动提升到 `html`,只设 `body` 失效,表现为"默认能横拖、要双指缩小才看全局"。`base.css` + `public/styles.css` 镜像
  - **新组件防溢出**:Phase C 新增的 `.set-card-head`(`justify-content:space-between`)补 `flex-wrap:wrap` + 首子元素 `min-width:0`,避免右侧长徽章(如批量页"解析完成 · 匹配 X …")不换行把卡撑宽
- **fix(theme): toast 在亮色/纸张主题下补浮层覆盖(检查更新等弹出不再是暗灰)** — `.toast` 背景写死暗色(`rgba(17,22,29,0.9)`),而它的同类浮层(`.confirm-card`/`.download-center`/`.user-dropdown`/`.shortcuts-panel`)在 `glass.css` 都有 light/paper 覆盖、唯独漏了 toast,导致亮/纸张主题下"检查更新""已是最新版"等提示仍是难看的暗灰块。把 `.toast` 加进这两个主题的浮层覆盖选择器组(白底 + frosted + 主题描边),文字色本就走 `var(--text)` 自适应。`glass.css` light/paper 两段 + `public/styles.css` 镜像同改
- **feat(ui): 全站重设计 Phase C — 批量下载骨架 + 五页页头统一 `.set-page-head`** — 用 Phase A 组件层把"规范派"页面收口,分两步降风险:
  - **批量下载页骨架**:两张卡 `.batch-card`→`.set-card`(正文移入 `.set-card-body`),卡头 `.batch-card-head`+`.batch-kicker`+`h3`→`.set-card-head`+`.set-kicker`+`.set-card-title`,源提示 `.batch-mode-pill`→`.set-badge is-muted`。`.batch-textarea`(资质共用)/`.batch-actions`/`.progress-wrap` 保留
  - **页头统一**:批量/标准补全/本地库/下载历史/使用统计五页页头(`.page-heading` 或裸 `<h2 style>`)统一为 `.set-page-head`(h1+p,本地库"刷新"进 `.set-page-head-actions`,统计补副说明)。`.page-heading` 是共享组件、不删,纯标记替换
  - 两个 `index.html` 同步(5×`.set-page-head` 对齐,0 残留 `.page-heading`)
  - **更正方案两处**:`.batch-workspace` 实为单列 grid(非"二列"),不套 `.set-split`;`#batchSummary` 装长串+JS 注入 span,`.set-badge` 的 nowrap+描边会溢出,故 summary 保留 `.batch-summary`
  - **暂缓(各有耦合,留专项)**:`renderBatchResults` 的 `.batch-result-card`/`.batch-toolbar`(重度移动端"查阅而非管理"处理,同搜索结果卡)、补全步骤卡 `.complete-step`/选项胶囊、本地库 `.local-table`、历史 `.library-grid`——转 `.set-*` 时需同步改 `responsive.css` 对应段,随各页本体专项做。详见 `docs/PAGES-REDESIGN.md` §4.3–4.8 落地记录
- **feat(qual): 全站重设计 Phase B — 资质查询 tab 去内联(`switchQualTab` 只切 class)** — 清掉资质查询页两个 tab(搜索/可视化)的内联 style,这是 `app-qual.js` 85 处内联里最扎眼、最独立的一刀:
  - `switchQualTab` 删掉 `t.style.color` / `t.style.borderBottomColor` 两行内联赋值,只切 `.qual-tab.active`(与同文件 `switchQualSettingsTab` 同款 CSS 驱动写法)
  - `.qual-tab` 外观移入 CSS:`padding 8px 16px`/`13px`/`2px` 下边框 + `.qual-tab.active`(`var(--text)` + `var(--accent)` 下边框)沿用原内联值,视觉零变化。`web/src/styles/pages/qualifications.css` + `public/styles.css` 镜像
  - 两个 `index.html` 的 tab 按钮去掉一长串内联 style(共用同一份 app-qual.js)
  - **重新排期说明**:资质/Labr 的页头 `.set-page-head`/搜索壳 `.set-search`/筛选胶囊 `.set-chip` 改名**挪到 Phase F** —— 这些类名被移动端 search-stage 动画(`search-stage.css`/`responsive.css`/`glass.css`)按精确选择器吃住,且 `.search-row` 与标准检索(保留原版)共用,桌面单改会静默打断移动端。已在 `docs/PAGES-REDESIGN.md` §4.2/§4.7 记录
- **feat(ui): 全站重设计 Phase A — `.set-*` 统一组件层外扩(纯样式、零引用)** — 续设置页重构,把已验证的 `.set-*` 体系外扩到其余 8 页(标准检索/Labr/批量/补全/本地库/历史/资质/统计/用户)用,是后续各页改造的地基。方案见 `docs/PAGES-REDESIGN.md` §三;可点击原型 `docs/pages-redesign-prototype.html` + `docs/mobile-redesign-prototype.html`:
  - 在 `web/src/styles/pages/settings.css` 末尾追加「全站统一组件层」,新增成员:`.set-page-head`(kicker+h1+p+右操作位,取代 `.page-heading` 与所有裸 `<h2 style>`)/`.set-card-head`+`.set-card-title`/`.set-toolbar`(`-left/-right`,取代 `.toolbar`/`.local-toolbar`/`.stats-controls`)/`.set-table`(sticky thead+hover+`.col-check/.col-actions/.col-num`,取代 `.local-table`/`.users-table`)/`.set-search`(`.thin` 薄变体,统一三处搜索壳覆写)/`.set-chips`+`button.set-chip` 交互筛选态(取代 `.qual-filter-btn`/`.source-tag`)/`.set-stats`+`.set-stat`(语义色,取代 `.stat-card`)/`.set-empty`/`.set-stepper`+`.set-step`(态:active/done/error)/`.set-badge`(语义色变体)/`.set-split`(`-wide`,取代各页二列 grid)/`.set-switch-danger`(高危开关红色态)/`.set-scroll-pane`(收口 `100vh - topbar - 140px` 魔数)/`.set-pager`/`.set-modal`(`-backdrop/-head/-body/-foot`,`.is-danger`)
  - **纯新增、暂无 HTML 引用(CI 必绿)**;Phase B–E 各页逐步接上
  - 同段**镜像追加**到 `public/styles.css` 末尾(维持迁移期双入口 cascade 等价);登记 `SECTIONS.md`
  - **主题纪律**延续:只用 `var(--*)` token、无裸 oklch、无 `color-mix`;唯一例外 `.set-modal` 阴影沿用 `components/modal.css` 的 rgba 字面量(`--shadow-lg` 仅 light/paper 定义、dark `:root` 无)
- **fix(settings): 修复深色主题下设置左导航未选中项露出浅灰原生按钮底色** — `.set-nav-item` 是 `<button>`,基础规则漏设 `background`,深色主题下浏览器原生 buttonface(浅灰)直接露出,只有 `.active`(设了 `var(--surface)`)正常。补 `background: transparent` + `text-align: left` + `font-family: inherit`(顺带 reset 原生按钮居中/系统字体)。`web/src/styles/pages/settings.css` + `public/styles.css` 镜像。
- **fix(theme): 移除 `html` 的 ambient 径向晕染 —— 三主题统一纯色平铺** — 用户反馈内容顶部一坨"左深右浅的灰渐变,丑死了"。经 DevTools `elementsFromPoint` 确诊是 `html` 背景的三层 ambient 径向晕染(左上角 `80% 60% at 12% -8%` 那层 + `background-attachment: fixed`)在内容顶部糊出的色块,跟页面无关(search/settings 都有)、跟新做的扁平 `.set-*` 设计冲突:
  - 暗色(默认)`html` 去掉三层 radial,改纯 `var(--bg)`;亮色 `:root[data-theme="light"] html` 覆盖直接删除(base 平铺已随 token 自适应);纸张主题本就平铺,不动
  - 两文件镜像:`web/src/styles/theme/glass.css`(默认段 + 删亮色覆盖)+ `public/styles.css`(同步)
  - `body::before` 蓝图网格(0.018 极淡 1px 线,非渐变)保留不动
- **feat(settings): 设置面板重设计 Phase C — `renderSettings` 整体重排为 `.set-layout` 左导航 + 右内容 IA** — 在 `public/js/app-settings.js` 内就地重写渲染(不动 TS 模块树、零构建风险、可回退),把"一页两套渲染 + 6 种卡片方言 + 三种标题写法"收敛成统一 `.set-*` 元件:
  - 四张卡片渲染函数(`renderUpdateCard` / `renderWebAccessCard` / `renderPortSettingCard` / `renderStartupSettingCard`)从 `.settings-card`/`.desktop-setting-card`/`.web-access-card`/`.port-setting-card` 等方言统一为 `.set-card` + `.set-row`(`.set-row-main`/`.set-row-control`),状态徽章 `.desktop-setting-status`→`.set-status`(is-ok/is-down/is-idle),版本号用 `.set-versions`,下载进度用 `.set-progress`;保留全部 `onclick`/`id`/state 钩子(`portSettingInput`/`.port-setting-row`/`.port-setting-status` 不动)
  - `renderSettings` 主模板由 `.settings-grid` + 散落 `.setting-section` 重排为左侧 `#settingsNav`(`.set-nav`,admin 多"公告管理/标准库"两项,点击 `settingsNavTo` 平滑滚动 + 高亮)+ 右侧 `#settingsBody` 分区:下载与源 / 访问方式 / 软件更新 / 资质订阅 / (admin)公告 / (admin)标准库
  - 并发/超时/搜索记录从 `.btn` 组换 `.set-seg`/`.set-seg-item`;源优先级行换 `.set-row.draggable`(`.set-drag-handle`+`.set-order`+`.set-chip`),`initDragSort`/`getDragAfter` 选择器同步 `.setting-row`→`.set-row`
  - 公告管理卡 `renderAnnouncementAdminCard` 去掉自带 `.setting-section`,改 `.set-head-row` + `.set-card`(外层 section 由主模板提供)
  - 两个入口 `web/index.html` + `public/index.html` 的 `#page-settings` 包裹为 `.set-layout > nav#settingsNav + .set-content(#settingsBody + 资质订阅块)`,资质块加 `id=set-sec-qual`、`.setting-section`→`.set-section`,折进同一两栏布局
  - 新增辅助类 `.set-head-row`/`.set-actions`/`.set-subsection`/`.set-versions`(`web/src/styles/pages/settings.css` + 镜像 `public/styles.css`),延续纯 token 纪律(无裸 oklch / 无 color-mix)
  - 旧卡片 class(`.settings-card`/`.settings-grid`/`.desktop-setting-*`/`.web-access-*` 等)的 CSS 规则暂留 styles.css(已无引用、无害),待 legacy 入口废弃时再清
- **feat(settings): 设置面板重设计 Phase B — 资质订阅区块接入 `.set-*`(去内联 style)** — 把"系统设置"页里静态手写的资质订阅区块从满屏内联 `style` 切到 Phase A 元件,这是消除拼凑感最扎眼、风险最低的一刀:
  - 区块标题 `.field-label`(内联 flex + 副标题 span)→ `.set-section-head`(`h2` + `p`)
  - 子 Tab `.qual-settings-tabs` / `.qual-settings-tab`(每个按钮一长串内联 padding/color/border-bottom)→ 叠加 `.set-tabs` / `.set-tab`,外观全交给 CSS,保留 `qual-settings-tab` / `data-qual-settings-tab` / `onclick` 钩子不动
  - `public/js/app-qual.js` `switchQualSettingsTab` 删掉 `t.style.color` / `t.style.borderBottomColor` 两行内联赋值,只切 `.active` class —— 选中态由 `.set-tab.active` 接管(原内联值本就等于该设计:`var(--text)` / `var(--accent)`)
  - 同步改 legacy `public/index.html` 同段(共用同一份 app-qual.js,不改它选中态会失效)
  - 未引入任何新 CSS(复用 Phase A 已镜像的 `.set-section-head` / `.set-tabs` / `.set-tab`),故 `public/styles.css` 无需追加;`.qual-settings-tab(s)` 旧 class 现仅作 JS 钩子、无对应 CSS 规则
- **feat(settings): 设置面板重设计 Phase A — 统一组件系统 `.set-*`（纯样式）** — 设置页原先"拼凑感"根因是结构而非配色:一页两套渲染(innerHTML 整刷 + 手写静态 HTML)、满屏内联 style、6 种卡片方言、两套 Tab、三种标题写法。本期落地统一元件系统打底,暂无 HTML 引用(CI 必绿):
  - 新增 `web/src/styles/pages/settings.css`:`.set-layout`(左导航+右内容两栏)/ `.set-nav`/ `.set-section`/ `.set-card`(唯一卡片)/ `.set-row`(设置原子,含 `.draggable` 拖拽变体)/ `.set-seg`(分段选择器,取代大卡选择+胶囊按钮)/ `.set-status`/ `.set-field`/ `.set-tabs`(统一子 Tab)/ `.set-chip`/ `.set-progress`/ `.set-inline-add`;开关复用 `.toggle-switch`、按钮复用 `.btn`
  - **主题纪律**:全文件只用 `var(--*)` token,无裸 oklch、无 color-mix,三主题自动适配 —— 故**无需** glass.css 的 light/paper override,也无需 oklch fallback
  - 接入 `index.css`(pages 段)+ 镜像追加到 `public/styles.css` 末尾(迁移期两份并存契约)+ 登记 `SECTIONS.md`
  - 设计方案与可点击原型:`docs/SETTINGS-REDESIGN.md` / `docs/settings-redesign-prototype.html`
- **fix(theme): light/paper Phase 5 补丁 — 残余组件级深色面板** — 收尾排查后补齐 Phase 4 未覆盖的散落硬编码暗 surface,light + paper 各 9 条:
  - **骨架屏**:`.skeleton-card` 背景 + 边框、`.skeleton-line` shimmer 中段高光色(原 `oklch(28% ...)` 在亮底上是深灰扫光)
  - **预览头**:`.preview-head`(`oklch(17% ...)` 深条)
  - **下载中心**:`.download-task` 任务卡背景 + 边框、`.download-center-head` / `.download-center-summary` 边线
  - **日志面板**:`.log-export-btn` 导出按钮背景 + 边框 + 字色
  - **移动端**:`body:not(.force-desktop) .filter-collapse` 筛选折叠条背景
  - **用户管理表**:`.users-table th/td` 暗边线改 `var(--border-strong)` / `var(--border)`
  - 文件:`web/src/styles/theme/glass.css` + `public/styles.css` Phase 5 段镜像,所有 oklch 配 rgba/hex fallback
- **fix(theme): light/paper Phase 4 补丁 — 整页级深色面板(使用统计 / 本地文件库 / 资质订阅·可视化 / 下载历史)** — 用户截图反馈 Phase 2/3 后仍有整页渲染成深灰:前几轮只审了 `glass.css` / `public/styles.css` 自身,漏掉 `pages/*.css` 里的硬编码暗 surface。补这几页 light + paper 覆盖:
  - **使用统计**:`.stat-card` / `.stat-card:hover` / `.stats-chart-box`(原 `oklch(16% ...)` 4 张卡 + 趋势/分布两图)
  - **本地文件库表格**:`.local-table-wrap` / `.local-table thead th`(吸顶表头)/ `tbody td` 边线 / `tbody tr:hover td` / `.normalize-list`
  - **资质订阅 / 资质查询 / 可视化**:`.qual-result-item` / `.qual-lab-card`(含 `.is-working`)/ `.qual-preset-item` / `.library-card` / `.qual-visual-card` / `.qual-visual-result` / `.qual-visual-lab-card` / `.qual-visual-query-head` / `.qual-visual-stats div` / `.qual-visual-standard` / `.qual-visual-bars·labs·lab-head·cap-chips span` / `.qual-visual-source.empty` / cap·more-btn hover
  - **下载历史页**:`收藏标准` + `下载历史` 容器复用 `.library-card`(同一选择器一并覆盖),行 `.library-row` 已在 Phase 3 覆盖
  - 文件:`web/src/styles/theme/glass.css` + `public/styles.css` Phase 4 段镜像,所有 oklch 配 rgba/hex fallback
- **fix(theme): light/paper Phase 3 补丁 — 详情卡 / 设置卡 / 标准库设置 / preview / normalize 容器** — 全量审计 hardcode 暗色未被 light/paper override 的选择器,补 24 个新规则 × 2 主题(共 48 条):
  - **预览容器**:`.preview-body` / `.preview-iframe` 原 `#1a1a1a` 在亮主题下是醒目黑框,light 改极淡蓝灰 `oklch(94% 0.008 245)`,paper 改米色 `oklch(91% 0.018 75)`
  - **标准库设置**:`.library-row` 边线、`.library-row code.library-row-value`、`.library-input` 暗背景
  - **多源 picker**:`.preview-source-year` / `.preview-source-ext` 内嵌小标签,含 `.active` 状态下 accent 色嵌入
  - **详情/Modal 内部**:`.detail-info-card` / `.modal-source-panel` / `.modal-source-default` / `.modal-source-stats span` / `.modal-source-row`
  - **设置页**:`.settings-card` / `.setting-choice`(含 `.active`)/ `.source-priority-list` / `.source-priority-row:hover` / `.source-status-list` / `.web-access-url-row` / `.web-access-phone-tip` / `.version-row span` / `.update-asset` / `.download-center-empty`
  - **批量补全归一化预览**:`.normalize-group` / `.normalize-row` / `.normalize-row-mini` / `.normalize-group.neutral`
  - **杂项**:`.batch-result-card .card-src` / `.complete-step > span`(步骤数字圆圈) / `.rename-preview-skip`
  - 文件:`web/src/styles/theme/glass.css` + `public/styles.css` Phase 3 段镜像,所有 oklch 配 rgba/hex fallback
- **fix(theme/light): 主背景 ambient gradient 调淡 + Labr 库检索 light/paper 覆盖** — 用户反馈 light 主题主界面"非常难看",太花。诊断:`:root[data-theme="light"] html` 的三层 radial-gradient 用了 0.40/0.30/0.25 透明度,薰衣草+天蓝+青蓝叠在一起像彩色糊布。同时 labr-row 用了 hardcoded `rgba(255,255,255,0.02)`,亮主题下隐身。
  - **light ambient 调淡**:三层 radial 从 40%/30%/25% → 18%/14%/12%,保留蓝调氛围、去掉"花花绿绿"
  - **labr light 覆盖 16 条**:.labr-row(白底 + border 取 var(--border)) / :hover(蓝调 highlight) / .labr-results-header / 三类 meta 文字色 / .labr-std-code 蓝徽章 / kind-0/1 / 5 类 ext 徽章(pdf/doc/xls/ppt/txt) / paid 徽章 / .preview-source-picker / .preview-source-btn(各 hover/active)
  - **labr paper 覆盖 同 16 条**:cream + burnt sienna 调色板,暖墨字徽章
  - 文件:`web/src/styles/theme/glass.css` + `public/styles.css` 镜像,所有新 oklch 配 rgba/hex fallback
- **fix(theme): light/paper 50+ "灰灰"残留补丁 + 设计文档** — 用户反馈切到 light/paper 后仍大量元素显示深灰色调:日志面板 / 通用按钮 / 结果卡内部按钮 / 工具栏 / batch+complete 卡片 / ctx-menu 右键 / modal 遮罩 / source-badge BZ/BW/BY / 状态徽章 / 进度条等。诊断:项目历史上大量 CSS hardcode `oklch(20% ...)` 暗色,没走 `var(--surface)`,light/paper 切换无效。新增 Phase 2 补丁段:
  - **light 覆盖 50+ 处**:.log-panel/.log-summary span / .progress-track / .source-health-mini / .btn-ghost:hover / .btn:disabled / .search-templates button / .toolbar .btn.active / .badge-count / .filter-sep / .filter-sort select / .status-group-header / .ctx-menu / .result-card.row-active / .saved / .card-actions button(各 disabled/save.saved/download)/ .src-prog-chip(各 loading/ok/fail)/ .source-bz/.source-gbw/.source-by / .batch-card / .batch-mode-pill / .batch-results-empty / .batch-stat / .batch-result-card / .batch-textarea / .complete-card/.step(各 active/done/error)/ .complete-dropzone/.complete-status/.complete-options / .modal/.confirm-card/.modal-overlay/.confirm-overlay / .detail-chip
  - **paper 同款选择器 50+ 处**:配色换米白 + 米褐 + 暖色阴影 + 赤陶 accent
  - 文件:`web/src/styles/theme/glass.css` 末尾追加 ~610 行;`public/styles.css` 末尾镜像
- **docs: 新增 `docs/THEME_DESIGN.md`** — 完整记录三主题设计哲学 / token 表 / 覆盖组件清单(80+) / 改一处的 workflow / 续作 AI 起手指南。方便换电脑或换 AI 时无缝接手主题设计工作
- **feat: 第三主题 Paper · Claude Linen 温暖印刷品** — 在 dark / light(Arctic Blue) 之外新增 paper 主题,模仿 Claude.ai 同色调:米白底 + Burnt Sienna 赤陶 accent + 暖墨色文字 + 1px 米褐边线,杂志内页 / 书页质感。
  - **设计哲学**:① 米白不是白(bg oklch(95% 0.018 75) 奶油亚麻) ② 边界靠 1px 边线不靠阴影(claude.ai 几乎无 shadow) ③ accent #c96342 赤陶 Anthropic 品牌色 ④ 文字带暖色调(hue=60-75)油墨印刷感 ⑤ frosted glass 全面退场 — 不用 backdrop-filter blur
  - **差异点**:html 纯 `var(--bg)` 不做 ambient gradient / body::before 网格 `display:none` / btn-primary 纯色赤陶不用渐变 / topbar/sidebar/search-row 不用 frosted
  - **Token 全套**(base.css + 镜像):4 层 surface 米白系 + 米褐 border + 暖墨 text + 赤陶 accent + 暖色 shadow + 苔藓绿 success + 暖红 danger
  - **glass.css 30+ overrides**:html / body::before / topbar / sidebar / sidebar-item.active / btn-primary / 4 玻璃面板 / search-row / focus / result-card / hover / toolbar / source-tag.active / mobile-tabbar / 手机端 cards / sticky 吸顶 / chip 按钮 / 资质徽章 / source-chip / source-badge / status-indicator / scope-badge / modal-overlay / search-history / me-theme-btn.active
  - **UI 入口 3 态切换**:app-theme.js `VALID=['dark','light','paper']`,加 `togglePicker/openPicker/closePicker`;topbar 单按钮改成「点击展开 picker」3 选 1 弹层,显示当前主题图标 + ✓ 标记选中项;手机「我」页主题行加第三个 `[📜 Paper]` chip
  - **picker 容器** `.topbar-theme-picker`:dropdown 绝对定位 132px min-width,点击外部自动关闭,各主题各自配色(paper 用 white + 米褐边 + 暖 shadow / light 用 frosted + 蓝 shadow)
  - 所有新 oklch 都带 sRGB rgba/hex fallback;legacy `bzxzTheme.toggle()` 接口保留(只在 dark↔light 切,paper 走 set 或 picker)
- **redesign(theme/light): Arctic Blue 蓝调亮色重设计** — 用户反馈旧 light 主题"太丑"(只是简单白底+蓝字+灰阴影,Bootstrap 模板感)。整套重设计,参考 Linear / Apple HIG / 蓝图纸美学,工程师工作台感。
  - **设计哲学 5 条**:
    1. 永不纯白:`--bg` 极淡蓝白 oklch(98% 0.006 245) / `--surface` oklch(99.5% 0.003 245) 带一丁点蓝调 / `--surface-elevated` 纯白只留 dropdown 顶层
    2. Cold Shadow(蓝调冷色阴影):所有 shadow 用 hue=245 蓝调 oklch 代替纯黑 — 高级感的灵魂
    3. frosted glass 必加 saturate(180%) — 亮底单纯 blur 是灰白糊,要饱和度回拉
    4. accent L=52(`oklch(52% 0.20 250)` ≈ #2855d4) — 保 a11y 对比度,不刺眼
    5. 同色系明暗渐变 — btn-primary 走 56%→48% 同蓝不同明度,不用廉价双色
  - **token 全套替换**:base.css + public/styles.css 镜像段加 5 个新 token(`--surface-elevated` / `--border-strong` / `--accent-soft` / `--glass-bg-strong` + `--shadow-sm/md/lg/glow-accent` 系列冷蓝阴影变量)
  - **ambient gradient 三层**:左上极淡天蓝 / 右下淡薰衣草 / 中下淡青蓝,oklch 85% 0.08 / 85% 0.06 / 88% 0.05,屏幕"色彩呼吸感"
  - **body::before 网格**:从黑 0.025 改成 oklch(35% 0.10 245 / 0.04) 深蓝调暗线,蓝图纸感
  - **所有 frosted 组件**:topbar / sidebar / search-row / toolbar / mobile-tabbar / dropdown 全套 `blur + saturate(180%)` + inset 顶部 1px 高光 + 冷蓝外阴影
  - **btn-primary 同色蓝渐变**:`linear-gradient(135deg, oklch(56% 0.22 250), oklch(48% 0.22 255))` + inset 高光 + 蓝色光晕 shadow,代替旧"蓝→紫"双色
  - **资质徽章 light 配方**:CNAS 浅蓝填(95% 0.04 245)+ 深蓝字(40% 0.22 250)+ 细蓝边(82% 0.10 245),CMA 浅绿填(95% 0.04 158)+ 深绿字 + 细绿边,雅致有层次
  - **手机端结果卡片 chip 按钮**:同款同色蓝渐变 + inset 高光,disabled 静默蓝灰
  - **覆盖所有 UI**:html bg / body::before / topbar / sidebar / sidebar-item.active(含 ::before 左侧 3px 蓝指示条) / sidebar-user-avatar / btn-primary / confirm-card / download-center / user-dropdown / shortcuts-panel / search-row / search-row:focus-within / result-card / result-card:hover / toolbar / source-tag.active / filter-chip.active / mobile-tabbar / mobile-tab.active / 手机端 .result-card / .qual-result-group / .labr-row / 手机端 search-stage sticky 吸顶 / 手机端 card-actions 按钮 / qual-badge-cnas / qual-badge-cma / qual-source-chip-cnas/cma / source-badge / status-indicator(current/expired/upcoming) / has-text-badge / no-text-badge / qual-scope-badge(all/partial) / modal-overlay / preview-overlay / confirm-overlay / search-history / me-theme-btn.active
  - 不动:announcement.css / admin.css(已用亮色调色板,CLAUDE.md 强制保留),chart.js 颜色(暂不做)
  - 所有新写 oklch 都带 sRGB rgba/hex fallback,Win7 Chrome ≤109 兼容
- **fix: 用户管理"功能权限"勾选 labr / local 保存后不生效** — 用户反馈勾选权限保存后再打开还是未勾选状态。诊断:后端 `admin-routes.ts` zod `allowedTabs` enum 只列 7 个 tab (`search/batch/complete/history/qual/stats/settings`),漏了 `labr` 和 `local`。前端 `TAB_ITEMS` 已经列了 9 个(含 labr/local)。链:
  - 用户勾选 labr → 前端发 PUT `/api/admin/users/:id` body 含 'labr'
  - 后端 zod 校验失败抛 400
  - 前端 `saveUserPerms` 用 `await apiFetch(...)` 不检查 res.ok → 400 被静默吞
  - UI 看起来"保存成功"(modal 关掉 + loadUsers),实际 DB 没更新
  - 再打开权限对话框,从 DB 读还是旧值 → 全恢复"未勾选"假象
  - 修法:
    - **后端**(根本修):`admin-routes.ts` 三处 zod enum (PUT settings.defaultAllowedTabs / POST users.allowedTabs / PUT users.allowedTabs) + 常量 `ALL_TABS` 都补齐 9 个 tab,跟前端 TAB_ITEMS 对齐
    - **前端**(防御):`saveUserPerms` + `saveDefaultPerms` 都加 `if (!res.ok)` 校验,失败时弹 toast 显示后端错误信息,不再静默"假成功"
- **feat: 双主题(dark/light)切换 + 个人偏好持久化** — 用户原需求"再新增一套明亮色主题,用户可以在设置里面切换"。设计:
  - 双主题:**dark(默认)** / **light**;由 `<html data-theme="dark|light">` 驱动,CSS 用 `:root[data-theme="light"]` 覆写变量 + hardcode 色值
  - 持久化:`localStorage 'bzxz.theme'`,跨会话保留
  - **避免 FOUC**:public/index.html + web/index.html `<head>` 顶部加内联 script,在 CSS 加载前先把 data-theme 设上,浏览器一开始就按目标主题渲染
  - 入口(主题是个人偏好,与角色无关,所有用户可用,不放设置页):
    - **桌面 topbar**:`🌙 / ☀️` 切换按钮,放在统计 + 用户头像之间,点击 toggle
    - **手机「我」页**:`🎨 主题 [🌙 深色] [☀️ 浅色]` chip 行,所有登录用户可见
  - 实施:
    - 新 `public/js/app-theme.js`:`bzxzTheme.get/set/toggle`,启动调 `syncThemeUI()` 让两套 UI 同步当前态;切换时 dispatch `themechange` CustomEvent 给下游订阅
    - `base.css` + `public/styles.css` 镜像加 `:root[data-theme="light"]` 变量覆写段(双声明 sRGB + oklch fallback,Win7 Chrome ≤109 兼容)
    - `theme/glass.css` + `public/styles.css` glass 段加 light 覆写:html 渐变 / body::before 网格 / topbar / sidebar / 玻璃面板 / search-row / result-card / toolbar / sidebar-item.active / mobile-tabbar / 手机卡片化容器 / 资质徽章 全套
    - HTML:topbar 加 `<button id="topbarThemeToggle">`,「我」页加 `.me-theme-row` 含两个 `.me-theme-btn[data-theme]`
    - CSS 新增 `.me-theme-row` / `.me-theme-btn` / `#topbarThemeToggle` 样式(active 态 accent 蓝底白字)
  - 不动:announcement / admin 已用亮色调色板(CLAUDE.md 强制保留具体色值),不受 data-theme 影响。chart.js 颜色暂不动(用户能看到就行,后续可加 themechange 订阅做重绘)
- **polish(mobile): 结果卡按钮改 chip 风(靠右贴边)** — 用户反馈手机端结果卡两个按钮(详情+预览)"框体太高了,宽度又太窄了,所有信息全挤左边"。诊断:flex 1 1 0 拉伸 + 44px 高 + accent 蓝大色块,视觉压迫感强,左侧文字信息 vs 右下两大色块对比悬殊。改 chip 风:
  - `display: flex; justify-content: flex-end` 靠右
  - `flex: 0 0 auto; min-width: 64px; min-height: 36px; padding: 0 16px`(从拉伸改 auto 宽 + 文字 padding)
  - `border-radius: 8px`,`font-size: 13px`,shadow 减半(0 2px 8px → 0 1px 4px)
  - 触控热区 64x36+ 仍超 Apple HIG 44x44 推荐
  - 用户视觉感受:卡片信息左对齐 + 按钮右对齐 chip,左右平衡;按钮不再喧宾夺主
- **polish(mobile): 三个搜索框 (标准/资质/Labr) 视觉统一** — 之前三个 tab 各自一套搜索框样式 — 标准检索是玻璃 frosted 容器、资质是裸 input 实色背景、Labr 又是另一种 flex 行。手机端三 tab 切换体感像三个产品。改造:
  - **DOM 统一**:资质 / Labr 的搜索行外套 `.search-row` 玻璃容器壳 + 局部 class `.qual-search-row` / `.labr-search-row`。资质页 input 后新加 `<button id="qualSearchBtn" onclick="doQualSearch()">🔍 搜索</button>`(之前只能 Enter,手机端用户找不到)
  - **CSS 视觉统一**:`.qual-search-row .qual-search-input` 在玻璃容器内清掉自身 background/border/radius/focus shadow,融入父容器;focus 光晕走 `.search-row:focus-within` 与标准检索同款
  - **手机端按钮统一规则**:`#searchBtn` / `#qualSearchBtn` / `#labrSearchBtn` 共享同一组样式(40px 高、accent 蓝、🔍 + 文字、order:2 紧贴 input);Labr 的「批量下载选中」`flex 1 1 100%; order:3` wrap 到第二行
  - **search-stage.css sticky 吸顶选择器同步**:`#page-qual.search-stage-active #qualSearchInput` → `.qual-search-row`(吸顶整个玻璃容器而非裸 input);Labr 同理
  - 改动:`public/index.html` + `web/index.html` 资质 + Labr DOM wrapper;`web/src/styles/responsive.css` + `public/styles.css` + `web/src/styles/pages/qualifications.css` + `web/src/styles/pages/search-stage.css` CSS 镜像
- **feat(mobile): 管理员底部 tabbar 加 Labr 入口 + 「设置」收紧为 admin-only** — 用户反馈手机端管理员需要直接进 Labr 库检索;同时游客 / 普通用户都不该看到「设置」(本来基本上是 admin 全局配置项)。
  - `public/index.html` 底部 mobile-tabbar 新加 `<button data-tab="labr" id="mobileTabLabr">📚 Labr</button>`,`style="display:none"` 默认隐
  - `public/index.html` 「我」页「设置」行加 `id="meRowSettings"` + `style="display:none"` 默认隐
  - `public/js/app-auth-admin.js:onAuthReady` 按 `currentUser.role === 'admin'` toggle mobileTabLabr / meRowSettings 显示。其它用户(普通注册 + guest)都看不到
  - 4 tab 在 375px 屏宽仍能装下(每 tab flex 1 1 0 ≈ 93px),文字 11px 不挤
  - admin 角色 `allowedTabs=null` 全 tab 放行,labr tab 进入无权限阻塞;app-core.js switchTab 的 `tab !== 'me'` 例外不影响 labr
- **fix(mobile): 移除"切换到完整版"按钮** — 用户反馈"切换完整界面后切不回去,纯纯多余"。诊断:`public/index.html:474` "我"页有 `toggleDesktopLayout` 按钮在 mobile/desktop 之间切,选择存 localStorage `bzxz.layout`。问题:切到 desktop 后,桌面布局没有等价的"回到手机版"入口("我"页本身只在手机布局存在),用户被卡在桌面端再也切不回。整功能下线:
  - `public/index.html:473-475` 删整段 me-section(只放着这一个按钮)
  - `public/js/app-mobile.js` 删 `toggleDesktopLayout` / `updateMeToggleLabel`,简化 `readForcedMode` 不再读 localStorage
  - 启动时主动 `localStorage.removeItem('bzxz.layout')` 清残留,让升级用户从被卡的桌面布局自动回手机
  - 保留 `?desktop=1` URL 逃生口(给开发者/远程调试,不暴露 UI)
- **polish(mobile): 搜索框两行布局 + 结果卡按钮统一 accent 蓝** — 用户反馈手机端"输入字脏 + 光标在外"和"按钮变丑(从原来的差异化变成 2 个灰块)"。
  - **搜索框两行布局**:第一行 `[input    ][🔍 搜索]`,input flex 1 1 0,padding 横向 14px(左)/4px(右)让字 + 光标离边明显;searchBtn 强制 order:2 紧贴 input 右,accent 蓝 40px 高,内置 `🔍` 图标 + `搜索` 文字。第二行 `source-tags` order:3 wrap 占满,保留 BZ/BW/BY 勾选能力
  - **search-templates(GB/T / GB / YY/T chip)手机端全藏** — 用户全靠手输,模板 chip 窄屏意义不大
  - **结果卡按钮统一 accent 蓝主色** — 详情 / 预览两个按钮都用 `var(--accent)` + `#fff` 文字 + `box-shadow oklch(66% 0.20 250 / 0.18)`,跟桌面端 download 按钮视觉同款。disabled 态切静默灰(`opacity 0.45 + oklch(18% 0.012 255 / 0.4)`)与可用按钮明显分离。`:active` 态 transform translateY(1px) + accent-h 加深做按压反馈
  - 改动:`web/index.html` + `public/index.html` searchBtn 内置 `<span class="search-btn-icon">🔍</span><span class="search-btn-label">搜索</span>`;`public/js/app-search.js` doSearch loading/复位两处同步保持新结构;`web/src/styles/responsive.css` + `public/styles.css` 镜像段都改
- **fix: 标准搜索"预览"按钮 disabled 判定** — 用户反馈预览按钮缺少 disabled 判定:实际上无本地缓存 + 无可下载源时点了也没意义。新增 `isPreviewable(r, checkLocal=true)`:
  - 本地有缓存(`_libraryFileIds` 命中)→ 必可点(秒开)
  - 否则按 `isDownloadable(r)` 判定 — 能下就能拉文本预览;不能下也没本地 → disabled
  - `applyLibraryDots` 同步刷新 preview 按钮的 disabled 态(library-check 异步到达后让"刚发现本地命中"的卡按钮翻成可点)
  - 上下文菜单"预览(本地)"项也按 isPreviewable 判定,不可用时显示"预览(本地)(不可用)"+ toast 提示
  - 改动:`public/js/app-search.js` 加 isPreviewable 函数 + buildResultCardHtml 预览按钮 disabled 表达式 + applyLibraryDots 刷新 disabled + 上下文菜单标签
- **fix: 标准搜索"下载"按钮 disabled 判定放宽** — 用户反馈按钮 disabled 判定过严:多源标准里第一优先级源可能 previewAvailable=false,但其他源能下,按钮却 disabled 让人误以为下不了。诊断:`resolveTextState` 设计上既要给「文本徽章」做信号区分(有文本/无文本/检测中三态),又被复用到「下载按钮」disabled 判定,两者口径混淆。
  - 新增 `isDownloadable(r)` 函数,与 `resolveTextState` 解耦:textBadge UI 信号不变(信息);下载按钮判定改用 isDownloadable —— 放宽到「非废止 + 有源 + (任一源 previewAvailable=true 或 gbw 还在轮询)」就允许点击
  - 级联下载本身按 downloadPriority 顺序逐源尝试,一源失败自动跳下一个,全部失败才报 toast。所以「让用户能试一下」不会真坑用户
  - `filterState.onlyDownloadable` 筛选条保持原口径(严格 previewAvailable=true),与文本徽章一致 — 用户主动筛选时不希望被 optimistic 行污染
  - 改动:`public/js/app-search.js` 加 isDownloadable 函数 + 下载按钮 disabled 表达式 + 上下文菜单"下载该标准"标签判断同步
- **perf: Labr 搜索首屏一次拉 100 条 + searchCache 接入** — 用户反馈 Labr 库检索慢。诊断:① 旧 page=1 走 SSR `state.dataList` scrape 只返 ≤4 条,用户首屏看不到全量,体感"搜了没拉全"; ② labr-service 完全没接 searchCache(其它三个 adapter 都接了),重复搜索 / 翻页 100% 走上游。
  - **page=1 并行路径**:新增 `searchPage1(keyword, opts)`,并行调 `searchInline` + `recList(pageNo=2, pageSize=100)`,merge 按 did 去重。总耗时 ≈ max(inline, rec-list) ≈ 800ms(并行不串行),结果集从 ≤4 条 → 最多 104 条,首屏一次到位
  - **page≥2 偏移**:前端 page=2 → 上游 pageNo=3 (page=1 已吃掉 SSR + pageNo=2,page=N 对应 pageNo=N+1)。前端零改动,偏移逻辑只在 service / routes 层
  - **searchCache 接入**:`searchInline` / `recList` 加 5min TTL 缓存(公共数据,跨用户共享安全。user-token 仅给 isFav 等私字段,列表本身一致)。重复搜索 / 翻页 = 0 延迟
  - **失败容忍**:`searchPage1` 内 inline 失败软回退(catch + 返 []),最差也有 rec-list 100 条;rec-list 失败才抛错
  - 改动:`src/sources/labr/labr-service.ts` `searchInline`/`recList`/新增 `searchPage1`; `src/api/labr-routes.ts` page=1 改调 searchPage1,page≥2 偏移 +1。前端 / labr-client / 下载流不动
- **feat: 手机端搜索 / 资质 / Labr 结果卡片化 v2 + 资质徽章迁移到标准号后** — 用户反馈手机端三个 tab 的结果显示"很丑",同时希望 CNAS / CMA 徽章紧贴标准号(标识紧跟标识)。整体重设计:
  - **资质徽章位置(全局,桌面+手机都改)**:`buildResultCardHtml` 把 `qualBadgeHtml` 从 `.card-title-row` 和 `.card-meta-line` 一起搬到 `.card-id` 内新加的 `.card-number-row` 容器中,紧贴 `.card-number` 后面。桌面端 inline-flex 一行;手机端 wrap 时徽章跟在标准号后,不再与标题/状态/源混在一起
  - **手机端搜索结果卡(.result-card)卡片化**:`display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 12px; background + border 卡片边界`。信息层级三段清晰:①.card-number-row 标识行(标准号 16px + 徽章) ②.card-title 标题行(14px,允许 wrap 2 行) ③.card-meta-line 元数据行(状态/文本/源扁平化成纯文本 + ::before · 分隔符,不再彩色徽章砌墙) ④.card-date 日期行(11px 极灰) ⑤.card-actions 操作行(2 按钮等宽 44px 高,详情 + 预览,download/save 沿用既有"手机端隐藏管理入口"契约)
  - **手机端资质查询组(.qual-result-group)卡片化**:每组明确卡片边界(padding 12px 14px + border-radius 12px + border + 背景),标准名 13px 缩进 22px 独占第二行对齐 ▶ + 标准号;qual-badge 字号 10px → 11px 易看清,padding 抬升方便点中 tooltip
  - **手机端 Labr 检索行(.labr-row)卡片化**:与上面统一视觉,padding 12px 14px + border-radius 12px + 同款边界色
  - **元数据行 ::before · 分隔符**用法:`> * + *::before { content: ' · ' }` 制造逗点分隔,把彩色 status-indicator / has-text-badge / source-badge 在手机端扁平化成纯文本灰字,既保留信息又不抢戏。同时显式隐 `.dot` / `.text-badge-dot` 等小圆点
  - **桌面端零影响**:所有手机化规则嵌在 `@media (max-width: 640px) body:not(.force-desktop)`,桌面 + force-desktop 完全走老规则
  - 改动文件:`public/js/app-search.js`(JS DOM)、`web/src/styles/components/result-card.css`(桌面 .card-number-row)、`web/src/styles/responsive.css`(手机 .result-card 卡片化)、`web/src/styles/pages/qualifications.css`(手机 .qual-result-group 卡片化 + badge 字号)、`web/src/styles/pages/labr.css`(手机 .labr-row 卡片化)、`public/styles.css`(legacy 镜像)。所有 oklch 都带 sRGB fallback
- **feat: 手机端搜索类 tab landing/active 两态布局** — 用户反馈"搜索框默认应该上下居中偏上、左右居中,聚焦感强;输入关键词搜索后再滑动到顶端置顶,方便连续使用"。三个搜索类 tab(标准检索 / 资质查询 / Labr 库检索)统一改造:
  - **landing 态**(`.page.search-stage-idle`):搜索框 `margin-top: 25vh`,左右默认满宽 + 弱化下方所有 UI(results 容器 / 模板 chip / source-tags / 筛选条 / 进度条 / summary / qual filters / labr pager / h2 标题 / labr 说明文案)全藏。手机首次进入 / 切到 tab 时若无结果即为此态
  - **active 态**(`.page.search-stage-active`):搜索框 `position: sticky; top: var(--topbar-h)`,frosted glass + blur(14px) backdrop,跨出 .content 内边距吸全宽,结果区滚动时它常驻顶部。资质 filters 二级 sticky 错位放在搜索框下面 44px(`top: calc(var(--topbar-h) + 44px)`)。标题 h2 / 资质 tab 栏 / labr 说明在 active 态都隐掉(topbar 已有 tab 名做上下文,腾出视口给结果)
  - **触发时机严谨**:不是 input 事件触发,而是用户点搜索 / Enter 触发 `setSearchStage('search'|'qual'|'labr', 'active')`。删字符 / 焦点变化不会抽动布局
  - **tab 切换时智能初始化**:`switchTab` 末尾对 search/qual/labr 调 `initSearchStageForTab`,按 DOM 里是否已渲出 .result-card / .qual-result-group / .labr-row 自动判定 idle vs active。从其它 tab 切回有结果的搜索 tab 直接保留 active 状态
  - **scroll reset**:切到搜索 tab 时 `window.scrollTo(0)`,符合"用户使用时各端页面置顶,方便连续使用"诉求
  - **桌面端不参与**:全部 CSS 嵌在 `@media (max-width:640px) body:not(.force-desktop)`,桌面 layout 完全不变
  - 实现:新增 `web/src/styles/pages/search-stage.css` + 镜像段加在 `public/styles.css:1303` 后,所有 oklch 都带 sRGB fallback;`public/js/app-core.js` 加 `setSearchStage` / `initSearchStageForTab` helpers + switchTab 末尾接入;`app-search.js` `doSearch` / `app-qual.js` `doQualSearch` / `app-labr.js` `doLabrSearch` 入口处各加一行 stage 切换调用;`web/src/styles/index.css` `@import` 新 CSS
- **fix: 防 0KB / 损坏 PDF 入库（三层下载完整性校验）** — 用户报告 gbw 偶发下到 0 字节 PDF,排查发现上游验证码通过后 `viewGb` 偶有 race(cookie 时序 / CDN 304 转 200 空 body),adapter 拿到 HTTP 200 + content-type=pdf 但 body 为空时直接 `writeFile` 入库 → 库里多出无法打开的 0KB 文件。三层防御:
  - **Layer 1（各 adapter `writeFile` 前 buffer 校验，最早最便宜）**:新增 `src/shared/download-integrity.ts` 暴露 `MIN_PDF_BYTES=1024` + `assertDownloadedPdf(bytes, label)`（size + `%PDF-` magic 双检）+ `assertNonEmptyDownload(bytes, label)`（仅 size，labr 可能是 doc/docx）。接入点:`gbw-adapter.ts:tryDownloadFinalFile`(原地抛 UpstreamError 被本函数 try/catch 降级 status=failed,让 `autoDownloadInner` 的 3 次 OCR 循环天然走下一轮重试 → 用户感知 = 成功率提升)、`by-adapter.ts:downloadPdf`(被本函数 catch → return false → 现有"下载失败"路径)、`labr-service.ts:downloadInner`(抛错让 batch flow 标该 did 失败、其他继续)、`bz-zhenggui-adapter.ts:exportStandardInner`(合成后 fs.stat size 兜底,pdf-lib magic 必然正确不查 magic)
  - **Layer 2（`addFileToLibrary` 入库前 `fs.stat` srcPath 兜底，漏改 adapter 也拦得住）**:`library-index.ts:570` 入函数早期 stat + unlink 残文 + 抛 `[download-integrity]` 前缀错;错误被 `moveDownloadToLibrary` 现有 try/catch 吃掉 → API 响应 `library_failed` + `libraryError` 冒到前端
  - **Layer 3（`moveDownloadToLibrary` 入口检查 `result.fileSize`，省一次 IO）**:adapter 已知 fileSize 时直接 early-return error,不进入库
  - 阈值 1024B 的依据:拦 0KB / 几十字节错误页 HTML 残骸;不误伤极小标准(gbw/by 单页 PDF 起步 5KB+,有效空 PDF 也得 700B+,1024 留余量)。万一误伤下调到 512 一行 const 改完
  - 单测:`src/shared/download-integrity.test.ts` 覆盖 0/100B/1024B + magic 正确/1024B HTML / 大尺寸 / labr 宽校验 共 8 case
  - 静态核查所有 `arrayBuffer()` → `writeFile` 落盘点已全覆盖;bz 单页 JPEG `bytes.length < 5000 + JPEG magic` 本就有自校验,无需重复
- **fix: tooltip detach 后样式失效(独立 floating class)** — 用户反馈强刷后 tooltip 还是大字 + 重叠看不清,跟前一版 polish 完全没生效。根因:JS portal `setupQualTooltipPortal` 把 tooltip 节点 detach 出 `.qual-badge` 后,CSS 后代选择器 `.qual-badge .qual-tooltip` 不再命中 → 字号 10px / 半透背景 / 毛玻璃 / box-shadow / padding / 宽度 / line-height 等全部失效,只剩 JS 设的 inline style(position/top/left/opacity 等几个),tooltip 视觉回退到 browser default(大字、无背景、占屏宽)。
  - 改 `public/styles.css` + `web/src/styles/pages/qualifications.css`:新增 `.qual-tooltip.qual-tooltip-floating` 独立选择器,复制一份样式(背景 + 毛玻璃 + 字号 10px + padding + 宽度 + shadow + line-height 等),只有 position/opacity 由 JS 管
  - 改 `public/js/app-qual.js` `setupQualTooltipPortal`:`showTip` detach 后立即 `tip.classList.add('qual-tooltip-floating')`;`hideTip` 复位前 `tip.classList.remove('qual-tooltip-floating')`
  - 顺手调整 showTip 流程:先设 `opacity: 0` 让 tooltip 不可见,设完 position:fixed 后用 getBoundingClientRect 拿到正确尺寸再算定位,最后 `opacity: 1` 显示。避免之前在 (0,0) 闪一下的视觉跳
- **polish: 资质徽章 tooltip 毛玻璃 + 字号收窄** — 用户反馈 tooltip 浮层 1) 背景透明导致与后面文字重叠看不清,2) 字号 12px 比 CMA/CNAS badge 字号 10px 大显眼,希望再小一号。改 `public/styles.css` + `web/src/styles/pages/qualifications.css` 两份 `.qual-badge .qual-tooltip`:
  - 背景从纯不透 `var(--surface)` 改成 `oklch(19% 0.014 255 / 0.78)` 半透(sRGB fallback `rgba(22,26,34,0.78)`)+ `backdrop-filter: blur(12px) saturate(140%)` 毛玻璃效果。降级:老 Chrome ≤74 不支持 backdrop-filter 直接忽略,半透背景仍生效,只是无毛玻璃质感
  - `font-size: 12px` → `10px`,跟 badge 一致
  - `box-shadow` 加深 `0.4` → `0.45`,弥补半透背景层级感弱化
- **fix: 资质徽章 tooltip 被分组框遮挡** — 用户报告 hover CMA/CNAS 徽章时 tooltip 浮层被上方的 status-group 分组框裁掉。根因:`.status-group-body { overflow: hidden }`(为支持折叠动画 `max-height: 0`)+ `.result-card { transition: transform }`(hover 时 `translateY(-1px)` 创建 containing block)双重夹击 —— 即便 `position: absolute / fixed`、z-index 拉到 9999 也会被祖先裁剪。修法:`app-qual.js` 加全局事件代理 `setupQualTooltipPortal`,mouseover 进 badge 时把 tooltip 节点 detach 到 `document.body` 末尾(留 Comment placeholder 占位),设 `position: fixed` + 用 `getBoundingClientRect` 算 viewport 坐标定位;mouseout 复位放回 badge。完全绕开任何 overflow / transform 祖先的限制。视口边界保护 + scroll/resize 时隐藏。CSS 不动 —— `position: absolute` 仍是默认状态,JS show 时 override,hide 时清空让 CSS 默认值生效。
- **fix: 资质查询搜带年时不返跨年(`searchQualifications` hasFullYear 路径)** — 用户报告资质查询页搜 `3324-2024` 返了 `3324-2008/3324-2017/33324-2016` 等无关跨年/相似数字标准。根因:`searchQualifications` 原本 `WHERE std_code_base = ? OR std_code_base LIKE ?` 这两条 OR 子句把所有同号跨年 + 子串相似的标准都拉回来。改:检测 query 经 extractFullCode 后是否带完整 4 位年份(`/-\d{4}[A-Z]?$/`),带年时 SQL 中 baseClause 整段去掉(只走 `std_code_norm` 精确路径),不带年时保留 base 双路径(`3324` 这种片段仍跨年命中,符合"无年用户主动想跨年看")。单测加 2 个回归 case:`does NOT return other years when user searches with a full year` + `returns cross-year matches when user searches without year`。本地 DB 实测验证:收紧前 CMA 返 3 条 (2008/2017/2024),收紧后只返 2024 一条。
- **feat: 8 个分组拆资质/无资质(主搜索结果)** — 用户进一步要求层级严格按"资质 → 状态"线性铺开:① 现行·有资质 ② 废止·有资质 ③ 现行·无资质 ④ 废止·无资质,「即将实施」和「其它」也跟着拆。改 `public/js/app-search.js`:
  - `statusCategory(s, standardNumber)` 返回 8 个 key:`'资质·现行' / '资质·即将实施' / '资质·其它' / '资质·废止' / '无资质·现行' / '无资质·即将实施' / '无资质·其它' / '无资质·废止'`,前缀按 `hasQualificationBadge` 加
  - `STATUS_GROUP_ORDER` 改 8 元素,有资质 4 组在前 + 无资质 4 组在后(各组内按"现行 → 即将实施 → 其它 → 废止"排)
  - 渲染时空组自动跳过(`if (!total) continue`),实际数据稀疏只会显示 2-4 组,UI 不会被 8 组撑爆
  - `_collapsedGroupsKey` 改 `bzxz_collapsed_status_groups_v2`,默认折叠 `['无资质·废止']`(不再是老的 `['废止']` —— 现在分两个废止组,只折叠无资质那个;有资质的废止默认展开,符合用户的"提上去不折叠"诉求)
  - filterBar `statusChips` 仍展示 4 个基础状态 chip(现行/即将/其它/废止),过滤匹配时剥前缀(`baseCat = cat.replace(/^(资质·|无资质·)/, '')`),`statusCounts` 也按基础状态聚合 —— chip 视觉简洁,过滤直觉性不变
  - 分组 CSS class 按基础状态映射(`status-group-current/upcoming/expired/other`,忽略资质前缀),颜色一致;资质前缀靠组名展示
  - 老用户首次访问:localStorage 没有 v2 key → 用默认 `['无资质·废止']`,自动迁移
- **feat: 资质命中条目排序优先(主搜索结果)** — 用户需求:有 CMA/CNAS 徽章的标准排在最上面,方便快速判断"这标准我们能测吗"。改 `public/js/app-search.js`:`sortByStatus` 顶部 + `sortFilteredResults` 三个非默认模式都加上 `hasQualificationBadge` 作为最高优先级 → 4 种排序(默认 / 日期 / 可下载 / 源数)都资质优先,模式选择只在"资质有无"分组内做次级排。资质徽章异步增量到达 → 每次 `fetchQualBadges` 完成 `renderResults` 都按"当时已知 qualData"重排,首屏 1-2 秒内渐进收敛到最终顺序。
- **note: 搜索框 placeholder 加年份提示** — 用户报告搜 `4463-201` / `4463-202` 命中 0 条,搜 `4463-2013` / `4463-2025` 正常。诊断:`BZ 远程 /api/gxist-standard/standardstd/list` 不接受残缺年份后缀 —— `keywords=4463-201` 总命中 0,`keywords=4463-2013` 命中 2;GBW / BY 远程行为类似。这是远程源搜索引擎的分词限制(token 匹配,不做子串扩展),非项目侧 bug。改:`public/index.html` + `web/index.html` 主搜索 `placeholder` 加"年份要写完整 4 位"提示,引导用户用 `4463-2013`(完整年份)或 `4463`(纯片段),避免 `4463-201` 这种半年份。**不动**:adapter 不做 query 重写(BZ/GBW/BY 都是 size=20 截断 + token 匹配,本地展开成 10 个年份并发查会放大远程 QPS 10× 风险)、不做本地 DB 补充(local 命中范围有限,补出来的结果反而误导)。
- **fix: 资质徽章多源结果增量拉取(`app-search.js` / `app-qual.js`)** — 用户报告搜 `4463`(关键词片段)时结果列表里的 `QB/T 4463-2025` 没有任何 CMA/CNAS 徽章,但搜 `4463-2025`(精确)时同条结果有 CMA 徽章。
  - **根因**:`app-search.js` 第一个源(通常是 BZ)返回后立即 `qualFetched = true` 锁死,只拉了 BZ 那 20 条 stdCode 的徽章 → 后到的 GBW/BY 源带来的新 stdCode(如 `QB/T 4463-2025` 在 BZ `size=20` 截断里漏掉、但 GBW 返回了)从来没被问过资质 → 自然无徽章。`fetchQualBadges` 本身 `qualData = data` 全量替换的写法,也会让后续若有补查发生时覆盖前面结果。
  - **改 `app-search.js`**:去掉 `qualFetched` 标志位 + 收尾兜底,改为**每个源返回都调一次** `fetchQualBadges(stdNums)`(`stdNums` 是当前 `results` 全量,fetchQualBadges 内部去重)。
  - **改 `app-qual.js`**:`fetchQualBadges` 改 **merge 而非 replace** —— 内部按 `qualData` 已有 key 过滤出 `pending`(只查新增 stdCode);响应回来后 `qualData[code] = data[code] || []` 写入(命中的填资质数组,没命中的填 `[]` 占位避免下次又被算成 pending,二次搜索同条结果不会重复请求)。新搜索时 `app-search.js:122` 仍把 `qualData = {}` 整体清空。
  - **不动**:后端 `/api/qualifications/batch-query` 接口契约不变(z.array().max(200) 上限够 4 源 × 20 = 80);UI 渲染逻辑 `qualBadgeHtml` 不变。
- **fix: 资质徽章收紧为同号同年命中(`queryByStdCodes`)** — 用户报告搜 `QB/T 4463-2025` 时主搜索显示有 CNAS 徽章,但「资质查询」页里 CNAS 没有这版,只有 2013 版。诊断验证:CNAS DB 里只有 `QB/T 4463-2013`(实验室 L0290),CMA DB 里 2013/2025 两版都有(机构 221700110366)。根因:`queryByStdCodes` 原本用 `WHERE std_code_base IN (...)` 跨年模糊匹配,设计意图是"实验室持有老版能力 → 新版搜索也亮徽章",但**前端 `qualBadgeHtml` / `buildQualTooltip` 并没有标年版差异**(代码注释「前端 tooltip 自行靠 year 对比标 ⚠ 跨年提示」从未兑现),用户体感就是"标准检索骗我说有 CNAS"。
  - 改:`queryByStdCodes` SQL `WHERE q.std_code_base IN (...)` → `WHERE q.std_code_norm IN (...)`,参数 `baseCodes` → `fullCodes`,反向映射 `baseToInputs` → `fullToInputs`,CNAS / CMA 两段相同改动。函数顶部注释更新:"严格同号同年命中,同号不同年视作不同资质"。删 `baseCodes` / `baseToInputs` 局部变量、`fullCodes` 那条「`void fullCodes` 占位」注释。
  - **不动 `searchQualifications`**(资质查询关键词搜) — 它本来 ORDER BY 把精确同年靠前,且 UI 列表展示完整带年 `stdCode` 让用户明确看到命中年版,跨年命中对用户是可见的有价值兜底
  - **不动 `extractBaseCode` 函数本身** — 仍被 `searchQualifications` / CNAS/CMA INSERT 入库写 `std_code_base` 列 / admin `qual/diagnose` / library-index 等地方在用
  - 单测翻转:`queryByStdCodes (Step 2-3)` 套件里原 "cross-year fuzzy match: searching 2024 returns 2017 / 2008 versions" 测试预期翻转为 "does NOT match different years",新增 "matches when DB has the exact same year as input" 同年正常命中回归 case
  - Trade-off:"DB 有老版资质 → 新版搜索也亮"的复用能力从主搜索徽章移除。用户需要这类信息走「资质查询」页关键词搜索,UI 列表会明示具体年版
  - 文档同步:`README.md` 三层归一化说明里 L2/L3 用途拆开标注、「近期重点」插入此次 fix 记录
- **移除 spc 数据源接入** — `spc.org.cn` 这条路走不通,放弃接入。删除 `src/sources/spc/`(spc-client.ts + spc-adapter.ts + spc-client.test.ts)、`scripts/sources/spc/`(整目录)、`docs/sources/spc-source-plan.md`,清理所有引用点:
  - 类型与注册:`SourceName` 联合类型、`VALID_SOURCES` Set、`SUPPORTED_SOURCES` / `SOURCE_LABEL_TO_CANONICAL` / `CANONICAL_TO_LABEL`(library-index)、`SOURCE_LABELS`(library-naming)、`SourceRegistry.FACTORIES`、`getSourceSemaphore` defaults
  - API:`sourceEnum` / `ALL_LIBRARY_SOURCES` / `library_source_priority` 过滤器 / `preview/files` allSources;admin `GET/POST/DELETE /api/admin/spc/cookie` 三端点删除;health 测试期望数组回退到 `['bz','gbw','by']`
  - 前端:`public/index.html` + `web/index.html` SPC chip 删除;`app-core.js` 的 `ALL_SOURCES` / `DEFAULT_DOWNLOAD_SOURCES` / `SOURCE_LABELS`;`app-download.js` switch case + `downloadSpc` 整函数;`app-search.js` sourceLabel dict
  - 配置:`.env.example` SPC_* 段整段删;`CLAUDE.md` 凭据契约示例去 SPC_USERNAME 引用;`build/installer.nsh` 注释列举去 `SPC_*`;`src/shared/http.ts` 注释去 spc 提法(保留 dispatcher 字段作通用扩展点)
  - 文档:`README.md` 源表 / 目录树 / API 表 / 「近期重点」插入「移除 spc」记录;`docs/ARCHITECTURE.md` §六-B 整节删 + §五并发段 spc 一行;`DEVELOPMENT.md` 目录树 / SourceAdapter 联合类型 / curl 例;`docs/README.md` spc-source-plan 链接;`ELECTRON_HANDOFF.md` 5→4 源描述
  - `settings` 表历史残留 `spc.cookies` / `spc.cookies_expires_at` 不主动清,无害(adapter 已不再读)

- **#73 fix: `parseLibraryFilename` 放宽 source 前分隔符，救回上一个 bug 砸坏的文件**：用户报告 `GB_T 24456-2009 BW.pdf`（上一个 #73 bug 砸坏的 V1 文件，缺 ` - `）「统一命名」卡在「无法解析」组，既不在 standard_files 表里也用不上「编辑」/「删除」/「统一命名」，只能去文件系统手改 —— 死局。根因：`parseLibraryFilename` 强制要求 source 前必须有 `\s*[-—]\s*`，缺连字符直接判 null。修：正则改 `(?:\s*[-—]\s*|\s+)`，允许「`-` / `—` 或纯空格」当 source 分隔符。重启后 scanLibrary 会捡回这种文件入索引，用户「统一命名」按 V2 pattern 渲染时自动补回 ` - ` 恢复规范。副作用：source label 字典只有 4 个（BW/BZ/BY/LB），手塞 PDF 文件名末尾恰好命中并被字典认下的概率极低（`SOURCE_LABEL_TO_CANONICAL` 字典拒绝即退 null）。
- **#73 fix: V1 文件按 V2 pattern 渲染时不再丢 ` - ` 分隔符**：用户报告 `GB_T 4893.2-2020 - BZ.pdf`（V1 老格式）「统一命名」预览显示 from→to = `GB_T 4893.2-2020 - BZ.pdf` → `GB_T 4893.2-2020 BZ.pdf`，把规范名劣化掉。根因：`renderLibraryFilename` 处理空 `{title}` 时贪婪吃两侧 sep，return 逻辑 `left || right` —— 默认 pattern `{stdCode} {title} - {source}` 中 title 左是 ` `（空格）、右是 ` - `（含强分隔字符），结果优先保留 left 把右边的 ` - ` 丢了。修：两侧 sep 都非空时优先保留含强分隔字符（`-` / `_` / `·` / `—`）的那一侧，弱 sep（纯空白）让位。修后 V1 文件渲染结果与原名一致 → willChange=false → 自动归到「已符合命名」折叠组跳过。其它 pattern 输出无影响（year 中段缺失、title 缺失但两侧都强 sep、V1 pattern 本身渲染等行为不变）。
- **labr fix: 标准号直连中文时不再 fallback 成 `LABR-${did}`**：用户报告 `GB/T 35607-2024` 落库后命名成 `LABR-14718 GB_T 35607-2024绿色产品评价 家具 - LB.pdf` —— 前面那撮 `LABR-14718` 多余且会把已识别的标准号留在 cleanTitle 里。根因：`STD_CODE_FROM_TITLE_RE` 末尾分隔符强制要求 `[|｜:：\s]`，但该 title 标准号末位 `-2024` 直接连中文（无 `|` / 空白）→ 抽不出 → 走 `fallbackCode = LABR-${did}` 兜底。修：分隔符改为 lookahead `(?=[|｜:：\s]|[一-鿿]|$)`，允许 CJK 字符或末尾当合法终止；不消费分隔符，剩余文本切片改用 `m[1].length` + 单独 `^[|｜:：\s]+` strip。`labr-client.test.ts` 加 `'GB/T 35607-2024绿色产品评价 家具'` 和「整段就是标准号」两个回归 case，原有 9 个 case 全数通过。历史已落地的 `LABR-${did} ...` 文件不会自动改名（库内 `std_code` 已成 `LABR-xxx`，#73「统一命名」也救不了），需要用户在「编辑」按钮里手改或删后重下。
- **#73 本地文件库：统一命名（批量 + 单文件，含整库快捷入口）**：库里同时存在 V1 (`{stdCode} - {source}.pdf`) 和 V2 (`{stdCode} {title} - {source}.pdf`) 格式的文件，还有用户手拷进来的杂乱命名，扫读 / 排序 / 搜索都受影响。本次给用户一个"按 admin pattern 一键统一命名"的工具：
  - **`src/services/library-naming.ts` 新增 `computeNormalizedName(input, pattern)`**：复用 `parseLibraryFilename` + `renderLibraryFilenameWithExt`，输出 `{currentName, normalizedName, willChange, error}`。保留原扩展名（labr 可能落 docx/xlsx 也能统一）。V1 老文件 title 缺失 → 模板引擎自动剥占位符 + 相邻分隔符 → 结果与原名相同 → willChange=false（要补 title 得跑源 detail，超出本端点范围，留作 #74 评估）。
  - **`src/api/preview-routes.ts` 提取 `renameLibraryFile(file, finalName, libDir)` helper**：PATCH（用户手输）与新 normalize 端点共用 rename + abs_path 同步 + GONE/CONFLICT/BAD_REQUEST 状态码，避免逻辑漂移。
  - **新增 `POST /api/preview/file/:id/normalize`**（单文件）：`?dryRun=1` 支持 → 返回 `{currentName, normalizedName, willChange, error}` 不动文件（供 rename modal 实时预览）；非 dryRun 则 parse 物理名 → 按 `library_filename_pattern` 重渲染 → 不变返回 `changed:false`、有变化走 `renameLibraryFile`。冲突 409、parse 失败 422 `UNPROCESSABLE`。
  - **新增 `POST /api/preview/files/normalize`**（批量 dryRun + scope 切换）：body `{ ids?, scope?: 'selected'|'all', dryRun? }`。`scope='all'` 忽略 ids，扫所有 library 行（提供整库格式化快捷入口）。三遍扫描——① computeForRow 算每条 from/to；② **self-conflict 检测**（同批两个旧文件渲染出相同 to，全部标 conflictReason 跳过，Windows 大小写不敏感 toLowerCase 比较）；③ 与库内已有同名文件冲突检测。dryRun=true 返回 `{preview, libraryTotal}`（libraryTotal 供前端「整库」chip 显示总数）；dryRun=false 实际执行返回 `{renamed, unchanged, failed}`。
  - **前端 `public/js/app-detail-utils.js`**：
    - 重构 `batchNormalizeLibraryFiles` → `openNormalizeModal({scope, selectedIds})`：modal 顶部新增 **scope chip 切换**「仅选中 N 项 / 整个文件库 M 项」，点击重新 dryRun 刷新内容（用 200ms setTimeout 避让 click bubble 关闭新 modal）；主区放「将重命名 N 项」突出，from→to grid 三列对比，默认 20 行 + 「全部展开」按钮可显示完整；其它三类（已符合 / 冲突 / 错误）做 `<details>` 折叠分组，**冲突项自动展开** 让用户立刻看到；50 行内全列。
    - `showConfirmHtml` 扩展支持 `confirmDisabled`（无可执行项时禁用确认按钮，Enter 键失效）+ `onMount(overlay)` 让调用方挂事件（chip / 展开按钮）。
    - `showRenameModal` **加实时预览**：modal 打开时异步调 `POST /file/:id/normalize?dryRun=1` 拿目标名 → input 下方显示「按内置格式将变为：xxx」绿底块 + 「套用内置格式」按钮；目标名 = 当前名时显示「文件名已是内置格式」灰底；parse 失败显示「内置格式不可用：xxx」灰底。
    - 新增 `normalizeSingleFile(fileId)` 调单文件端点；`updateLocalSelectionUi` 同时控制「批量删除」和「统一命名」按钮 disabled 状态。
  - **HTML 双 entry**：`public/index.html` + `web/index.html` `.local-toolbar-actions` 全选和批量删除按钮之间插入 `#fileLibraryBatchNormalize`（**ghost 样式**避免与红色批量删除按钮争视觉焦点，文案「统一命名」直白，title 解释「按 admin 设置的内置命名格式统一改名」）。
  - **CSS 双写**：`web/src/styles/pages/local-library.css` + `public/styles.css` 同步新增 `.normalize-chip(.active)` / `.normalize-summary` / `.normalize-list / -row / -from / -arrow / -to / -more / -more-btn` / `.normalize-group(.conflict/.error/.neutral)` 折叠分组 / `.rename-preview-box / -label / -name / -skip` —— 等宽字体 + grid 三列 (from / → / to) 让差异一眼能比较；冲突 / 错误条块用左竖线 + 浅底色提示非阻塞跳过；rename modal 内置格式预览用绿底（确认性）vs skip 用灰底（提示性）。
- **#72 资质卡 scope chip + 部分参数限制项 + 全部参数折叠态精简**：产品标准（GB/T、GB 等含「全部参数」/「部分参数」标记的资质）卡头扫读力度不够 —— 之前必须展开才能看 scope，部分参数的限定描述也藏在展开层里。本次：
  - **`public/js/app-qual.js` `buildQualUnifiedList` 加 groupScope 计算**：扫 grp.items 求组级 scope（全部参数 ≻ 部分参数 ≻ null，遇到 `paramScopeRank === 0` 短路）。卡头标准名称后面渲 `qual-scope-badge` chip：全部参数=绿色（success 调），部分参数=橙色（warning 调）。N 项计数 chip 保留。
  - **全部参数：折叠态彻底精简**：`collapsible = groupScope !== 'all'` 决定 header 是否带 `onclick`、arrow 是否渲▶（替换为 16px 占位保持横向对齐）、body 是否渲（直接空字符串）。同质 item 展开无价值，少一层视觉噪声。
  - **部分参数：限制项第二行长驻**：聚合该组所有 `paramScopeRank===1` item 的 `limitDesc`，去重（key=limitDesc 字符串）、过滤 `/` / `—` 占位，`；` join 成一行，渲在卡头下方 `.qual-scope-limit-row`（橙左竖线 + 6% 橙底，不抢戏）。仍可展开看明细（生效/到期日期对用户重要）。
  - **CSS 双写**：`web/src/styles/pages/qualifications.css` + `public/styles.css` 同步新增 `.qual-scope-badge.scope-all/partial` + `.qual-scope-limit-row`。oklch 都带 sRGB fallback。
  - **搜索结果卡 `qualBadgeHtml` 不动**：搜索结果的 chip 是「这标准能否沾资质」的 hint 维度，资质查询页才是 scope（全部/部分）维度，两边语义不同不混用。
- **#71 搜索结果命中本地库时跳过源拉取**：之前用户在搜索结果点「下载」，即使绿点亮着（本地已有）也会再走一遍 source 级联，labr/by/gbw 都有日配额，命中场景重复拉纯属浪费。本次：
  - **`public/js/app-download.js` `downloadOne` 入口加短路**：`_libraryFileIds.get(r.id)` 有 fileId + `window.bzxzPublicSettings.downloadPreferLocal !== false` 时走新增的 `downloadFromLocal(r, fileId)` —— 复用 `/api/preview/file/:id?attachment=1`（纯本地流，无 source adapter），通过 `downloadLocalFile` 触发浏览器/Electron `will-download` 钩子，跟普通下载体验对齐（行状态、绿点、Toast、history 都正常）。Toast 文案前缀「本地库命中，复制完成」便于用户区分。
  - **本地命中失败兜底**：用户在资源管理器里删了 / 移走文件后再点下载会失败，自动清缓存里的 fileId（防 stale 绿点）→ 回退源下载。
  - **「指定来源下载」不走短路**：`downloadSpecificSource` 不受影响，保留「我要这个源的版本」语义（用于校对源差异）。
  - **`src/api/admin-routes.ts` 新增 setting `download_prefer_local`（默认 `'1'`）**：admin 在「文件库」设置区可关；toggle 在 `public/js/app-settings.js` 的 `renderLibraryStatus` 加了一行，保存后通过 `window.bzxzPublicSettings` 当前会话立即生效，无需刷新。
  - **`src/api/auth-routes.ts` GET /api/auth/status 响应新增 `publicSettings.downloadPreferLocal`**：写在 `/status` 让首屏一次拿（普通用户拿不到 `/api/admin/settings`），前端 `app-auth-admin.js` 的 `checkAuthStatus` 把它写到 `window.bzxzPublicSettings`，全局所有页面共用。
  - **记 history 时 source 用 `r.sources[0]`** 而非 `'local'`，避免历史按源统计被污染（多一个 fake source 分类）。
- **#70 Win 桌面端本地文件库 tab 隐藏「下载」按钮**：用户原话「内网用户才需要下载」—— 桌面端用户可用「打开路径」直接在资源管理器拿物理文件，HTTP 下载多余。`public/js/app-detail-utils.js` `renderFileLibrary` 库结果列 `isElectron === true` 时不渲染 `downloadBtn`；导出文件列（kind!=='library'）维持原样不动。Web 浏览器端（手机/局域网）保留，是远程用户唯一拷文件的路径。
- **#69 本地文件库：标准号显示修复 + 标准名称列 + 默认命名带 title**：之前用户在本地文件库搜「3324」看到的是 `GB3324-2024`（应为 `GB/T 3324-2024`），表头是「文件名」（实际是物理 fileName 整串），新下载的文件名不带 title。三处一起改：
  - **`src/api/app.ts` /api/downloads**：library 行的 `standardNumber` 不再用 `std_code_norm + year` 拼装（`std_code_norm` 是 `extractBaseCode` 产物，故意剥掉 `/T` 大写化了，给索引用而非展示用），改成 `parseLibraryFilename(basename(abs_path)).stdCodeRaw` 反解物理文件名 → `GB/T 3324-2024` 原样还原。parse 失败（用户手放进库的非规范命名）兜底回旧逻辑。response 同时新增 `title` 字段（V2 命名 `{stdCode} {title} - {source}.pdf` 解析得到）冒给前端。
  - **默认命名模板从 `{stdCode} - {source}` 改为 `{stdCode} {title} - {source}`**：`src/api/admin-routes.ts:71` + `src/services/library-index.ts:597` 两处同步；`download-to-library.ts` 已经在拉 detail 把 title 传进 `addFileToLibrary`，新下载自动落成 `GB_T 3324-2024 木家具通用技术条件 - BW.pdf`。已在 admin 设置里改过 pattern 的用户不受影响（DB 已存的 setting 值优先）。
  - **本地文件库表头 + 列内容**：`public/index.html` + `web/index.html` 镜像，「文件名」改成「标准名称」；搜索框 placeholder 改「按标准号或标准名称筛选…」。`public/js/app-detail-utils.js` 的 `renderFileLibrary` 列内容改用 `f.title || f.fileName` 渲染，tooltip 仍是完整 fileName 方便排查物理路径；过滤搜索覆盖 `fileName + standardNumber + title` 三个字段。
  - **老文件不批量重命名**：表里没存 title 列、老文件名也不带 title，要补必须按 source + stdCode 重新拉 detail。用户后续手动编辑或删后重下即可补全；批量改名留作 #70 评估（要协调多源限速 + 不同 source 不同登录链路）。
- **#68 桌面安装版 .env.local 配置落地**：之前 `.env.example` 只在仓库根存在、`env-loader.ts` 只查 `process.cwd()/.env.local` —— 用户用 NSIS 安装包装完后，`$INSTDIR` 里既看不到模板也不知道把 `.env.local` 放哪，labr 等需要凭据的源直接报「凭据未配置」无法使用。本次三处补齐：
  - **`package.json` 的 `extraResources` 加 `.env.example`** → 打包后落到 `$INSTDIR\resources\.env.example`
  - **`build/installer.nsh` 的 `customInstall` 段把模板 `CopyFiles` 到 `$INSTDIR\.env.example`** → 用户在 INSTDIR 直接可见；`customUnInit` / `customRemoveFiles` 把 `$INSTDIR\.env.local` 也按"备份-Rename-还原"模式保留，升级 / 重装不丢凭据
  - **`src/shared/env-loader.ts` 扩展搜索路径**：`cwd/.env.local` 不存在时再查 `dirname(process.execPath)/.env.local`，安装版 / portable 都能命中 exe 同级的 `.env.local`；命中后打一行 log 方便定位
  - **README 凭据配置段补桌面安装版说明** —— 三种部署形态（源码 / 安装版 / portable）各自的 `.env.local` 放置位置都写清楚
- **#67 手机端「下载/收藏」入口双 entry 对齐**：之前 `web/src/styles/responsive.css:191-206` 已经把手机端的下载中心、卡片下载/收藏按钮、「只看收藏」chip、「下载历史」入口全部 `display:none`，但 legacy `public/index.html` 直接 `<link>` 的 `public/styles.css` 漏了同步 → 用 legacy 入口进访的手机端还能看到这些按钮，违反 CSS 迁移期「重复加载、cascade 等价」契约。本次在 `public/styles.css` 的 `@media (max-width:640px)` 块末尾镜像同一段（注释 + 6 行规则），两个 HTML 入口行为一致。
  - **JS 端键盘 `d` 也补一道兜底（`public/js/app-search.js:1281`）**：原本 `toggleSavedStandard` 已有 `isMobile()` early-return、右键菜单按 `onMobile` 过滤，但快捷键 `d` 没检查 —— 手机外接键盘场景能绕 CSS 触发 `downloadOne`。现在 `d` 分支也加 `if (window.isMobile && window.isMobile()) return;`，与 `s` / 右键菜单的兜底风格一致。
- **#66 本地文件库独立成顶级 tab + 5 项管理能力**：之前"本地文件库"是「下载历史」tab 里的一个 card，随着用户积累的标准 PDF 增多，已不堪用。本次拆出为独立 sidebar 入口 `data-tab="local"`，改表格布局（标准号 / 文件名 / 来源 / 大小 / 时间 / 操作），去掉原"路径"列；每行 5 个动作：`预览 / 下载 / 打开路径 / 编辑 / 删除`；表头复选 + 单行复选 + "全选 / 批量删除"工具条。
  - **后端新增 4 端点（`src/api/preview-routes.ts`）**：`DELETE /api/preview/file/:id` 物理删 PDF + 删 `standard_files` 行；`POST /api/preview/files/batch-delete` 批删，body `{ ids: number[] }`，返回 `{ deleted, failed }`；`POST /api/preview/file/:id/reveal` 桌面端"在资源管理器中定位"，靠 `process.env.BZXZ_ELECTRON` 卡口 + `process.emit('bzxz:reveal-in-folder', absPath)` 喂主进程，Web 端 501；`PATCH /api/preview/file/:id` rename，body `{ fileName }`，校验非法字符 + `isInsideLibrary` 防越界 + 409 拒绝覆盖同名，`std_code_norm` 索引键保留不动（避免绿点/搜索失效）。
  - **Electron 主进程（`electron/main.ts`）**：启动时 `process.env.BZXZ_ELECTRON = '1'` 喂卡口；`process.on('bzxz:reveal-in-folder', absPath => shell.showItemInFolder(absPath))` 监听后端事件总线。
  - **前端（`public/js/app-detail-utils.js`）**：重写 `renderFileLibrary` 为表格；新增 `openLocalPreview` / `downloadLocalFile` / `revealLocalFile` / `renameLocalFile` / `deleteLibraryFile` / `deleteExportFile` / `batchDeleteLibraryFiles` / `onLocalCheck` / `onLocalCheckAll` / `updateLocalSelectionUi`。删除全部带 `showConfirm` 二次确认。`window.bzxz.isElectron` 为真时显示「打开路径」按钮，为假（Web 浏览器）时改为「复制路径」。
  - **页面拆分（`public/index.html` + `web/index.html`）**：新增 `#page-local` 容器；`#page-history` 保留"收藏标准"+"下载历史"两个 card，副标题改为"记录每一次下载行为。收藏夹用于监控收藏标准是否有新版本。"，"常用标准库" → "收藏标准"。
  - **CSS**：`public/styles.css` 末尾 + `web/src/styles/pages/local-library.css`（新文件）。表格布局 + sticky thead + 复选列窄 + 操作列 nowrap + 720px 窄屏紧凑。`.btn.btn-xs` 与 `.btn.btn-danger` 全局补全。
  - **switchTab 联动（`public/js/app-core.js`）**：`tab === 'local'` 时调 `refreshFileLibrary()`；同时去掉 `renderDownloadHistory` 里冗余的 `refreshFileLibrary()`（独立 tab 后不再耦合）。
  - **TAB 字典（`public/js/app-auth-admin.js`）**：`TAB_LABELS` / `TAB_ITEMS` 加 `local: '本地文件库 / 已下载标准管理'`，`KNOWN_TABS` 已有该键无需改。
- **#65 Labr sidebar 文案 + 位置调整**：把「Labr库检索」按钮从「资质查询」之后挪到「标准检索」紧下方（高频使用 → 高优先级位置）；副标题 `labr.cc 标准库补给` → `标准库补给`（不在 UI 中暴露上游域名）。`public/index.html` + `web/index.html` 双 entry 镜像；`public/js/app-auth-admin.js` 的 `TAB_LABELS` / `TAB_ITEMS` 同步。README 「支持的标准源」表行 `labr.cc` 改为 `标准库补给源`（用户向描述），API 表里的 `source=labr` 保留（开发者文档参考，方案 A）。
- **labr 第 4 标准源接入**：新增 `labr.cc` 检索与下载。架构上**独立 service，不挂 SourceRegistry** —— labr 的下载产物形态、限速契约、登录链路都与既有三源差异大（kind=0 直拉无消耗 / kind=1 需登录走 preview2 限 5/天），强行做 SourceAdapter 会扭曲 BZ/GBW/BY 的共同契约。
  - **后端**：新表 `labr_temp_urls` 缓存 kind=1 的短时下载链跨 token 持久化；源级 semaphore=2 防限频；`labr-client` 复用 BY adapter 的 token 持久化 / cookie 模式 + `LABR_USERNAME`/`LABR_PASSWORD` 注入；`labr-service` 编排 List / Detail / Download，batch 路径带指数退避；API 路由 `/api/labr/search` / `/labr/download/:did` / `/labr/batch-download` + `/api/preview/files?stdCode=&year=` 多源候选。
  - **前端**：sidebar 新 tab「Labr库检索」(`web/index.html` + `KNOWN_TABS` + `TAB_LABELS`/`TAB_ITEMS`)；legacy 路线 `public/js/app-labr.js`（与 app-qual.js 对齐）实现搜索 + 翻页 + 全选 + 单 / 批量下载，结果就地渲染 ok / 失败，限速被跳过条目单独提示数量。错误 code `LABR_RATE_LIMIT` / `LABR_AUTH` 给中文友好提示。`sanitizeLabrTitle` 白名单 `<font color>` / `<mark>` / `<b>` 后 escape 其余，让搜索高亮直接渲染。
  - **样式**：`web/src/styles/pages/labr.css` —— labr-row 家族 + std-code 蓝徽章 + kind-0 绿 / kind-1 橙 + ext 按 office 套件主色（PDF 红 / DOC 蓝 / XLS 绿 / PPT 橙 / TXT 灰）+ paid 橙 + 640px mobile 紧凑。所有 oklch() 都按 CLAUDE.md 契约带 rgba() fallback 兄弟。
  - **资质徽章兼容**：labr 入库的文件 `std_code` 走与 CNAS/CMA 一致的三层归一化（`cleanStdCode` → `std_code_norm`/`std_code_base`），跨年 / 全角变体能沾资质徽章。
  - **已知遗留**：legacy `public/index.html` 入口缺 labr 样式（仅写入 `web/src/styles/*`，未镜像到 `public/styles.css`，因为后者第 1593 行 `.library-row-label` 处预先存在文件损坏）。
  - 详见 [`docs/sources/labr-source-plan.md`](./docs/sources/labr-source-plan.md)
- **多源 preview picker**：库内同一标准号同时存在多版本（多年份 / 多扩展名 / 多源）时，预览顶部展开切换条，按钮显示 `源名 · year · ext`，active 蓝高亮；点击 `switchPreviewSource(fileId, stdCode)` 直接换 iframe src 到 `/api/preview/file/:fileId`，跳过 `/preview/request` 整轮 RTT（候选已确定在库）。仅 overlay 路径实装，popup 路径暂不支持（注入 UI 复杂度高、价值低）。`closePreviewOverlay` 清空 picker DOM 防泄漏。CSS 在 `web/src/styles/components/preview.css` 新增 `.preview-source-picker` 块 + 640px 横滚。
- **资质查询展示重构：CMA / CNAS 不再分两栏**：搜索页 + 可视化页统一改为单列纵排，按 `(标准号 + 资质类型)` 分组，全局严格 **CNAS 段在前、CMA 段在后**，段间一条虚线分割。每组标题行布局：`▶ [CNAS / CMA 徽章] 标准号 标准名 ... N 项`，徽章蓝/橙色块、占位居中。
  - **buildQualUnifiedList 替代 buildQualColumn**：`public/js/app-qual.js`。组内 items 按 `paramScopeRank` 三档排序 —— `0 = 全部参数`、`1 = 部分参数`、`2 = 其它`，确保"全部参数"那一条永远顶在该组最上面（产品标准用户最关心"这家整张证书是否覆盖此标准"的判定）。
  - **删除冗余信息**：不再渲染机构名「机构 XXX」（即使多机构也不显示）、不再渲染 `limitDesc`「限定 ...」。展开后每条记录字段只剩：类别 chip + `检测项目 xxx` + `生效 / 到期`。
  - **「全部参数 / 部分参数」高亮**：含这两个关键字的 item 整张卡 `qual-result-item-scope` 类，淡蓝背景 + 文字加粗，扫读时一眼锁定。
  - **CSS 双写**：`public/styles.css` + `web/src/styles/pages/qualifications.css` 同步新增 `.qual-source-chip` / `-cnas` / `-cma`、`.qual-source-divider`、`.qual-result-item-scope`。`.qual-results-grid / .qual-col / .qual-col-header` 保留兜底（手机端 responsive 仍有引用），新方案不再产出这些类。
- **桌面端下载统一入库 + 绿点秒亮**：之前残留两个 UX 漏洞 —— ① Electron 用户下载完同一份 PDF 会出现两份（一份在 `<exe>\standards\` 由后端 `moveDownloadToLibrary` 写入，一份在 `Desktop/bzxz/` 由 `will-download` 钩子写入，因为前端 `triggerDownload` 又触发了一次 HTTP 下载）；② 下载成功后绿点不会立刻亮，要等下次搜索 / `library-check` 才更新。
  - **前端 `triggerDownload` 在 Electron 早返回**：`public/js/app-detail-utils.js` 里检查 `window.bzxz?.isElectron`，是就 `return`，不再创建 `<a download>` 触发浏览器下载流。Web 浏览器侧（手机访问）逻辑不变，仍然走 `/api/downloads/:filename` 拿一份本地副本。
  - **后端 BZ/BY `/export` 接 `moveDownloadToLibrary`**：原 `ExportTaskService.runTask` 跑完 adapter 就 `markSuccess`，文件停留在 `data/exports/`，与 `multi-download` / `auto-download` 走的入库路径不一致 → 桌面"下载"按钮按一下 BZ/BY PDF 不会到 `standards/` 库、绿点也无从亮起。现在 `runTask` 在 adapter 完成后立即调 `moveDownloadToLibrary`，把入库后的 `fileId` / 可能的 `libraryError` 透回 SSE 流的最终 frame。`ExportTask` 接口加 `fileId?: number; libraryError?: string`；`markSuccess` 签名扩展接受这两个字段；`ExportTaskService` 构造函数追加 `db / sourceRegistry / source` 参数，`standards-routes.ts:277` 调用点同步更新。失败不影响 task 成功状态 —— 文件下下来了就算成功，入库错把 `libraryError` 冒给前端按 `library_failed` 一样处理。
  - **前端 4 个下载入口统一 `markLibraryHit`**：`public/js/app-download.js` 加 helper `markLibraryHit(resultId, fileId)`，下载成功后写入 `_libraryFileIds` Map 并调 `applyLibraryDots()` 刷新绿点。在 `downloadOne`（级联）/ `downloadSpecificSource`（指定源）/ `downloadSelected` worker（批量勾选）/ `doCascadeDownload` worker（批量级联）四个成功分支统一调用。BW 从 `data.fileId` 拿、BZ/BY 从 SSE `td.fileId` 拿、`multi-download` 从 `data.fileId` 拿 —— 三条响应路径的 `fileId` 字段都已经在后端补齐。下载完按钮右上角绿点几百毫秒内点亮。
- **Popup 预览 AbortController 独立化**：修复连续点不同标准的预览时第一个 popup tab 卡在 loading 不动的 bug。
  - **原 bug**：`_previewPollAbort` 全局变量被 overlay 路径和 popup 路径共用。用户点预览 A → popup A 启动 poll，ctrl A 写入全局；回主页点预览 B → `runPreviewWithPopup` 头部 `_previewPollAbort.abort()` 把 A 的 poll 杀了 → A 标签页永远卡在 loading 骨架。
  - **修复**：`runPreviewWithPopup` 自己 `new AbortController()`，传给 `pollPreviewTaskForPopup`。每个 popup 独立 controller，互不干扰；fetch 也挂 signal 让网络层一并取消。
  - **`_previewPollAbort` 现在只服务 overlay 模式**：`pollPreviewTask` 写入、`closePreviewOverlay` / 失败重试按钮 abort 它。Popup 模式完全脱钩。变量声明处也加注释说明 scope。
- **Electron 桌面端预览跳系统浏览器**：解决 Phase 2 `window.open` 在 Electron 里被默认行为接管（弹出无菜单的裸 BrowserWindow，PDF 全屏 / 缩放 / 另存为体验都差）的问题。
  - **`electron/main.ts:391` 注册 `mainWindow.webContents.setWindowOpenHandler`**：拦截所有渲染进程的 `window.open(url, '_blank')`，对 `http:` / `https:` URL 调 `shell.openExternal(url)` 让系统默认浏览器（Edge / Chrome）打开 —— PDF 用浏览器原生 viewer，全屏 / 缩放 / 打印 / 另存为全部到位。`about:` / `file:` / `javascript:` 等非 http(s) 协议直接 deny 不放行，安全收紧。
  - **`public/js/app-search.js` 两处 ready 分支接入 Electron 检测**：`runPreviewWithOverlay` 和 `pollPreviewTask` 拿到 ready 状态后，若 `window.bzxz.isElectron` 为 true（preload 注入），改成 `window.open(file_url) + closePreviewOverlay()` —— overlay 仅作 loading 占位，PDF 用系统浏览器展示。Web 浏览器侧（手机访问局域网）仍然在 overlay 内 iframe 渲染。
  - **行为变化**：Electron 桌面用户点预览，loading 一闪过后系统浏览器弹一个新 tab 展示 PDF。Phase 2 的「热路径 `window.open` 跳新 tab」在 Electron 里也自动转成 `shell.openExternal`，体验统一。
  - **冷路径 popup 占位 trick 在 Electron 中自然降级**：`window.open('about:blank')` 被 handler deny + 不放行 → 返回 null → fallback `runPreviewWithOverlay`，再被 ready 分支接住跳系统浏览器。逻辑链路完整。
- **绿点批量查询切 chunk**：`fetchLibraryAvailability` 原来把整个 results 数组当一个 POST 提交。后端 `/api/preview/library-check` zod 限定 `items.max(500)`，多源搜索合并后 results 经常 > 500 → 400 错误 → catch 静默吞 → 绿点对所有结果全瞎。改成 400/批切片并发查询：每批独立 fetch，任一失败不影响其他 chunk 的命中。后端上限不放宽（better-sqlite3 `SQLITE_MAX_VARIABLE_NUMBER` 默认 32766，IN 参数过多 SQL 会被截或拒）—— 切片是正确的客户端响应。
- **DB 自动备份 + 缺失自愈（防升级丢账号）**：commit `0bd54c4` 之前的 `installer.nsh` 没保留 `$INSTDIR\data`，从更早版本升级的用户会被旧卸载器 `RMDir /r` 把 `users` / 资质数据全部抹掉。装机版升级走的是「上一次安装时落盘的卸载器」 —— 即使现在 installer 修了，旧 exe 的卸载器逻辑无法追溯。所以再加一层 application-level 防御。
  - **备份位置选 `%APPDATA%\bzxz\bzxz-db-backups\`**：NSIS 永远不会动 userData，与 `$INSTDIR` 物理隔离。环境变量 `BZXZ_USER_DATA_DIR` 由 `electron/main.ts:524` 注入；backend 进程通过此环境变量拿到路径。
  - **启动自愈**：`src/services/db.ts::getDb` 在 `new Database(path)` 之前调一次 `tryRestoreDbBeforeOpen(path)` —— 检测 db 文件不存在或 < 100 字节（SQLite header 最小值），从最新备份 `copyFileSync` 过去，让上层照常 open。找不到备份时静默退让，让程序走「全新 db、首次注册即管理员」路径。
  - **启动后异步备份**：用 `better-sqlite3` 的 `db.backup()` API（SQLite Online Backup，对 WAL 模式安全）拷一份 `bzxz-<YYYYMMDD-HHmmss>.db`。保留最近 7 份，更老的删掉。失败静默不阻塞启动。
  - **管理员接口**：`GET /api/admin/db/backups` 列出所有备份元数据（name / size / mtime），`POST /api/admin/db/backups` 手动触发一次备份（打补丁前主动留一份）。
  - **行为兼容**：现有用户首次启动后立刻得到一份基线备份；下次升级即使踩旧卸载器逻辑也能自愈。**已经丢账号的用户没法回溯历史 —— 这是版本切换的一次性伤害**，只能重新注册管理员；未来不再发生。
- **Hotfix：绿点 CSS 同步到 `public/styles.css`**：Phase 1 时把 `.dot-local::after` 规则只加到 `web/src/styles/components/result-card.css`，但 packaged 装机版 Electron 走 `public/index.html` 入口、只 `<link>` legacy `public/styles.css`，新文件根本不会被加载 → 用户看不到绿点。**本质是迁移期双写漏了一边**（CLAUDE.md 已明确"`public/styles.css` 仍是真相源"）。现在把那段 CSS 同步到 `public/styles.css` 的 `.result-card .card-actions button` 块之后，与 web/src/styles 端 cascade 等价。
- **预览优化 Phase 3：轮询提速 + 移除 cache-buster 让浏览器走 304**：
  - **轮询前 5 次 300ms，之后退化 1500ms**：`pollPreviewTask` 和 `pollPreviewTaskForPopup` 都把固定 1500ms 间隔改成 `attempt <= 5 ? 300 : 1500`。CNAS/By 源命中本地缓存的标准 ~1-2s 就完成 export，原来 1500ms 步长意味着最坏 5 个完整间隔（7.5s）才感知到 ready；改后前 5 次密集采样最快 300ms 内捕获，超过 1.5s 没好就降到 1500ms 减负载。**前 5 次 = 1500ms 之内**，跟原版 1 个轮询周期等长，对后端是无 regression 改动；用户感知到的"下载到出现 PDF"延迟从 typical 2-3s 降到 ~500ms。
  - **移除 iframe URL 的 `?t=Date.now()` cache-buster**：原来在 `runPreviewWithOverlay` 和 `pollPreviewTask` 拿到 ready 后把 url 拼上一个时间戳避免 iframe 缓存 stale。但后端 `/api/preview/file/:id` 已经发了 `ETag` + `Cache-Control: private, max-age=0, must-revalidate`，浏览器每次都会带 `If-None-Match` 做条件请求，命中 → 304 + 复用内存里的 PDF。原来强制带 ts 让浏览器把每次都当不同 URL，跳过条件 GET = 每次重新下整个 PDF。改后用户连点同一标准的预览第二次起几乎瞬间渲染。
  - **`pollPreviewTask` 也回填 `_libraryFileIds` 缓存**：原本只在 popup 路径回填，现在 overlay 路径走完 ready 也写一笔。两条路径都贡献绿点 + 第二次秒开。
  - **行为兼容**：UI 仍然显示「正在自动下载…（N）」计数，N 现在最大可能是 ~6-10（前 5 次密集采样后再几次 1.5s），用户语义不变。
- **预览优化 Phase 2：预览直跳新 tab（热路径秒开 / 冷路径 about:blank 占位 + 自动跳转）**：解决 overlay iframe 模式的两个老问题 —— ① 命中本地的标准也要走 `/api/preview/request` 一轮 RTT 才能渲染；② iframe 内 PDF 缩放 / 全屏受 overlay 容器限制、键盘快捷键被劫持。
  - **热路径**：`previewStandard` 开头查 `_libraryFileIds.get(id)`（Phase 1 已经预填好的缓存）。命中 → 直接 `window.open('/api/preview/file/:fileId', '_blank')`，**完全跳过 API 调用**，浏览器直接走 304 缓存渲染。绿点 = 秒开承诺，体感非常好。
  - **冷路径（同步开占位 tab）**：未命中时，先在 `previewStandard` 同一个 click tick 内 `window.open('about:blank', '_blank')` —— 这一步必须在用户手势调用栈里、否则 popup blocker 拦死。立刻 `popup.document.write` 一个 loading 骨架（暗色背景 + spinner + "正在自动下载 XXX…"），再异步发 `/api/preview/request` 拿 fileId / taskId。`writePreviewLoadingPage` 用 `document.write` 而非 innerHTML，因为 `about:blank` 刚开时还没有 body 节点；origin 通过 opener 继承同源，写入权限 OK。
  - **拿到 fileId → `popup.location.replace(/api/preview/file/:fileId)`**：浏览器原生 PDF viewer 接管整个 tab，可以全屏 / 双指缩放 / 打印 / 另存为，完全没有 overlay 限制。任务还在 downloading 时 `pollPreviewTaskForPopup` 每 1500ms 拉一次，每轮检查 `popup.closed` 让用户关 tab 等于取消；同时刷新弹窗里的 hint 文字「轮询中… 已 N 次」让用户感知到进度。
  - **失败 → `writePreviewErrorPage`**：弹窗变红色错误页 + 关闭按钮。重试入口故意不放在弹窗里 —— 用户回主页重点一次预览按钮即可，避免把状态机搬到弹窗里。
  - **Popup 被拦兜底**：`window.open` 返回 null / popup.closed === true 时（用户开了浏览器拦截器、企业策略屏蔽弹窗），降级到 `runPreviewWithOverlay` —— 行为与 Phase 2 之前完全一致的 overlay + iframe 流程，零功能退化。
  - **缓存回填**：`runPreviewWithPopup` 和 `pollPreviewTaskForPopup` 拿到 fileId 后都会 `_libraryFileIds.set(id, fileId) + applyLibraryDots()`，**第二次点同标准的预览就走热路径**。配合 Phase 1 已经有的「搜索完批量扫库」，绿点 → window.open 秒开的覆盖率会越用越高。
  - **行为变化**：原先 overlay 内嵌 iframe 现在大多数走新 tab；用户预期变化 = "看完关 tab 而不是按 ESC"。`closePreviewOverlay` 现在主要在 popup blocker 兜底 / 桌面端某些隐藏入口里触发。
- **预览优化 Phase 1：搜索后台扫描本地库 + 绿点指示器**：搜索完成后非阻塞批量查 `/api/preview/library-check`，命中的标准在「预览」按钮右上角叠一个脉冲小绿点（`.dot-local::after`），用户一眼能区分「点开就秒开」vs「点开要下 5-30 秒」。
  - **后端**：`src/services/library-index.ts` 加 `bulkLookup(db, items, sources?)` 函数，一条 `WHERE std_code_norm IN (?, ?, ...)` 拼参数 SQL 拿全部候选，JS 端按 sources 优先级挑首条命中。**不做 fs.access**：watcher 已经维护表的真实存在性，绿点容忍极少数 stale 误指，省下 200 次 stat。`src/api/preview-routes.ts` 加 `POST /api/preview/library-check`，body `{items: [{stdCode, year?}], sources?}`，响应 `{fileIds: Array<number|null>}` 与 items 同序平行数组（避免前端镜像 `extractBaseCode` 归一化逻辑）。
  - **前端**：`public/js/app-search.js` 加模块级 `_libraryFileIds` 缓存（`resultId → fileId`）、`_libraryCheckAbort` controller、`fetchLibraryAvailability` 异步函数、`applyLibraryDots` DOM 应用函数。`doSearch` 开头清缓存 + 末尾 fire-and-forget 调一次接口；`renderResults` / `appendNextResultsBatch` 每次都调 `applyLibraryDots` 让过滤排序后的新 DOM 也能涂上绿点。失败静默，绿点是 nice-to-have，不影响搜索结果展示。
  - **CSS**：`web/src/styles/components/result-card.css` 加 `.card-actions [data-action="preview"].dot-local::after` 一组规则（6px 圆点 + 暗色背景描边 + 2.4s 脉冲动画，`prefers-reduced-motion` 兜底）。
  - **后续 Phase 2 复用**：`_libraryFileIds` 缓存也是 Phase 2「预览跳新 tab」热路径的关键 —— 有绿点直接 `window.open('/api/preview/file/:fileId')`，跳过 `/api/preview/request` 整轮 RTT。
- **回退「手机端点资质标准号头直跳标准搜索」**：commit `721cda3` 引入的 `onQualGroupClick` 把手机端点击行为劫持成 `switchTab('search') + doSearch`，但用户反馈这破坏了"看资质详情"的正常预期 —— 点标准号头本来应该展开下面的检测项目列表（CMA/CNAS 几十条能力），而不是丢掉当前上下文跳到搜索页。`public/js/app-qual.js` 删掉 `onQualGroupClick` 整个函数 + onclick 改回 `toggleQualGroup(gid)`，手机端与桌面端行为重新统一为 expand / collapse。
- **手机端隐藏下载 / 收藏入口**：手机定位是「查阅」场景，下载依赖本地 standards 库目录 + 桌面 IPC（手机浏览器没有），收藏只是 localStorage 单端孤岛、跨端不同步。把所有触发面收掉避免误点：顶栏「下载中心」按钮、结果卡 `[data-action="download"]` / `[data-action="save"]`、筛选条「只看收藏」chip、长按右键菜单的"下载该标准"/"加入收藏"项、"我"页"下载历史"行、sidebar 历史 tab 全部 `display:none`。详情 / 预览弹窗里的 `#previewDownloadBtn` 保留（临时复制单个链接到外部浏览器仍然有用）。`toggleSavedStandard` 入口加 `window.isMobile()` early-return，防快捷键 / 外部脚本绕过 CSS。`?desktop=1` 逃生通道仍可走 `body.force-desktop` 还原所有功能。`web/src/styles/responsive.css` 顺手修了 78d940f oklch 脚本造成的尾部截断（`.card-actions` 规则及 4 按钮等宽样式被吃掉了 8 行）。
- **下载入库加固 + 失败可见性**：解决"批量下载日志报 8/8 成功，但 library 目录里只有 5 个"的灵异 bug。根因是 `addFileToLibrary` 偶发抛错（Windows `EBUSY`/`EPERM` 锁竞争、跨卷 race 等），被 `moveDownloadToLibrary` 静默 `console.error` 吞掉、API 响应里仍带 `status: 'downloaded'` → 前端记一笔成功、用户却看不到库里没文件。
  - **A: `moveIntoLibrary` helper（`src/services/library-index.ts`）**：抽出从 `addFileToLibrary` 中的「rename + 撞名 + 跨卷」逻辑。`renameWithRetry` 对 `EBUSY`/`EPERM`/`EACCES` 做 4 次指数 backoff 重试（累计 ~1.4s，覆盖典型 AV 锁窗口）；跨卷 `EXDEV` 走 `copy → .part → rename → unlink src` 中转，保留原子可见性（`.part` 后缀已在 watcher `ignored()` 里）；同名 PDF 用 `access` 预检 + `(1)/(2)` 后缀避免静默覆盖用户手放进来的文件。
  - **B: 失败原因冒到 API 响应**：`moveDownloadToLibrary` 返回值新增 `error: string` 字段（`src/services/download-to-library.ts`）。`/api/standards/multi-download` 与 `/auto-download` 在 `moved.error` 存在时把 `status` 降级为 `'library_failed'` + 带 `libraryError` 字段（`src/api/standards-routes.ts`）。日志同时打到 `console.error`（ring buffer 拦截 → `/api/diagnostics/logs` 可查）+ 响应体。
  - **C: 前端区分「入库成功」vs「下到 exports 但没入库」**：`public/js/app-download.js` 批量级联分支新增 `library_failed` 处理：UI 标 ⚠ 失败 + 原因显式展示 + 失败结果弹窗能看到具体 errno。`downloadErrorMessage` fallback 链补 `libraryError`，单源下载也能看到 `入库失败: rename 失败 (EBUSY)` 这种具体诊断。
  - **不动 preview-routes**：预览自动下载用 `moved.fileId` 判断成功，无 fileId 自动 fallback 到下一源；UI 上只有最终的「所有源都未能下载」消息，具体 errno 走 `/api/diagnostics/logs`。
  - **行为兼容**：库不可写 / 入库失败时文件仍在 `data/exports/`，`/api/downloads/:filename` fallback（先看 exports/ 再走索引）保证 `triggerDownload(fileName)` 能拉到本地副本。

- **下载架构：多用户并发适配（A+B+C 组合）** —— 把单机部署 + 多用户共享出口 IP 这个物理约束闭环掉。
  - **A: 跨用户下载去重**：`ExportTask` 加 `subscribers: number[]`，`ExportTaskStore` 加 `activeByStandard: Map<standardId, taskId>` 索引。两个用户同时点同标准下载 → 第二个调用 `createTask` 时把 userId 追加到 subscribers 拿现有 task 的 SSE 进度流，**底层 adapter.exportStandard 只跑一次**。task 进入终态（success/failed）时摘除活跃索引，下次同标准下载能起新任务。owner 校验从 `userId ===` 改成 `isSubscriber(taskId, userId)`，两个用户都能读同 task。
  - **B: 删除竞速模式**：`downloadMode = 'race'` 全链路移除（`app-core.js` / `app-download.js` / `app-settings.js` / `web/src/main.ts` / 设置页 UI）。理由：竞速假设源独立，但实际整个系统是同一个出口 IP，对源站是一个客户，3 源同时打反而放大频控触发概率。`doRaceDownload` / `setDownloadMode` 留 thin wrapper 防旧 onclick / localStorage 报错。
  - **C: 源级并发信号量**：`src/shared/semaphore.ts` 新建（FIFO 计数信号量，含 `run()` 自动 acquire/release、`setLimit()` 运行时可调）。`src/shared/source-semaphore.ts` 注册三源全局默认：`bz=2 / gbw=4 / by=4`。`BzAdapter.exportStandard` / `ByAdapter.exportStandard` / `GbwAdapter.autoDownload` 入口包 `getSourceSemaphore(src).run(...)`。前端 `downloadConcurrency` 多用户叠加也不会让真实出口超额。
  - **诊断接口**：`GET /api/diagnostics/sources` 返回 `{ bz, gbw, by }` 各源的 `{ active, limit, waiting }`，`waiting > 0` 长期不归零 ⇒ 源端瓶颈。
  - **测试**：`semaphore.test.ts` 7 个用例（限额 / FIFO / run() / 异常 release / setLimit grow / 输入校验）。
  - **删 60 行 + 加 250 行净 +190**：竞速删 80 行 + 信号量 + 跨用户索引 + 测试。
  - **风险评估**：A 的去重逻辑跟 preview-task-store 已验证模式同源；B 是纯删除；C 是加层 try/finally，最坏情况下未持有 release 会立刻抛错（带 paired-call 单测覆盖）。CI 跑 build / test 验证全链路。

- **资质可视化 tab 改用搜索页同款布局**（Step 8 — 推翻 Step 7 的 .qv2-* 设计）：用户反馈 Step 7 的"stdCode 大字 + 行头徽章"过于花哨。改回与「资质查询-搜索」**完全同款**：两列 CMA/CNAS、标准号分组默认收起、机构名行内（多机构时）。
  - **buildQualColumn 提到模块级**：从 `renderQualSearchResults` 内部抽出，可视化页 `renderQualVisual` 直接复用。两个 tab 视觉/交互完全一致，未来改一处生效两处。多 query 时按 query 分 section，每 section 内调一次 `buildQualColumn` 渲染 CMA/CNAS 两列。`gidPrefix` 参数让两 tab 的 group id 不冲突。
  - **section head 用 `.qv-section-title`**：黄绿 strong + 灰色 "N 条"，配「全部展开/全部收起」按钮。`toggleQualVisualSection` 简化为遍历 `[id$="_body"]` + 旋转 arrow（与搜索页 `toggleAllQualGroups` 同行为）。
  - **删除 Step 7 引入的所有 `.qv2-*` 选择器**：~60 行 CSS 清掉，oklch declaration 数从 797 回到 774。代码路径只剩一个真相源，无回滚负担。
  - **后端 `/api/qualifications/visual` 不动，无 schema 改动**。

- **资质可视化 tab 重设计**（Step 7）：~~解决"机构名重复占位 + CMA/CNAS 分两列被截 + 标准号埋在卡头不显眼"三个 UX 痛点。~~ 设计被用户认为太花哨，Step 8 推翻重做。
  - **机构名提到顶部 stats 栏**：所有结果卡片不再重复显示机构名。stats 栏从 4 列网格扩到 6 列（用 `:has(.qv2-lab-pill)` 选择器），右侧加一格"检验机构"卡片，单机构显示全名、多机构显示数量 + hover 全名 tooltip。
  - **标准号成为视觉主体**：每个 stdCode 一张独立卡片，stdCode 用 `DM Mono 16px 700` 大字显示，右侧贴年份徽章。当用户搜的关键词带年份且与 stdCode 年份不一致时，徽章变橙色 ⚠ + 卡片边框虚线半透明（视觉提示"这是跨年兜底命中"）。
  - **CMA/CNAS 改为能力行头徽章**：不再分两列。同 stdCode 下所有能力扁平列出，每行最前面一个圆点 + 源名小徽章。能力排序：未过期 > 过期 → CMA > CNAS → testItem 字母序。同 query 内 stdCard 排序：与输入同年优先 → 能力多优先 → stdCode 字母序。
  - **能力行紧凑两行**：第一行 testItem（主信息），第二行 `category · limit 截断到 24 字 · 生效~到期`。限制超长鼠标 hover 看全文 tooltip。过期记录整行 0.62 透明 + 日期红色。
  - **类名 `.qv2-*` 与旧 `.qual-visual-*` 隔离**：旧 CSS 完全保留，新 markup 不命中老选择器；回滚只需把 `renderQualVisual` 函数体换回，CSS 留着不用清。
  - **新增 23 条 oklch declaration**，全部走 sRGB hex / rgba fallback；`npm run oklch:check` 797/797 通过。

- **资质匹配 Step 6 — 抓取侧清洗 + 搜索归一化 LIKE + 旧数据 fixup**：解决"资质查询页搜片段 `3325-` 匹不上 CNAS 脏空格变体"的问题，把 Step 1-5 没覆盖的最后一类场景闭掉。
  - **抓取入库清洗**：`src/shared/std-code.ts` 加 `cleanStdCode(raw)`，只折叠"年份连字符附近的多空格"，不动前缀大小写和 `/T`。`syncCnasLab` / `syncCmaLab` INSERT 前调一次，CNAS 写出的 `'GB/T 3325 -2024'` 一进 DB 就变成 `'GB/T 3325-2024'`。
  - **搜索归一化 LIKE 兜底**：`searchQualifications` WHERE 增加 `std_code_norm LIKE ? OR std_code_base LIKE ?` 两条分支，query 也跑一遍 extractFullCode/extractBaseCode 后做子串。用户搜 `'3325-'` → extractFullCode 算成 `'3325-'`，`'GB3325-2024'` 含 `'3325-'` 命中 ✓。彻底闭掉"片段查询遇上脏空格"的盲区。
  - **旧数据一次性 fixup**：`db.ts::fixupDirtyStdCodes` 启动检测 `std_code LIKE '% -%' OR '%- %'` 的行，JS 侧用 `cleanStdCode(x) !== x` 精筛后原地 update + 重算 norm/base。幂等：清洗过的行下次启动不再被处理。老用户升级后不用手动重抓 CNAS。
  - **测试**：6 个 `cleanStdCode` 单测（脏空格变体 / 前缀保留 / 多空格 / trim / 修订标记 / 幂等）+ 1 个 `searchQualifications` 片段查询回归测试。29 个纯函数测试本地全过。
  - **CLAUDE.md 契约更新**：归一化契约改成"`cleanStdCode → extractFullCode → extractBaseCode` 三层防御"。

- **资质匹配严谨度大改**（5 步）：解决"匹配能跑但担心不严谨"的系统性隐患，把所有入口收敛到归一化列索引等值查询。
  - **Step 1 — 归一化函数扩展 + 拆分**：`src/shared/std-code.ts` 抽出 `preNormalize` / `extractFullCode` / `extractBaseCode`（脱离 `qualification-service.ts` 避免 db.ts 循环依赖）。新增 prepass 覆盖全角数字/字母/空格/破折号、ISO 冒号年份分隔符 (`ISO 4287:1997` → `ISO 4287-1997`)、无空格变体 (`GB/T3325-2024`)、修订标记 (`2010A`)。`extractFullCode` 保留年份用于精确匹配，`extractBaseCode` 剥年份用于跨年模糊兜底。
  - **Step 5 — 徽章 tooltip 标注命中年份**：`public/js/app-qual.js` 给跨年命中加 ⚠ 视觉标记。当 source 下所有命中行的年份都与用户搜的不同时，徽章本体加 `.qual-badge-cross-year`（虚线边框 + 半透明）+ ⚠ 小图标；tooltip 每条命中行也显式标"仅匹配到 XXXX 版"。`web/src/styles/pages/qualifications.css` 加配套样式 + oklch fallback。
  - **Step 2-3 — DB schema 加归一化列 + 重写 queryByStdCodes**：`cnas_qualifications` / `cma_qualifications` 加 `std_code_norm` (extractFullCode) + `std_code_base` (extractBaseCode) 两列与 B-tree 索引；`db.ts::migrate()` 检测列不存在时自动回填（分块 1000 行/事务，幂等）。`queryByStdCodes` 老 Phase 1 (`std_code IN (...)`) + Phase 2 (LIKE `prefix%digits%` + LIMIT 2000 + JS 端 base 比对) 共约 100 行替换成两条 `std_code_base IN (?, ?, ?)` 索引等值查询，O(log N)，再无 LIMIT 截断风险；同时彻底消除"用户搜 3325 误命中 33325"五位数字号边界 case（base 列 `GB3325 ≠ GB33325`，不进结果集）。
  - **Step 4 — 资质查询页修脏数据 bug**：`searchQualifications` 老纯 LIKE 子串匹配匹不到 `'GB/T 3325 -2024'` 这种 CNAS 抓取脏空格变体（中间空格断了 `'%GB/T 3325-2024%'`）。改成 `std_code_norm = ? OR std_code_base = ?` 与 LIKE 兜底 OR 起来，闭掉这条未爆 bug。`queryVisualKeywords` 内部复用 `searchQualifications`，一改全闭。
  - **管理诊断接口加强**：`GET /api/admin/qual/diagnose` 增加 `normColumnHit` / `baseColumnHit` 字段，对比 DB 列里实际落盘的归一化值与即时算出的值，老数据回填异常一眼可见。
  - **测试**：`qualification-service.test.ts` 新增 8 个 case 覆盖全角/无空格/ISO 冒号/修订标记/跨年模糊/五位数字号防误命中/搜脏数据 4 类场景；老回归 case `finds GB/T 3325-2024 even when...` 升级 schema 加归一化列。`extractBaseCode` / `extractFullCode` / `buildFuzzyLikePattern` 共 23 个纯函数单测全过。
  - **风险与回滚**：列加迁移是 additive 改动，不删旧 `std_code` 列；旧行回填日志会打 `[db] backfilled N rows`。`buildFuzzyLikePattern` 保留 export（诊断接口仍用），未来确认稳定后再清。

- **预览自动下载 Phase 3 polish**：解决连点 / 失败重试 / 长下载体验三个痛点。
  - **按 (stdCode, year) 去重 taskId**：`src/services/preview-task-store.ts` 给每个任务存一个 normalized key（`stdCode.toUpperCase().replace(/[^A-Z0-9]/g,'') + '::' + year`），新增 `findActiveTaskByKey()` 在 createTask 之前查活跃任务（仅 pending / downloading 算活跃）。`preview-routes.ts` 的 `not_in_library` 分支调用它 → 若有活跃任务直接复用 taskId 并返回 `{ reused: true }`，不再 fire-and-forget 第二个 `runAutoDownload`。覆盖两类场景：用户连点 5 次预览 / 先点下载再点预览同一标准。
  - **失败 UI 加「重试」按钮**：`public/js/app-search.js` 的 `pollPreviewTask` 失败分支抽出 `renderPreviewFailedUi()`，渲染「重试」+「关闭」两个按钮。重试点击 → abort 旧 poll → 重新调 `previewStandard(_previewLastId)` 走完整 `/api/preview/request` 流程；后端 dedup 兜底，若旧任务还活着复用、否则起新任务。
  - **取消 3 分钟前端超时**：`pollPreviewTask` 的 `while (Date.now() < deadline)` 改成 `while (!ctrl.signal.aborted)`，前端只在 ready / failed / 用户关闭 / 重试时停 poll。后端任务无 deadline，仅靠 preview-task-store 的 10 分钟无更新 TTL GC 作兜底（GC 命中后轮询接口返 404，前端当作 failed 处理弹「重试」UI）。
- **标准 PDF 预览 Phase 2：自动下载 + 入库 + 文件夹监听**。
  - **下载即入库（单路径）**：以前下载先落 `data/exports/` 然后 14 天清理；现在直接 `fs.rename` 进 `standards_library_dir`，按 admin 模板（`{stdCode} - {SOURCE}.pdf` 之类）命名并 UPSERT 索引。`data/exports/` 已不再放 PDF，仅留补全功能输出的 xlsx 报表，**不再有 14 天自动清理**（标准永久保留）。`src/shared/fs.ts` 删除 `cleanupOldExportFiles` 和 `DEFAULT_EXPORT_RETENTION_DAYS`。
  - **入库 hook 抽出**：`src/services/download-to-library.ts` 暴露 `moveDownloadToLibrary(db, sourceRegistry, source, standardId, result)`，给 `auto-download` / `multi-download` / preview 自动下载共用。`addFileToLibrary` 改用 `fs.rename`（跨卷 EXDEV/EPERM/EACCES 时 copy+unlink 兜底）+ 文件名冲突 `(1)`、`(2)` 后缀去重。
  - **文件名模板引擎**：`src/services/library-naming.ts` 提供 `renderLibraryFilename(pattern, ctx)`，支持 `{stdCode} {source} {year} {title}` 占位符。空值与相邻分隔符（空格/`-`/`_`/`·`/`—`）会被吞掉，结尾不会留下"GB 3324-2024 -.pdf"这种悬空连字符；非法路径字符 `\/:*?"<>|` 一律清成空格；总长截到 200 字符避免触发 Windows 260 字符路径上限。`admin-routes` zod schema 强制模板必须包含 `{stdCode}`，否则不同标准会落同一个文件名互相覆盖。
  - **/api/downloads 兼容 library**：`GET /api/downloads` 现在 union exports（xlsx）+ library（PDF）两类条目，library 条目带 `fileId` / `previewUrl` / `downloadUrl: /api/preview/file/:id?attachment=1` / `kind:'library'`；`GET /api/downloads/:filename` 走 exports 找不到时回退按 basename 查 standard_files 索引，旧前端 `triggerDownload(fileName)` 不必同步改。
  - **chokidar 文件夹监听**（默认开）：用户把 PDF 拖到库目录立刻入索引，无需重扫。`startLibraryWatcher` 在 `app.ts` 启动时根据 `library_watcher_enabled='1'` 自动起；admin 设置页加「文件夹监听 ☑ 启用」开关（OneDrive/NAS 抖动场景可关）；切换 watcher / 改库目录 / 触发重扫都会重启 watcher 跟上新路径。`awaitWriteFinish: { stabilityThreshold: 1500ms, pollInterval: 200ms }` 防大文件写一半就入库。
  - **预览自动下载 + poll**：`POST /api/preview/request` 未命中本地库时不再直接报 `not_in_library`，而是后台触发自动下载（按 admin 配置的 source 优先级依次尝试）+ 入库，立即返回 `{ status: 'downloading', taskId }`；新增 `GET /api/preview/task/:taskId` 让前端轮询（1500ms 间隔，3 分钟超时上限）。任务跑完返回 `{ status: 'ready', fileId, url }`，前端切 iframe 加载。所有源都失败 → `{ status: 'failed', error }`，弹"自动下载失败"提示。
  - **数据库默认值**：`src/services/db.ts` qualDefaults 新增 `library_watcher_enabled='1'`、`library_filename_pattern='{stdCode} - {source}'`、`library_source_priority='["gbw","bz","by"]'`。
- **标准 PDF 预览（Phase 1）**：搜索结果卡片新增「预览」按钮，命中本地库时即时打开内嵌 PDF 阅读器；未命中时弹"先下载再预览"提示，**不自动触发下载**（自动下载留到 Phase 2）。
  - 新表 `standard_files (id, std_code_norm, year, source, abs_path, size, mtime, mime, indexed_at)` + 唯一约束 `(std_code_norm, year, source)`；多源同号通过 source 后缀文件名（`GB_T 3324-2024 - BW.pdf`）共存，索引唯一键避免相互覆盖。`src/services/db.ts`
  - 新模块 `src/shared/library-paths.ts`：库路径解析 + 写入探针 + 回退。默认 `<exe同级>/standards/`，**刻意不放 C 盘 userData**（避免长期占用 C 盘）；用户装在 Program Files 时探针失败 → 回退 `userData/standards` 并在管理员设置页打"⚠ 已临时回退"banner。Electron 主进程 `electron/main.ts` 新增 `BZXZ_EXE_DIR` / `BZXZ_USER_DATA_DIR` 环境变量喂给后端。
  - 新模块 `src/services/library-index.ts`：扫描 + 增量索引（按 mtime+size 比对，未变即跳）+ 命中清理（fs.access 失败的行即时删）+ source-priority 查询。文件名规则 `{stdCode} - {SOURCE}.pdf`，源后缀**永远写入**（决策见 docs/ARCHITECTURE）。
  - 新路由 `src/api/preview-routes.ts`：
    - `POST /api/preview/request`：查本地库，命中返回 `{status: 'ready', fileId, url}`；未命中返回 `{status: 'not_in_library', tried}`。源优先级支持请求级 override，缺省读 settings.library_source_priority。
    - `GET /api/preview/file/:id`：流式回 PDF，**完整 HTTP Range 支持**（含 suffix range `bytes=-N`）+ ETag（`W/"{size_hex}-{mtime_hex}"`，避免每次跑 hash）+ 304 / 416 / 410（库根改了之后旧索引行残留指向库外的 410 GONE）。Content-Disposition 走 RFC 5987 让中文名直接显示，`?attachment=1` 强制另存。
  - `src/api/admin-routes.ts` 扩展：`GET /admin/settings` 现在带 `library: { dir, writable, fallbackUsed, fallbackReason, indexCount, lastIndexedAt }`；`PUT` 新支持 `standardsLibraryDir` / `libraryFilenamePattern` / `librarySourcePriority` 三字段，路径变更触发 fire-and-forget 全量重扫；新增 `POST /admin/library/rescan`。
  - 启动钩子：`src/api/app.ts` 进程起来后异步增量扫描一次（fire-and-forget），磁盘上手动加的 PDF 也能立刻被预览查到。
  - 前端：`public/index.html` 加 `#previewOverlay` 全屏预览层（iframe + 头部下载/新标签/关闭按钮）；`public/js/app-search.js` 加 `previewStandard(id)` + 卡片「预览」按钮 + 右键菜单条目 + Esc/点遮罩关闭；`public/js/app-settings.js` 加 admin-only「标准库」section（路径配置 + 索引计数 + 一键重扫 + fallback banner）。
  - CSS：`public/styles.css` 末尾新增预览 overlay 与库设置卡片样式；`web/src/styles/components/preview.css` 镜像新增，按 dual-stylesheet 契约同步加载。
  - 安全要点：所有路径走 `isInsideLibrary()` 做"绝对路径必须落在库根之内"二次校验，防扫描跟随 symlink 把库外文件纳入索引；`requireAuth` 与搜索口径一致（含 guest）。
- 用户管理新增「允许局域网游客」开关（默认关）：原先 `loginRequired=0`「开放桌面模式」下，guest 回退只对 loopback 客户端（`127.0.0.1` / `::1`）放行，LAN 上的手机和同事 PC 仍被 `auth-middleware.ts:requireAuth` / `auth-routes.ts:/status` 强制要求登录 —— 这是安全默认值，防止"随手关了需要登录"后整个 Wi-Fi 的人都匿名进来。新开关给"完全可信内网"场景一个逃生口：开启后 LAN 客户端也获 guest 回退，账号体系对 LAN 失效。UI 在「用户管理 → 顶部工具条」第三个 checkbox，开启时弹 confirm 弹框显式确认风险（橙色 toast）。
  - 后端：`src/api/admin-routes.ts`（settings GET/PUT 加 `lanGuestAllowed`）+ `src/api/auth-routes.ts:89`（`effectiveLoginRequired` 公式纳入新设置）+ `src/api/auth-middleware.ts:108`（`requireAuth` 卡口纳入）
  - 前端：`public/index.html` 加 `#lanGuestAllowedToggle` + `public/js/app-auth-admin.js` 加 populate 与 `toggleLanGuestAllowed()` confirm 流程

### Changed
- **手机端资质查询：隐掉「可视化」tab + 标准号头点击直跳「标准搜索」**
  - **隐 tab**：`public/styles.css` 与 `web/src/styles/responsive.css` `@media (max-width: 640px)` 块新增 `body:not(.force-desktop) .qual-tab[data-qual-tab="visual"] { display: none; }`，并去掉只剩 1 个 tab 时多余的 `tab-bar` 底线。窄屏下可视化矩阵一列摊开无密度优势，搜索 tab 单独够用；想看可视化的切「桌面版」即可。
  - **点击直跳标准搜索**：`public/js/app-qual.js` 抽出 `onQualGroupClick(gid, code)` 替换原 `toggleQualGroup` onclick。手机端（≤640px 且未切桌面版）点资质结果里的标准号头 → `switchTab('search')` + 预填 `#searchInput` + 自动 `doSearch()`；桌面端保留 expand/collapse 不变。Why：窄屏用户在资质页看到标准号，下一步几乎一定是「去搜它能不能下到」，强制先展 5 行检测项目再去复制粘贴属于多此一举。

### Fixed
- **NSIS 升级会把本地 `standards/` 标准库整目录删掉**：用户报告升级后 `G:\bzxz\standards` 下几十 GB 已下载 PDF 全没了。
  - **根因**：`build/installer.nsh` 之前只把 `$INSTDIR\data`（资质数据库）做了 backup-rename-restore 保护，PDF 库目录 `$INSTDIR\standards`（默认库路径 `<exe 同级>\standards`）落在 NSIS `RMDir /r "$INSTDIR"` 扫荡范围里直接被清空。electron-builder 升级时静默调用旧版卸载器 → 不弹任何询问 → 整库蒸发。
  - **修**：`build/installer.nsh` 给 `standards/` 加同款 backup-rename-restore（同卷 Rename 是元数据操作、几十 GB 也是瞬时完成）。standards 默认**始终保留**、不弹询问、不接受 `IDNO`（PDF 体量大、误操作代价高，想真正清掉走资源管理器手删）。`data/` 的弹窗保留旧逻辑、文案里加一句提示 standards 始终保留。

- **标准检索 CNAS 资质徽章漏命中（GB/T 3325-2024 等）**：搜索 `3325-2024` 时 `GB/T 3325-2024` 显示无 CNAS 资质，实际数据库里有。
  - **根因**：`queryByStdCodes` 的 Phase 2 模糊回退用 `q.std_code LIKE 'GB%' + LIMIT 500` —— CNAS 表里 `GB` 前缀几万条，目标行 `'GB/T 3325 -2024'`（含 scraper 残留空格）常被 LIMIT 截在窗口外，JS 端 `extractBaseCode` 严格判等就拿不到候选行。Phase 1 精确 `IN` 又因为入参是干净的 `'GB/T 3325-2024'`、DB 里是带空格变种而错过 → 两路都漏。
  - **修**：`src/services/qualification-service.ts` 抽出 `buildFuzzyLikePattern(base)`，把 `extractBaseCode` 输出再拆成 `(prefix, digits)`，拼成 `'GB%3325%'` 这种「字母前缀 + 数字尾巴」紧 LIKE，命中收敛 ~100×；同时 `LIMIT` 提到 2000、加 `ORDER BY rowid` 让结果稳定。安全侧 prefix 强制 `/^[A-Z]+$/` 且 ≤ 8 字符、digits 走白名单 `[A-Z0-9]` 过滤并截到 16 字符，杜绝 `%` / `_` 注入扩成全表扫描的 DoS 向量。
  - **回归测试**：`qualification-service.test.ts` 新增 `buildFuzzyLikePattern` 7 个单元用例 + 1 个端到端用例（in-memory SQLite 灌 800 条无关 GB 行 + 1 条目标行，验证 `GB/T 3325-2024` 命中）。

- **BZ 下载失败 `Cannot find package 'pdf-lib' imported from app.asar.unpacked/dist/src/shared/pdf-merge-worker.js`**：
  - **根因**：`pdf-merge-worker.js` 在 `asarUnpack` 名单里，被 electron-builder 抽到 `app.asar.unpacked/dist/src/shared/`；运行时 Node 从该路径走 `node_modules/pdf-lib` 解析，逐级向上找却落不到 `app.asar/node_modules/pdf-lib` —— asar 外的目录不会回 hop 到 asar 内部去找包。worker_threads 子线程在 dev `tsx`/`tsc-then-electron` 跑时都能命中（`node_modules` 是真目录），打包后才暴露
  - **修**：`package.json` `build.asarUnpack` 额外加 `node_modules/pdf-lib/**/*`、`node_modules/@pdf-lib/**/*`、`node_modules/pako/**/*`、`node_modules/tslib/**/*`（pdf-lib 的 3 个 prod 依赖），让 worker 在 `app.asar.unpacked` 下能正常向上解析。worker 文件本身已经在 asarUnpack 里，主进程 `await import('pdf-lib')` 走的是 asar 内部解析，不受影响
- 手机端 `#toolbar` 整条隐藏（两行：已选/下载选中/停止/全选 + 收藏徽章/只看收藏/紧凑/导出结果）：上一轮把复选框去掉后这两行只剩观感、按不到任何东西，仍占两行空间用户要滑过才看到结果。"只看收藏"在折叠筛选条里已经有同等入口（`data-filter-toggle="saved"`）不丢功能；批量下载 / 导出 / 密度切换在手机端不常用，要的用户走"切换到完整版"。`public/styles.css` §11 + `web/src/styles/responsive.css` 同步。用 `!important` 是因为 `updateToolbar()` 主动写 inline `style.display='flex'`，普通类选择器压不过 inline style
- 老浏览器（Win7 Chrome ≤109、Win7 Edge、老版 Safari）打开 Web 端整个 UI 变白底黑字、按钮没颜色没边框、阴影/半透明边框全丢：根因是整套 CSS（`:root` 核心变量 + 散布在选择器里的硬编码颜色）用 `oklch()` 定义，oklch 要 **Chrome 111（2023-03）/ Firefox 113 / Safari 15.4** 起才支持，Win7 上 Chrome 官方最高只到 109 装不上 111+，每条带 oklch 的 declaration 整条失效 → 主题崩溃。
  - **修**：双声明套路，每条 `xxx: oklch(...)` 前面注入一条等价的 `xxx: #RRGGBB` 或 `xxx: rgba(R,G,B,a)` fallback。旧浏览器解析 oklch 失败丢弃后一条、保留前面 hex；新浏览器两条都解析、cascade 后者赢、像素级一致
  - **覆盖**：用 `scripts/css-oklch-fallback.mjs` 一次性扫 `public/styles.css` + `web/src/styles/**/*.css`，34 个文件、773 条 oklch declaration 全部就地插入 fallback。脚本幂等可反复跑、有 `--check` 模式给 CI / PR 守门
  - **算法**：OKLCh → sRGB 走 CSS Color Module Level 4 的 OKLab → LMS³ → 线性 sRGB → gamma 编码；oklch 色域大于 sRGB 的高 chroma 值做 gamut mapping（保持 L 和 h 不变，二分搜索 sRGB 内最大 C），避免单通道独立 clamp 引起的偏色
  - **工作流**：写新 oklch → 跑 `npm run oklch:fix` → CI 用 `npm run oklch:check` 拦未配对
  - **验证**：F12 Console 跑 `CSS.supports('color', 'oklch(50% 0 0)')` 在 Win7 Chrome 上返 `false`，在新版返 `true`；computed style 上各色变量两边都能拿到合理值
- 手机端标准搜索结果筛选条默认折叠：原来 `.filter-bar` 包含源 chips + 状态 chips + 3 个 toggle + 排序下拉，手机窄屏折行后能占 4–5 行，用户每次搜完都要先滑过这一坨才能看到结果。
  - JS：`public/js/app-search.js:renderFilterBar()` 把原内容包进 `<div class="filter-bar-body">`，前面加一个 `<button class="filter-collapse">筛选 ▾ <count></button>` 折叠按钮；按钮上的徽章实时显示激活筛选项数（source/status 各算 1 + 三个 toggle 任一开各 1）；新增 click handler 切 `.filter-bar.open`，`aria-expanded` 同步给屏幕阅读器
  - CSS：桌面默认 `.filter-collapse { display:none }`、`.filter-bar-body { display:contents }`（子项继续直接参与 `.filter-bar` 的 flex 排版，桌面视觉零回归）；手机 ≤640px 块反过来：按钮 `display:inline-flex`、body 默认 `display:none`、`.open` 时 `display:flex` flex-wrap。`public/styles.css` + `web/src/styles/components/filter-bar.css` + `web/src/styles/responsive.css` 三处同步
- 手机端标准搜索结果卡片不够紧凑（原来 9 行：复选框 / 标准号 / 标题 / 推荐性 / state / source / 资质徽章 / 时间 / 按钮）：用户反馈"复选框单独占用一行"。重构成 5 行：标准号 / 标准名 / **标识合并行（state + 文本状态 + 源 + CMA/CNAS 资质徽章 同行 flex-wrap）** / 时间 / 4 按钮等宽平铺。
  - JS：`public/js/app-search.js` 渲染时在 `.card-source-line` 后新增 `.card-meta-line` div，把 statusBadge / textBadge / srcBadges / `qualBadgeHtml()` 揉成一行；资质徽章在桌面端原位（`.card-title-row` 内）仍渲一份，手机端靠 `display:none` 切换 —— 双 template 维护成本最低
  - CSS：`public/styles.css` + `web/src/styles/components/result-card.css`（桌面默认 `.card-meta-line { display:none }`）；`public/styles.css` §11 + `web/src/styles/responsive.css` ≤640px 块（手机端隐藏 `.check-col` / `.card-subtitle`（推荐性标签）/ `.card-title-row .qual-badges` / `.card-state` / `.card-source-line`，显示 `.card-meta-line`，把 `.card-title-row` 回到 row 方向，`.card-body` 解除 `-webkit-line-clamp:2`）
  - 按钮行：`.card-actions` 在手机端 `display:flex; gap:6px; flex-wrap:nowrap`，4 个按钮（收藏/详情/预览/下载）`flex: 1 1 0; min-width:0; min-height:44px; padding:8px 4px; font-size:13px` —— 等宽平铺撑满卡片宽度，触控热区 44px 达标
- 设置页「内置 Web 服务」URL 行 label 列对齐问题：本机行只有"本机"两字（一行），内网行是"内网 📱 手机版"（带圆角徽章，宽度远超 42px），但 `.web-access-url-row` 的 `grid-template-columns: 42px ...` 把 label 列硬钉在 42px，徽章塞不下被强制换行 → "内网"一行 + "📱手机版"徽章另起一行 → 本机行高 1 行、内网行高 2 行，URL 跟左侧 label 视觉错位。修：第 1 列改为 `auto`（grid 自动取整列最大宽，所有行 label 列等宽），同时给 `.web-access-url-row > span` 和 `.web-access-phone-hint` 加 `white-space: nowrap` 防内部"📱"和"手机版"在窄屏被拆。`public/styles.css` + `web/src/styles/components/toggle-switch.css` 双栈同步
- 手机端标准检索结果卡片"从中间开始、左边像分列了却空着"（同一列表里有些卡片显示正常、有些异常）：
  - **根因**：`public/styles.css` 行 902-910（≤900px 块）把 `.result-card` 定成 `grid-template-columns: 24px minmax(0, 1fr)` 二列网格，并把 `.card-id` / `.card-body` / `.card-state` / `.card-source-line` / `.card-date` / `.card-actions` 全部钉死 `grid-column: 2`；行 1004-1005（≤640px 手机块）又把网格改回 `grid-template-columns: 1fr` 单列，但**没有同步重置子项的 `grid-column: 2`**。单列网格里子项要求位于第 2 列 → 浏览器创建隐式列轨道把内容放到右边，显式 `1fr` 列空着 → 视觉上"左边像有列却空着"。
  - **为什么时好时坏**：每个卡片渲染哪些子项不一样（有的有 `card-state`、有的没有 `card-actions`），隐式列的宽度由内容撑出来，因此同一列表里会出现"宽窄不一、偏移程度不同"的混合现象 —— 视觉上像 bug 只命中部分卡片。
  - **修**：在 ≤640px 块加 `body:not(.force-desktop) .result-card > *, .batch-result-card > * { grid-column: auto; }`，让所有子项回到显式单列的自然流。`public/styles.css` §7
  - web 端 (`web/src/styles/responsive.css`) 的 ≤640px 块没有 `.result-card` 1fr 重写规则（沿用 ≤900px 的二列网格 + checkbox 占第一列），所以 web 端不受影响。如果以后 web 也加 ≤640px 单列重写，记得同步带上 `grid-column: auto` 重置。
- 登录会话很快被踢出（桌面 / Web / 手机三端通病）：表面看 `SESSION_MAX_AGE_MS` 已经是 **30 天**，但有两个隐藏 bug 让有效时长远小于 30 天。
  - **Bug 1（关键）：续期只刷 DB，不重发 Cookie。** 原 `auth-middleware.ts:148-152` 滑窗逻辑只 `UPDATE sessions SET expires_at = ?`，浏览器侧 Cookie 仍按首次登录时的 30 天 `Max-Age` 倒计时，到点自己删 —— 用户体感是"明明天天用，怎么 30 天后就让我重登"。修复：续期时同步 `res.setHeader('Set-Cookie', cookieOpts(token))`，DB 和 Cookie 一起滑窗。
  - **Bug 2：续期只在「需要登录」分支跑。** 「开放桌面模式」分支（`!isLoginRequired()`）原本压根不续期，桌面端一旦设置了"无需登录"且 LAN 客户端登录，30 天后被踢。修复：两条分支都调用同一个 `maybeRenewSession()`。
  - **Bug 3：续期阈值过苛。** 原本"剩余 < 1 小时"才触发续期，意味着 29 天 23 小时内的所有访问都不续。改为"剩余 < SESSION_MAX_AGE_MS / 2"（半个周期），即只要每 15 天上线一次就永不掉线。新增 `SESSION_RENEW_THRESHOLD_MS` 常量。
  - **重构副产物**：`SESSION_MAX_AGE_MS` 和 `cookieOpts()` / `clearCookieHeader()` 抽到新文件 `src/api/session-cookie.ts`，消除 `auth-routes.ts:16` 与 `auth-middleware.ts:67` 两份硬编码，避免今后再被偷偷改成不一致的值。`auth-routes.ts` 现在从共享文件 import。
- 手机端「资质查询 → 搜索」子标签点不动：`app-qual.js:switchQualTab()` 第 16 行原先有 `if (isMobile()) tab = 'visual'` 的硬重定向，按钮在 DOM 里、click handler 触发了，但被函数顶部强制改写成 visual，外观上像"点了没反应"。注释还写"搜索子标签 UI 隐藏（见 styles.css）"但 CSS 里实际上根本没藏。去掉重定向，两个子标签现在都可用。初版"手机端只保留可视化"的规划同步修订到 `docs/MOBILE_ADAPTATION.md §5.5`。
- 手机端两处排版收敛：
  - **标准检索结果卡片**：原来标题与 CMA/CNAS 资质徽章挤在同一 flex 行（`.card-title-row`），长标准名截断时徽章会被推开变形，BW/BZ/BY 源标签也会和徽章错位。手机模式（≤640px）下把 `.card-title-row` 改成 column 方向 —— 标准名独占一行，资质徽章另起一行贴左对齐，`card-body` 的 `-webkit-line-clamp:2` 在手机端解除以容纳徽章行。`public/styles.css` §11
  - **资质查询结果分组头**：原来 `.qual-result-std` 是单行 flex（▶ + 标准号 + 标准名 + N项），手机窄屏挤不下会让标准号被强行折行（例如 `GB/T 3324-2017` 被拆成 `GB/T 3324-` / `2017`）。手机模式下加 `flex-wrap: wrap` + `.qual-std-name { flex: 1 1 100%; padding-left: 22px; }`，让标准名落到第二行与标准号对齐缩进，N项 spani 保持在第一行右侧。CMA / CNAS 左右两栏（`.qual-results-grid`）保持不变，仅 gap 收紧。`public/styles.css` §12
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
