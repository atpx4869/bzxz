# Electron Desktop App — Handoff Document

## Current Status (2026-04-28)

Electron 桌面应用 **基本功能已跑通**：TypeScript 编译通过，`npx electron .` 可正常启动窗口并加载 Express 服务。

## 已完成

1. **`electron/main.ts`** — 主进程
   - Express 随机端口启动（`app.listen(0)`）
   - `BrowserWindow` 创建（1280×860, min 900×600）
   - 系统托盘（右键菜单：打开/退出，双击恢复窗口）
   - 关闭窗口不退出（Windows 托盘驻留）
2. **`electron/preload.ts`** — preload 脚本，暴露 `window.bzxz` 供前端判断 Electron 环境
3. **`package.json`** — 添加 `electron:dev` / `electron:build` / `electron:dist` 脚本和 build 配置
4. **`tsconfig.json`** — include electron 目录，exclude release
5. **`start.bat`** — 一键启动脚本

## 待完成

### 1. 托盘图标（小问题）
`electron/main.ts` 第 37-38 行，当前用 `nativeImage.createEmpty()` 创建空图标，托盘能工作但不可见。需要一个 `public/favicon.ico`（16×16 + 32×32 的 .ico 文件），然后改回：

```typescript
function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'favicon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  // ...
```

### 2. 打包测试（需验证）
```bash
# TypeScript 编译
npx tsc -p tsconfig.json

# 打包为 portable .exe（单文件）
npm run electron:build   # → release/bzxz *.exe

# 打包为 NSIS 安装包
npm run electron:dist    # → release/bzxz Setup *.exe
```

**注意**：首次打包会下载 electron-builder 的 win 依赖（~50MB），可能需要几分钟。

### 3. 已知问题 / 注意事项

- **`public/favicon.ico` 不存在** — 目前 public/ 下只有 `index.html` 和 `gbw-captcha.html`，缺应用图标。需要准备一个 .ico 文件放在 `public/favicon.ico`。
- **punycode deprecation** — Electron/Node 内部警告，不影响功能。
- **打包后路径** — `extraResources` 配置了 `data/accounts.json` 和 `scripts/ocr_ddddocr.py`，打包后通过 `process.resourcesPath` 访问，但代码中目前是用 `process.cwd()` 的相对路径。如果打包后运行报找不到文件，需要在 `app.ts` 中区分开发/打包环境的路径。

## 关键命令速查

```bash
# 开发模式（浏览器）
npm run dev                # tsx src/index.ts → http://localhost:3000

# Electron 开发模式
npm run electron:dev       # 编译 → 启动 Electron 窗口

# 一键启动（Windows）
start.bat

# 测试
npm test                   # 11/12 pass（1个因 DNS 超时失败，非代码 bug）

# 打包
npm run electron:build     # portable .exe
npm run electron:dist      # NSIS 安装包
```

## 关键文件结构

```
bzxz/
├── electron/
│   ├── main.ts            # Electron 主进程
│   └── preload.ts         # 预加载脚本
├── src/
│   ├── api/app.ts         # Express API（被 Electron 复用）
│   ├── sources/           # 各数据源适配器
│   └── services/          # 业务逻辑
├── public/
│   ├── index.html         # 前端 SPA
│   └── favicon.ico        # ← 需要添加
├── package.json           # electron:dev/build/dist 脚本 + build 配置
├── tsconfig.json          # include electron/
└── ELECTRON_HANDOFF.md    # 本文档
```

## 电子应用拆包路径适配（打包后需要处理）

`src/api/app.ts` 中 `createApp()` 使用 `process.cwd()` 作为基础路径。在 Electron 打包后 `process.cwd()` 指向 asar 所在目录，`extraResources` 中的文件不在 `process.cwd()` 下。如果打包后运行报 `data/accounts.json not found`，需要：

```typescript
// 在 app.ts 顶部判断环境
const BASE_DIR = process.resourcesPath 
  ? path.join(process.resourcesPath, '..')  // 打包后
  : process.cwd();                            // 开发时
```
