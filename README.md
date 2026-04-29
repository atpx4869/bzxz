# bzxz — 多源标准检索与批量下载

面向自用的标准检索与文档导出系统。Web 前端 + Express API + Electron 桌面壳。

## 当前支持的标准源

| 源 | 代号 | 搜索 | 导出 |
|---|---|---|---|
| bz.gxzl.org.cn | `bz` | JSON API | 逐页 JPEG → pdf-lib 合并 PDF |
| openstd.samr.gov.cn | `gbw` | JSON API | ddddocr OCR 验证码 → 直接 PDF |
| bzuser.gxzl.org.cn | `bvip` | 需登录 | 账号池 + JWT token → 直链 PDF |

## 快速开始

### 环境

- Node.js ≥ 18
- Python ≥ 3.8 + ddddocr

```powershell
npm install
pip install ddddocr
npm run build
node dist/src/index.js
```

打开 `http://localhost:3000`。

### 一键启动 (Windows)

```bat
start.bat
```

## 运行模式

| 模式 | 命令 | 说明 |
|------|------|------|
| Web 开发 | `npm run dev` | tsx 热重启 |
| Web 生产 | `node dist/src/index.js` | 编译后运行 |
| Electron 桌面 | `npm run electron:dev` | 本地窗口 + 托盘 |
| Electron 打包 | `npm run electron:build` | 输出 `release/*.exe` 便携版 |

## 目录结构

```
├── .github/workflows/   # GitHub Actions 自动打包
├── electron/            # Electron 主进程 + preload
├── public/              # 前端静态文件 (index.html)
├── scripts/             # 勘察脚本 + 注册机 + OCR 桥接
├── src/
│   ├── api/             # Express 路由
│   ├── domain/          # 领域模型
│   ├── services/        # 业务逻辑
│   ├── shared/          # 工具函数
│   └── sources/         # 数据源适配器 (bz/gbw/bzvip)
└── data/exports/        # 导出文件 (.gitignore)
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/standards/search?q=&source=` | 搜索 |
| GET | `/api/standards/:id` | 详情 |
| POST | `/api/standards/:id/preview/detect` | 探测预览 |
| POST | `/api/standards/:id/export` | 导出（bz/bvip） |
| POST | `/api/standards/:id/auto-download` | gbw 自动验证码下载 |
| POST | `/api/download-sessions/:id/verify` | 提交验证码 |
| GET | `/api/downloads/:filename` | 下载导出文件 |
| POST | `/api/upload` | Excel 批量导入 |
| POST | `/api/resolve` | 多源解析 |

## 自动打包 (GitHub Actions)

推送 `main` 分支自动触发 Windows 便携版构建，产物在 Actions → Artifacts 下载。

## 前端功能

- 多源并行搜索 + 去重 + 状态排序
- 卡片式结果展示
- 批量勾选下载 + 进度条
- gbw 自动 OCR 验证码
- 下载优先级设置（持久化）
- 底部日志面板 + 执行历史

## 前端功能

- 多源并行搜索 + 去重 + 状态排序
- 卡片式结果展示（进场动画）
- 批量勾选下载 + 进度条 + 完成通知
- 行级下载反馈（spinner + 卡片高亮 + 成功/失败闪烁）
- BZ 页级实时进度
- 搜索历史（最近 10 条 + localStorage 持久化）
- 键盘快捷键（`Ctrl+K` 搜索 / `Ctrl+Enter` 确认 / `Esc` 关闭 / `?` 查看）
- GBW 自动 OCR 验证码
- 下载优先级设置（持久化）
- 底部日志面板 + 执行历史

## TODO

- [ ] 详情抽屉面板 — 右侧滑入，不遮挡结果列表
- [ ] 搜索结果筛选栏 — 按来源/状态即时过滤
- [ ] 搜索结果统计条 — 聚合显示各源/各状态数量
- [ ] 空状态插图 — 搜索无结果时展示 SVG 引导
- [ ] 暗色/亮色主题切换 — 跟随系统 + 手动切换
- [ ] 下载队列面板 — 独立进度条、暂停/取消、拖拽排序
- [ ] 结果导出 CSV — 搜索结果导出为文件
- [ ] 搜索建议/自动补全 — 输入时联想标准号

## 测试

```bash
npm test
```
