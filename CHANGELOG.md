# Changelog

## [Unreleased]

### Added / Changed
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
