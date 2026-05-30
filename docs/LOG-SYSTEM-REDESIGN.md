# 日志系统重做方案

> 把当前悬浮在所有页面底部的「下载日志」可折叠面板，重做成与「标准检索 / 系统设置」
> **同级的独立菜单**，统一收纳前端操作日志 + 后端运行日志，**持久化到本地**，支持
> 按模块 / 级别 / 时间 / 关键词四维筛选。
>
> 可点击预览：`docs/log-system-prototype.html`（顶部可切三主题，左筛选栏 + 右列表，
> 假数据演示四维筛选交互）。

---

## 一、现状（重做前）

**前端日志（`app-detail-utils.js`）**

- `addLog(msg, status)` / `updateLog(id, msg, status)`：status 仅 `success`/`fail`/`pending`，
  条目字段只有 `{ id, time, msg, status }`，`time` 只精确到 **时:分**（无日期、无秒）。
- 全部存在内存数组 `logEntries`，**刷新即丢、关客户端即没**，无持久化。
- 来源散落 `app-search.js` / `app-download.js` / `app-complete.js` / `app-detail-utils.js`，
  **无 module 字段** —— 全靠 msg 文本里自带"搜索…/下载…/标准补全…"区分。
- 展示：底部可折叠面板 `#logPanel`（`layout/log-panel.css`），跨所有页面悬浮，
  `renderLogs()` 只渲前 50 条，标题"📋 下载日志 (N)"，有「导出」按钮。

**后端日志（已有，未被前端日志面板用上）**

- `src/shared/log-buffer.ts`：import 时拦截 `console.log/warn/error`，写入 500 条环形缓冲，
  字段 `{ ts: ISO, level: 'log'|'warn'|'error', message }`。
- `GET /api/diagnostics/logs?limit=`（`app.ts:258`，**requireAdmin**）已暴露这些日志。
- 即后端"运行日志"基础设施**已存在**，重做时复用、不从零造。

**痛点**：① 日志混在业务页面底部，没有"日志中心"的位置感；② 不能按模块/级别筛选；
③ 时间粒度粗、无日期；④ 前端日志关窗即丢，事后无法排障；⑤ 前后端日志两套、互不相通。

---

## 二、目标形态

1. **独立菜单**：侧栏「运行日志」项，与标准检索/系统设置同级（`switchTab('logs')` → `#page-logs`）。
   移动端进「我」页的入口行（统计同款，不占底部 Tab）。
2. **取代底部面板**：删除 `#logPanel` 悬浮面板 —— 日志全部进独立页。下载进行中的"实时进度"
   仍可保留一个**轻量 toast / 顶部 strip**（见 §六 风险）。
3. **统一两源**：前端操作日志（addLog 扩字段）+ 后端运行日志（log-buffer）汇入同一列表。
4. **持久化到本地**：关客户端重启仍可查史。
5. **四维筛选**：模块 / 级别 / 时间 / 关键词，可叠加。

---

## 三、数据模型

统一日志条目（前后端归一到同一形状）：

```ts
interface LogRecord {
  id: number;            // 自增
  ts: string;            // ISO 完整时间戳（含日期 + 秒，取代现在的"时:分"）
  module: 'search' | 'download' | 'complete' | 'qual' | 'ocr' | 'local' | 'system';
  level: 'success' | 'fail' | 'warn' | 'info' | 'pending';
  msg: string;           // 主文本
  detail?: string;       // 次要信息（来源链路、耗时、原因等，列表里灰字 · 接在 msg 后）
  source: 'frontend' | 'backend';
}
```

**前端侧改造**：`addLog` 签名从 `addLog(msg, status)` 扩为
`addLog(msg, { module, level, detail })`，**保留旧两参调用兼容**（旧调用 level=status、
module 按调用文件兜底推断），逐处补 `module`。`ts` 用完整 ISO（含秒），渲染时按需格式化。

**后端侧改造**：`log-buffer.ts` 的 `LogEntry` 增 `module`（按 message 前缀或调用点 tag 推断，
默认 `system`），`level` 从 `log/warn/error` 映射到 `info/warn/fail`。前端日志页通过
`GET /api/diagnostics/logs` 拉后端段，与本地前端段**按 ts 归并排序**后统一渲染。

---

## 三·五、可记录事件全景（"能记到多细"）

代码里**后端已经在打大量带 `[模块]` 前缀的 console 日志**，log-buffer 已全部截获 ——
这意味着"更细"几乎是零新增采集成本，只要给 `module` 做前缀映射 + 决定哪些值得呈现给用户。
下面是实际可落地的事件清单（前缀来自现有代码，非虚构）：

