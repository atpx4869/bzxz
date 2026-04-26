# bz.zhenggui.vip 源实现文档

本文档描述当前 `bz.zhenggui.vip` 数据源在本项目中的实现方式，目标不是单纯记录代码，而是沉淀一套后续可复用的“接源方法”。

后面新增任何标准源时，建议先阅读本文档，再按同样的结构完成：

1. 识别搜索链路
2. 识别详情链路
3. 识别预览链路
4. 识别导出链路
5. 抽象成统一 `SourceAdapter`
6. 用真实请求完成验证

---

## 1. 当前源概览

### 1.1 源站点

- 主站：`https://bz.zhenggui.vip`
- 搜索页示例：
  - `https://bz.zhenggui.vip/standardList?searchText=3324-2017&activeTitle=true`
- 详情页示例：
  - `https://bz.zhenggui.vip/standardDetail?standardId=443847&docStatus=0&standardNum=GB/T+3324-2017&searchType=1`

### 1.2 源站特征

该站点不是传统服务端渲染页面，而是 **SPA 单页应用**。直接抓 HTML 只能拿到壳，真正的标准数据需要通过浏览器渲染后，再从网络请求或渲染结果中提取。

本项目当前选择的实现方式是：

- **搜索/详情/预览发现**：用 Playwright 驱动页面
- **预览分页抓取**：用普通 HTTP 直接下载资源
- **PDF 导出**：把分页 JPEG 合并成 PDF

这个思路适合绝大多数“前端页面 + 后端接口 + 资源 CDN”型标准站点。

---

## 2. 当前源的功能拆分

当前源在项目里被拆成 4 个能力：

1. `searchStandards(query)`
2. `getStandardDetail(id)`
3. `detectPreview(id)`
4. `exportStandard(id)`

这 4 个能力就是后续新增源时也应该优先实现的最小集合。

---

## 3. 搜索链路实现

### 3.1 页面入口

搜索页：

`/standardList?searchText=<query>&activeTitle=true`

例如：

`https://bz.zhenggui.vip/standardList?searchText=3324-2017&activeTitle=true`

### 3.2 实际数据来源

页面渲染后会发起一个 POST 请求：

`https://login.bz.zhenggui.vip/bzy-api/org/std/search?...`

这个请求带有动态 `nonce` 和 `signature`，不建议在当前阶段直接手写模拟。当前实现采用 Playwright 打开真实页面，再等待该响应返回。

### 3.3 返回结构

当前已验证搜索返回数据主结构在：

- `data.rows`

而不是最初猜测的 `data.records`。

典型字段包括：

- `standardId`
- `standardNum`
- `standardName`
- `standardType`
- `standardStatus`
- `standardUsefulDate`
- `standardUselessDate`
- `docStatus`
- `hasPdf`

### 3.4 当前实现策略

代码位置：

- `src/sources/bz-zhenggui/bz-zhenggui-adapter.ts`

实现要点：

1. 用 Playwright 打开搜索页
2. 用 `waitForResponse()` 等待 `/std/search`
3. 解析 `data.rows`
4. 映射成统一 `StandardSummary`

### 3.5 fallback 策略

如果接口响应未拿到，当前会尝试从页面 DOM 里提取详情链接。

注意：

- fallback 只能作为兜底
- 不能用页面列表索引去伪造标准 ID
- 必须从真实详情链接或真实响应里拿上游 `standardId`

这一点是后续接源时非常重要的统一规则。

---

## 4. 详情链路实现

### 4.1 页面入口

详情页：

`/standardDetail?standardId=<id>&docStatus=0&searchType=1`

### 4.2 实际数据来源

详情页会触发两个关键接口：

1. `.../bzy-api/org/standard/stdcontent`
2. `.../bzy-api/org/standard/getPdfList`

### 4.3 字段来源优先级

当前实现采用以下优先级：

1. **优先使用接口返回值**
   - `standardNum`
   - `standardName`
   - `standardUsefulDate`
   - `standardUselessDate`
   - `standardStatus`
2. **页面文本作为兜底**

这样做的原因是：

- 页面整段文本容易带无关前缀
- 页面文本可能混入面包屑、按钮文字、状态标签
- 接口字段更稳定、更适合作为统一模型输入

### 4.4 当前统一映射

详情映射输出为 `StandardDetail`，核心字段包括：

- `id`
- `source`
- `sourceId`
- `standardNumber`
- `title`
- `status`
- `publishDate`
- `implementDate`
- `abolishedDate`
- `previewAvailable`
- `detailUrl`
- `breadcrumbs`
- `contentText`
- `moreInfo`

