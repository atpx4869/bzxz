# bzxz 架构约定

> 本文档记录代码层的约定，新加功能时按这些规则放——避免再一次"多 AI 多次拼凑"的混乱。
> 与代码不一致时，**以代码为准**，但应该有人来更新这份文档。

---

## 一、API 响应壳 (Result Envelope)

所有 JSON API 端点统一返回 `{ data, error }` 壳，定义在 `src/shared/response.ts`：

```ts
type ApiResult<T> =
  | { data: T;    error: null }
  | { data: null; error: { code: string; message: string; details?: unknown } }
```

**写后端时**：永远走 `respond(res, payload)` / `respondError(res, status, code, message, details?)`，**禁止直接** `res.json(...)` 或 `res.status(N).json(...)`。

**写前端时**：从 fetch 拿到响应后用 `readApiResponse(res)` 解包，它会自动取 `data` 或把 `error` 字段透出。

**SSE/流响应**：每条 `data:` 行也用同样的壳（`{ data: T, error: null }` 或 `{ data: null, error: {...} }`），客户端用同一解包路径。

**例外**：文件下载（`/api/downloads/:filename`）、静态资源、`GET /` 不走 Result 壳——它们不是 JSON。

---

## 二、命名风格

| 边界 | 风格 | 原因 |
|------|------|------|
| 数据库（SQLite 列） | `snake_case` | SQL 惯例，`lab_no`、`created_at` |
| Service 层方法/属性 | `camelCase` | TypeScript 惯例 |
| API 请求体字段 | `camelCase` | 客户端契约 |
| API 响应体字段 | `camelCase` | 客户端契约 |
| 前端 JS 标识符 | `camelCase` | JS 惯例 |
| localStorage 键名 | `snake_case` 前缀 `bzxz_` | 与 DOM/Web 习惯一致 |

**转换边界**：
- DB → API：路由层用 `toCamelCase(...)` 包装（`src/shared/case.ts`）
- API → DB：路由层用 `toSnakeCase(...)` 把请求体喂给 service（zod schema 也用 camelCase）
- service 层本身不关心 snake/camel——它接受什么形态由路由决定

---

## 三、路由前缀

按"资源族 → 子资源"分层。**功能上同族的，URL 也要同族**：

```
/api/auth/*               用户认证（登录、注册、会话、改密）
/api/admin/*              管理员（用户管理、全局设置）
/api/stats/*              使用统计

/api/standards/*          标准检索、详情、预览、下载
/api/standards/:id/...
/api/download-sessions/*  下载会话（验证码流程）
/api/tasks/*              异步任务进度

/api/qualifications/*     资质能力（CNAS / CMA 统一族）
  /search                 资质搜索
  /batch-query            批量按标准号查
  /visual                 可视化批量查
  /settings               同步设置
  /stats                  统计
  /labs/cnas              CNAS 实验室订阅 (GET/POST)
  /labs/cnas/:labNo       (DELETE/PUT)
  /labs/cnas/sync         (POST)
  /labs/cnas/sync-logs    (GET)
  /labs/cma               CMA 同上
  /labs/cma/search        CMA 候选机构搜索
  /links                  CNAS↔CMA 关联
  /links/:source/:id      (DELETE)

/api/downloads*           导出文件列表/下载/删除
/api/health               健康检查
```

**Legacy aliases**：旧路径（`/api/cnas/labs`、`/api/cma/sync`、`/api/qualification-links/*`）在 `src/api/app.ts:legacyRouteAlias` 中央 rewrite 表里透明转发到新路径，下个大版本删除。**新代码不要写旧路径。**

---

## 四、错误处理

后端 3 条路径合一：

1. **请求验证**：抛 zod 错误，`normalizeError` 转 `BadRequestError`，被全局错误中间件捕获 → `{ error: { code: 'BAD_REQUEST', ... } }`
2. **业务约束/找不到**：直接 `throw new BadRequestError(msg)` / `throw new NotFoundError(msg)` / `throw new UpstreamError(msg)`（定义在 `src/shared/errors.ts`）
3. **意料外异常**：被全局错误中间件捕获 → `{ error: { code: 'INTERNAL_SERVER_ERROR' } }`

