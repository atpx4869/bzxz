# bzxz 开发指南

## 快速开始

```bash
git clone https://github.com/atpx4869/bzxz.git
cd bzxz
npm install
pip install ddddocr
npm run build
npm run dev
```

服务启动后访问 `http://localhost:3000/api/health` 确认可用。

## 项目架构

### 后端（src/）

```
src/
├── index.ts                       # 入口
├── api/app.ts                     # Express路由（所有端点在这）
├── domain/standard.ts             # SourceAdapter接口 + 领域模型
├── services/
│   ├── standard-service.ts        # 标准搜索/详情服务
│   ├── export-task-service.ts     # 导出任务队列
│   ├── export-task-store.ts       # 任务状态存储
│   └── source-registry.ts         # 源注册表（新增源改这）
├── shared/
│   ├── pooled-fetch.ts            # 带并发池的 fetch 封装
│   ├── page-cache.ts              # 分页结果磁盘缓存
│   └── text-availability-cache.ts # gbw 文本可用性缓存
└── sources/
    ├── bz-zhenggui/               # bz源实现
    │   └── bz-zhenggui-adapter.ts
    ├── by/                        # by源实现
    │   └── by-adapter.ts
    ├── gbw/                       # gbw源实现
    │   ├── gbw-adapter.ts
    │   └── gbw-download-session-store.ts
    └── shared/
        └── captcha-ocr.ts         # 验证码OCR (ddddocr→tesseract)
```

### 前端（public/）

无构建步骤，原生 ESM 模块按职责拆分：

| 模块 | 职责 |
|------|------|
| `js/app-core.js` | 全局状态、消息提示、source pill 控件 |
| `js/app-search.js` | 搜索、结果渲染（卡片/分组/骨架屏）、键盘导航、右键菜单、文本可用性轮询 |
| `js/app-download.js` | 单个下载、验证码弹窗 |
| `js/app-complete.js` | 批量导出 + 任务进度面板 |
| `js/app-settings.js` | 配置项 UI |
| `js/app-detail-utils.js` | 详情页字段格式化共享逻辑 |
| `js/app-auth-admin.js` | 登录/注册/管理员视图 |
| `js/app-announcements.js` | 公告轮播 |
| `js/app-qual.js` | 资质/许可证模块 |

样式集中在 `public/styles.css`，使用 OKLCH 色变量 + DM Sans/DM Mono/Source Serif 4 字体栈。

### 持久化文件（data/）

| 文件/目录 | 作用 |
|-----------|------|
| `bzxz.db` | better-sqlite3 主库（用户、任务） |
| `.server-port` | 上次启动端口，用于 electron 重连 |
| `.page-cache.json` | 搜索分页 JSON 缓存 |
| `.text-availability-cache.json` | gbw 全文可用性缓存 |
| `exports/` | 导出产物（已 .gitignore） |

## SourceAdapter 接口

`src/domain/standard.ts` 定义了所有源必须实现的接口：

```ts
interface SourceAdapter {
  source: 'bz' | 'gbw' | 'by';
  searchStandards(input): Promise<StandardSummary[]>;
  getStandardDetail(id): Promise<StandardDetail>;
  detectPreview(id): Promise<PreviewInfo>;
  exportStandard(id): Promise<ExportResult>;
  createDownloadSession?(id): Promise<DownloadSessionInfo>;
  submitDownloadCaptcha?(sessionId, code): Promise<DownloadSessionInfo>;
}
```

新增源实现此接口即可。

## 新增源的步骤

1. **勘察**：`scripts/sources/<name>/` 下写 Playwright 或 fetch 脚本，摸清站点行为
2. **文档**：`docs/sources/<name>-source-implementation.md`
3. **实现**：`src/sources/<name>/` 下实现 `SourceAdapter`
4. **注册**：在 `src/services/source-registry.ts` 添加新源

## 关键依赖

| 依赖 | 用途 |
|------|------|
| express | API 框架 |
| playwright | bz源预览分页检测 + gbw下载页 |
| cheerio | gbw详情页 HTML 解析 |
| sharp + tesseract.js | 验证码 OCR（回退方案） |
| ddddocr (Python) | 验证码 OCR（首选，需python环境） |
| pdf-lib | PDF 合成 |

## 常用命令