| module | 典型事件（真实日志点） | 级别 |
|---|---|---|
| **ocr** 验证码识别 | worker 启动 / 启动失败（`[ocr-worker] startup failed`）、单次识别结果与置信度、stderr/stdout、非法 JSON | info / warn / fail |
| **search** 检索 | 各源逐个搜索发起、命中条数、单源失败原因（`[resolver] source X error for query`）、CNAS 反爬等待重试（`CNAS anti-bot at offset…waiting Ns`） | success / fail / warn |
| **download** 下载 | 级联逐源尝试、命中源+耗时+大小、gbw 终态文件下载失败（`[gbw] tryDownloadFinalFile failed`）、by 源下载 HTTP 异常（`[by-adapter] downloadPdf got HTTP`）、preview-task 下载失败（`[preview-task] X 下载失败`） | success / fail |
| **qual** 资质同步 | CNAS/CMA 同步进度与结果、`checkForUpdate failed→全量同步`、`fetchLabName/fetchOrgInfo failed`、字段缺失跳过 | success / warn / fail |
| **by/labr 登录** （归 download/qual 或单列 `auth`） | by 三步登录每步 HTTP 状态 / 缺 VIEWSTATE / 凭据疑似错误（`[by-adapter] login step N…`）、labr SSO bridge 失败、session 软失败 | warn / fail |
| **complete** 补全 | 上传解析、A 列识别、逐条匹配进度、未匹配条目、输出列写入 | success / warn |
| **local** 本地库 | 启动扫描结果（`[library] startup scan`）、watcher 增删改、统一命名/批量删除结果 | info / warn / fail |
| **system** 系统 | 端口占用回退（`port X in use`）、服务启停、DB 备份/还原（`[db-backup]`）、std_code 回填/清洗（`[db] backfilled/cleaned`）、`.env.local` 加载、PDF 合并 worker 错误 | info / warn / fail |

**呈现分层（重要）**：日志可以非常细，但不能淹没用户。建议两档：
- **默认视图**：只显示"用户关心的业务事件"（搜索完成/下载成功失败/同步结果/OCR 识别失败等）。
- **「详细模式」开关**（页头一个 toggle）：打开后连同低层调试日志（每步 HTTP 状态、worker stdout、
  反爬等待、字段缺失逐条等）一并显示。给管理员排障用，普通用户默认看精简档。

这样"既能更详细、又不吵"——细节都记下来了，但默认折叠，需要时一键展开。

---

## 四、持久化

**前端操作日志**：写 `localStorage`（key 如 `bzxz.logs`，**滚动保留最近 N 条 / M 天**，
见下）——纯前端、零后端改动、重启可查。注意：本项目 artifact 规则禁 localStorage，但这是
**正式应用代码**、非 artifact，Electron renderer 的 localStorage 正常可用。

> 备选：若希望前后端日志都落同一份、且容量更大，可在后端 `db.ts` 建 `app_logs` 表，
> 前端日志经新接口 `POST /api/logs` 落库。**工作量更大**，建议二期再上；一期先 localStorage。

**后端运行日志**：当前 log-buffer 是纯内存（重启丢）。一期可保持现状（前端拉到的是本次
运行的后端日志）；二期把 buffer 落地到 `<userData>/logs/app-YYYYMMDD.log`（按天滚动文件，
配合现有 NSIS 升级保留契约里的目录策略）。

**容量上限**：前端 localStorage 保留最近 **10000 条 / 30 天**（超出滚动丢弃，预览页脚已注明）。
清空走二次确认（不可逆操作，沿用 `.set-modal` confirm 约定）。

---

## 五、信息架构与组件（复用 `.set-*`）

页面 `#page-logs`，两栏 `.set-layout` 同源布局：

| 区域 | 组件 | 内容 |
|---|---|---|
| 页头 | `.set-page-head` | kicker「RUNTIME LOG」+ h1「运行日志」+ 副说明 + 右侧「导出 / 清空」 |
| 左栏 | `.set-stats`（2×2） | 概览：总计 / 成功 / 失败 / 警告（带语义色） |
| 左栏 | 模块筛选 `.filter-chip` 竖列 | 全部 / 标准检索 / 下载 / 标准补全 / 资质同步 / 系统，各带计数 + 色点 |
| 左栏 | 级别筛选 `.filter-chip` 竖列 | 全部 / 成功 / 失败 / 警告 / 信息 |
| 右栏顶 | `.set-search` + `.seg` | 关键词搜索框 + 时间区间段选（全部 / 今天 / 近7天） |
| 右栏 | `.set-table` 行式列表 | 列：时间(时:分:秒 + 日期) / 模块徽章 / 正文+详情 / 级别标签；**左侧 3px 语义色条** |
| 右栏底 | `.set-pager` 风格脚注 | 「显示 X / N 条」+ 容量说明 |

