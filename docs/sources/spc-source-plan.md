# spc.org.cn 第 5 数据源接入方案

> 跨会话续上必备：先读本文档 → `out/spc-chain-summary.md` → `out/spc-sample-09a6fd0484f5.pdf` → `docs/sources/labr-source-plan.md`（架构模板参考）。
>
> 凭据位置：`.env.local` 的 `SPC_USERNAME` / `SPC_PASSWORD`（gitignored），cookie 在 settings 表 `spc.cookies`。**不进 commit / 不进 memory**：账号密码、cookie 真值、token 真值都不允许。

## 1. 为什么做（why）

- bz/gbw/by 三源对部分新国标命中不全；labr 是社区上传源、文件质量不稳定
- spc.org.cn 是中国标准出版社官网，PDF 来自原始排版，无水印、文字可选、可打印（实测 GB 18584-2024 / 430KB / 20 页）
- 接入后用户在主搜索栏输入「GB 18584-2024」→ spc 跟 bz/gbw/by 同 chip 出现 → 点导出 → 几秒落到 standards_library_dir → 绿点亮起

## 2. 链路勘察结论

```
1. POST /submitlogin                         # 拿 cookie（需要 4 字母 JPEG 验证码）
   body: type=&loginmethod=0&loginfrom=&username=...&password=...&checkcode=<XNTW>
   → 302 + Set-Cookie

2. POST /queryfocus                          # 关键字搜索（匿名可调）
   body: text=<keyword>
   → JSON [{a100,idmd5,a301,a302}, ...]
        a100 含 <font color='red'>...</font> 高亮，需 stripHighlightTags

3. POST /stdlib/stdonline                    # 拿 reader token（必须登录）
   body: a100=<a100>&standclass=<CN|ISO|GW>
   → HTML，内含 <script>var rc = "<base64-token>";</script>

4. GET  /stdlib/onlinereading?token=<rc>&type=
   → 201 application/pdf, 完整正本字节流
```

**约束**：token 单次有效。每次下载都要现走 step 3 + step 4。

## 3. 文件清单

### 新建

| 文件 | 说明 |
|---|---|
| `src/sources/spc/spc-client.ts` | 协议层 stateless HTTP 客户端 + 纯函数 |
| `src/sources/spc/spc-client.test.ts` | 纯函数单测（≈30 case） |
| `src/sources/spc/spc-adapter.ts` | 编排层，实现 SourceAdapter，仿 by-adapter |
| `docs/sources/spc-source-plan.md` | 本文档 |

### 修改（点状）

| 文件 | 改什么 |
|---|---|
| `src/domain/standard.ts` | `SourceName` 加 `'spc'` |
| `src/shared/id.ts` | `VALID_SOURCES` 加 `'spc'` |
| `src/services/source-registry.ts` | `FACTORIES` 加 `spc: () => getSpcAdapter()` |
| `src/services/library-index.ts` | `SUPPORTED_SOURCES` + `SOURCE_LABEL_TO_CANONICAL` (`SPC↔spc`) + `CANONICAL_TO_LABEL` |
| `src/services/library-naming.ts` | `SOURCE_LABELS` 加 `spc: 'SPC'` |
| `src/api/preview-routes.ts` | `sourceEnum` + `ALL_LIBRARY_SOURCES` + `allSources` + `library_source_priority` 过滤器 |
| `src/shared/source-semaphore.ts` | DEFAULTS 加 `spc: 2` |
| `.env.example` | 注释占位 `SPC_USERNAME` / `SPC_PASSWORD` |
| `public/js/app-search.js` | line 1174 sourceLabel dict 加 `spc: 'SPC'` |
| `README.md` | 源表 + .env.local 段补 spc |
| `CHANGELOG.md` | feat 行 #64 |
| `docs/ARCHITECTURE.md` | 六-B 节 spc |

## 4. 关键设计决策

### 4.1 凭据策略：MVP 手动 Cookie，OCR 自动登录留 Polish

submitlogin 需要 `checkcode`（GET `/checkcode/service` 返回 4 字母 JPEG），无法纯 HTTP 自动化。

- **MVP**：admin 面板加「上传 Cookie」输入框（task #11）。用户在浏览器手动登录后从 devtools 拷 `Cookie: JSESSIONID=...` 字符串粘进来，后端校验后写 settings 表。
- **Polish**（未来）：electron BrowserWindow 弹 spc 登录页，preload 桥拦截 Set-Cookie 自动落库；或接 ddddocr 自动识别验证码。

### 4.2 Token 单次有效 → exportStandard 一气呵成

step 3 + step 4 必须在同一次 adapter 调用里串联，**不能拆**：

- `detectPreview` 不预拉 token（拉了立刻就废）→ 退化为 `{previewAvailable: true, pageUrls: []}`
- `exportStandard` 内部依次跑 stdonline → onlinereading → buffer → addFileToLibrary

### 4.3 standclass 推导

stdonline POST 必带 `standclass`。`inferStandclass(a100)` 从前缀映射：

