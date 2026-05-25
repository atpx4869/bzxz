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

- **搜索**：按标准号/关键词搜索资质记录，支持来源过滤（CNAS/CMA/全部）
- **可视化**：批量关键词查询，按标准号聚合展示 CMA/CNAS 能力，统计面板显示命中数、能力数、过期记录
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
- 标准号模糊匹配：去除年份/类型后缀后比对（如 `GB/T 23440-2009` → `GB23440`）
- 后台定时同步：默认每周日凌晨 3 点（可配置 cron 表达式）

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
├── scripts/             # 勘察脚本 + 注册机 + OCR 桥接
├── src/
│   ├── api/             # Express 路由（含 auth/admin/stats/资质）
│   ├── domain/          # 领域模型 + SourceAdapter 接口
│   ├── services/        # 业务逻辑 + SQLite 数据库 + 使用追踪
│   │   ├── cnas-scraper.ts   # CNAS Playwright 采集器
│   │   ├── cma-scraper.ts    # CMA 采集器
│   │   └── qualification-service.ts  # 资质同步调度
│   ├── shared/          # 工具函数（ID解析/错误/路径）
│   └── sources/         # 数据源适配器
│       ├── bz-zhenggui/ # BZ 标准在线
│       ├── gbw/         # BW 国标网
│       ├── by/          # BY 内部网
│       └── shared/      # OCR 验证码工具
├── docs/                # 源实现文档
└── data/                # SQLite 数据库 (bzxz.db, .gitignore)
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

### 统计（需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/summary` | 汇总计数 |
| GET | `/api/stats/timeseries` | 每日趋势数据 |
| GET | `/api/stats/by-source` | 来源分布 |
| GET | `/api/stats/by-user` | 用户分布（仅 admin） |
| GET | `/api/stats/recent` | 近期事件列表 |

## 前端功能

- 现代深色毛玻璃主题（oklch 色彩空间 + backdrop-filter）
- 免登录模式（默认开启，无需注册即可使用）
- 多源并行搜索 + 去重 + 状态排序
- 搜索结果自动标注 CNAS/CMA 资质能力（绿色徽章）
- 卡片式结果展示（进场动画）
- 批量勾选下载 + 进度条 + 完成通知
- 新版**深色玻璃拟态**登录页（紫蓝渐变 + 浮动光球 + 模糊磨砂卡片），底部内联应用版本号 + `/api/health` 实时在线状态徽标
- 主题统一：topbar / sidebar / 卡片 / 主按钮均采用同色系玻璃拟态 + 渐变 active 态
- **后端自动切源下载**：批量下载时后端按优先级自动尝试多个源，失败自动切换
- 行级下载反馈（spinner + 卡片高亮 + 成功/失败闪烁）
- BZ 页级实时进度
- 搜索历史（可配置条数 3~20，localStorage 持久化）
- 常用标准收藏、本地文件库、下载历史
- 键盘快捷键：全局 `Ctrl+K` 聚焦搜索 / `Ctrl+Enter` 触发 / `Ctrl+A` 全选 / `Ctrl+D` 取消 / `Alt+1..6` 切源；结果列表 vim 风格 `j` `k` `g g` `G` `x` `d` `s` `Enter`（详见 [DEVELOPMENT.md](./DEVELOPMENT.md#前端键盘快捷键)）
- 结果行右键菜单：复制编号 / 复制标题 / 查看详情 / 单条下载
- 状态分组（现行 / 即将实施 / 其它 / 废止）默认折叠 `废止`，折叠状态持久化
- BW 自动 OCR 验证码 + 后台文本可用性检测（乐观 UI，搜索即可下载）
- 搜索状态指示器：右下角 toast「正在搜索 → 搜索中 N/M 源」+ 卡片级文本可用性 tri-state 徽章（检测中脉冲点 / 有正文 / 无正文）+ 顶部 source-progress 进度条带
- 下载模式设置（顺序/竞速）、下载优先级、并发数和超时时间（持久化）
- 数据源健康检测（设置页手动检测 + 单源重试）
- 底部日志面板 + 执行历史
- 登录/注册界面 + 用户菜单
- 使用统计仪表盘（Chart.js 图表）
- 管理员用户管理面板（批量操作、权限控制、使用明细）
- 资质能力验证面板：
  - 搜索/可视化/订阅管理/同步日志 四个子标签页
  - 搜索结果自动标注 CNAS/CMA 资质徽章（hover 详情）
  - 可视化批量查询，按标准号聚合 CMA/CNAS 能力并排展示
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
2. **文档**：`docs/sources/<name>-source-implementation.md`
3. **实现**：`src/sources/<name>/` 下实现 `SourceAdapter` 接口
4. **注册**：在 `src/services/source-registry.ts` 添加新源

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