四个筛选维度**可叠加**（模块 ∩ 级别 ∩ 时间 ∩ 关键词）。色点/色条复用主题 token，
三主题自适应。移动端左筛选栏退化为顶部横向滚动 chip 条，行收成两列（时间 + 正文）。

---

## 六、分期

- **Phase 1 ✅ 已落地（独立页骨架 + 前端日志迁入）**
  - 侧栏加「运行日志」项 + `#page-logs`（两个 index.html）；`switchTab('logs')` 接上。
  - `addLog` 扩字段（兼容旧两参，module 按文本推断）；`ts` 改完整时间戳。
  - 渲染从 `#logPanel` 迁到 `#page-logs`，实现四维筛选 + 详细模式。
  - localStorage 持久化 + 容量滚动 + 清空二次确认。
  - 删底部 `#logPanel`，保留下载实时进度 `.progress-strip`。
- **Phase 2 ✅ 已落地（后端日志汇入）**
  - `log-buffer.ts` 加 `module`（按 `[前缀]`/关键词推断）；`/api/diagnostics/logs` 随之返回 module。
  - 前端 `loadBackendLogs()`：切到日志页 / 点「刷新」时拉 `/api/diagnostics/logs?limit=500`，
    映射 level（error→fail、warn→warn、log→info 且标 verbose）后与本地前端段 `getMergedLogs()`
    按 tsMs 归并倒序。概览/计数/列表/导出全部基于合并集。
  - 权限：`/api/diagnostics/logs` 仍 **requireAdmin** —— 非管理员请求被 403，前端静默只显前端日志
    （后端段对管理员可见，与现有权限一致）。
  - 清空只清前端本地段，后端 buffer 不归前端清（重启服务才滚动覆盖）；文案已说明。
- **Phase 3 ✅ 已落地（部分，可选增强）**
  - **日志详情展开**：多行（堆栈）/ 长正文行可点击展开完整内容（`.log-full` pre 块，等宽、可滚）；
    `logExpanded` 记展开态，事件委托绑定一次。纯前端。
  - **后端日志按天落文件**：`log-buffer.ts` 在内存 buffer 之外，按天追加
    `<userData>/bzxz-logs/app-YYYYMMDD.log`（tab 分隔：ts/level/module/message），
    保留最近 14 天、超期清理。全程 best-effort、失败静默；目录取 `BZXZ_USER_DATA_DIR`，
    非 Electron（开发/测试）无该变量时**不落文件**，避免往 cwd 乱写。
  - **导出 csv**：已在 Phase 2 落地（含来源列）。
  - **跳过 `app_logs` 入库**：按天文件已提供磁盘持久化，再建 DB 表是重复能力 + 多一处 schema
    迁移风险，**不做**。需要全文检索历史日志再议。
  - 待办：日志页直接读取/下载后端 .log 历史文件（目前后端只回内存 buffer 的近 500 条）。

---

## 七、风险与注意

- **下载实时进度**：现在底部面板兼任"下载进行中"的实时反馈（pending 态 + 进度）。删面板后，
  这类瞬时进度应保留一个轻量呈现（顶部 strip 或 toast），**别让用户为看进度专门跳日志页**。
  日志页负责"事后可查的历史"，实时进度是另一回事，两者分开。
- **toast 不变**：toast 是即时提示，**保留**；日志页是历史归档。两者并存、各司其职。
- **localStorage 配额**：单域约 5MB，10000 条结构化日志需估算大小；超限要静默滚动丢弃旧条，
  不能抛异常打断业务。
- **权限**：后端日志含敏感运行信息，`/api/diagnostics/logs` 保持 requireAdmin；前端页对非管理员
  隐藏后端段。
- **移动端**：日志页只读查阅，符合"查阅而非管理"，但筛选栏要收口成横向 chip（见 §五）。
- **双入口镜像**：`#page-logs` 的 HTML 要在 `web/index.html` + `public/index.html` 同步；
  CSS 走 `.set-*` 体系（新筛选 chip 列若需新类，按 token-only 纪律加，双文件镜像）。
- **文档同步**：落地后更新 README 功能清单、SECTIONS.md（若加新 CSS 段）、CHANGELOG。
