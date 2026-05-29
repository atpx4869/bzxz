# 标准盒子 · StandardsBox

> 多源标准检索与批量下载 · CNAS/CMA 实验室资质能力验证

面向团队的标准检索与文档导出系统。Web 前端 + Express API + SQLite + Electron 桌面壳；深色玻璃拟态登录页 + 主题统一的工作区。

部署方式：在一台主机上运行 Electron 桌面端，团队成员通过同局域网的 Web 服务地址访问使用。

> 仓库 ID 仍叫 `bzxz`（保留 npm 包名 / 设置文件路径 / 升级链路）；产品名与界面统一展示为 **标准盒子 / StandardsBox**。

## 支持的标准源

| 源 | 代号 | 搜索 | 导出 |
|---|---|---|---|
| bz.gxzl.org.cn | `bz` | JSON API | 逐页 JPEG → pdf-lib 合并 PDF |
| openstd.samr.gov.cn | `gbw` (显示为 BW) | JSON API | ddddocr 验证码 → 直接 PDF |
| std.samr.gov.cn | `by` | JSON API | 直接 PDF |
| 标准库补给源 | `labr` | JSON API + 独立 service（不挂 SourceRegistry） | kind=0 直拉 / kind=1 登录+preview2，限 5/天；带 multi-source preview picker |

## 快速开始

### 环境

- Node.js ≥ 20
- Python ≥ 3.8 + ddddocr（仅 BW 源需要）

```powershell
npm install
pip install ddddocr
npm run build
node dist/src/index.js
```

打开 `http://localhost:3000`。默认免登录模式，直接以 `guest` 普通用户使用。首次注册用户自动成为管理员。

如需启用登录验证，在「用户管理」中勾选「需要登录」。

### 一键启动 (Windows)

```bat
start.bat
```

自动检测 Node.js 环境（fnm / nvm / 手动安装），补装依赖，启动服务并打开浏览器。`start.vbs` 提供无窗口静默启动。

### 凭据配置 (.env.local)

部分源需要账号登录。复制 `.env.example` 为 `.env.local` 填入真实凭据：

**开发 / 源码运行**（仓库根目录）：

```bash
cp .env.example .env.local
# 编辑 .env.local 填入 LABR_USERNAME / LABR_PASSWORD 等
```

**桌面安装版**（NSIS 安装后）：在 `$INSTDIR`（默认 `C:\Program Files\标准盒子` 或自选目录）能直接看到 `.env.example`，复制为 `.env.local` 后填入凭据，**重启应用**即可生效。升级 / 重装会保留 `.env.local`，不必重填。

**Portable 版**：在 portable exe 同级目录创建 `.env.local`，与安装版同样被 `dirname(process.execPath)` 命中。

`.env.local` 已在 `.gitignore` 中，绝不会被提交。加载时机：
- Web 后端 `src/index.ts` / Electron 主进程 `electron/main.ts` 启动时
- `scripts/sources/**/inspect-*.ts` 勘察脚本自行加载
- 搜索顺序：`process.cwd()/.env.local` → `dirname(process.execPath)/.env.local`，命中第一个就停
- 真实环境变量（CI / shell `set`）优先级高于 `.env.local`（`override: false`）

支持的键见 `.env.example`。新增源的凭据按 `<SOURCE>_USERNAME` / `<SOURCE>_PASSWORD` 命名约定。

## 运行模式

| 模式 | 命令 | 说明 |
|------|------|------|
| Web 开发 | `npm run dev` | tsx 热重启 |
| Web 生产 | `npm run start` | 编译后运行 |
| Electron 开发 | `npm run electron:dev` | 本地窗口 + 托盘 |
| Electron 打包 | `npm run electron:build` | 便携版 `.exe` |
| Electron 安装包 | `npm run electron:build:nsis` | NSIS 安装包 |
| Electron 全量 | `npm run electron:build:all` | portable + nsis |

## 资质能力验证

支持查询 **CNAS**（中国合格评定国家认可委员会）和 **CMA**（检验检测机构资质认定）实验室的检测能力范围。

### 功能概览

- **搜索**：按标准号/关键词搜索资质记录，支持来源过滤（CNAS/CMA/全部）；"全部参数"/"部分参数"的能力记录在分组内自动置顶并淡蓝高亮加粗
- **可视化**：批量关键词查询，按 `query → (标准号 + 资质类型)` 两级聚合，**CNAS 段在前、CMA 段在后**单列纵排（与「搜索」tab 同款渲染：标准号分组默认收起、徽章随标准号头展示）。stats 显示命中数、能力数、过期记录
- **订阅管理**：订阅/取消订阅实验室，实时同步进度显示（如 `2541/6521 (39%)`）
- **同步日志**：记录每次同步的时间、状态、抓取记录数

### CNAS 订阅详情

订阅 CNAS 实验室后自动采集并展示：

| 字段 | 说明 |
|------|------|
| 注册编号 | CNAS 注册编号 |
| 其他名称 | 报告/证书允许使用认可标识的其他名称 |
| 单位地址 | 机构注册地址 |
| 认可有效期限 | 认可有效期范围 |
| 证书附件（能力范围） | 任务编号、评审类型、签发日期、公布状态 |

### CMA 订阅详情

订阅 CMA 机构后自动采集并展示：

| 字段 | 说明 |
|------|------|
| 证书编号 | CMA 证书编号 |
| 信用代码 | 组织机构代码/统一社会信用代码 |
| 地址 / 行政区划 / 行业 | 机构基本信息 |
| 证书颁发时间 / 有效期 | 证书时间范围 |
| 证书状态 | 正常/注销等 |

### 机构关联

可将同一物理机构的 CNAS 和 CMA 资质关联，查询时自动合并显示名称。

### 技术实现

- CNAS：Playwright 无头浏览器 + Stealth 反检测，分页抓取能力范围 API
- CMA：HTTP 请求 + Cheerio HTML 解析
- 增量同步：对比证书日期避免不必要的全量抓取
- **标准号三层归一化匹配**（`src/shared/std-code.ts`）：
  - **L1 `cleanStdCode`** 抓取入库前清洗（折叠"年份连字符附近的多空格"，如 `'GB/T 3325 -2024'` → `'GB/T 3325-2024'`），让原始 `std_code` 字段子串 LIKE 一致工作
  - **L2 `std_code_norm`** 保留年份的归一化列（`'GB3325-2024'`），用于同号同年精确匹配；走 B-tree 索引等值查询。**主搜索结果资质徽章**只用这层(`queryByStdCodes`),收紧到"同号同年才亮"
  - **L3 `std_code_base`** 剥年份的归一化列（`'GB3325'`），用于跨年版本兜底 —— 仅"资质查询"页关键词搜索(`searchQualifications`)使用,UI 列表展示完整带年 `stdCode` 让用户明确看到命中的是哪个年版
  - 覆盖变体：脏空格 / 全角字符 / 无空格 (`GB/T3325`) / ISO 冒号年份 (`ISO 4287:1997`) / 修订标记 (`2010A`)
  - 启动时自动回填旧数据（`backfillNormalizedStdCodes`）+ 清洗历史脏 `std_code`（`fixupDirtyStdCodes`），幂等
