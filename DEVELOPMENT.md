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
└── sources/
    ├── bz-zhenggui/               # bz源实现
    │   └── bz-zhenggui-adapter.ts
    ├── gbw/                       # gbw源实现
    │   ├── gbw-adapter.ts
    │   └── gbw-download-session-store.ts
    └── shared/
        └── captcha-ocr.ts         # 验证码OCR (ddddocr→tesseract)
```

## SourceAdapter 接口

`src/domain/standard.ts` 定义了所有源必须实现的接口：

```ts
interface SourceAdapter {
  source: 'bz' | 'gbw';
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
| playwright | bz源的 SPA 页面驱动 |
| cheerio | gbw详情页 HTML 解析 |
| sharp + tesseract.js | 验证码 OCR（回退方案） |
| ddddocr (Python) | 验证码 OCR（首选，需python环境） |
| pdf-lib | PDF 合成 |

## 常用命令

```bash
npm run dev              # 开发启动（tsx 热更新）
npm run build            # 编译
npm test                 # 运行测试
npm run inspect:source   # bz源搜索勘察
npm run inspect:detail   # bz源详情勘察
npm run inspect:gbw:source   # gbw源搜索勘察
npm run inspect:gbw:detail   # gbw源详情勘察
npm run inspect:gbw:showgb   # gbw下载页勘察
```

## API 快速参考

```powershell
# health
curl.exe "http://localhost:3000/api/health"

# 搜索(bz)
curl.exe "http://localhost:3000/api/standards/search?q=3324-2017&source=bz"

# 搜索(gbw)
curl.exe "http://localhost:3000/api/standards/search?q=3324-2024&source=gbw"

# 详情
curl.exe "http://localhost:3000/api/standards/bz:443847"
curl.exe "http://localhost:3000/api/standards/gbw:25940C3CEF158A9AE06397BE0A0A525A"

# gbw自动下载
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/standards/gbw:{id}/auto-download"
```

## 导出文件

`data/exports/` 目录，已加入 `.gitignore`。

## 注意事项

- bz源需要 Playwright 驱动浏览器，耗时较长
- gbw自动下载依赖 Python 的 ddddocr，识别失败会自动回退 tesseract.js
- 任务状态为内存存储，服务重启丢失（导出文件保留）
- Windows 下 curl 是 PowerShell 别名，使用 `-Method Post` 代替 `-X POST`