**禁止反模式**：把业务"失败"塞进 HTTP 200（如 `res.json({ status: 'failed', ... })`）。失败就走 4xx/5xx + Result error。

前端：`readApiResponse(res)` 返回 `{ code, message, details? }` 时即表示失败，调用方做 `if (data.code) { ... }` 或读 `data.message` 直接显示。

---

## 五、三层配置存储

三层并存，各自的职责**严格不重叠**。新加配置项前看这张表：

| 层 | 存什么 | 范围 | 文件/位置 |
|----|--------|------|----------|
| **DB `settings` 表** | 全局策略、跨设备共享、需要权限管控 | 服务端全局 | `bzxz.db` |
| **localStorage** | UI 偏好、单机使用习惯、可丢失 | 单浏览器/单用户 | 浏览器本地 |
| **Electron `settings.json`** | 桌面集成（下载路径、开机启动、LAN 访问开关） | 单台设备的桌面客户端 | 用户数据目录 |

**怎么选**：

- 重启/换电脑/换浏览器后**必须保留** → DB
- 只影响当前看到的 UI（顺序、密度、面板位置） → localStorage
- 涉及 OS / Electron API（路径、注册表、托盘） → Electron settings.json
- 安全/管控相关（登录是否必填、注册是否开放） → DB（不能让前端 localStorage 篡改）

**禁止**：同一个语义存在两层。例如下载并发数：只放 localStorage（每用户独立），不要再在 DB 也存一份"默认值"。

**键名规范**：
- DB settings 表：`snake_case`（`qual_sync_cron`、`registration_enabled`）
- localStorage：`bzxz_` 前缀 + `snake_case`（`bzxz_priority`、`bzxz_download_mode`）
- Electron settings.json：`camelCase`（`downloadPath`、`webServiceEnabled`）—— JSON 是 JS 边界

---

## 六、源 (Source) 抽象

`SourceAdapter` 接口（`src/domain/standard.ts`）：
- 必选：`searchStandards`、`getStandardDetail`、`detectPreview`、`exportStandard`
- 可选：`createDownloadSession`、`submitDownloadCaptcha`、`getDownloadSession`、`autoDownload`

**各源能力不一致是业务本质，不是设计问题**：
- `gbw`：搜索 + 自动验证码 + 直接下载 PDF (`autoDownload`)
- `bz`：搜索 + 逐页 JPEG → pdf-lib 合并 (`exportStandard`)
- `by`：搜索 + 内网直链 PDF (`exportStandard`)

路由层调用时根据 `adapter.autoDownload`、`adapter.exportStandard` 是否存在选择路径——前端的 `/api/standards/multi-download` 已经做了这层路由。**不要为了"统一"强抽基类**——之前评估过，会产出空壳接口。

---

## 七、前端模块布局

`public/js/app-*.js` 8 个文件按固定顺序加载，**共享全局变量**（如 `currentUser`、`results`、`savedStandards`）。
**这不是 ES module，是依赖 `<script>` 顺序的全局拼装。** 不要尝试改 ES module 化——HTML 里 30+ 个 `onclick="fn()"` 内联调用全部依赖函数在全局作用域。

`window._tabCleanup` 是模块间唯一的协作约定：模块如果起了轮询/定时器，注册一个停止函数到 `window._tabCleanup.<name> = stopFn`，`switchTab()` 在切换前会统一调用。

`apiGet/apiPostJson/apiPutJson/apiDelete` 是新代码首选，自动解 Result 壳并抛 `Error`（带 `.code` / `.details`）。旧代码用 `fetch + readApiResponse` 兼容。

---

## 八、添加新功能的检查清单

写一个新 API 端点时：