- 后台定时同步：默认每周日凌晨 3 点（可配置 cron 表达式）
- 诊断接口：`GET /api/admin/qual/diagnose?code=<标准号>` 返回 DB 实际命中行 + 归一化列匹配状态，用于排查漏命中

## 账号管理

基于 SQLite 的本地用户体系，无需外部数据库。

- **免登录模式**：默认开启，无需注册即可使用；默认身份为 `_guest` 普通用户
- **注册**：首个注册用户自动成为管理员，后续默认普通用户
- **登录**：Session Cookie（HttpOnly，30 天滑动续期）
- **管理员功能**：
  - 开启/关闭公开注册
  - 开启/关闭登录验证（需要登录）
  - 用户增删改查（角色、启用/禁用、权限）
  - 用户级功能权限控制（按 Tab 配置可访问功能）
  - 新用户默认权限设置（出厂默认仅 “标准检索 / 批量下载 / 标准补全” 三项）
  - 查看用户使用明细（搜索/下载次数、来源分布、事件列表）

## 使用统计

自动记录搜索、下载、批量解析等操作事件，提供可视化仪表盘：

- 汇总卡片（按事件类型）
- 趋势折线图（按日期）
- 来源分布饼图
- 管理员可按用户维度查看明细

## 目录结构

```
├── .github/workflows/   # GitHub Actions 自动打包
├── electron/            # Electron 主进程 + preload
├── public/              # 前端 SPA (legacy index.html + styles.css，过渡期保留)
├── web/                 # 新前端：Vite + TypeScript（详见 web/README.md）
│   └── src/styles/      # 模块化 CSS（base / layout / components / pages / responsive / theme）
├── scripts/             # 勘察脚本 + 注册机 + OCR 桥接 + css-oklch-fallback.mjs（老浏览器兼容）
├── src/
│   ├── api/             # Express 路由（含 auth/admin/stats/资质）
│   ├── domain/          # 领域模型 + SourceAdapter 接口
│   ├── services/        # 业务逻辑 + SQLite 数据库 + 使用追踪
│   │   ├── cnas-scraper.ts   # CNAS Playwright 采集器
│   │   ├── cma-scraper.ts    # CMA 采集器
│   │   └── qualification-service.ts  # 资质同步调度
│   ├── shared/          # 工具函数（ID解析/错误/路径）
│   └── sources/         # 5 个数据源（4 个 SourceAdapter + labr 独立 service）
│       ├── bz-zhenggui/ # BZ 标准在线
│       ├── gbw/         # BW 国标网
│       ├── by/          # BY 内部网
│       ├── labr/        # LB 标准库补给源（独立 service，不挂 SourceRegistry）
│       └── shared/      # OCR 验证码工具
├── docs/                # 源实现文档
├── data/                # SQLite 数据库 (bzxz.db, .gitignore)
└── standards/           # 本地标准 PDF 库（预览功能；Electron 模式下放 exe 同级）
```

## API 端点

### 公共

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |

### 认证（无需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/status` | 检查初始化状态 + 当前用户 |
| POST | `/api/auth/register` | 注册（首个用户自动 admin） |
| POST | `/api/auth/login` | 登录 |

### 认证（需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| DELETE | `/api/auth/session` | 登出 |
| GET | `/api/auth/me` | 当前用户信息 |
| PUT | `/api/auth/password` | 修改密码 |

### 标准检索与下载（需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/standards/search?q=&source=` | 搜索标准 |
| GET | `/api/standards/:id` | 标准详情 |
| POST | `/api/standards/:id/preview/detect` | 探测预览 |
| POST | `/api/standards/:id/export` | 导出（bz/bvip） |
| POST | `/api/standards/:id/auto-download` | BW 自动验证码下载 |
| POST | `/api/standards/multi-download` | 多源自动切源下载（按优先级依次尝试） |
| GET | `/api/standards/check-sources` | 检测各数据源连接状态 |
| POST | `/api/standards/:id/download-session` | 创建下载会话 |
| POST | `/api/download-sessions/:id/verify` | 提交验证码 |
| GET | `/api/download-sessions/:id` | 查询下载会话 |
| POST | `/api/standards/resolve` | 批量解析标准号 |
| POST | `/api/standards/complete` | Excel 批量导入+解析 |
| GET | `/api/tasks/:taskId` | 查询导出任务状态 |
| GET | `/api/tasks/:taskId/stream` | SSE 实时任务进度 |
| GET | `/api/downloads/:filename` | 下载导出文件 |

### 资质能力验证（需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/standards/qualifications` | 按标准号批量查询资质（搜索结果徽章） |
| GET | `/api/qualifications/search?q=&source=` | 关键词搜索资质记录 |
| POST | `/api/qualifications/visual` | 可视化批量关键词查询 |
| GET | `/api/qualifications/settings` | 资质同步设置 |
| PUT | `/api/qualifications/settings` | 更新同步设置 |
| GET | `/api/qualifications/stats` | 资质数据统计 |
| GET | `/api/cnas/labs` | CNAS 订阅实验室列表（含同步进度） |
| POST | `/api/cnas/labs` | 添加 CNAS 实验室（支持粘贴完整 URL） |
| DELETE | `/api/cnas/labs/:labNo` | 删除 CNAS 实验室 |
| PUT | `/api/cnas/labs/:labNo` | 编辑 CNAS 实验室名称 |
| POST | `/api/cnas/sync` | 触发 CNAS 同步（单个或全部） |
| GET | `/api/cnas/sync-logs` | CNAS 同步日志 |
| GET | `/api/cma/search-labs?q=` | 搜索 CMA 机构候选 |
| GET | `/api/cma/labs` | CMA 订阅实验室列表（含同步进度） |
| POST | `/api/cma/labs` | 订阅 CMA 实验室 |
| DELETE | `/api/cma/labs/:certNumber` | 删除 CMA 实验室 |
| PUT | `/api/cma/labs/:certNumber` | 编辑 CMA 实验室名称 |
| POST | `/api/cma/sync` | 触发 CMA 同步（单个或全部） |
| GET | `/api/cma/sync-logs` | CMA 同步日志 |
| POST | `/api/qualification-links` | 关联 CNAS/CMA 实验室 |
| DELETE | `/api/qualification-links/:source/:id` | 取消关联 |