```bash
npm run dev              # 开发启动（tsx 热更新）
npm run build            # 编译
npm test                 # 运行测试
npm run inspect:gbw:source   # gbw源搜索勘察
npm run inspect:gbw:detail   # gbw源详情勘察
npm run inspect:gbw:showgb   # gbw下载页勘察

npm run oklch:fix        # 给所有 CSS 里 oklch() 注入 sRGB fallback（Win7 Chrome 兼容）
npm run oklch:check      # 只检查，有未配对 oklch 退非零（CI 守门）
```

> **写新 oklch() 后必跑 `npm run oklch:fix`**。oklch 要 Chrome 111+，Win7 Chrome 最高 109 整条 declaration 解析失败 → 主题崩。脚本扫 `public/styles.css` + `web/src/styles/**/*.css`，给每条 `xxx: oklch(...)` 插一条等价 `xxx: #RRGGBB` 在前面；幂等，可反复跑。色值经 OKLab → sRGB + gamut mapping（保 L、保 h、二分搜最大 C），不会偏色。

## API 快速参考

```powershell
# health
curl.exe "http://localhost:3000/api/health"

# 搜索
curl.exe "http://localhost:3000/api/standards/search?q=3324-2024&source=bz"
curl.exe "http://localhost:3000/api/standards/search?q=3324-2024&source=gbw"

# 详情
curl.exe "http://localhost:3000/api/standards/bz:443847"
curl.exe "http://localhost:3000/api/standards/gbw:25940C3CEF158A9AE06397BE0A0A525A"

# 导出
curl.exe -X POST "http://localhost:3000/api/standards/bz:443847/export"

# gbw自动下载
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/standards/gbw:{id}/auto-download"
```

## 前端键盘快捷键

> ⚠️ `≤640px` 手机模式下整套快捷键禁用（无物理键盘 + 触控热区优先）。手机端用底部 tabbar 切换页面、长按结果行打开操作。

结果列表聚焦时（点击任意结果行后自动激活）：

| 键 | 作用 |
|----|------|
| `j` / `↓` | 下一行 |
| `k` / `↑` | 上一行 |
| `g g` | 跳到首行 |
| `G` | 跳到末行 |
| `x` | 切换勾选 |
| `d` | 单条下载 |
| `s` | 查看详情 |
| `Enter` | 打开当前行详情 |
| `Esc` | 取消激活 / 关闭右键菜单 |

全局：

| 键 | 作用 |
|----|------|
| `Ctrl + K` | 聚焦搜索框 |
| `Ctrl + Enter` | 触发搜索 |
| `Ctrl + A` | 全选当前结果 |
| `Ctrl + D` | 取消全选 |
| `Alt + 1..6` | 切换 source pill |

右键任意结果行可打开上下文菜单（复制编号、复制标题、查看详情、单条下载…）。

## 手机端调试

桌面端启动后，同 Wi-Fi 下手机浏览器直接访问 `http://<lan-ip>:5937/` 即可调试（默认端口固定 5937，见「设置 → 网页版启动器」内网地址）。

- **断点**：`@media (max-width:640px)` 进手机布局；`?desktop=1` 或写 `localStorage['bzxz.layout']='desktop'` 逃回桌面版
- **路由还原**：`?tab=search|qual|me` 由 `initRouter()` 还原，可直接深链分享/刷新
- **桌面浏览器模拟**：Chrome DevTools → Toggle device toolbar → 选 iPhone/Android 预设，刷新触发 mobile-only DOM 路径（如 mobile-tabbar）
- **PWA 验证**：`chrome://inspect` 远程调试手机；在 iOS Safari「添加到主屏」后从主屏图标启动，验证 `display: standalone` + 状态栏色
- **不可用功能**：`≤640px` 隐藏批量下载、用户管理、订阅同步管理 —— 需要时点「我」页「切换到完整版」（写 `localStorage['bzxz.layout']='desktop'`）

详细规划与边界见 [`docs/MOBILE_ADAPTATION.md`](./docs/MOBILE_ADAPTATION.md)。

## 导出文件

`data/exports/` 目录，已加入 `.gitignore`。

## 注意事项

- bz源搜索/详情走 REST API，仅分页数探测用到 Playwright
- gbw自动下载依赖 Python 的 ddddocr，识别失败会自动回退 tesseract.js
- 任务状态为内存存储，服务重启丢失（导出文件保留）
- Windows 下 curl 是 PowerShell 别名，使用 `-Method Post` 代替 `-X POST`
