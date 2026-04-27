# bz.gxzl.org.cn 注册机 + 账号池下载方案

## 1. 注册机

### 用法

```bash
# 注册3个账号（仅注册）
npx tsx scripts/register-bot.ts 3

# 注册3个 + 登录获取token
npx tsx scripts/register-bot.ts 3 --login
```

账号池：`data/accounts.json`

### 技术要点

**注册 API**
```
POST https://bz.gxzl.org.cn/api/blade-user/register
Content-Type: application/json

{
  "userType": "2",       // 2=个人用户, 1=企业用户
  "tenantId": "000000",
  "account": "用户名",
  "password": "密码",
  "newPassword": "密码",
  "realName": "真实姓名",
  "name": "真实姓名",     // 个人用户name=realName
  "phone": "手机号",
  "email": "xx@test.com",
  "type": "9",
  "checked": true        // 必须true=同意条款
}
```

- 无需手机/邮箱验证，最简字段即可
- 密码规则：6-14位，至少1小写字母+1数字+1特殊字符

**登录 API（获取token）**
```
1. GET /api/blade-auth/oauth/captcha
   → { key: "xxx", image: "data:image/png;base64,..." }

2. OCR识别验证码（ddddocr）→ captchaCode

3. POST /api/blade-auth/oauth/token?tenantId=000000&username=...&password=<MD5>&grant_type=captcha&scope=all&type=account
   Headers:
     Authorization: Basic cG9ydGFsOnBvcnRhbF9zZWNyZXQ=
     Tenant-Id: 000000
     Captcha-Key: <key>
     Captcha-Code: <code>
   → { access_token, refresh_token, token_type: "bearer", expires_in: 3599 }
```

- 密码传MD5（32位小写hex）
- Authorization 固定值：`cG9ydGFsOnBvcnRhbF9zZWNyZXQ=`（base64 of `portal:portal_secret`）

### 网络注意

- Node.js fetch 默认 IPv6 会超时 → 脚本使用 `https.request({ family: 4, rejectUnauthorized: false })`
- TLS 证书不受 Node.js 信任 → `rejectUnauthorized: false`

### OCR 依赖

`scripts/ocr_ddddocr.py`（Python桥接），stdin传入base64图片，stdout返回识别文本。

---

## 2. 直接PDF下载（已验证可用！）

### 发现的关键端点

```
GET /api/gxist-standard/standardOrder/download?id=<order_id>&Blade-Auth=bearer%20<token>
Host: bzuser.gxzl.org.cn (或 bz.gxzl.org.cn — 两者都通)
```

**已验证**：返回完整PDF文件（8.3MB for GB/T 17657-2022），Content-Type: application/pdf，Content-Disposition: attachment;filename=xxx.pdf

### Token 传递方式

**重要**：`Blade-Auth` 作为**URL查询参数**传递，不是HTTP Header！
```
Blade-Auth=bearer%20<token>
```
（`%20` = 空格，即 `Blade-Auth=bearer <token>`）

### JWT Token 结构

```json
{
  "tenant_id": "000000",
  "user_name": "xxx",
  "real_name": "xxx",
  "user_id": "2048707592267018242",
  "role_name": "user",
  "client_id": "portal",       // 登录方式：portal=注册登录, saber=其他
  "detail.roleNames": "付费会员",
  "authorities": ["user"],
  "scope": ["all"]
}
```

---

## 3. 待解决：如何获取 Order ID

**当前状态**：下载端点 work，token work，但缺少创建下载订单的API。

### 前端下载流程（从 bzuser 平台 JS 分析）

bzuser.gxzl.org.cn 是 avue/element-ui 应用（与 bz.gxzl.org.cn 的 Nuxt 应用不同，但共享后端API）。

标准详情页 URL：`https://bzuser.gxzl.org.cn/#/standard/standardDetail?id=2946532&stdNo=xxx`

页面右侧浮窗有"下载PDF"按钮（Vue组件 `b5fb229a`），点击触发 `download-pdf-click` 事件。

### 已探测的订单相关API

| 端点 | 方法 | 结果 |
|------|------|------|
| `/api/gxist-order/order/my-list` | GET | ✅ 200，返回我的订单列表 |
| `/api/gxist-order/order/save` | POST | ❌ 400 "商品类型不正确" |
| `/api/gxist-order/order/detail?id=` | GET | 未测试 |
| `/api/gxist-order/order/submit` | POST | 未测试 |
| `/api/gxist-standard/standardOrder/save` | POST | ❌ 404 |
| `/api/gxist-standard/standardOrder/create` | POST | ❌ 404 |
| `/api/gxist-standard/standardOrder/download?id=` | GET | ✅ 200 直接返回PDF |

### 下一步建议

1. **在浏览器中抓包**：在 bzuser 标准详情页点"下载PDF"，用 DevTools Network 捕获完整请求链，特别是创建订单的 POST 请求及其 body
2. **搜索 bzuser 平台 JS chunk**：订单创建逻辑可能在 `chunk-3f48c178.js`（zgstdnoveltysearchorder）或 `chunk-7d243c9c.js`（zgstdvalidationorder）中。用 `Host: bzuser.gxzl.org.cn` 访问 `https://222.84.61.205/js/<chunk-name>.js`
3. **尝试不同 productType**：`/api/gxist-order/order/save` 返回"商品类型不正确"，需要找到正确的 productType 字段值
4. **可能的简化路径**：检查 `/api/gxist-cms/zgstd/download` 端点（在JS中发现 `responseType:"blob"`），它在代码中定义为 `m=function(e){return Object(a["a"])({url:"/api/gxist-cms/zgstd/download",method:"get",responseType:"blob",params:{id:e}})}`，虽然目前返回404，可能需要特定的host或参数格式

---

## 4. 平台架构总结

```
bz.gxzl.org.cn (222.84.61.205)
├── Nuxt SPA（登录/注册页面）
├── API: /api/blade-user/register（注册）
├── API: /api/blade-auth/oauth/token（登录）
├── API: /api/blade-auth/oauth/captcha（验证码）
├── API: /api/gxist-standard/standardstd/list（搜索，无需认证）
├── API: /api/gxist-standard/standardstd/detail（详情，无需认证）
├── API: /api/gxist-standard/standardstd/read-image（逐页JPEG，无需认证）
└── API: /api/gxist-standard/standardstd/read-pages（页数查询）

bzuser.gxzl.org.cn (同一IP 222.84.61.205)
├── avue/element-ui SPA（标准查询/下载平台）
├── API: /api/gxist-standard/standardOrder/download?id=xxx（PDF下载，需token）
├── API: /api/gxist-order/order/*（订单CRUD，需token）
└── JS: /js/app.f79139ec.js, /js/chunk-vendors.194a1202.js + 大量chunk

两者共享后端（同一IP），但token鉴权方式不同：
- bz.gxzl.org.cn: 无需认证（公开搜索/预览）
- bzuser.gxzl.org.cn: Blade-Auth=bearer <token> 作为查询参数
```
