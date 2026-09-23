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
- **动态域名追踪** — 自动追踪站点最新域名，即使资源站域名变更也不影响使用
- **零依赖部署** — 无第三方依赖，仅用原生 `fetch`，一键部署到 Vercel

---

## 架构总览

```
┌──────────────────────────────────────────────────────┐
│                   Stremio 客户端                      │
│          （桌面版 / Web / Android TV / ios )          |
└──────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│                   Vercel Edge CDN                    │
│        静态缓存 · 全球节点 · 就近响应（HIT）              │
└──────────────────────────────────────────────────────┘
                        │ MISS
                        ▼
┌──────────────────────────────────────────────────────┐
│              Vercel Edge Function                    │
│  ┌──────────────────────────────────────────────┐    │
│  │              Handler 层                      │    │
│  │   路由解析 · 请求分发 · 响应封装                 │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │              Adapter 层                      │    │
│  │   站点请求 · RSC 解析 · 签名生成                │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │             Resolver 层                      │    │
│  │   IMDb 解析 · 多语言匹配 · 缩略图获取            │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │              Cache 层                        │    │
│  │        L1 内存 · L2 Upstash Redis             │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│              资源站 (0996zp.com)                      │
│        域名由 jpyy.com 动态发现，自动跟随变更             │
└──────────────────────────────────────────────────────┘
```

---

## 项目结构

```
jpyyVecel/
├── api/
│   └── index.js              # Vercel Edge Function 入口（含日志时间戳补丁）
├── src/
│   ├── handler.js            # 主处理逻辑（路由分发）
│   ├── adapter.js            # 站点适配器（搜索/详情/剧集/流媒体）
│   ├── manifest.js           # Stremio 清单
│   ├── config.js             # 全局配置
│   ├── cache.js              # 多级缓存（内存 + Redis + 冷却降级）
│   ├── domain-resolver.js    # 域名动态追踪
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
| `TMDB_API_KEY` | 内置 | TMDB API 密钥（用于 IMDb 解析） |

---

## 接口文档

所有接口遵循 [Stremio Addon SDK 规范](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api.md)。

### Manifest

```http
GET /manifest.json
```

返回 Addon 清单，声明支持的资源、类型和目录。

**支持目录**：

| Catalog ID | 类型 | 名称 |
|------------|------|------|
| `jinpai-movie` / `movie` | movie | 电影 |
| `jinpai-series` / `series` | series | 电视剧 |
| `jinpai-variety` / `variety` | series | 综艺 |
| `jinpai-anime` / `anime` | series | 动漫 |
| `jinpai-short` / `short` | series | 短剧 |

> 同时支持完整 ID 和简写别名，兼容不同 Stremio 客户端的请求方式。

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
    "videos": [
      {
        "id": "jp146932:1:1",
        "season": 1,
        "episode": 1,
        "title": "第1集",
        "thumbnail": "https://...",
        "released": "2026-09-21T..."
      }
    ],
    "behaviorHints": { "defaultVideoId": "jp146932:1:1" }
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

资源站域名可能随时变更。本 Addon 通过以下策略保持服务可用：

### 追踪机制

1. **优先使用** `CONFIG.BASE_DOMAIN`（默认域名，不探测）
2. **请求失败时**（403 / 超时）触发探测：
   - 依次测试 `FALLBACK_DOMAINS`
   - 全部失败 → 访问 `jpyy.com` 提取最新域名
3. **探测结果缓存**：写入 Redis，7 天内跨实例共享
4. **并发锁**：Redis 锁防止多实例同时探测

### 探测流程

```
请求失败
    ↓
获取 Redis 锁（60 秒 TTL）
    ↓
检查 Redis 缓存的域名（7 天 TTL）
    ↓
依次探测候选域名
    ↓
找到可用 → 写入 Redis → 返回
    ↓
全部失败 → 访问发现源 → 提取域名
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

**3 Body Problem**（之前失败 → 现在成功）：

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
# 启动本地服务
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
cache-control: public, s-maxage=600, stale-while-revalidate=1200
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

确保 `meta.id` 是**影片级**（不带 `:1:1`），且 `videos` 数组包含所有集数。参见 `src/handler.js` 的 `handleMeta` 函数。

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

### Q5：如何降低 Redis 用量？

- 增大缓存 TTL（如 Catalog 从 5 分钟改为 10 分钟）
- 减少写入频次（仅缓存成功响应）
- 升级 Upstash 套餐（免费额度 10k 命令/天）

