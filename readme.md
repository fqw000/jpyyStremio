# 金牌影视 · Stremio Addon

> 一个为 **Stremio** 打造的影视插件，对接「金牌影视」资源站。支持目录浏览、关键词搜索、元数据获取与流媒体播放，兼容站内 ID 与 IMDb ID 双格式。

基于 **Vercel Edge Functions** 部署，配合 **Upstash Redis** 实现跨实例缓存，全链路响应迅速、稳定、可扩展。

---

## 目录

- [核心特性](#核心特性)
- [架构总览](#架构总览)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [接口文档](#接口文档)
- [缓存策略](#缓存策略)
- [ID 格式](#id-格式)
- [域名动态追踪](#域名动态追踪)
- [多语言 IMDb 匹配](#多语言-imdb-匹配)
- [调试与测试](#调试与测试)
- [常见问题](#常见问题)
- [技术栈](#技术栈)
- [项目演进](#项目演进)
- [许可证](#许可证)

---

## 核心特性

- **完整功能** — 支持 `catalog`、`meta`、`stream`、`search` 四大接口，与 Stremio 官方规范对齐
- **双 ID 体系** — 同时兼容站内 ID (`jp146932`) 与 IMDb ID (`tt0109830`)，与其他 Addon 无缝协作
- **多语言 IMDb 匹配** — 通过 TMDB 别名搜索（含中/英/日/韩/俄/印地等），解决英文原名匹配不到中文资源的问题
- **剧集精解** — 正确处理「每季独立条目」的资源站数据模型，剧集列表、分集播放准确无误
- **三级缓存** — 内存 → Upstash Redis → Vercel CDN，有效降低源站压力，提升响应速度
- **Redis 冷却降级** — Redis 慢响应时自动降级到内存缓存，避免长时间等待
- **官方域名 API** — 通过 `jpyy.com` 的官方接口 `getDomain` 直接获取最新域名列表，比 HTML 解析更可靠
- **零依赖部署** — 无第三方依赖，仅用原生 `fetch`，一键部署到 Vercel

---

## 架构总览

```
┌──────────────────────────────────────────────────────┐
│                   Stremio 客户端                       │
│              （桌面版 / Web / Android TV）              │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│                   Vercel Edge CDN                     │
│        静态缓存 · 全球节点 · 就近响应（HIT）             │
└──────────────────────────────────────────────────────┘
                        │ MISS
                        ▼
┌──────────────────────────────────────────────────────┐
│              Vercel Edge Function                     │
│  ┌──────────────────────────────────────────────┐    │
│  │              Handler 层                       │    │
│  │   路由解析 · 请求分发 · 响应封装               │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │              Adapter 层                       │    │
│  │   站点请求 · RSC 解析 · 签名生成               │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │             Resolver 层                       │    │
│  │   IMDb 解析 · 多语言匹配 · 缩略图获取           │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │              Cache 层                         │    │
│  │        L1 内存 · L2 Upstash Redis             │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │           Domain Resolver 层                  │    │
│  │   官方 API · HTML 提取 · 域名探测（三层策略）   │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│              资源站 (0996zp.com)                       │
│        域名由 jpyy.com 官方 API 动态发现               │
└──────────────────────────────────────────────────────┘
```

---

## 项目结构

```
jpyyVecel/
├── api/
│   └── index.js              # Vercel Edge Function 入口（含日志时间戳补丁）
├── public/                   # 静态资源（配置页面）
│   ├── configure.html
│   ├── configure.css
│   └── configure.js
├── src/
│   ├── handler.js            # 主处理逻辑（路由分发）
│   ├── adapter.js            # 站点适配器（搜索/详情/剧集/流媒体）
│   ├── manifest.js           # Stremio 清单（支持动态生成）
│   ├── config.js             # 全局配置（支持用户配置覆盖）
│   ├── cache.js              # 多级缓存（内存 + Redis + 冷却降级）
│   ├── domain-resolver.js    # 域名动态追踪（API + HTML 三层策略）
│   ├── imdb-resolver.js      # IMDb → 站内 ID 解析（多语言匹配）
│   ├── tmdb.js               # TMDB / Cinemeta 集成
│   ├── rsc.js                # Next.js RSC 流解析
│   ├── http.js               # HTTP 客户端（超时/重试/域名切换）
│   └── helper.js             # 工具函数（Hash / Utils）
├── test.js                   # 测试脚本
├── vercel.json               # Vercel 路由配置
├── package.json
└── README.md
```

---

## 快速开始

### 前置条件

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18 | 本地开发 |
| Vercel 账号 | - | 部署平台 |
| Upstash 账号 | - | Redis 缓存（免费套餐足够） |

### 第一步：克隆项目

```bash
git clone <your-repo-url>
cd jpyyVecel
npm install
```

### 第二步：配置 Upstash Redis

1. 访问 [console.upstash.com](https://console.upstash.com/) 并登录
2. 创建 Redis 数据库：
   - **Name**：`jpyy-cache`
   - **Type**：Regional
   - **Region**：`ap-southeast-1`（新加坡，与 Vercel 同区域）
   - **Plan**：Free
3. 复制 **REST URL** 与 **REST TOKEN**

### 第三步：配置环境变量

在 Vercel Dashboard → 项目 → **Settings → Environment Variables** 添加：

| Key | Value | 环境 |
|-----|-------|------|
| `UPSTASH_REDIS_REST_URL` | 从 Upstash 复制 | All |
| `UPSTASH_REDIS_REST_TOKEN` | 从 Upstash 复制 | All |

或在本地 `.env.local` 中配置（用于 `vercel dev`）：

```bash
UPSTASH_REDIS_REST_URL="https://xxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="xxx"
```

### 第四步：部署

```bash
# 预览部署
npx vercel

# 生产部署
npx vercel --prod
```

部署成功后会输出：

```
✅ Production: https://jpyy-xxx.vercel.app
```

### 第五步：绑定自定义域名（推荐）

1. Vercel Dashboard → 项目 → **Settings → Domains**
2. 添加域名（如 `stremio.yourdomain.com`）
3. 在 DNS 服务商处添加 CNAME 记录：
   - **Type**：`CNAME`
   - **Name**：`stremio`
   - **Value**：`cname.vercel-dns.com`
   - **Proxy status**：**DNS only**（灰色云，不要开启 Cloudflare 代理）

### 第六步：在 Stremio 中安装

1. 打开 Stremio
2. **Addons** → **Community Addons** → **Install from URL**
3. 输入：
   ```
   https://stremio.yourdomain.com/manifest.json
   ```
4. 点击 **Install**

---

## 配置页面

访问 `/configure` 可打开图形化配置页：

```
https://stremio.yourdomain.com/configure
```

### 可配置项

| 配置项 | 键 | 默认值 | 说明 |
|-------|-----|--------|------|
| **资源站域名** | `bd` | `0996zp.com` | 高级用户可自定义 |
| **TMDB API Key** | `tk` | 内置 | 防止限流，可选 |
| **支持类型** | `cats` | 全部 5 类 | 电影/电视剧/综艺/动漫/短剧 |
| **启用 IMDb 解析** | `imdb` | `true` | 支持 tt 格式 |
|**启用 stream **| `stream` | `true` | 防止id校验无法播放，配合jpyyProvider使用|

### 配置传递方式

配置通过**查询参数**传递（base64url 编码）：

```
默认：https://your-domain/manifest.json
自定义：https://your-domain/manifest.json?cfg=eyJiZCI6...
```

### 配置示例

**只启用电影和电视剧**：

```javascript
{ cats: ['movie', 'series'] }
```

**自定义域名**：

```javascript
{ bd: 'new-domain.com' }
```

---

## 修改默认域名

本项目默认站点域名为 `0996zp.com`。如需更换，请**同步修改**以下 3 处：

### 1. 后端默认值

**`src/config.js`**（第 51-56 行附近）：

```javascript
BASE_DOMAIN: user.bd || 'new-domain.com',
FALLBACK_DOMAINS: [
  user.bd || 'new-domain.com',
  'www.' + (user.bd || 'new-domain.com'),
  'x8kb9k8.com',
].filter(Boolean),
```

### 2. 前端配置页

**`public/configure.js`**（第 21 行附近）：

```javascript
const DEFAULTS = {
  baseDomain: 'new-domain.com',   // ⚠️ 必须与 src/config.js 一致
  enableImdb: true,
};
```

### 3. 文档

**`README.md`**：全局搜索 `0996zp.com` 并替换为 `new-domain.com`。

### 为什么需要三处同步？

| 位置 | 作用 |
|------|------|
| `src/config.js` | 后端兜底域名（API 全部失败时使用） |
| `public/configure.js` | 前端 placeholder，判断"是否与默认相同" |
| `README.md` | 用户文档示例 |

### 使用provider的要关注provider项目是否更新domain

### 优先级说明

```
用户自定义域名（?cfg=bd=xxx）
    ↓ 优先级最高
官方 API 动态发现域名
    ↓ 优先级中
硬编码默认域名（本处配置）
    ↓ 优先级最低
```

**大多数情况下，官方 API 会自动获取最新域名**，硬编码的默认值仅作为**最终兜底**。

---

## 环境变量

### 必需

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST 地址 | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis 认证令牌 | `AXxx...` |

### 可选（默认值已内置）

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `BASE_DOMAIN` | `0996zp.com` | 资源站默认域名 |
| `DISCOVERY_URL` | `https://jpyy.com` | 域名发现源 |
| `TMDB_API_KEY` | 内置 | TMDB API 密钥 |

---

## 接口文档

所有接口遵循 [Stremio Addon SDK 规范](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api.md)。

### Manifest

```http
GET /manifest.json
```

返回 Addon 清单，声明支持的资源、类型和目录。

**支持目录**（可通过配置页面动态调整）：

| Catalog ID | 类型 | 名称 |
|------------|------|------|
| `jinpai-movie` / `movie` | movie | 电影 |
| `jinpai-series` / `series` | series | 电视剧 |
| `jinpai-variety` / `variety` | series | 综艺 |
| `jinpai-anime` / `anime` | series | 动漫 |
| `jinpai-short` / `short` | series | 短剧 |

### Catalog · 浏览

```http
GET /catalog/:type/:id.json?skip=0
```

| 参数 | 说明 |
|------|------|
| `type` | `movie` 或 `series` |
| `id` | 目录 ID（如 `jinpai-movie`） |
| `skip` | 分页偏移量（每页 48 条） |

### Catalog · 搜索

```http
GET /catalog/:type/:id/search=:query.json
```

例如：`/catalog/movie/jinpai-movie/search=阿甘.json`

### Meta

```http
GET /meta/:type/:id.json
```

| ID 格式 | 说明 | 示例 |
|---------|------|------|
| `jpXXXXX` | 站内电影 | `jp146870` |
| `jpXXXXX:S:E` | 站内剧集 | `jp146932:1:1` |
| `ttXXXXXXX` | IMDb 电影 | `tt0109830` |
| `ttXXXXXXX:S:E` | IMDb 剧集 | `tt0455275:4:5` |

**响应关键字段**：

```json
{
  "meta": {
    "id": "jp146932",
    "type": "series",
    "name": "一瓯春",
    "poster": "https://...",
    "background": "https://...",
    "description": "...",
    "year": "2026",
    "releaseInfo": "2026-",
    "imdbRating": 5.9,
    "cast": ["娜塔莉·伊曼纽尔", "克莱尔·弗兰妮", "本·库拉"],
    "director": "彼得·休伊特",
    "genres": ["惊悚"],
    "videos": [
      {
        "id": "jp146932:1:1",
        "season": 1,
        "episode": 1,
        "title": "第1集",
        "thumbnail": "https://image.tmdb.org/...",
        "released": "2026-09-21T..."
      }
    ]
  }
}
```

### Stream

```http
GET /stream/:type/:id.json
```

返回可用的流媒体列表（含多清晰度 HLS 地址）。

### 调试接口

| 端点 | 说明 |
|------|------|
| `/debug/domains` | 查看当前域名状态 |
| `/debug/domains?action=clear` | 清空域名缓存 |
| `/debug/domains?action=api` | 测试官方域名 API |
| `/debug/cache` | 查看缓存统计 |

---

## 缓存策略

三层缓存，逐级降低源站压力。

| 层级 | 存储 | 命中耗时 | 生命周期 |
|------|------|---------|---------|
| **L1** | 内存 Map | < 1ms | 实例级（约 60 秒） |
| **L2** | Upstash Redis | < 10ms | 跨实例（几小时到几天） |
| **L3** | Vercel CDN | < 100ms | 全局（按 TTL） |

### 各接口缓存 TTL

| 数据 | 内存 | Redis | CDN |
|------|------|-------|-----|
| **Catalog** | 60s | 5 分钟 | 5 分钟 |
| **Meta** | 60s | 30 分钟 | 10 分钟 |
| **Episodes** | 60s | 30 分钟 | - |
| **Stream** | 60s | 3 分钟 | 1 分钟 |
| **Search** | 60s | 10 分钟 | 5 分钟 |
| **IMDb 映射** | - | 7 天 | - |
| **TMDB 元数据** | - | 7 天 | - |
| **TMDB 缩略图** | - | 7 天 | - |
| **当前域名** | - | 7 天 | - |

### Redis 冷却降级机制

当 Redis 连续 3 次响应超过 500ms 或失败时：

```
[Cache] ⚠️ Redis 失败 (802ms × 3)，冷却 60 秒
```

进入 **60 秒冷却期**，期间：
- 跳过 Redis 读取/写入
- 仅使用内存缓存
- 冷却结束后自动恢复

**适用场景**：本地 dev 环境（Redis 延迟高）或 Upstash 网络抖动。

---

## ID 格式

本项目同时支持两种 ID 体系，**对外优先使用 IMDb ID**，站内 ID 作为降级方案。

### 站内 ID

直接使用资源站的 `vodId`：

```
jp146870           → 电影
jp146932:1:1       → 剧集：第 1 季第 1 集
```

### IMDb ID

通过 TMDB / Cinemeta 解析为站内 ID：

```
tt0109830          → 阿甘正传
tt0455275:4:5      → 越狱 第 4 季第 5 集
```

**转换流程**：

```
tt13016388:1:1
    ↓ 查询 TMDB 获取所有别名（中/英/日/韩/俄等）
    ↓ 逐个搜索站点，合并去重
    ↓ 用所有候选标题匹配结果
    ↓ 得到「三体第一季（国语）」vodId
    ↓ 查询详情找到第 1 集 nid
    ↓ 返回流媒体地址
```

---

## 域名动态追踪

资源站域名可能随时变更。本 Addon 通过**三层策略**保持服务可用：

### 追踪机制

```
请求失败
    ↓
① 内存缓存（实例级，7 天内有效）
    ↓ 未命中
② Redis 缓存（跨实例，7 天 TTL）
    ↓ 未命中
③ jpyy.com 官方 API 获取域名列表
    │   GET /api/mw-movie/anonymous/website/get/domain
    │       ?websiteSeoId=86
    │   Headers: sign, t, deviceId, client-type
    ↓ 失败
④ jpyy.com HTML 提取（兜底）
    ↓ 失败
⑤ 硬编码备用域名（最终兜底）
```

### 官方 API 签名算法

```
sign = SHA1(MD5(sorted_params + "&key=" + SIGN_KEY + "&t=" + t))

其中：
  sorted_params = 参数按 key 升序排列后拼接
  SIGN_KEY      = cb808529bae6b6be45ecfab29a4889bc
  t             = 毫秒时间戳
```

### 并发锁

使用 Redis 锁防止多实例同时探测：

```
domain:probe:lock    TTL 60 秒
```

### 手动清空

```bash
curl "https://your-domain.vercel.app/debug/domains?action=clear"
```

---

## 多语言 IMDb 匹配

### 问题背景

TMDB 返回的标题往往是**英文原名**（如 `3 Body Problem`），而站点收录的是**中文译名**（如 `三体`）。直接搜索会匹配失败。

### 解决方案

**四步走**：

1. **收集候选标题**：从 TMDB 拉取所有别名（`alternative_titles` API）
2. **优先级排序**：纯中文 > 中文混合 > 原始标题 > 其他语言
3. **多标题搜索**：逐个搜索站点，合并去重（最多 5 个候选）
4. **多别名匹配**：对每个结果，计算与**所有候选标题**的最高相似度

### 效果示例

**3 Body Problem**：

```
[Candidates] 📋 5 个标题: 三体 | 3 Body Problem | 3体 | ...
[MultiSearch]   "三体" → 24 条
[MultiSearch]   "3 Body Problem" → 24 条
[MultiSearch]   "3体" → 24 条
[IMDb→Vod] 📋 Total candidates: 52
[SeasonMatch]   - "三体第一季（国语）" → season=1, sim=0.85
[IMDb→Vod] ✅ Resolved: tt13016388 → vodId=103388
```

**匹配成功**：`3 Body Problem` → `三体第一季（国语）`

---

## 调试与测试

### 本地开发

```bash
npx vercel dev
# 服务运行在 http://localhost:3000
```

### 运行测试脚本

```bash
# 默认测本地
node test.js

# 测线上
BASE_URL=https://wangqifei0x00.eu.org node test.js

# 跳过缓存测试
SKIP_CACHE_TEST=1 node test.js
```

### 查看日志

**本地**：`vercel dev` 终端

**线上**：

```bash
npx vercel logs https://your-domain.vercel.app --follow
```

### 日志格式

所有日志自动带时间戳：

```
[16:46:26.085] [Worker] 📨 GET /meta/series/jp146734%3A1%3A1.json
[16:46:26.085] [Adapter] 📄 fetchDetail: vodId=146734
[16:46:26.085] [HTTP] 🌐 https://0996zp.com/detail/146734?_rsc=xsbs6
[16:46:27.792] [HTTP] ✅ 200 (1707ms)
[16:46:29.615] [Cache] ✅ L2 WRITE: detail:146734 (ttl=1800s)
[16:46:29.615] [Meta] ✅ Built: "随我沉沦" (series), videos=0
```

### 响应头检查（CDN 缓存）

```bash
curl -I "https://your-domain/meta/series/jp146905%3A1%3A1.json" | grep -iE "x-vercel-cache|age|cache-control"
```

**预期**：

```
age: 112
cache-control: public, s-maxage=600
x-vercel-cache: HIT
```

---

## 常见问题

### Q1：Stremio 中搜索无结果？

确认 `manifest.js` 的 `catalogs` 中已声明 `extra` 字段：

```javascript
{
  type: 'movie',
  id: 'jinpai-movie',
  extra: [
    { name: 'search', isRequired: false },
    { name: 'skip', isRequired: false },
  ],
}
```

### Q2：剧集详情页只显示 S1E1？

**关键**：确保 `meta.videos` 数组**在 `meta` 构建后**才赋值，且 `behaviorHints.defaultVideoId` 在 `videos` 之后设置。

```javascript
// ❌ 错误顺序
if (meta.videos) { /* 此时 videos 未定义 */ }
meta.videos = ...;

// ✅ 正确顺序
meta.videos = ...;
if (meta.videos.length > 0) {
  meta.behaviorHints = { defaultVideoId: meta.videos[0].id };
}
```

### Q3：CDN 缓存不生效？

检查响应头：

```bash
curl -I "https://your-domain/catalog/movie/movie.json" | grep -i cache
```

若 `x-vercel-cache: MISS` 持续出现：
- 检查 `jsonResponse` 是否设置了 `Cache-Control`
- 确认使用自定义域名（`*.vercel.app` 默认不缓存）

### Q4：站点不可达（Connect Timeout）？

可能域名被墙。切换到备用域名：

```bash
# 查看当前域名
curl "https://your-domain/debug/domains" | jq .current

# 清空域名缓存，强制重新探测
curl "https://your-domain/debug/domains?action=clear"
```

### Q5：官方域名 API 测试

```bash
curl "https://your-domain/debug/domains?action=api" | jq .
```

**预期**：返回域名列表 + 签名信息。

### Q6：如何降低 Redis 用量？

- 增大缓存 TTL（如 Catalog 从 5 分钟改为 10 分钟）
- 减少写入频次（仅缓存成功响应）
- 升级 Upstash 套餐（免费额度 10k 命令/天）

### Q7：Vercel 返回 403 / Security Checkpoint？

**原因**：短时间内大量请求触发 Vercel 安全防护。

**解决**：
- 等待 10-30 分钟
- 用浏览器访问验证
- 请求时带完整浏览器头

**Stremio 客户端不会被拦**（有正常的 User-Agent）。

### Q8：本地 dev 缓存不生效？

**原因**：`vercel dev` 每次请求可能创建新实例，内存缓存失效。

**说明**：这是 dev 环境的固有限制，**不代表生产环境**。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Vercel Edge Functions (V8 Isolate) |
| 语言 | JavaScript (ES Module) |
| 缓存 | Upstash Redis + Vercel CDN |
| 元数据 | TMDB API + Cinemeta |
| 协议 | Stremio Addon SDK |
| 依赖 | 零第三方依赖（仅原生 `fetch`） |

---

## 项目演进

```
阶段 1 · 基础功能
  ├─ Manifest / Catalog / Meta / Stream / Search
  └─ 站内 ID 支持

阶段 2 · 通用性
  ├─ IMDb ID 支持
  └─ 与其他 Addon 互通

阶段 3 · 稳定性
  ├─ 域名动态追踪
  ├─ 三级缓存
  └─ Redis 冷却降级

阶段 4 · 性能优化
  ├─ CDN 缓存
  ├─ Episodes 独立缓存
  ├─ 多语言 IMDb 匹配
  └─ Catalog 简写 ID 兼容

阶段 5 · 用户体验
  ├─ 配置页面（bd/tk/cats/imdb）
  ├─ 官方域名 API
  └─ 类型筛选
```

---

## 贡献

欢迎提交 Issue 与 Pull Request。若本项目对你有帮助，请给一个 ⭐️ Star。

---

## 许可证

MIT License

---

## 免责声明

本项目仅供学习与技术研究使用，所有内容均来自第三方资源站，请勿用于商业用途。使用者需自行承担相应责任。

---

<div align="center">

**Made with ❤️ for Stremio Community**

</div>