- [ ] 路由路径符合「资源族 → 子资源」分层（见 § 三）
- [ ] 用 `respond()` / `respondError()` 输出（见 § 一）
- [ ] 请求体 zod schema 用 camelCase（见 § 二）
- [ ] 如果 service 返回 DB row（snake_case），路由出口用 `toCamelCase()`
- [ ] 错误抛 `AppError` 子类，不要 `res.status(...).json(...)`（见 § 四）
- [ ] 配置项放对层（见 § 五）

写前端调用时：

- [ ] 用 `apiGet/apiPostJson/...` 或 `fetch + readApiResponse`
- [ ] 起了 timer/poller？注册到 `window._tabCleanup`
- [ ] 字段名用 camelCase


---

## 九、并发架构（多用户场景）

> 服务推广到内网后会出现 N 个用户同时检索 / 下载 / 同步资质的情况。
> 这一节记录关键资源池的设计，新加耗时操作前先看这里——别再回退成全局 mutex。

### 1. CnasScraper 页面池（`src/services/cnas-scraper.ts`）

**问题**：CNAS 实验室同步走 Playwright，原先用 Promise 链 mutex 串行化，N 个用户排队等。

**方案**：共享 Browser + 每任务独立 Context/Page + 信号量。

- `openPage()` 复用同一个 browser，每个调用方拿到独立的 `Context` + `Page`
- 信号量 `maxConcurrent = 3`（CNAS 站点限速 + 内存占用平衡）
- `navigateToLab(page, labInfo)` 改为接收外部 page，由 caller 负责生命周期

**禁止**：在 scraper 外再加 mutex / Promise 链——会把并发吃光。

### 2. PDF 合成 Worker 池（`src/shared/pdf-merge.ts` + `pdf-merge-worker.ts`）

**问题**：`pdf-lib` 合成 1 个标准 ≈ 0.5–3s 纯 CPU，多人同时下载时主线程被钉死，API 响应停滞。

**方案**：`worker_threads` 池，JPEG 通过 `transferList` 零拷贝传给 worker。

- `POOL_SIZE = 2`（两个常驻 worker 保持热启动）
- `mergeJpegsToPdf({ jpegBuffers, outputPath, onProgress })`——`jpegBuffers` 的 ArrayBuffer 会被 detach
- 队列 + WeakMap 跟踪每个 slot 的 pending job
- Worker 启动开销 ≈ 50-100ms（pdf-lib 懒加载首次）

**Electron 打包注意**：worker_threads 不能从 `app.asar` 加载 `.js`。`package.json` 的 `build.asarUnpack` 拉出 `dist/src/shared/pdf-merge-worker.js`，`getWorkerEntry()` 把路径里的 `app.asar` 改写成 `app.asar.unpacked`。**改 pdf-merge 相关文件位置时必须同步这两处。**

**Shutdown**：`src/api/app.ts:shutdown()` 调用 `closePdfMergePool()` 让 worker 优雅退出。

### 3. Tesseract Worker 池（`src/sources/shared/captcha-ocr.ts`）

**问题**：tesseract.js 的 worker 不能并发 `recognize`，原先用 mutex 全局串行。

**方案**：`POOL_SIZE = 2` 池 + free 栈 + waiters FIFO 队列。

- `acquireTesseract()` / `releaseTesseract()`——经典的信号量模式
- 只在 ddddocr Python 子进程不可用时回退到 tesseract，所以 2 个 worker 够用

### 4. undici HTTP 连接池（`src/shared/http.ts`）

**配置**：`connections: 32, pipelining: 4`（per-origin）。

- 32 是经验值：源站点（如 bz / gbw / by）单 host 不容易触发限速，但又不会暴起耗本机端口
- pipelining=4 在 keep-alive 长连接上做请求复用——绝大多数源站 HTTP/1.1，pipelining 比建新连接便宜

### 5. ddddocr 子进程多路复用（`src/sources/shared/captcha-ocr.ts`）