### Q6：Vercel 返回 403 / Security Checkpoint？

**原因**：短时间内大量请求触发 Vercel 安全防护。

**解决**：
- 等待 10-30 分钟
- 用浏览器访问验证
- 请求时带完整浏览器头（`User-Agent` 等）

**Stremio 客户端不会被拦**（有正常的 User-Agent）。

### Q7：本地 dev 缓存不生效？

**原因**：`vercel dev` 每次请求可能创建新实例，内存缓存失效。

**说明**：这是 dev 环境的固有限制，**不代表生产环境**。生产环境实例复用率高，缓存命中率高。

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

#### 整体业务流程

# 金牌影视 Stremio Addon · 完整业务流程

## 一、总体架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│   Stremio   │────▶│ Vercel Edge  │────▶│  Handler    │────▶│   Adapter   │
│   Client    │     │     CDN      │     │  (路由分发) │     │ (站点适配)  │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                          │                    │                    │
                          ▼                    ▼                    ▼
                    ┌──────────┐        ┌──────────┐        ┌─────────────┐
                    │CDN 缓存  │        │ Resolver │        │  Cache 层   │
                    │(10min)   │        │ IMDb/剧集│        │内存+Redis   │
                    └──────────┘        └──────────┘        └─────────────┘
                                                                  │
                                                                  ▼
                                                          ┌─────────────┐
                                                          │ 资源站 API  │
                                                          │0996zp.com   │
                                                          └─────────────┘
```

---

## 二、核心业务流程

### 流程 1：Manifest 请求

**触发时机**：用户安装 Addon 或 Stremio 启动时

```
输入：
  GET /manifest.json
  无参数

处理：
  1. handleRequest() 检测 pathname === '/manifest.json'
  2. 后台异步触发 probeAndUpdate()（域名预探测，不阻塞响应）
  3. 直接返回 MANIFEST 常量

输出：
  {
    "id": "com.local.jinpai",
    "version": "1.0.0",
    "name": "金牌影视",
    "resources": ["catalog", "meta", "stream"],
    "types": ["movie", "series"],
    "catalogs": [
      { "type": "movie",  "id": "jinpai-movie",  "name": "金牌影视 - 电影" },
      { "type": "series", "id": "jinpai-series", "name": "金牌影视 - 电视剧" },
      { "type": "series", "id": "jinpai-variety","name": "金牌影视 - 综艺" },
      { "type": "series", "id": "jinpai-anime",  "name": "金牌影视 - 动漫" },
      { "type": "series", "id": "jinpai-short",  "name": "金牌影视 - 短剧" }
    ],
    "idPrefixes": ["tt", "jp"]
  }

缓存：
  CDN: 不缓存（Cache-Control: public）
  内部: 无需缓存

耗时：
  < 50ms
```

---

### 流程 2：Catalog 浏览

**触发时机**：用户点击 Board 中的目录（如「金牌影视 - 电影」）

```
输入：
  GET /catalog/movie/jinpai-movie.json?skip=0

  路径参数：
    type:   movie | series
    id:     jinpai-movie | movie（简写）
    skip:   分页偏移量（0, 48, 96, ...）