- `GB / GB/T / JJF / JJG / DB / HB / HG / HJ / JC / JG / ...` → `CN`
- `ISO / IEC / ISO/IEC` → `ISO`
- `ASTM / BS / DIN / ANSI / JIS / NF / EN` → `GW`
- 默认 → `CN`

### 4.4 PDF 字节读取必须 arrayBuffer，不能 text()

```typescript
const ab = await resp.arrayBuffer();
const buf = Buffer.from(ab);
```

spc 后端发的是 `Content-Type: application/pdf;charset=utf-8`（错误地加了 charset）。Playwright/Chromium 会按 utf-8 解码字节、破坏 PDF；但 Node undici 的 `arrayBuffer()` 不看 charset，永远返回原始字节 —— 这是 spc 接入能走纯 HTTP 的核心。

### 4.5 Session 自愈

stdonline 失败检测：
- (a) 响应 status 是 302 且 Location 指向 `/loginpage` → cookie 失效
- (b) 响应是 200 但 HTML 里抠不到 `var rc = "..."` → cookie 失效

抛 `SpcAuthError` → adapter 层 invalidateSession → **不自动重登**（验证码过不去）→ 抛 `BadRequestError("spc 凭据失效，请在 admin 面板重新粘贴 Cookie")` 给前端弹提示。

### 4.6 sourceId 编码：避开 createStandardId 的 `:` 禁忌

`StandardSummary.id = 'spc:${a100}|${standclass}'`，但 `createStandardId` 禁止 sourceId 含 `:`。ISO 形态 `ISO 4287:1997` 会撞。方案：sourceId 里把 `:` 替换成 `∶`（U+2236，视觉相同但不与分隔符冲突），decodeA100 时还原。

### 4.7 复用基础设施

- `pooledFetch` (`src/shared/http.ts`) — 网络重试 + 连接池 + undici
- `getSourceSemaphore('spc')` — 并发限流（默认 2，撞限速降到 1）
- `addFileToLibrary` (`src/services/library-index.ts`) — 入库统一
- `cleanStdCode / extractFullCode / extractBaseCode` (`src/shared/std-code.ts`) — std_code 三层归一化（**强制**）
- `getSetting / setSetting` — settings 表存 cookie + 过期时间

## 5. 已知坑（写进 PR 描述供 reviewer）

1. **arrayBuffer 字节路径**：labr 的 downloadDirect 已经按这个套路 + 跑通了；spc 照抄
2. **a100 编码**：含空格的 `GB 18584-2024` → `URLSearchParams` 自动编成 `GB+18584-2024`，spc 后端只认 `+`
3. **Token 单次有效**：不能在并发的不同请求间复用
4. **Cookie 寿命未知**：可能小时级也可能周级，保守按 6 小时；用户报告失效后再调
5. **限速未压测**：spc 没已知日额度，但高频请求可能触发 IP 风控；首版并发 2 + 失败回退 1
6. **OCR 验证码暂不做**：用户每隔 N 天可能需要重新粘 cookie
7. **ISO `:` 兼容**：sourceId 用 `∶`（U+2236）编码 a100 里的 `:`；下载时 `decodeA100` 还原

## 6. 验证流程

### 单元
- `spc-client.test.ts` 覆盖：stripHighlightTags / inferStandclass / extractTokenFromHtml / mergeCookies（≈30 case，**不测网络**）

### 集成（手动）
1. `.env.local` 填 `SPC_USERNAME` / `SPC_PASSWORD`（可选，MVP cookie 路径用不到）
2. admin 面板「粘 Cookie」（task #11 上线后）→ POST `/api/admin/spc/cookie` → 写 settings
3. 主搜索栏输入 `GB 18584-2024` → 应在 spc chip 看到结果
4. 点导出 → 期望几秒内落到 standards_library_dir，绿点亮起
5. 校验落地 PDF：与 `out/spc-sample-09a6fd0484f5.pdf` SHA256 比对，应一致或差异仅在 metadata
6. cookie 过期场景：手动清 settings 里的 `spc.cookies` → 再下载应抛 "spc 凭据失效"

### CI 守门
`web:typecheck → web:test → web:build → backend build → backend test`。SourceName 加 `spc` 后 TS 强制要求所有 `Record<SourceName, ...>` 类型补全。

## 7. 进度登记表

| 节点 | 任务 | Commit | 备注 |
|---|---|---|---|
| #64 | 文档同步 + 5 文件接入 | (本次) | 协议层 + adapter + 单测 + 点状改 + 文档 |
| #65 | admin Cookie 上传端点 | — | task #11，前后端联调 |
| #66 | smoke test 脚本 | — | `scripts/sources/spc/smoke-test.ts` 走真实链路验收 |
| #67 | 限速观察 | — | 跑批 100 个标准观察是否触发 IP 风控 |
| #68 | Polish: BrowserWindow 自动登录 | — | electron preload 桥拦截 Set-Cookie |