其中：

- `moreInfo.stdContent` 保存详情接口原始结构
- `moreInfo.pdfList` 保存 PDF 列表原始结构

后面新源接入时，也建议保留一个类似的 `moreInfo/raw/meta` 区域，用来存源特有字段。

---

## 5. 预览链路实现

### 5.1 入口判断

当前源不是直接给完整 PDF 下载链接，而是给“分页预览资源”。

详情页滚动预览区域时，会加载：

- `meta.json`
- `fp1.bin`
- `fp2.bin`
- `I/1`
- `I/2`
- ...

### 5.2 已验证链路

对于 `bz:443847`，已实际验证：

- 预览元数据：
  - `https://resource.zhenggui.vip/immdoc/60b0afbe9d9c425698e9b91995922d28/doc/meta.json?...`
- 分页资源：
  - `https://resource.zhenggui.vip/immdoc/60b0afbe9d9c425698e9b91995922d28/doc/I/1`
  - `https://resource.zhenggui.vip/immdoc/60b0afbe9d9c425698e9b91995922d28/doc/I/2`

### 5.3 `meta.json` 的作用

`meta.json` 是当前源最关键的预览探测依据，已验证字段包括：

- `pc`: 总页数
- `pw`: 页宽
- `ph`: 页高
- `ext`: 原始文档扩展名（例如 `pdf`）

示例：

- `pc = 23`
- `pw = 794`
- `ph = 1123`
- `ext = pdf`

### 5.4 当前实现方式

当前 `detectPreview(id)` 的实现逻辑：

1. 打开详情页
2. 监听 `/doc/meta.json` 响应
3. 滚动页面，触发预览懒加载
4. 从 `meta.json` URL 中提取 `resourceKey`
5. 根据 `pc` 生成分页地址列表：

```text
https://resource.zhenggui.vip/immdoc/{resourceKey}/doc/I/1
https://resource.zhenggui.vip/immdoc/{resourceKey}/doc/I/2
...
```

### 5.5 当前统一输出

预览探测返回 `PreviewInfo`：

- `standardId`
- `resourceKey`
- `totalPages`
- `pageWidth`
- `pageHeight`
- `fileType`
- `pageUrls[]`
- `meta`

这个结构后面可以作为所有新源的统一预览模型。

---

## 6. 导出链路实现

### 6.1 当前导出策略

当前源导出不依赖站点提供“整本 PDF 下载”，而是：

1. 先通过 `detectPreview()` 拿到所有分页资源 URL
2. 下载每一页图片
3. 用 `pdf-lib` 合并成一个 PDF

### 6.2 当前已验证事实

分页资源 `I/1` 实际文件头是 JPEG：

- 不是 HTML
- 不是 JSON
- 可以直接作为图片嵌入 PDF

所以当前导出链路非常明确：

**分页 JPEG → 合并 PDF**

### 6.3 导出文件命名规则

当前导出文件命名规则为：

`标准号 标准名称.pdf`

例如：

`GB_T 3324-2017 木家具通用技术条件.pdf`

### 6.4 文件名规范化规则

当前实现会对文件名做安全处理：

- `/` → `_`
- `\` → `_`
- `:` → `_`
- `*` → `_`
- `?` → `_`
- `"` → `_`
- `<` → `_`
- `>` → `_`
- `|` → `_`

因此：

- `GB/T 3324-2017`
- 会变成
- `GB_T 3324-2017`

### 6.5 当前导出任务模型

导出不是同步直接返回文件，而是：

1. `POST /api/standards/:id/export`
2. 返回任务对象
3. `GET /api/tasks/:taskId` 查询状态

当前任务状态为轻量单机版：

- `queued`
- `running`
- `success`
- `failed`

任务存储目前是内存 Map，适合自用 MVP，不适合多实例部署。

---

## 7. 当前项目中的统一抽象

### 7.1 核心接口

代码位置：

- `src/domain/standard.ts`

核心接口：

```ts
interface SourceAdapter {
  searchStandards(input): Promise<StandardSummary[]>;
  getStandardDetail(id): Promise<StandardDetail>;
  detectPreview(id): Promise<PreviewInfo>;
  exportStandard(id): Promise<ExportResult>;
}
```

### 7.2 为什么这样抽象

因为后面加新源时，不应该把搜索、详情、预览、导出逻辑散落在 controller 里。

统一抽象带来的好处：

- 新源只需要补一个 adapter
- API 层无需改协议
- 后面做多源优先级时，只需要在 service 层增加调度器