ddddocr 是单 Python 进程，请求/响应通过 **UUID-keyed pending map** 多路复用：调用方塞一个 reqId 进 stdin，监听 stdout 收到同一 reqId 时 resolve。无锁，天然并发安全。

### 总览

| 资源 | 池大小 | 模式 | 触发场景 |
|------|--------|------|----------|
| CnasScraper Page | 3 | 共享 browser + 每任务 context | CNAS 资质同步 |
| PDF Merge Worker | 2 | worker_threads | bz 源逐页 JPEG → PDF 合成 |
| Tesseract Worker | 2 | tesseract.js 池 | 验证码 OCR（ddddocr 不可用时回退）|
| undici HTTP | 32/origin | keep-alive + pipelining | 所有外网 HTTP 请求 |
| ddddocr 子进程 | 1（多路复用）| UUID pending map | 验证码 OCR 首选 |

**加新的耗时操作前**：判断它是 CPU 密集还是 IO 密集，CPU → worker_threads 池；IO → 看是否已有 client 池可复用；都不是 → 先想想是不是真的需要锁。

## 十、标准库 / 预览模块（Phase 1）

> "下载 + 预览"两个看似独立的功能在底层其实共用一个本地 PDF 库。Phase 1 只接入预览（读路径），Phase 2 才会把下载流接进来（写路径），同一索引、同一目录、同一文件名规则。

### 数据模型

```
standard_files
├── std_code_norm  (extractBaseCode 归一后的标准号)
├── year           (从文件名末尾抽出，可空)
├── source         ('gbw' | 'bz' | 'by')
├── abs_path       (含 SOURCE 后缀的绝对路径)
├── size / mtime   (扫描时的 stat 快照，增量比对用)
└── UNIQUE (std_code_norm, year, source)
```

唯一约束的形状决定了"多源同号"的存储方式：**永远带源后缀**（`GB_T 3324-2024 - BW.pdf`），不靠 rename 策略，让两源能并存在同一目录而不互相覆盖。

### 路径解析（src/shared/library-paths.ts）

两级回退：

1. `settings.standards_library_dir`（用户配置）或默认 `<BZXZ_EXE_DIR>/standards/`
2. 探针失败 → `<BZXZ_USER_DATA_DIR>/standards/`（Windows Program Files 兼容）
3. 都不通 → 硬塞默认路径 + 把 `fallbackReason` 写进 LibraryStatus，管理员设置页打 banner

之所以**默认不放 C 盘 userData**：标准 PDF 体积大、长期累积，放 C 盘会鼓胀用户 OS 盘；放 exe 同级让用户自己挑装机盘（D / E）。

### 安全 (`isInsideLibrary`)

扫描和预览端点各做一次"绝对路径必须落在库根之内"校验，防 symlink 跟随把库外文件纳入索引。库根改了之后，旧索引行残留指向库外 → 直接 410 GONE + 删行，下次扫描重建。

### 扫描策略 (`scanLibrary`)

- 启动时增量扫描一次（fire-and-forget）
- 管理员手动 POST `/admin/library/rescan` 全量重扫
- 增量靠 `(mtime, size)` 双比对；都没变即跳过 parse
- **不递归子目录**：Phase 1 保持库结构扁平，便于用户在文件管理器里直接浏览
- **不上 fs.watch**：Windows + OneDrive 场景里 watcher 太不稳定，启动扫描 + 手动重扫覆盖 95% 场景

### 查询优先级 (`lookupFile`)

请求级 `sources` > settings `library_source_priority` > 默认 `['gbw','bz','by']`。多源同号时按数组顺序选第一个本地有的；fs.access 失败的行即时清掉，避免返回 404 fileId。

### Phase 2 预告（未实现）

下载流改造：现在下载完写 `data/exports/`（14 天清理）；Phase 2 改成"按文件名模板写进 standards/" + 完成时 INSERT `standard_files`；预览端点的 `not_in_library` 分支接通自动下载，下完即跳预览。当前 Phase 1 已为这个流程预留 settings `library_filename_pattern` 字段。
