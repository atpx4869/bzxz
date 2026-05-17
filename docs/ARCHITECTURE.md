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
