# bzxz 移交文档

## 当前状态 (2026-04-29)

Electron 桌面应用 + Web 版均可正常使用。所有已知路径/代理/命名问题已修复。

## 功能清单

### 搜索
- 4 个数据源：BZ（标准在线）、GBW（国标网）、BY（内部网）、BZVIP（VIP账号）
- 支持多源搜索去重，同一标准号合并结果
- 批量解析标准号（粘贴换行分隔的标准号列表）

### 下载
- 竞速模式（多源同时竞争，取最快完成）
- 级联模式（按优先级逐源尝试）
- 批量下载（N 并发，进度条 + 日志）
- 单条下载带逐行状态反馈（按钮 spinner、卡片高亮、成功/失败闪烁）
- BZ 下载页级进度实时显示（如 `BZ 下载 12/45 页`）
- 完成日志显示文件大小和耗时
- 统一文件命名：`标准号 标准名称.pdf`

### 桌面端特性
- 系统托盘驻留（右键菜单：打开/退出，双击恢复窗口）
- 关闭窗口不退出
- 自动选择随机端口
- 下载文件保存到用户 downloads/bzxz（可自定义）
- 绕过系统代理直连（Clash 等不影响）
- 隐藏默认菜单栏
- LAN 访问支持（绑定 0.0.0.0）

### 一键启动
- `start.bat` — 自动检测 Node.js（fnm/nvm/manual/standard），npm install 缺依赖，启动服务 + 打开浏览器
- `start.vbs` — 无窗口静默启动

## 关键命令速查

```bash
npm run dev                # Web 开发模式 → http://localhost:3000
npm run electron:dev       # Electron 开发模式
npm run build              # TypeScript 编译
npm run electron:build     # portable .exe
npm run electron:dist      # NSIS 安装包
npm test                   # 测试
start.bat                  # Windows 一键启动
```

## 项目结构

```
bzxz/
├── electron/
│   ├── main.ts            # Electron 主进程（Express + BrowserWindow + Tray）
│   └── preload.ts         # 预加载脚本
├── src/
│   ├── index.ts           # Web 版入口
│   ├── api/app.ts         # Express API
│   ├── domain/standard.ts # 领域类型定义
│   ├── services/          # 业务逻辑（任务队列、标准解析）
│   ├── sources/           # 4 个数据源适配器
│   │   ├── bz-zhenggui/   # BZ 标准在线（Playwright 截图 + 逐页下载）
│   │   ├── gbw/           # GBW 国标网（验证码识别 + 下载）
│   │   ├── by/            # BY 内部网
│   │   ├── bz-vip/        # BZVIP 会员（账号池 + 打码）
│   │   └── shared/        # OCR 验证码工具
│   └── shared/            # 通用工具（路径、错误、ID 解析）
├── public/
│   ├── index.html         # 前端 SPA
│   ├── favicon-256.png    # 应用图标
│   └── favicon-32.png     # 托盘图标
├── scripts/               # Python OCR 脚本
├── data/                  # 运行时数据（账号、导出文件）
├── package.json
├── tsconfig.json
├── start.bat / start.vbs  # 一键启动
└── ELECTRON_HANDOFF.md    # 本文档
```

## 核心设计决策

### 路径解析（getter 函数）
所有路径常量用 getter 函数（`getRootDir()`, `getExportsDir()`）而非模块级常量，原因：Electron 打包后 `BZXZ_BASE_DIR` 由 main.ts 在运行时设置，模块级常量在 import 时就固化，会指向错误目录。

### 代理直连
Node.js `fetch()` (undici) 会使用 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量。入口文件（`src/index.ts` 和 `electron/main.ts`）在所有 import 之前清除这些变量 + 设置 `NO_PROXY='*'`。Chromium 渲染进程通过 `session.defaultSession.setProxy({ mode: 'direct' })` 绕过。

### 跨源 ID 映射
搜索结果去重时保留 `_sourceIds` map，记录每个源的专属 ID。下载时用源专属 ID 调用对应适配器，避免 BZ 标准号传给 GBW 适配器。

### BZ 逐页进度
BZ 适配器逐页下载，每完成一页回调 `onProgress(current, total)`。`ExportTaskService` 将进度写入 `ExportTaskStore`。前端轮询 `/api/tasks/:id` 时读取 `currentPage`/`totalPages`，实时显示页级进度。

### 下载日志系统
`addLog(msg, status)` 返回 ID，`updateLog(id, msg, status)` 更新同一条目。避免 BZ 轮询刷屏，同一条日志持续更新显示最新进度。

## 打包注意事项

1. `extraResources` 配置了 `public/`, `scripts/`, `data/` 到 `resources/`。打包后通过 `process.resourcesPath` 访问。
2. 打包后 `process.cwd()` 指向 asar 所在目录，不适用于数据文件读写。必须用 `BZXZ_BASE_DIR` 环境变量（指向 `resourcesPath`）。
3. 图标文件 `public/favicon-256.png` 和 `public/favicon-32.png` 已就绪。
4. 首次打包需下载 electron-builder win 依赖（~50MB）。