---

## 8. 当前文件结构说明

与此源相关的核心文件：

- `src/sources/bz-zhenggui/bz-zhenggui-adapter.ts`
- `src/services/standard-service.ts`
- `src/services/export-task-service.ts`
- `src/services/export-task-store.ts`
- `src/api/app.ts`
- `src/domain/standard.ts`

辅助勘察脚本：

- `scripts/sources/bz-zhenggui/inspect-source.ts`
- `scripts/sources/bz-zhenggui/inspect-detail.ts`

这两个勘察脚本很重要。后续加新源时，不建议先写正式 adapter，而是先写同类 inspect 脚本，把链路摸清楚。

---

## 9. 当前验证结果

截至本文档编写时，当前源已完成以下验证：

### 9.1 自动化验证

- `npm test` 通过
- `npm run build` 通过

### 9.2 实际运行验证

已实际跑通：

- `GET /api/health`
- `GET /api/standards/search?q=3324-2017`
- `GET /api/standards/bz:443847`
- `POST /api/standards/bz:443847/preview/detect`
- `POST /api/standards/bz:443847/export`
- `GET /api/tasks/{taskId}`

### 9.3 实际导出结果

已实际导出：

- `GB_T 3324-2017 木家具通用技术条件.pdf`

---

## 10. 当前源的已知限制

### 10.1 依赖前端行为

搜索和详情依赖 Playwright 驱动页面，意味着：

- 如果页面结构大改
- 如果接口触发时机变化
- 如果预览懒加载逻辑变化

都可能需要更新 adapter。

### 10.2 导出任务状态不持久化

当前导出任务状态只保存在内存里：

- 服务重启后任务记录会丢
- 但导出的 PDF 文件仍然在磁盘上

### 10.3 当前未做多源协调

当前是单源实现，没有做：

- 多源优先级
- 多源去重
- 多源 fallback
- 多源字段冲突合并

这些都应放到后续 service 层完成，不应该写进单源 adapter。

---

## 11. 新源接入时的统一流程

后面接任何新源，建议按下面步骤执行。

### 步骤 1：先做 inspect 脚本

至少先写两个脚本：

1. `sources/<source-name>/inspect-source.ts`
2. `sources/<source-name>/inspect-detail.ts`

目标不是立刻实现，而是先确认：

- 搜索数据从哪里来
- 详情数据从哪里来
- 预览数据从哪里来
- 是否有分页资源
- 是否需要签名/nonce/token/session

### 步骤 2：确定“最小真实链路”

新源至少要明确这四件事：

1. 搜索能不能拿到真实 `sourceId`
2. 详情能不能拿到稳定字段
3. 预览能不能拿到总页数或资源列表
4. 导出到底是直链下载，还是分页合成

### 步骤 3：只实现统一接口

不要让 controller 知道源站细节。

只在 adapter 里实现：

- `searchStandards`
- `getStandardDetail`
- `detectPreview`
- `exportStandard`

### 步骤 4：保留源原始字段

统一模型之外，保留：

- `meta`
- `moreInfo`
- `raw`

否则后面排查源字段变动会非常痛苦。

### 步骤 5：最后再做优先级聚合

不要一开始就在单源 adapter 里加多源逻辑。

正确方式是：

- 单源 adapter 负责单源能力
- service 层负责多源调度与优先级

---

## 12. 新源实现文档模板

后续每接一个新源，建议都按以下模板补一份文档。

```md
# <source-name> 源实现文档

## 1. 源概览
- 主站
- 搜索页
- 详情页
- 是否 SPA

## 2. 搜索链路
- 页面入口
- 实际接口
- 返回结构
- 字段映射

## 3. 详情链路
- 页面入口
- 实际接口
- 字段优先级
- 统一映射

## 4. 预览链路
- 是否存在预览
- 是否分页
- 元数据接口
- 页资源地址模式

## 5. 导出链路
- 直链下载 / 分页合成 / 其他
- 文件命名规则

## 6. 当前限制
- 依赖项
- 风险点
- 未完成项

## 7. 验证记录
- 自动化验证
- 手工验证
- 样例结果
```

---

## 13. 本文档的用途

本文档后续主要用于三件事：

1. **新增源时做对照模板**
2. **回头维护当前源时快速定位实现方式**
3. **以后做多源统一时明确哪些逻辑该在 adapter，哪些逻辑该在 service**

如果后面你开始接第二个源，我建议直接先复制本文档结构，再对第二个源做同样的链路梳理。这样多源接入会非常整齐。