### 管理（需 admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/settings` | 获取系统设置 |
| PUT | `/api/admin/settings` | 更新设置（注册开关等） |
| GET | `/api/admin/users` | 用户列表（含使用统计） |
| POST | `/api/admin/users` | 创建用户 |
| PUT | `/api/admin/users/:id` | 更新用户（角色/状态/密码） |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| GET | `/api/admin/users/:id/events` | 用户使用明细 |
| POST | `/api/admin/library/rescan` | 全量重扫标准库目录 |
| GET | `/api/admin/qual/diagnose?code=` | 资质漏命中诊断：返回 DB 行的归一化列状态、Phase1/Phase2/索引等值各路径命中情况 |
| GET | `/api/admin/db/backups` | 列出所有 db 自动备份（userData/bzxz-db-backups/*）：name / size / mtime |
| POST | `/api/admin/db/backups` | 手动触发一次 db 备份（打补丁 / 升级前主动留底） |

### 诊断（需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/diagnostics/hosts` | 上游主机延迟统计（按 origin 维度 min/max/avg） |
| GET | `/api/diagnostics/sources` | 源级并发信号量当前状态：`{ bz, gbw, by }` 各 `{ active, limit, waiting }` |

### 预览（需登录，含 guest）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/preview/request` | 查本地库；命中返回 `{status:'ready', fileId, url}`；未命中后台触发自动下载并返回 `{status:'downloading', taskId, tried}` |
| GET | `/api/preview/task/:taskId` | 轮询自动下载任务：`pending`/`downloading`/`ready{fileId,url}`/`failed{error}` |
| GET | `/api/preview/file/:id` | 流式回 PDF（HTTP Range + ETag + 304；`?attachment=1` 强制另存） |
| GET | `/api/preview/files?stdCode=&year=` | 多源候选：列出该 `(stdCode, year)` 在 `gbw/bz/by/labr` 4 源里能找到的所有本地文件，供 multi-source preview picker 渲染切换条 |
| POST | `/api/preview/library-check` | 批量本地库命中检查：body `{ items: [{stdCode, year}] }`，返回每条 `{ stdCode, year, hit, fileId? }`，用于搜索结果绿点指示器 |
| DELETE | `/api/preview/file/:id` | 删除本地文件库中的标准 PDF（物理删 + 删 `standard_files` 行；库根外路径拒绝）|
| POST | `/api/preview/files/batch-delete` | 批量删除：body `{ ids: number[] }`；返回 `{ deleted: number[], failed: [{id,message}] }` |
| POST | `/api/preview/file/:id/reveal` | Electron 桌面端在系统资源管理器中定位文件（`shell.showItemInFolder`）；Web 浏览器侧 501 NOT_SUPPORTED |
| PATCH | `/api/preview/file/:id` | 重命名本地文件：body `{ fileName }`；保留 `std_code_norm` 索引键，仅改物理文件名 |

### Labr 库检索（需登录，第 4 源；独立 sidebar tab）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/labr/search?keyword=&page=&pageSize=` | 翻页搜索 labr.cc。`page=1` 走首屏 inline dataList（≤4 条），`page≥2` 走 rec-list；pageSize 上限 500；过滤 `is_free=1 && price=0 && ext=pdf` |
| GET | `/api/labr/detail/:did` | 资源详情（`info` + `detail` 完整字段） |
| POST | `/api/labr/download` | body `{ did }` 单条下载入库。kind=0 匿名直拉 / kind=1 走 preview2（限 5/天）+ `labr_temp_urls` 缓存。错误 code：`LABR_RATE_LIMIT` / `LABR_AUTH` |
| POST | `/api/labr/batch-download` | body `{ items: [{did}] }` 批量下载（上限 100）。撞 `LABR_RATE_LIMIT` 后后续 kind=1 任务全部短路标 `skipped:'quotaExhausted'`，kind=0 继续 |

### 统计（需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/summary` | 汇总计数 |
| GET | `/api/stats/timeseries` | 每日趋势数据 |
| GET | `/api/stats/by-source` | 来源分布 |
| GET | `/api/stats/by-user` | 用户分布（仅 admin） |
| GET | `/api/stats/recent` | 近期事件列表 |

## 前端功能

- **标准 PDF 预览（Phase 2）**：搜索结果卡片「预览」按钮 → 命中本地库即时打开内嵌 iframe PDF 阅读器（支持 Range + ETag）；**未命中后台自动按源优先级下载并入库，前端 1.5s 轮询任务直到 ready 切 iframe**（3 分钟超时上限）。库目录默认 `<exe同级>/standards/`，Windows Program Files 安装时探针失败会回退到 `userData/standards` 并在管理员设置页打 banner。所有下载（搜索卡片「下载」/ 预览自动下载 / 批量多源）现在统一 `fs.rename` 进库目录，按 admin 模板（默认 `{stdCode} - {SOURCE}.pdf`，支持 `{stdCode} {source} {year} {title}` 占位符）命名 UPSERT 索引；多源同号通过 source 后缀文件名共存。可选 chokidar 监听（默认开），用户手动拖 PDF 进库目录立刻入索引
- 现代深色毛玻璃主题（oklch 色彩空间 + backdrop-filter）
- 免登录模式（默认开启，无需注册即可使用）
- 多源并行搜索 + 去重 + 状态排序
- 搜索结果自动标注 CNAS/CMA 资质能力（绿色徽章）
- 卡片式结果展示（进场动画）
- 批量勾选下载 + 进度条 + 完成通知
- 新版**深色玻璃拟态**登录页（紫蓝渐变 + 浮动光球 + 模糊磨砂卡片），底部内联应用版本号 + `/api/health` 实时在线状态徽标
- 主题统一：topbar / sidebar / 卡片 / 主按钮均采用同色系玻璃拟态 + 渐变 active 态
- **后端自动切源下载**：批量下载时后端按优先级自动尝试多个源，失败自动切换
- **多用户并发适配**：
  - **跨用户下载去重**：两个用户同时点同一标准下载，底层 `adapter.exportStandard` 只跑一次。`ExportTaskStore` 用 `activeByStandard` 索引找现有活跃任务，把新用户追加到 `subscribers`，共享同一 SSE 进度流和最终结果
  - **源级并发信号量**（`src/shared/source-semaphore.ts`）：每个源全局并发上限独立钉死，与前端 `downloadConcurrency` 解耦。默认 `bz=2 / gbw=4 / by=4 / labr=2`（依据：BZ 单次涉及 12 路 JPEG + pdf-lib worker，GBW/BY 是直 PDF；labr 限速未压测保守起步）。多用户叠加不会让真实出口超额
  - 诊断接口 `GET /api/diagnostics/sources` 返回各源 `{ active, limit, waiting }`
- 行级下载反馈（spinner + 卡片高亮 + 成功/失败闪烁）
- BZ 页级实时进度
- 搜索历史（可配置条数 3~20，localStorage 持久化）
- 常用标准收藏（监控收藏标准是否有新版本）、独立的本地文件库管理 tab、下载历史
- 键盘快捷键：全局 `Ctrl+K` 聚焦搜索 / `Ctrl+Enter` 触发 / `Ctrl+A` 全选 / `Ctrl+D` 取消 / `Alt+1..6` 切源；结果列表 vim 风格 `j` `k` `g g` `G` `x` `d` `s` `Enter`（详见 [DEVELOPMENT.md](./DEVELOPMENT.md#前端键盘快捷键)）
- 结果行右键菜单：复制编号 / 复制标题 / 查看详情 / 单条下载
- 状态分组（现行 / 即将实施 / 其它 / 废止）默认折叠 `废止`，折叠状态持久化
- BW 自动 OCR 验证码 + 后台文本可用性检测（乐观 UI，搜索即可下载）
- 搜索状态指示器：右下角 toast「正在搜索 → 搜索中 N/M 源」+ 卡片级文本可用性 tri-state 徽章（检测中脉冲点 / 有正文 / 无正文）+ 顶部 source-progress 进度条带
- 下载优先级、并发数和超时时间（持久化）；后端按级联顺序逐源尝试，同标准跨用户自动去重
- 数据源健康检测（设置页手动检测 + 单源重试）
- 底部日志面板 + 执行历史
- 登录/注册界面 + 用户菜单
- 使用统计仪表盘（Chart.js 图表）
- 管理员用户管理面板（批量操作、权限控制、使用明细）
- 资质能力验证面板：
  - 搜索/可视化/订阅管理/同步日志 四个子标签页
  - 搜索结果自动标注 CNAS/CMA 资质徽章（hover 详情）
  - 可视化批量查询：按 `query → (标准号 + 资质类型)` 两级聚合，**CNAS 段优先 + CMA 段在后**单列纵排，与「搜索」tab 共用同一套渲染（`buildQualUnifiedList`），改一处两边生效
  - 同 stdCode 下"全部参数"/"部分参数"自动置顶（这类条目代表整张证书覆盖范围，比单项检测更有信号价值）
  - CNAS 订阅详情（注册编号、其他名称、单位地址、认可有效期、证书任务列表）
  - CMA 订阅详情（证书编号、信用代码、地址、行业、证书状态）
  - 实时同步进度显示（`2541/6521 (39%)`），2 秒轮询自动刷新
  - 机构关联（CNAS/CMA 合并显示）
- **公告系统**：
  - 管理员可在设置页"公告管理"创建/编辑/停用/删除 Markdown 公告
  - 所有用户登录后首次进入时自动弹出未读公告，关闭后标记为已读
  - 编辑时可勾选"重置已读"让所有用户再看到一次
  - 首次启动 / 版本升级后，自动拉取对应版本的 GitHub Release Notes 并弹窗展示

## Electron 桌面端

- 系统托盘驻留（右键菜单 / 双击恢复窗口）
- 关闭窗口不退出，最小化到托盘
- 端口配置：默认固定 HTTP 端口 **5937**（首次安装自动写入，便于局域网用户书签同一地址）。设置页可改成其它端口或留空切换随机模式，配 端口可用性检测按钮；端口被占用时自动 fallback 到随机端口（可一键立即重启应用生效）
- 绕过系统代理直连（Clash 等不影响）
- 隐藏默认菜单栏
- 内置 Web 服务启动器：设置页显示本机地址和局域网地址，可复制或用浏览器打开
- LAN 访问支持（绑定 `0.0.0.0`），可在设置页开关控制；关闭后本机 `localhost` 仍可使用，内网访问返回 403
- 开机自启开关（仅桌面端可用）
- 在线更新：启动后轻量检查 GitHub Release；设置页可手动检查、打开下载页、下载并启动 NSIS 安装包
- 下载文件保存到 `用户目录/downloads/bzxz`

## 手机访问

桌面端启动后，同局域网的手机浏览器可直接访问 `http://<lan-ip>:5937/` 使用。

- **入口**：桌面端「设置 → 网页版启动器」卡片，内网行带「📱 手机版」徽章；点复制按钮把地址发到手机即可
- **URL 路由**：`?tab=search|qual|me` 等参数会被 `initRouter()` 还原，刷新/分享深链不丢 tab 状态
- **响应式断点**：`≤640px` 进手机模式 —— 隐藏 sidebar、底部出现 mobile-tabbar（标准 / 资质 / 我），结果卡片单列、批量勾选/快捷键禁用、触控热区 ≥44×44px
- **逃生口**：手机上访问 `?desktop=1` 或在「我」页点「切换到完整版」回到桌面布局（写 `localStorage['bzxz.layout']` 持久化）
- **PWA**：支持 iOS Safari / Android Chrome「添加到主屏」生成独立窗口图标；HTTP 内网部署无 Service Worker，因此**无离线缓存 / 无 Web Push**（详见 [`docs/MOBILE_ADAPTATION.md §6`](./docs/MOBILE_ADAPTATION.md)）
- **不可用功能**：批量下载、用户管理、订阅同步管理在手机端隐藏，需要时用「切换到完整版」逃生口
- **登录策略**：默认即使关掉「需要登录」，LAN 客户端仍要登录（开放桌面模式只对本机 loopback 生效，防 Wi-Fi 上的人匿名进入）。完全可信内网想让手机也直接进，去「用户管理」勾「允许局域网游客 ⚠」（开启时有弹框警告）

## 自动打包 (GitHub Actions)

推送 `main` 分支自动触发 Windows 构建（便携版 + NSIS 安装包）。

- 使用 `npm ci` 安装依赖，保证 Actions 构建可重复
- 打包前自动把版本号设置为 `1.0.<github.run_number>`
- Artifacts 名称包含版本号，便于区分构建产物
- 自动发布 GitHub Release，tag 形如 `v1.0.123`
- Release 上传 `release/*.exe`，桌面端在线更新会优先选择名称包含 `Setup` 的 NSIS 安装包
- Portable 便携版仍提供手动下载，不参与自动安装更新

## 开发指南

### 新增数据源

1. **勘察**：`scripts/sources/<name>/` 下写 Playwright 或 fetch 脚本
2. **文档**：`docs/sources/<name>-source-implementation.md`（或 `-source-plan.md`，参考 labr）
3. **实现**：`src/sources/<name>/` 下实现 `SourceAdapter` 接口（不符合「单 stdCode → 单 PDF」契约的源走独立 service，参考 labr）
4. **注册**：在 `src/services/source-registry.ts` 添加新源；同步更新 `SourceName` / `VALID_SOURCES` / `SUPPORTED_SOURCES` / `SOURCE_LABELS` / `sourceEnum` / `ALL_LIBRARY_SOURCES` / source-semaphore `DEFAULTS` / 前端 `sourceLabel` dict（TS 会通过 `Record<SourceName,...>` 强制提示漏改的点）
5. **凭据**：如需账号密码，按 `.env.local` + `<SOURCE>_USERNAME` / `<SOURCE>_PASSWORD` 命名（见 CLAUDE.md 凭据配置契约）

### SourceAdapter 接口

```ts
interface SourceAdapter {
  readonly source: SourceName;
  searchStandards(input): Promise<StandardSummary[]>;
  getStandardDetail(id): Promise<StandardDetail>;
  detectPreview(id): Promise<PreviewInfo>;
  exportStandard(id, onProgress?): Promise<ExportResult>;
  createDownloadSession?(id): Promise<DownloadSessionInfo>;
  submitDownloadCaptcha?(sessionId, code): Promise<DownloadSessionInfo>;
  autoDownload?(id, maxRetries?): Promise<DownloadSessionInfo>;
}
```

### 测试

```bash
npm test
npm run build
npx tsc -p tsconfig.electron.json --noEmit
```

## 更新日志

完整变更记录见 [CHANGELOG.md](./CHANGELOG.md)。近期重点：

- **polish(mobile): 搜索框两行布局 + 结果卡按钮统一 accent 蓝** — 手机端搜索行重写:第一行 `[input    ][🔍 搜索]`(input padding 横向加大让字 / 光标离边明显,searchBtn order:2 紧贴右),第二行 source-tags wrap 保留勾选能力;search-templates(GB/T 等 chip)手机端全藏。结果卡 2 按钮(详情 + 预览)都改 accent 蓝主色 + 圆角 10px + box-shadow + active 按压反馈,跟桌面 download 视觉同款
- **fix: 标准搜索"预览"按钮 disabled 判定** — 新增 `isPreviewable(r)`:本地有缓存 → 必可点;否则按 `isDownloadable` 判定。"applyLibraryDots" 在 library-check 异步到达后会刷新 disabled 让"刚发现本地命中"的卡按钮翻成可点
- **fix: 标准搜索"下载"按钮 disabled 判定放宽** — 新增 `isDownloadable(r)` 与 `resolveTextState` 解耦:textBadge UI 信号(有/无/检测中)不变,下载按钮判定改放宽到「非废止 + 有源 + (任一源 previewAvailable 或 gbw 还在轮询)」就允许点击。级联模式天然逐源尝试,一源失败跳下一个。"只看可下载"筛选条保持严格口径(用户主动筛选不希望被 optimistic 污染)
- **perf: Labr 搜索首屏一次拉 100 条 + searchCache 接入** — page=1 改并行 `searchInline + recList(pageNo=2, pageSize=100)` merge by did,首屏结果集从 ≤4 条 → 最多 104 条,耗时不变(并行)。`searchInline`/`recList` 加 5min TTL searchCache,重复搜索 / 翻页 = 0 延迟。labr 上游 pageNo 偏移由后端透明处理,前端零改动
- **feat: 手机端搜索 / 资质 / Labr 结果卡片化 v2 + 资质徽章迁移到标准号后** — CNAS/CMA 徽章从标题行 / meta-line 搬到标准号紧后面(`.card-number-row` 新容器),标识紧跟标识。手机端 .result-card / .qual-result-group / .labr-row 统一卡片化(padding 12-14px / border-radius 12px / 明确边界色),信息层级三段清晰:标识行 → 标题 → 元数据(状态/文本/源扁平化成 · 分隔纯文本,不再彩色徽章砌墙)→ 日期 → 操作。手机端结果卡按钮收敛为「详情+预览」2 个(沿用「查阅而非管理」契约)。桌面端零影响
- **feat: 手机端搜索类 tab landing/active 两态布局** — 标准检索 / 资质查询 / Labr 库检索三个 tab 在手机端统一改造:未搜索时搜索框上下居中偏上(`margin-top: 25vh`)+ 隐藏下方所有 UI(模板/source-tag/筛选条/h2/进度条…),聚焦氛围强;用户点搜索后切到 active 态,搜索框 `position: sticky; top: var(--topbar-h)` 吸到 topbar 下方,frosted glass + blur,结果区滚动时常驻顶部。资质 filters 二级 sticky 错位放下面 44px。`switchTab` 切回搜索 tab 时按"DOM 是否已渲出结果"自动判定 idle 还是 active + scroll reset 到顶,方便用户连续使用。桌面端完全不变(规则全部嵌在 `@media (max-width:640px) body:not(.force-desktop)`)
- **fix: 防 0KB / 损坏 PDF 入库（三层下载完整性校验）** — gbw 偶发上游验证码通过后 `viewGb` race 返回空 body,adapter 直接 `writeFile` 入库 → 库里多出无法打开的 0KB PDF。新增 `src/shared/download-integrity.ts` 暴露 `MIN_PDF_BYTES=1024` 阈值 + `assertDownloadedPdf`(size + `%PDF-` magic 严校验,gbw/by/bz 用)+ `assertNonEmptyDownload`(仅 size,labr 用、可能是 doc/docx)。三层防御:L1 各 adapter `writeFile` 前 buffer 校验(gbw 抛错被本函数 catch → status=failed → autoDownloadInner 3 次 OCR 重试循环天然下一轮、其他源走"下载失败"路径)、L2 `addFileToLibrary` 入库前 `fs.stat` srcPath 兜底(漏改 adapter 也拦得住)、L3 `moveDownloadToLibrary` 入口检查 `result.fileSize`(省一次 IO)。所有抛错都带 `[download-integrity]` 前缀,可在 `/api/diagnostics/logs` ring buffer grep 频率。阈值 1024B 留余量(有效空 PDF 700B+,gbw/by 单页起步 5KB+)
- **fix: 资质徽章多源结果增量拉取** — 用户报告搜 `4463`(关键词片段)时结果里的 `QB/T 4463-2025` 没有任何 CMA/CNAS 徽章,但搜 `4463-2025`(精确)时同条结果有 CMA 徽章。根因:`app-search.js` 第一个源(BZ)返回后立即 `qualFetched = true` 锁死,只拉了 BZ 那 20 条 stdCode 的徽章,后到的 GBW/BY 返回的新 stdCode(BZ `size=20` 截断里漏掉的)从来没被问过资质。改:每个源返回都调一次 `fetchQualBadges`,`fetchQualBadges` 内部按 `qualData` 已有 key 过滤出 `pending`(只查新增 stdCode)+ merge 而非 replace。
- **fix: 资质徽章收紧为同号同年命中** — 用户报告搜 `QB/T 4463-2025` 显示有 CNAS,但资质查询页里 CNAS 没有这版(只有 2013 版)。根因:`queryByStdCodes`(批量徽章) 原本用 `std_code_base = ?` 跨年模糊匹配,DB 里只要有同号任意年版资质就会亮徽章,UI 上又没标年版差异 → 用户误以为"2025 版也被 CNAS 认证"。改:`queryByStdCodes` 改用 `std_code_norm IN (...)` 严格同号同年命中。同号不同年视作不同资质(实验室持有 2013 版能力不等于持有 2025 版能力)。**跨年复用需求请走「资质查询」页关键词搜索**(`searchQualifications` 保留 L3 `std_code_base` 兜底,且 UI 列表展示完整带年 `stdCode`,用户明确看到命中年版)。
- **移除 spc 数据源接入** — `spc.org.cn` 这条路走不通,放弃。删除 `src/sources/spc/`、`scripts/sources/spc/`、`docs/sources/spc-source-plan.md`,回退 `SourceName` / `VALID_SOURCES` / `SOURCE_LABELS` / source-semaphore / source-registry / sourceEnum / ALL_LIBRARY_SOURCES / `library_source_priority` 过滤器 / 前端 chip / 前端 download switch / sourceLabel dict / admin 三 cookie endpoint(`GET/POST/DELETE /api/admin/spc/cookie`) / `.env.example` SPC_* 段 / health 测试期望。`settings` 表里历史残留 `spc.cookies` / `spc.cookies_expires_at` 两行不主动清,无害(adapter 已不再读)。
- **#73 fix: `parseLibraryFilename` 放宽 source 前分隔符，救回上一个 bug 砸坏的文件** — 用户报告 `GB_T 24456-2009 BW.pdf`（上一个 bug 砸坏的 V1 文件，缺 ` - `）「统一命名」卡在「无法解析」组，scanLibrary 不入索引 → 「编辑」/「删除」/「统一命名」全用不上。修：正则 `\s*[-—]\s*` → `(?:\s*[-—]\s*|\s+)`，允许「`-`/`—` 或纯空格」当 source 分隔符；重启 scanLibrary 自动捡回，「统一命名」按 V2 pattern 渲染时补回 ` - `。副作用：source label 字典只有 4 个（BW/BZ/BY/LB），手塞 PDF 末尾命中字典的概率极低
- **#73 fix: V1 文件按 V2 pattern 渲染时不再丢 ` - ` 分隔符** — 用户报告 `GB_T 4893.2-2020 - BZ.pdf`（V1）「统一命名」被预览成 `GB_T 4893.2-2020 BZ.pdf`，把规范名劣化掉。根因：`renderLibraryFilename` 处理空 `{title}` 时两侧 sep 用 `left||right`，左 ` `（空格）优先保留把右 ` - ` 吞了。修：两侧 sep 都非空时优先含强分隔字符（`-` / `_` / `·` / `—`）的那一侧，弱 sep（纯空白）让位。V1 文件按默认 V2 pattern 渲染后与原名一致 → willChange=false → 跳过
- **labr fix: 标准号直连中文时不再 fallback 成 `LABR-${did}`** — 实测 `GB/T 35607-2024绿色产品评价 家具`（labr title 标准号末位直接连中文，无 `|` / 空白）抽不出 stdCode → 走 `LABR-${did}` 兜底命名成 `LABR-14718 GB_T 35607-2024绿色产品评价 家具 - LB.pdf`。修：`STD_CODE_FROM_TITLE_RE` 末尾分隔符改 lookahead `(?=[|｜:：\s]|[一-鿿]|$)`，允许 CJK 字符 / 末尾终止；不消费分隔符，rest 切片改用 `m[1].length` + 单独 `^[|｜:：\s]+` strip。原有 9 个 case 全数通过 + 2 个新回归 case。历史 `LABR-${did} ...` 文件需手动改名（库内 std_code 已存成 LABR-xxx）
- **#73 本地文件库：统一命名（批量 + 单文件，含整库快捷入口）** — 库里 V1 (`{stdCode} - {source}.pdf`) 和 V2 (`{stdCode} {title} - {source}.pdf`) 并存 + 手拷杂乱命名，给用户一键统一工具。`computeNormalizedName(input, pattern)` 复用 `parseLibraryFilename` + `renderLibraryFilenameWithExt`，保留原扩展名（labr 可能 docx/xlsx）；V1 title 缺失 → 模板引擎自动剥占位符 → willChange=false（不强行渲染会产生空段）。`renameLibraryFile` helper 抽出，PATCH / normalize 端点共用 rename + abs_path 同步逻辑。新增 `POST /api/preview/file/:id/normalize`（单文件，支持 `?dryRun=1` query）+ `POST /api/preview/files/normalize`（批量，body `{ids?, scope?, dryRun?}`，`scope='all'` 服务端拉全库 ID；三遍扫：compute → self-conflict（小写比对 Windows 文件系统）→ existing-file conflict；dryRun=true 返回 `{preview, libraryTotal}`，dryRun=false 执行）。前端工具栏 `btn-ghost`「统一命名」按钮（启用条件与批量删除一致，配色避让红色批量删除）；点击 → dryRun → `showConfirmHtml`（扩展 `confirmDisabled` + `onMount(overlay)` 钩子）渲改名列表：scope chip「仅选中 N 项 / 整个文件库 M 项」可一键切换（200ms setTimeout 防点击冒泡关闭新弹窗）、3 个 `<details>` 折叠分组（不变 / 冲突 / 无法解析，冲突默认展开）、>20 行带「全部展开」按钮、确认后实际执行。rename modal 重写为 input + 「套用内置格式」prefill 按钮 + 异步 dryRun 实时预览框（`.rename-preview-box` 绿底显示「按内置格式将变为：xxx」，已是内置格式 / 不可解析则灰字提示）。CSS 双写 `pages/local-library.css` + `public/styles.css` 加 `.normalize-chip(.active)` / `.normalize-group(.conflict/.error/.neutral)` 折叠三角动画 / `.rename-preview-box/-label/-name/-skip` 等，所有 oklch 都带 sRGB fallback。V1 title 补全（要跑源 detail）留作 #74
- **#72 资质卡 scope chip + 部分参数限制项 + 全部参数折叠态精简** — 产品标准（GB/T、GB 等含「全部参数」/「部分参数」标记）卡头扫读力度不足。`buildQualUnifiedList` 新增 groupScope 计算（全部参数 ≻ 部分参数 ≻ null），卡头标准名称后渲 `qual-scope-badge` chip（全部=绿、部分=橙）。全部参数组 `collapsible=false`、不渲 body、arrow 替换为 16px 占位；部分参数组在卡头下方长驻 `.qual-scope-limit-row`（聚合该组所有 `limitDesc` 去重、`；` join，橙左竖线 + 6% 橙底），但仍可展开看明细（生效/到期日期）。CSS 双写 `web/src/styles/pages/qualifications.css` + `public/styles.css`，oklch 都带 sRGB fallback。搜索结果卡 `qualBadgeHtml` 不动（hint 维度 vs scope 维度语义不同）
- **#71 搜索结果命中本地库时跳过源拉取** — 用户点搜索结果「下载」时，若绿点亮着（`_libraryFileIds` 有 fileId）+ `download_prefer_local`（默认开）未关，`downloadOne` 走新增的 `downloadFromLocal` → `/api/preview/file/:id?attachment=1`（纯本地流，无 source adapter），零联网。`/api/auth/status` 响应新增 `publicSettings.downloadPreferLocal` 让所有用户拿到全局开关（普通用户拿不到 `/api/admin/settings`）。admin 在「文件库」设置区可关 toggle，保存后通过 `window.bzxzPublicSettings` 当前会话立即生效。命中失败（用户删了物理文件）自动清缓存 + 回退源下载。「指定来源下载」不走短路（保留「我要这个源的版本」语义）。history 记 `r.sources[0]` 而非 `'local'` 避免按源统计被污染
- **#70 Win 桌面端本地文件库 tab 隐藏「下载」按钮** — 桌面端用户可用「打开路径」直接在资源管理器拿物理文件，HTTP 下载多余。`renderFileLibrary` 库结果列 `isElectron === true` 时不渲染 `downloadBtn`；导出文件列不动。Web 浏览器端保留（远程用户唯一拷文件的路径）
- **#69 本地文件库标准号显示修复 + 标准名称列 + 默认命名带 title** — 本地文件库搜「3324」之前看到 `GB3324-2024`（应为 `GB/T 3324-2024`），表头「文件名」实际渲染物理 fileName。修：① `/api/downloads` library 行的 `standardNumber` 改为 `parseLibraryFilename(basename(abs_path)).stdCodeRaw` 反解物理名（带 `/T`，原大小写），不再用归一化列拼装；response 同时新增 `title` 字段。② 默认 `library_filename_pattern` 从 `{stdCode} - {source}` 升级为 `{stdCode} {title} - {source}`（新下载自动落成 `GB_T 3324-2024 木家具通用技术条件 - BW.pdf`；已改过 admin 设置的用户不动）。③ 表头「文件名」改「标准名称」（`public/index.html` + `web/index.html` 双镜像），列内容用 `title || fileName`，tooltip 仍是完整 fileName 便于排查物理路径。老文件批量改名留作 #70 评估（要协调多源限速 / 不同登录链路）
- **#68 桌面安装版 .env.local 配置落地** — `.env.example` 进 `extraResources` + NSIS `customInstall` CopyFiles 到 `$INSTDIR\.env.example` 让用户直接看到模板；`env-loader.ts` 扩展搜索路径加 `dirname(process.execPath)/.env.local`，安装版 / portable 都能命中 exe 同级；NSIS `customUnInit` + `customRemoveFiles` 把 `.env.local` 按"备份-Rename-还原"模式保留，升级 / 重装不丢凭据
- **#67 手机端「下载/收藏」入口双 entry 对齐** — 之前 `web/src/styles/responsive.css:191-206` 已把手机端下载中心、卡片下载/收藏按钮、「只看收藏」chip、「下载历史」入口全部 `display:none`，但 legacy `public/styles.css` 漏了同步 → legacy 入口的手机端还能看到。本次镜像同段 + `app-search.js` 键盘 `d` 加 isMobile early-return（防外接键盘绕过）
- **#66 本地文件库独立成顶级 tab + 完整管理能力** — 把"本地文件库"从「下载历史」tab 抽出来成独立侧边栏入口 `data-tab="local"`，改为表格布局（标准号 / 文件名 / 来源 / 大小 / 时间 / 操作），去掉原"路径"列。每行 5 个动作：`预览`（新 tab 打开 `/api/preview/file/:id`） / `下载`（`?attachment=1`） / `打开路径`（仅 Electron 桌面端显示，通过 IPC 走 `shell.showItemInFolder`；Web 端 fallback 为"复制路径"） / `编辑`（rename 物理文件名，保留 `std_code_norm` 索引键不动） / `删除`（带二次确认 `showConfirm`）。新增表头复选框 + 单行复选 + 「全选 / 批量删除」工具条，批量删走 `POST /api/preview/files/batch-delete`。后端新增 4 个端点：`DELETE /api/preview/file/:id`、`POST /api/preview/files/batch-delete`、`POST /api/preview/file/:id/reveal`（Electron-only，`process.env.BZXZ_ELECTRON` 卡口）、`PATCH /api/preview/file/:id`（rename，校验非法字符 + 防路径越界 + 拒绝覆盖同名）。Electron `electron/main.ts` 加 `BZXZ_ELECTRON=1` + 监听 `process.on('bzxz:reveal-in-folder')` 调 `shell.showItemInFolder`。「下载历史」tab 留下"收藏标准"和"下载历史"两个 card，标题改为"下载历史"，副标题点明"收藏夹用于监控收藏标准是否有新版本"
- **#65 Labr sidebar 文案 + 位置调整** — 把 「Labr库检索」按钮从「资质查询」之后挪到「标准检索」紧下方（高频使用→放高优先级位置）；副标题从 `labr.cc 标准库补给` 简化为 `标准库补给`（不在 UI 中暴露具体上游域名）。`public/index.html` + `web/index.html` 双 entry 镜像；`public/js/app-auth-admin.js` 的 `TAB_LABELS` / `TAB_ITEMS` 同步。README 的"支持的标准源"表行 `labr.cc` 改为 `标准库补给源`（用户向描述），API 表里的 `source=labr` 保留（开发者文档参考）
- **labr #64 双 fix** — ① Labr 搜索结果 title 不再字面出现 `<font color="red">`：`sanitizeLabrTitle` 把上游高亮 `<font>` 整体转 `<mark>` 再统一 escape，规避之前 escape 链没转 `"` 导致白名单正则永远失配的 bug。② labr 入库的标准在主搜索预览也亮绿点：`/api/preview/library-check` 默认改用 4 源全集 `ALL_LIBRARY_SOURCES`（"绿点 = 库里有没有"OR 语义），与 `/api/preview/files` / `runAutoDownload` 的"自动选源"priority 语义解耦
- **labr sidebar 入口镜像到 legacy `public/index.html`** — #62 修复用户装包后看不到 Labr 入口的问题。根因：Electron 装包跑起来加载 `http://localhost:port` → Express 把 `public/` 当静态根 → 实际入口是 legacy `public/index.html`；但 #56 sidebar `<button data-tab="labr">` 与 `<div id="page-labr">` 只加到了 `web/index.html`，#61 也只镜像了 CSS。本次把 sidebar 按钮（qual 之后、stats 之前）+ `#page-labr` 容器 + `<script src="/js/app-labr.js">` 三件套全部镜像到 `public/index.html`。两步切换契约：未来砍 legacy 入口时整段删
- **labr 第 4 标准源接入** — 新增 `labr.cc` 检索 / 下载（独立 service，不挂 SourceRegistry）。`info.kind=0` 直拉文件系统、无配额；`info.kind=1` 需登录 + preview2 链路、5/天硬限速。新 sidebar tab 「Labr库检索」（独立 keyword + 翻页 + 全选/批量下载，下载结果就地渲染、限速被跳过的条目单独提示）。新表 `labr_temp_urls` 跨 token 持久化短时下载链；源级 semaphore=2 防限频；`std_code_norm/_base` 三层归一化沾资质徽章。详见 [`docs/sources/labr-source-plan.md`](./docs/sources/labr-source-plan.md)
- **多源 preview picker** — 同一标准号在库内同时存在多个版本（多年份 / 多扩展名 / 多来源）时，预览顶部展开切换条，按钮显示 `源名 · year · ext`，点击秒切 iframe（跳过 `/preview/request` RTT，候选已确定在库）。仅 overlay 路径实装，popup 路径暂不支持
- **桌面端下载统一入库 + 绿点秒亮** — 三个口子合一：① `triggerDownload` 在 `window.bzxz.isElectron` 时 early-return，避免浏览器再触发一次 `will-download` 把同一份 PDF 重复落到 `Desktop/bzxz/`；② `ExportTaskService.runTask`（BZ/BY 异步 `/export` 路径）补上 `moveDownloadToLibrary` 调用，与 `multi-download`/`auto-download` 同款入库 hook，并把 `fileId` 通过 SSE 末帧透回前端（`ExportTask.fileId/libraryError` + `markSuccess` 携带）；③ 前端 4 个下载入口（`downloadOne` / `downloadSpecificSource` / `downloadSelected` worker / `doCascadeDownload` worker）拿到 `fileId` 后统一调 `markLibraryHit` 写入 `_libraryFileIds` 并 `applyLibraryDots`，下载完按钮右上角绿点几百毫秒内点亮，不必等下次搜索/library-check 触发
- **Electron 桌面端预览跳系统浏览器** — `mainWindow.webContents.setWindowOpenHandler` 拦截渲染进程的 `window.open(http(s)://...)`，调 `shell.openExternal` 走系统默认浏览器（Edge / Chrome）打开 PDF。原生 viewer 的全屏 / 缩放 / 打印 / 另存为体验比 Electron 内嵌 iframe 好得多。前端 `runPreviewWithOverlay` 和 `pollPreviewTask` 检测 `window.bzxz.isElectron` 后改走 `window.open + closePreviewOverlay`，Web 浏览器侧（手机访问）仍然 iframe 渲染。`about:` / `file:` / `javascript:` 等协议 deny 不放行
- **DB 自动备份 + 缺失自愈** — 启动时把 `data/bzxz.db` 用 SQLite Online Backup 复制到 `%APPDATA%\bzxz\bzxz-db-backups\bzxz-<时间戳>.db`（NSIS 永远不动 userData，物理隔离），保留最近 7 份。下次启动若 db 缺失或 < 100 字节自动从最新备份还原 —— 防 commit `0bd54c4` 之前的旧 installer 卸载器 RMDir 把 `data\bzxz.db` 抹掉导致 admin 账号丢失。`GET/POST /api/admin/db/backups` 用于查询 / 手动触发
- **预览优化 Phase 3：轮询提速 + 移除 cache-buster** — 预览自动下载轮询从固定 1500ms 改为「前 5 次 300ms + 之后 1500ms」，CNAS 缓存命中场景从 typical 2-3s 降到 ~500ms。同时移除 iframe URL 的 `?t=Date.now()` cache-buster，让后端 `ETag + must-revalidate` 生效 = 第二次预览同一标准走浏览器 304 缓存几乎瞬间渲染
- **预览优化 Phase 2：预览直跳新 tab** — 热路径（绿点命中）`window.open('/api/preview/file/:fileId')` 跳过 `/api/preview/request` 整轮 RTT，浏览器走 304 缓存即可秒开；冷路径在 click 同一 tick 里 `window.open('about:blank')` 占住新 tab（popup blocker safe），写入 loading 骨架，异步拿到 fileId 后 `popup.location.replace` 跳过去，原生 PDF viewer 接管 = 全屏 / 缩放 / 打印不受 overlay 限制。失败写错误页 + 关闭按钮；popup 被拦截降级到原 overlay+iframe 流程，零功能退化
- **预览优化 Phase 1：本地库批量扫描 + 绿点指示器** — 搜索完成后非阻塞 POST `/api/preview/library-check`（单条 SQL 跑在 `idx_standard_files_lookup` 上，200 条 ≤ 5ms），命中的标准在「预览」按钮右上角叠一个脉冲绿点。用户一眼区分「秒开 vs 要下载」。`_libraryFileIds` 缓存供 Phase 2 复用
- **回退手机端「资质标准号头点击直跳标准搜索」** — 点标准号头应该展开下面的检测项目列表（用户预期），而不是丢上下文跳搜索页。`onQualGroupClick` 函数删掉，onclick 改回 `toggleQualGroup(gid)`，手机端与桌面端行为重新统一
- **手机端去掉下载 / 收藏入口** — 手机定位是「查阅」场景。顶栏下载中心、结果卡下载/收藏按钮、长按菜单对应项、"我"页"下载历史"行、sidebar 历史 tab 全 `display:none`；`toggleSavedStandard` 加 `isMobile()` early-return 防快捷键绕过。详情/预览弹窗 `#previewDownloadBtn` 保留。`?desktop=1` 仍可一键还原桌面布局
- **下载入库加固 + 失败可见性** — `addFileToLibrary` 加 `EBUSY/EPERM/EACCES` retry（4 次指数 backoff，覆盖 Windows AV 锁窗口）+ 跨卷 `.part` 中转。`moveDownloadToLibrary` 失败原因冒到 API 响应 `libraryError` 字段，前端识别 `status:'library_failed'` 标 ⚠ 显示具体 errno，根治"日志报 8/8 成功但库里只有 5 个"灵异。
- **多用户并发适配** — 跨用户下载去重（同标准只跑一次底层 export，subscribers 共享 SSE 流）+ 源级全局信号量（bz=2/gbw=4/by=4，跟前端 `downloadConcurrency` 解耦）+ 删除竞速模式（多用户共享出口 IP 时放大频控风险）。诊断 `/api/diagnostics/sources` 看实时 `{active,limit,waiting}`
- **资质匹配三层防御** — `cleanStdCode` 抓取入库前清洗 + `std_code_norm`/`std_code_base` 归一化列与索引等值匹配；启动时自动回填旧数据 + 清洗历史脏 `std_code`。覆盖全角/无空格/脏空格/ISO 冒号/修订标记变体，根除"搜 `GB/T 3325-2024` 匹不到 `GB/T 3325 -2024` 脏空格变体"等已知 bug。诊断 `/api/admin/qual/diagnose?code=` 一键定位漏命中
- **资质可视化 tab 重构** — 改用与「资质查询-搜索」同款两列布局，标准号分组默认收起，"全部参数"/"部分参数"分组内自动置顶
- **Win7 老浏览器全面兼容** — `scripts/css-oklch-fallback.mjs` 给 34 个 CSS 文件、773 条 `oklch()` declaration 一次性注入 sRGB hex / rgba fallback；新写 oklch 后跑 `npm run oklch:fix`，CI 用 `npm run oklch:check` 守门
- **BZ 下载修复** — packaged Electron 跑 pdf-merge-worker 报 `Cannot find package 'pdf-lib'`：补 `pdf-lib` + `@pdf-lib` + `pako` + `tslib` 到 `asarUnpack`
- **前端模块化（P1）** — `public/styles.css` 1179 行整体拆分为 31 个文件，
  布局在 `web/src/styles/{base,layout,components,pages,responsive,theme}/`。过渡期与原文件
  重复加载、cascade 等价，零视觉回归；详见 [`web/src/styles/SECTIONS.md`](./web/src/styles/SECTIONS.md)
- **1.14.1** — 文本可用性轮询提速：首次 2s→300ms、缓存命中场景视觉延迟 ~2.3s → ~0.3s
- **1.14.0** — 前端大改：tri-state 文本徽章、骨架屏列对齐、状态分组+折叠持久化、source-progress 进度条带、vim 风格键盘导航、右键上下文菜单；移除"正在检测文本…"持久 toast
- **品牌升级** — 产品名统一为「标准盒子 / StandardsBox」；登录页改为深色玻璃拟态，新增版本号 + 在线状态指示；主工作区跟进玻璃拟态主题
- **桌面端端口设置** — 设置页新增"固定端口 + 端口检测"，未指定/被占用自动 fallback 到随机端口
- **打包修复** — `playwright` 改为 runtime dep + asarUnpack，修复 NSIS/portable 包内 CNAS 抓取报 `Cannot find package 'playwright'` 的问题
- **1.12.0** — 启动脚本端口被占自动 fallback，桌面端默认窗口加宽避免下载按钮被挤掉
- **1.11.0** — 诊断面板加"上游延迟统计"，undici pipelining 缓解 GBW 慢握手；BY 内网 isAvailable 加 60s 负缓存
- **1.10.0** — 启动时环境自检（BW/BZ/BY 连通 + OCR worker 预热），异常顶部红条提示
- **1.9.0** — Python OCR 常驻守护进程（OCR 从 1-3s 降到 ~50-200ms）；tesseract 也改单例常驻；下载并发默认 3→5
- **1.8.0** — 整源删除 BZVIP；API 统一 `{ data, error }` 壳 + camelCase；路由前缀重组（旧路径 alias 兼容）；下载端点鉴权；db schema 迁移改用 PRAGMA 列检测

## License

ISC
