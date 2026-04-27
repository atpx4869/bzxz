# bzxz - 标准检索与导出服务

面向自用的标准检索与文档导出编排系统，支持多源搜索、详情查询、预览探测和自动/手动导出。

## 当前支持的标准源

| 源 | 代号 | 搜索 | 详情 | 导出方式 |
|---|---|---|---|---|
| bz.gxzl.org.cn | `bz` | JSON API | JSON API | 分页JPEG合成PDF |
| std.samr.gov.cn + c.gb688.cn | `gbw` | JSON API | HTML解析 | ddddocr验证码 → PDF |
| 内网 172.16.100.72:8080 | `by` | HTML解析 | HTML解析 | 直链PDF下载 |

## 目录结构

```text
├── docs/sources/          # 各源实现文档
├── scripts/
│   ├── ocr_ddddocr.py       # ddddocr Python 桥接
│   ├── register-bot.ts       # bz注册机
│   ├── sync.sh               # 代码同步脚本
│   └── sources/              # 各源勘察脚本
├── public/
│   └── gbw-captcha.html   # gbw验证码交互页
├── src/
│   ├── api/               # Express API 路由
│   ├── domain/            # 领域模型
│   ├── services/          # 业务服务
│   ├── shared/            # 共享工具
│   └── sources/
│       ├── bz-zhenggui/   # bz源适配器
│       ├── by/            # by源适配器
│       ├── gbw/           # gbw源适配器+下载会话
│       └── shared/        # OCR模块(ddddocr+tesseract)
└── data/exports/          # 导出文件目录
```

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.8 + ddddocr（gbw自动下载必需）
- Chromium（`npm run inspect` 脚本需要）

### 安装

```bash
npm install
pip install ddddocr
npm run build
```

### 启动

```bash
npm run dev
# 或
node dist/src/index.js
```

服务默认监听 `http://localhost:3000`。

## API 端点

### 通用

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查，返回可用源列表 |
| GET | `/api/standards/search?q=&source=` | 搜索标准 |
| GET | `/api/standards/:id` | 标准详情 |
| POST | `/api/standards/:id/preview/detect` | 探测预览能力 |
| POST | `/api/standards/:id/export` | 导出标准 |
| GET | `/api/tasks/:taskId` | 查询导出任务 |

### gbw 下载

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/standards/:id/download-session` | 创建下载会话（获取验证码） |
| POST | `/api/standards/:id/auto-download` | 自动OCR识别验证码并下载（最多5次重试） |
| POST | `/api/download-sessions/:id/verify` | 手动提交验证码 |
| GET | `/api/download-sessions/:id?source=gbw` | 查询下载会话状态 |
| GET | `/gbw-captcha.html` | 验证码交互页面 |

### 使用示例

```powershell
# 搜索各源
curl.exe "http://localhost:3000/api/standards/search?q=3324-2024&source=bz"
curl.exe "http://localhost:3000/api/standards/search?q=3324-2024&source=gbw"
curl.exe "http://localhost:3000/api/standards/search?q=3324-2024&source=by"

# 导出
curl.exe -X POST "http://localhost:3000/api/standards/bz:{id}/export"
curl.exe -X POST "http://localhost:3000/api/standards/by:{id}/export"

# gbw自动下载（ddddocr识别验证码）
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/standards/gbw:{id}/auto-download"
```

## gbw 自动下载流程

```
auto-download
  → 创建下载会话
  → ddddocr 识别验证码（优先）
    → 命中 → 自动提交 → 下载PDF → status: downloaded
    → 未命中 → 新建会话 → ddddocr再试（最多5轮）
    → ddddocr失败 → 回退tesseract.js
    → 5轮全败 → status: failed（保留attempts日志）
```

## 新增源

流程：
1. `scripts/sources/<name>/` 下写勘察脚本
2. `docs/sources/<name>-source-implementation.md` 写实现文档（参考 `docs/sources/gbw-source-implementation.md`）
3. `src/sources/<name>/` 下实现 `SourceAdapter`
4. 在 `src/services/source-registry.ts` 注册

## 测试

```bash
npm test
npm run build
```

## bz 注册机（账号池）

批量注册 `bz.gxzl.org.cn` 个人账号，每号 15 次/月下载额度。

```bash
# 注册5个账号（仅注册）
npm run register:bot -- 5

# 注册3个账号 + 登录获取 JWT token
npm run register:login -- 3
```

账号池存储在 `data/accounts.json`（已 gitignore），字段：

| 字段 | 说明 |
|------|------|
| `username` / `password` | 登录凭据 |
| `realName` / `phone` | 注册信息 |
| `accessToken` | JWT bearer token（`--login` 后填充） |
| `refreshToken` | 刷新 token |
| `registeredAt` / `loggedInAt` | 时间戳 |

技术细节见 `scripts/register-bot-readme.md`。

## bz 直接 PDF 下载（进行中）

通过账号 token 可直接下载完整 PDF，跳过当前分页 JPEG → PDF 合成的流程。

**已可用的端点：**

```
GET /api/gxist-standard/standardOrder/download?id=<order_id>&Blade-Auth=bearer%20<token>
→ 直接返回 PDF（已验证，8.3MB for GB/T 17657-2022）
```

**待解决：**

创建下载订单时 `POST /api/gxist-order/order/save` 返回 `400 "商品类型不正确"`，需找到正确的请求体格式。

**下一步：** 在 `bzuser.gxzl.org.cn` 标准详情页点击"下载PDF"，浏览器 DevTools 抓包即可捕获订单创建的完整请求。

详见 `scripts/register-bot-readme.md` 中的完整 API 清单和平台架构。

## 同步脚本

```bash
bash scripts/sync.sh              # 默认 timestamp message
bash scripts/sync.sh "fix: xxx"   # 自定义 message
```

一键 `pull → add → commit → push`。
