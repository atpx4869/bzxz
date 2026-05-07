# bzxz — 多源标准检索与批量下载

面向团队的标准检索与文档导出系统。Web 前端 + Express API + SQLite + Electron 桌面壳。

## 支持的标准源

| 源 | 代号 | 搜索 | 导出 |
|---|---|---|---|
| bz.gxzl.org.cn | `bz` | JSON API | 逐页 JPEG → pdf-lib 合并 PDF |
| openstd.samr.gov.cn | `gbw` (显示为 BW) | JSON API | ddddocr 验证码 → 直接 PDF |
| std.samr.gov.cn | `by` | JSON API | 直接 PDF |
| bzuser.gxzl.org.cn | `bzvip` | 需登录 | 账号池 + JWT → 直链 PDF |

## 快速开始

### 环境

- Node.js ≥ 18
- Python ≥ 3.8 + ddddocr（仅 BW 源需要）

```powershell
npm install
pip install ddddocr
npm run build
node dist/src/index.js
```

打开 `http://localhost:3000`，首次访问自动进入注册页面（首个用户为管理员）。

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

## 账号管理

基于 SQLite 的本地用户体系，无需外部数据库。

- **注册**：首个注册用户自动成为管理员，后续默认普通用户
- **登录**：Session Cookie（HttpOnly，30 天滑动续期）
- **管理员功能**：
  - 开启/关闭公开注册
  - 用户增删改查（角色、启用/禁用）
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
├── public/              # 前端 SPA (index.html)
├── scripts/             # 勘察脚本 + 注册机 + OCR 桥接
├── src/
│   ├── api/             # Express 路由（含 auth/admin/stats）
│   ├── domain/          # 领域模型 + SourceAdapter 接口
│   ├── services/        # 业务逻辑 + SQLite 数据库 + 使用追踪
│   ├── shared/          # 工具函数（ID解析/错误/路径）
│   └── sources/         # 数据源适配器
│       ├── bz-zhenggui/ # BZ 标准在线
│       ├── gbw/         # BW 国标网
│       ├── by/          # BY 内部网
│       ├── bz-vip/      # BZVIP 会员
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
| POST | `/api/standards/:id/download-session` | 创建下载会话 |
| POST | `/api/download-sessions/:id/verify` | 提交验证码 |
| GET | `/api/download-sessions/:id` | 查询下载会话 |
| POST | `/api/standards/resolve` | 批量解析标准号 |
| POST | `/api/standards/complete` | Excel 批量导入+解析 |
| GET | `/api/tasks/:taskId` | 查询导出任务状态 |
| GET | `/api/tasks/:taskId/stream` | SSE 实时任务进度 |
| GET | `/api/downloads/:filename` | 下载导出文件 |

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

- 多源并行搜索 + 去重 + 状态排序
- 卡片式结果展示（进场动画）
- 批量勾选下载 + 进度条 + 完成通知
- 行级下载反馈（spinner + 卡片高亮 + 成功/失败闪烁）
- BZ 页级实时进度
- 搜索历史（可配置条数 3~20，localStorage 持久化）
- 键盘快捷键（`Ctrl+K` 搜索 / `Ctrl+Enter` 确认 / `Esc` 关闭 / `?` 查看）
- BW 自动 OCR 验证码
- 下载优先级设置（持久化）
- 底部日志面板 + 执行历史
- 登录/注册界面 + 用户菜单
- 使用统计仪表盘（Chart.js 图表）
- 管理员用户管理面板（含使用明细）

## Electron 桌面端

- 系统托盘驻留（右键菜单 / 双击恢复窗口）
- 关闭窗口不退出，最小化到托盘
- 自动选择随机端口
- 绕过系统代理直连（Clash 等不影响）
- 隐藏默认菜单栏
- LAN 访问支持（绑定 0.0.0.0）
- 下载文件保存到 `用户目录/downloads/bzxz`

## 自动打包 (GitHub Actions)

推送 `main` 分支自动触发 Windows 构建（便携版 + NSIS 安装包），产物在 Actions → Artifacts 下载。

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
```

## License

ISC