处理：
  1. handleRequest() 匹配 catalog 路由
  2. 解析 extras：{ skip: "0" }
  3. handleCatalog('jinpai-movie', 0)
  4. fetchCatalog('jinpai-movie', 0)
       ├─ 检查 Redis 缓存: catalog:jinpai-movie:0
       │   ├─ HIT → 返回缓存
       │   └─ MISS → 继续
       ├─ 获取当前域名: getBaseDomain() → "0996zp.com"
       ├─ 请求站点: GET https://0996zp.com/vod/show/id/1/page/1
       │   Headers: { RSC: 1, Referer: https://0996zp.com/ }
       ├─ parseCatalog(text) 解析 RSC 流
       └─ setCache('catalog:jinpai-movie:0', result, 300)
  5. 转换为 Stremio 格式的 metas
  6. 返回 JSON

内部数据流：
  RSC 原始文本
    ↓ parseCatalog()
  [{ vodId, vodName, vodPic, vodPubdate, vodTotal, ... }]
    ↓ 映射
  [{ id: 'jp146870', type: 'movie', name: '...', poster: '...', year: '...' }]

输出：
  {
    "metas": [
      {
        "id": "jp146870",
        "type": "movie",
        "name": "醉胆追凶",
        "poster": "https://obs.3688baihuo.com/...",
        "year": "2028"
      },
      ...
    ]
  }

缓存：
  CDN:     public, s-maxage=300（5 分钟）
  Redis:   catalog:jinpai-movie:0，TTL 300s
  内存:    L1，TTL 60s

耗时：
  首次: 3-5s（含站点请求）
  缓存: < 500ms（Redis/CDN HIT）
```

---

### 流程 3：Catalog 搜索

**触发时机**：用户在 Stremio 搜索框输入关键词

```
输入：
  GET /catalog/movie/jinpai-movie/search=阿甘.json

  路径参数：
    type:   movie | series
    id:     jinpai-movie
    search: 搜索关键词（URL 编码）

处理：
  1. 解析 extras: { search: "阿甘" }
  2. handleSearchInCatalog('movie', 'jinpai-movie', '阿甘', undefined)
  3. searchVideos('阿甘', page=1, pageSize=24)
       ├─ 检查缓存: search:阿甘:1:24
       │   ├─ HIT → 返回
       │   └─ MISS → 继续
       ├─ 生成签名: signSearch('阿甘', 1, 24)
       │   t = Date.now()
       │   signKey = `keyword=阿甘&pageNum=1&pageSize=24&type=false&key=xxx&t=${t}`
       │   sign = SHA1(MD5(signKey))
       ├─ 请求站点: GET https://0996zp.com/api/mw-movie/anonymous/video/searchByWord
       │   ?keyword=%E9%98%BF%E7%94%98&pageNum=1&pageSize=24&type=false
       │   Headers: { Referer, sign, t }
       └─ setCache('search:阿甘:1:24', result, 600)
  4. 按请求的 type 过滤（movie 或 series）
  5. 转换为 Stremio metas

输出：
  {
    "metas": [
      {
        "id": "jp59460",
        "type": "movie",
        "name": "阿甘正传",
        "poster": "https://...",
        "year": "1994"
      },
      ...
    ]
  }

缓存：
  CDN:   public, s-maxage=300
  Redis: search:阿甘:1:24，TTL 600s

耗时：
  首次: 2-3s
  缓存: < 500ms
```

---

### 流程 4：Meta 请求 - JP 电影

**触发时机**：用户点击影片（如「分娩监禁」）进入详情页

```
输入：
  GET /meta/movie/jp146673.json

  路径参数：
    type: movie
    id:   jp146673

处理：
  1. parseId('jp146673') → { source: 'jp', vodId: '146673', rawId: 'jp146673' }
  2. fetchDetail('146673')
       ├─ 检查缓存: detail:146673
       │   ├─ HIT → 返回（< 500ms）
       │   └─ MISS → 继续
       ├─ 获取域名: "0996zp.com"
       ├─ 请求站点: GET https://0996zp.com/detail/146673?_rsc=xsbs6
       ├─ parseDetail(text) 解析 RSC 流
       ├─ extractEpisodes(detail) 提取剧集列表
       └─ setCache('detail:146673', result, 1800)
  3. 判断 isSeries = vodTotal > 0
  4. 构建 meta 对象
  5. 电影：videos = [{ id: metaId, title: 影片名 }]
  6. 返回 JSON

内部数据结构：
  detail = {
    vodId: '146673',
    vodName: '分娩监禁',
    vodContent: '...',
    vodPic: 'https://...',
    vodYear: 2028,
    vodScore: 5.8,
    vodClass: '恐怖',
    vodActor: '...',
    vodTotal: 0,
    episodes: [{ nid: '1315252', name: '蓝光' }]
  }

输出：
  {
    "meta": {
      "id": "jp146673",
      "type": "movie",
      "name": "分娩监禁",
      "description": "...",
      "poster": "https://...",
      "background": "https://...",
      "year": "2028",
      "director": "...",
      "cast": ["..."],
      "genres": ["恐怖"],
      "imdbRating": 5.8,
      "videos": [
        { "id": "jp146673", "title": "分娩监禁", "thumbnail": "https://..." }
      ]
    }
  }

缓存：
  CDN:   public, s-maxage=600（10 分钟）
  Redis: detail:146673，TTL 1800s（30 分钟）

耗时：
  首次: 3-5s
  缓存: < 500ms
```

---

### 流程 5：Meta 请求 - JP 剧集

**触发时机**：用户点击剧集（如「一瓯春」）进入详情页

```
输入：
  GET /meta/series/jp146932.json

处理：
  1. parseId('jp146932') → { source: 'jp', vodId: '146932' }
  2. fetchDetail('146932')
       ├─ 检查 Redis 缓存: detail:146932
       ├─ 请求站点: GET https://0996zp.com/detail/146932?_rsc=xsbs6
       └─ parseDetail → extractEpisodes
  3. isSeries = true（vodTotal = 8）
  4. 过滤数字集数：videos[].name 匹配 /^\d+$/
  5. 排序：按 episode 升序
  6. 获取每集缩略图（TMDB）
       ├─ getTmdbIdByJp('146932', '一瓯春', 2026)
       │   ├─ 检查缓存: tmdbid:jp:146932
       │   ├─ MISS → searchTmdbByTitle() 搜索 TMDB
       │   └─ setCache('tmdbid:jp:146932', tmdbId, 604800)
       └─ getTmdbThumbs(tmdbId, 1)
           ├─ 检查缓存: tmdbthumbs:{tmdbId}:1
           ├─ MISS → fetchSeasonThumbnails()
           └─ setCache(..., 604800)
  7. 构建 videos 数组（关键：id 格式为 jpXXXXX:1:N）
  8. 设置 behaviorHints.defaultVideoId
  9. 返回 JSON

输出：
  {
    "meta": {
      "id": "jp146932",                        // ← 影片级！不带 :1:1
      "type": "series",
      "name": "一瓯春",
      "poster": "https://...",
      "videos": [
        {
          "id": "jp146932:1:1",                // ← 集级
          "season": 1,
          "episode": 1,
          "title": "第1集",
          "thumbnail": "https://image.tmdb.org/...",
          "released": "2026-09-21T..."
        },
        { "id": "jp146932:1:2", "season": 1, "episode": 2, "title": "第2集" },
        ...
      ],
      "behaviorHints": {
        "defaultVideoId": "jp146932:1:1"
      }
    }
  }

关键点：
  ✅ meta.id 必须是影片级（jp146932），不能带 :1:1
  ✅ videos[].id 必须是集级（jp146932:1:1）
  ✅ videos 数组包含所有集数

耗时：
  首次: 4-8s（含 TMDB 搜索 + 站点请求）
  缓存: < 1s
```

---

### 流程 6：Meta 请求 - TT 格式（IMDb）

**触发时机**：用户从其他 Addon（如 Cinemeta）点击播放，或搜索 tt ID

```
输入：
  GET /meta/series/tt13016388.json

处理：
  1. parseId('tt13016388') → { source: 'imdb', imdbId: 'tt13016388' }
  2. resolveImdbToVod('tt13016388', 'series', 1)
       ├─ 检查缓存: imdb2vod:tt13016388:series:1
       ├─ MISS → getCachedMeta('tt13016388', 'series')
       │   ├─ 请求 TMDB: /find/tt13016388
       │   ├─ 得到 tmdbId=108545, title="3 Body Problem"
       │   └─ setCache('meta:tt13016388:series', meta, 604800)
       ├─ collectCandidateTitles(meta, 'series')
       │   ├─ 原始标题: "3 Body Problem"
       │   ├─ fetchAlternativeTitles(108545, 'series')
       │   │   └─ 返回: ["三体", "3体", "Задача трёх тел", ...]
       │   └─ 排序（纯中文优先）: ["三体", "3 Body Problem", "3体", ...]
       ├─ searchWithMultipleTitles(candidates, 'series')
       │   ├─ 搜索 "三体" → 24 条
       │   ├─ 搜索 "3 Body Problem" → 24 条
       │   ├─ 搜索 "3体" → 24 条
       │   └─ 合并去重 → 52 条
       ├─ findSeasonMatch(52, 1, candidates)
       │   └─ 匹配到 "三体第一季（国语）" → vodId=103388
       └─ setCache('imdb2vod:tt13016388:series:1', result, 604800)
  3. fetchDetail('103388') 获取详情
  4. 构建 meta（同流程 5）
  5. 返回 JSON

输出：
  {
    "meta": {
      "id": "tt13016388",
      "type": "series",
      "name": "三体第一季（国语）",
      "videos": [
        { "id": "tt13016388:1:1", "season": 1, "episode": 1, "title": "第1集" },
        ...
      ]
    }
  }

缓存：
  Redis: imdb2vod:tt13016388:series:1（7 天）
         meta:tt13016388:series（7 天）
         tmdbid:jp:103388（7 天）

耗时：
  首次: 8-15s（TMDB 搜索 + 多标题搜索 + 匹配）
  缓存: < 1s
```

---

### 流程 7：Stream 请求 - JP 电影

**触发时机**：用户点击电影的播放按钮

```
输入：
  GET /stream/movie/jp146673.json

处理：
  1. parseId('jp146673') → { source: 'jp', vodId: '146673', episode: 1 }
  2. fetchEpisodes('146673')
       ├─ 检查缓存: episodes:146673
       │   ├─ HIT → 返回
       │   └─ MISS → 检查 detail:146673
       │       ├─ HIT → 提取 episodes → 回填 episodes 缓存
       │       └─ MISS → 请求站点详情页
       ├─ 解析 RSC → extractEpisodes
       └─ setCache('episodes:146673', episodes, 1800)
  3. 找 nid：电影只有 1 集 → nid = episodes[0].nid = '1315252'
  4. fetchStream('146673', '1315252')
       ├─ 检查缓存: stream:146673:1315252
       ├─ MISS → 生成签名: signStream('146673', '1315252')
       │   signKey = `clientType=1&id=146673&nid=1315252&key=xxx&t=${t}`
       ├─ 请求站点: GET https://0996zp.com/api/mw-movie/anonymous/v2/video/episode/url
       │   ?clientType=1&id=146673&nid=1315252
       │   Headers: { Referer, deviceid, sign, t }
       └─ setCache('stream:146673:1315252', result, 180)
  5. 转换为 Stremio 格式

输出：
  {
    "streams": [
      {
        "name": "金牌影院",
        "title": "蓝光",
        "url": "https://ppvod011.blbtgg.com/.../index.m3u8?auth_key=1788343846-...",
        "type": "hls",
        "behaviorHints": {
          "notWebReady": false,
          "bingeGroup": "jp-146673"
        }
      },
      { "name": "金牌影院", "title": "高清", "url": "...", "type": "hls" },
      { "name": "金牌影院", "title": "标清", "url": "...", "type": "hls" }
    ]
  }

缓存：
  CDN:   public, s-maxage=60（1 分钟，URL 有时效）
  Redis: stream:146673:1315252，TTL 180s（3 分钟）

耗时：
  首次: 3-6s
  缓存: < 500ms
```

---

### 流程 8：Stream 请求 - JP 剧集

**触发时机**：用户点击剧集某一集的播放按钮

```
输入：
  GET /stream/series/jp146932%3A1%3A3.json

  路径参数（解码后）：
    id: jp146932:1:3

处理：
  1. parseId('jp146932:1:3') → { source: 'jp', vodId: '146932', season: 1, episode: 3 }
  2. fetchEpisodes('146932')
       ├─ HIT → 返回 8 集列表
       └─ MISS → 请求站点 → 缓存
  3. 找 nid：
       episodes.find(ep => parseInt(ep.name, 10) === 3)
       → nid = '1314910'（第 3 集）
  4. fetchStream('146932', '1314910')
       └─ 同流程 7
  5. 转换为 Stremio 格式

输出：
  同流程 7，但 URL 对应第 3 集

关键：
  ✅ Stream 请求的 ID 必须带 :1:3（集级）
  ✅ 通过 episode 号匹配 nid
```

---

### 流程 9：Stream 请求 - TT 格式

**触发时机**：用户从其他 Addon 用 tt ID 播放

```
输入：
  GET /stream/series/tt13016388%3A1%3A1.json

处理：
  1. parseId → { source: 'imdb', imdbId: 'tt13016388', season: 1, episode: 1 }
  2. resolveImdbToVod('tt13016388', 'series', 1)
       └─ 同流程 6，得到 vodId=103388
  3. fetchEpisodes('103388')
       └─ 同流程 8
  4. 找 nid
  5. fetchStream('103388', nid)
  6. 返回 streams

输出：
  同流程 7/8
```

---

### 流程 10：域名探测（后台）

**触发时机**：
- Manifest 请求时（异步，不阻塞）
- 请求失败时（403 / Connect Timeout）

```
输入：
  无（内部触发）

处理：
  1. probeAndUpdate()
       ├─ 检查 Redis 锁: domain:probe:lock
       │   ├─ 存在 → 等待最多 5 秒（其他实例正在探测）
       │   └─ 不存在 → 获取锁（TTL 60s）
       ├─ 检查 Redis 缓存: domain:current
       │   ├─ 存在且未过期（7 天）→ 直接使用
       │   └─ 不存在 → 继续
       ├─ 依次探测候选域名
       │   ├─ CONFIG.BASE_DOMAIN
       │   ├─ FALLBACK_DOMAINS[0..N]
       │   └─ 每个域名 HEAD 请求，超时 8 秒
       ├─ 全部失败 → 访问发现源 jpyy.com
       │   ├─ 检查重定向 Location 头
       │   └─ 从 HTML 提取域名
       └─ 找到可用域名 → setCache('domain:current', { domain, ts }, 604800)
  2. 更新内存变量 currentDomain

输出：
  无（内部状态）

缓存：
  Redis: domain:current，TTL 7 天
  内存:  currentDomain，实例级

耗时：
  首次: 5-15s（含候选探测）
  缓存: < 10ms
```

---

## 三、数据流转总结

### 3.1 完整播放链路（JP 格式）

```
Stremio 客户端
    ↓ GET /meta/series/jp146932.json
Handler
    ↓ handleMeta()
Adapter
    ↓ fetchDetail('146932')
Cache
    ├─ Redis HIT → 返回
    └─ MISS → 站点
Resource Site
    ↓ RSC 流
Parser
    ↓ parseDetail + extractEpisodes
Handler
    ↓ 构建 meta.videos
Stremio
    ↓ GET /stream/series/jp146932%3A1%3A3.json
Handler
    ↓ handleStream()
Adapter
    ├─ fetchEpisodes('146932')  ← 复用 Meta 缓存
    └─ fetchStream('146932', nid)
Resource Site
    ↓ 播放地址
Stremio
    ↓ HLS 播放
播放器
```

### 3.2 完整播放链路（TT 格式）

```
Stremio（从 Cinemeta 点击）
    ↓ GET /stream/series/tt13016388%3A1%3A1.json
Handler
    ↓ resolveImdbToVod('tt13016388', 'series', 1)
Resolver
    ├─ TMDB 查询 → tmdbId + 标题
    ├─ 多语言别名搜索站点
    ├─ 匹配 Season → vodId=103388
    └─ 缓存结果（7 天）
Adapter
    ├─ fetchEpisodes('103388')
    └─ fetchStream('103388', nid)
Resource Site
    ↓ 播放地址
Stremio
    ↓ HLS 播放
```

---

## 四、缓存键速查表

| 数据类型 | Redis Key | TTL |
|---------|-----------|-----|
| Catalog | `catalog:{catalogId}:{skip}` | 5 分钟 |
| Detail | `detail:{vodId}` | 30 分钟 |
| Episodes | `episodes:{vodId}` | 30 分钟 |
| Stream | `stream:{vodId}:{nid}` | 3 分钟 |
| Search | `search:{keyword}:{page}:{size}` | 10 分钟 |
| IMDb→Vod | `imdb2vod:{imdbId}:{type}:{season}` | 7 天 |
| TMDB Meta | `meta:{imdbId}:{type}` | 7 天 |
| TMDB ID | `tmdbid:jp:{vodId}` | 7 天 |
| TMDB Thumbs | `tmdbthumbs:{tmdbId}:{season}` | 7 天 |
| 当前域名 | `domain:current` | 7 天 |
| 域名锁 | `domain:probe:lock` | 60 秒 |

---

## 五、关键规范约束

| 规范 | 说明 |
|------|------|
| **Catalog 中的 id** | 影片级（`jp146932`），不带 `:1:1` |
| **Meta 的 id** | 与请求一致（`jp146932` 或 `tt13016388`） |
| **Meta.videos[].id** | 集级（`jp146932:1:1`） |
| **Stream 的 id** | 集级（`jp146932:1:1`） |
| **电影 videos** | 返回 1 条，`id = meta.id` |
| **剧集 videos** | 返回全部集数，按 episode 升序 |
| **behaviorHints** | 剧集需设置 `defaultVideoId` |

---

## 六、性能特征

| 场景 | 首次 | 缓存命中 |
|------|------|---------|
| Manifest | < 50ms | < 50ms |
| Catalog | 3-5s | < 500ms |
| Meta (JP) | 3-5s | < 500ms |
| Meta (TT) | 8-15s | < 1s |
| Stream (JP) | 3-6s | < 500ms |
| Stream (TT) | 3-6s | < 500ms |
| Search | 2-3s | < 500ms |

**网络物理极限**：中国 → Vercel Edge（新加坡）往返约 **3 秒**，这是 CDN 缓存也无法消除的延迟。