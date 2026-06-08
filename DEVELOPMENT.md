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

## Node 环境（fnm）—— 新 shell 跑 npm 前先激活

本机 Node 由 **fnm**（Fast Node Manager，自身用 WinGet 装）管理，默认版本 **v22.22.3**（满足 `engines.node >=20`）。

fnm 跟 nvm-windows 不一样：**它不往全局 PATH 塞固定目录**，每开一个 shell 要先注入当前版本的路径，否则 `where node` 找不到、`npm` 也跑不了。新开的 PowerShell 里先跑：

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression
node -v        # 应打印 v22.22.3
npm -v
```

永久生效（写进 `$PROFILE`，以后每开窗口自动激活，还会在 `cd` 进带 `.node-version` / `.nvmrc` 的目录时自动切版本）：

```powershell
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
Add-Content $PROFILE 'fnm env --use-on-cd | Out-String | Invoke-Expression'
```

仓库根放了 `.node-version`（内容 `22`），配合上面的 `--use-on-cd`：`cd` 进项目时 fnm 会自动切到 Node 22，换机器 / CI 上不会版本飘。

> 排障：`where node` 报 `Could not find files` 基本就是「fnm 没激活」，跑上面那条 `fnm env` 即可，不必重装 Node。

## 本地调试 / 测试入口

> 构建 / 打包以 GitHub Actions 为准。PR Check 跑 `npm run build → npm test → npm run oklch:check`；`main` 打包 workflow 在同样检查通过后再跑 Electron portable + NSIS。下面几条是**交互调试**用的，按要验证的东西挑。

迁移期有 **两个前端入口**，验证设置面板等改动时要分清在哪个入口看：

| 入口 | 启动 | 看什么 | 说明 |
|------|------|--------|------|
| **legacy（Express 直供 public/）** | `npm run dev` | `http://localhost:3000` | 无构建步骤，改完 `public/**` 刷新即见。覆盖绝大多数设置页交互（源优先级拖拽、资质订阅、网页版/端口卡片的浏览器态） |
| **web 镜像（迁移脚手架）** | 暂无独立 dev server | `web/index.html` / `web/src/**` | 计划态镜像；当前仓库没有 `web/package.json`，改 `public/index.html` 的入口结构时同步检查 `web/index.html`，迁移路线见 `docs/MIGRATION.md` |
| **桌面端（Electron）** | `npm run electron:dev` | Electron 窗口 | 只有这里 `hasDesktopXApi()` 为真，**桌面专属卡片**（网页服务开关 / 端口设置 / 开机自启 / 应用更新）才会点亮；浏览器入口里它们显示「仅桌面端」 |

改了 CSS / oklch 后必跑：

```powershell
npm run oklch:check      # 有未配对 oklch 退非零（CI 同款守门）；要自动补 fallback 用 npm run oklch:fix
```

设置面板这类纯前端改动的最小验证闭环：`npm run dev` 开 legacy 入口看交互 → 桌面卡片用 `npm run electron:dev` 复核 → `npm run oklch:check` 守 CSS → push 让 Action 跑全量 typecheck/test/build。

## 新机器 / 新 shell 第一次提交前 —— PowerShell UTF-8 配置（**强制**）

Windows PowerShell 5.1 默认 `$OutputEncoding` 是 GBK，**直接 `git commit -m "中文"` 会被转成 `??`** 写进 commit object，事后看 `git log` 永远是问号、无法恢复。新机器或新开的 PS 窗口里第一次提交前先跑：

```powershell
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
git config --global i18n.commitencoding utf-8
git config --global i18n.logoutputencoding utf-8
git config --global core.quotepath false
```

后三条 `git config --global` 写一次就永久生效。前四条 `chcp` / `$OutputEncoding` 每次新开 PS 窗口都要重跑 —— 推荐塞进 `$PROFILE`。

**长 commit message**（带 why / how 多段）用 here-string + 写临时文件 + `git commit -F` 最稳：

```powershell
$msg = @"
第一行扼要
（空行）
Why: ...
How: ...
"@
[System.IO.File]::WriteAllText("$PWD\.git\COMMIT_EDITMSG_tmp", $msg, (New-Object System.Text.UTF8Encoding $false))
git commit -F .git\COMMIT_EDITMSG_tmp
Remove-Item .git\COMMIT_EDITMSG_tmp
```

`Set-Content -Encoding utf8NoBOM` 只在 PS 7+ 可用，PS 5.1 会报「无法绑定参数 Encoding」—— 用上面 `[System.IO.File]::WriteAllText` 兜底。

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
    ├── labr/                      # labr 标准库补给源（独立 service，不挂 SourceRegistry）
    │   ├── labr-client.ts
    │   └── labr-service.ts
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
  source: 'bz' | 'gbw' | 'by';  // labr 走独立 service，不实现此接口
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
npm run build            # TypeScript 编译（CI 同款；本机按需跑，不代替 Actions）
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
