# 金牌影视 + 555 · Stremio Addon

> 一个为 **Stremio** 打造的影视插件，对接「金牌影视」资源站（jpyy），并**实验性支持**「555 电影」站。支持目录浏览、关键词搜索、元数据获取与流媒体播放，兼容站内 ID 与 IMDb ID 双格式。

基于 **Vercel Edge Functions** 部署，配合 **Upstash Redis** 实现跨实例缓存，全链路响应迅速、稳定、可扩展。

> ⚠️ **关于 555 源**
> 555 站点为**实验性支持**，不纳入长期维护。原因：
> - 站点有反爬挑战（JS 暴力搜索），维护成本高
> - 站点无搜索 API，仅能分类浏览
> - 站点结构可能随时变更
> - **后期可能随时删除该源**
> 
> 建议使用 555 源时**不要依赖其长期稳定性**。

---

## 目录

- [核心特性](#核心特性)
- [架构总览](#架构总览)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [配置页面](#配置页面)
- [环境变量](#环境变量)
- [接口文档](#接口文档)
- [缓存策略](#缓存策略)
- [ID 格式](#id-格式)
- [域名动态追踪](#域名动态追踪)
- [多语言 IMDb 匹配](#多语言-imdb-匹配)
- [555 源说明](#555-源说明)
- [调试与测试](#调试与测试)
- [常见问题](#常见问题)
- [技术栈](#技术栈)
- [项目演进](#项目演进)
- [许可证](#许可证)

---

## 核心特性

- **完整功能** — 支持 `catalog`、`meta`、`stream`、`search` 四大接口，与 Stremio 官方规范对齐
- **双源架构** — jpyy（主）+ 555（实验），用户可独立开关
- **双 ID 体系** — 同时兼容站内 ID (`jp146932`) 与 IMDb ID (`tt0109830`)，与其他 Addon 无缝协作
- **多语言 IMDb 匹配** — 通过 TMDB 别名搜索（含中/英/日/韩/俄/印地等），解决英文原名匹配不到中文资源的问题
- **剧集精解** — 正确处理「每季独立条目」的资源站数据模型
- **三级缓存** — 内存 → Upstash Redis → Vercel CDN，有效降低源站压力
- **Redis 冷却降级** — Redis 慢响应时自动降级到内存缓存，避免长时间等待
- **官方域名 API** — 通过 `jpyy.com` 的官方接口 `getDomain` 直接获取最新域名列表
- **JS 挑战求解** — 自动求解 555 站点的 MD5 暴力搜索挑战
- **配置化开关** — 源开关、类型筛选、Stream 开关全部通过 URL 参数控制
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
│  │   路由解析 · 源分发 · 响应封装                 │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────┬───────────────────────┐    │
│  │   Adapter (jpyy)     │   Adapter (555)       │    │
│  │   站点请求 · RSC 解析 │   HTML 解析 · 挑战求解│    │
│  └──────────────────────┴───────────────────────┘    │
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
            ┌───────────┴───────────┐
            ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐
│   jpyy 资源站         │  │   555 资源站          │
│   0996zp.com         │  │   555zxdy.cc         │
│  （域名动态追踪）      │  │  （用户配置域名）      │
└──────────────────────┘  └──────────────────────┘
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
│   ├── handler.js            # 主处理逻辑（路由分发 + 源分发）
│   ├── adapter.js            # jpyy 站点适配器
│   ├── adapter-555.js        # 555 站点适配器（实验性）
│   ├── parser-555.js         # 555 HTML 解析器（纯函数）
│   ├── challenge-555.js      # 555 JS 挑战求解器
│   ├── manifest.js           # Stremio 清单（支持多源动态生成）
│   ├── config.js             # 全局配置（支持用户配置覆盖）
│   ├── cache.js              # 多级缓存（内存 + Redis + 冷却降级）
│   ├── domain-resolver.js    # jpyy 域名动态追踪
│   ├── imdb-resolver.js      # IMDb → jpyy vodId 解析
│   ├── tmdb.js               # TMDB / Cinemeta 集成
│   ├── rsc.js                # Next.js RSC 流解析
│   ├── http.js               # HTTP 客户端（超时/重试/域名切换）
│   └── helper.js             # 工具函数（Hash / Utils）
├── health.js                 # 完整测试脚本（jpyy + 555）
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

### 配置项总览

| 分组 | 配置项 | 键 | 默认值 | 说明 |
|------|-------|-----|--------|------|
| **源开关** | 启用的影视源 | `srcs` | `['jpyy', '555']` | 至少选一个 |
| **jpyy** | 资源站域名 | `bd` | `0996zp.com` | 高级用户可自定义 |
| **jpyy** | TMDB API Key | `tk` | 内置 | 防止限流，可选 |
| **jpyy** | 支持类型 | `cats` | 全部 5 类 | 电影/电视剧/综艺/动漫/短剧 |
| **jpyy** | 启用 IMDb 解析 | `imdb` | `true` | 支持 tt 格式 |
| **jpyy** | 启用 Stream | `stream` | `true` | 关闭后仅提供目录和元数据 |
| **555** | 555 域名 | `d555` | `www.555zxdy.cc` | 站点域名变更时可修改 |
| **555** | 555 分类 | `c555` | 全部 7 类 | 电影/剧集/动漫/综艺/短剧/体育/今日更新 |

### 配置传递方式

配置通过**查询参数**传递（base64url 编码）：

```
默认：https://your-domain/manifest.json
自定义：https://your-domain/manifest.json?cfg=eyJiZCI6...
```

### 配置示例

**只启用 jpyy（关闭 555）**：

```javascript
{ srcs: ['jpyy'] }
```

**只启用 555**：

```javascript
{ srcs: ['555'] }
```

**关闭 Stream 功能**：

```javascript
{ stream: false }
```

**自定义 jpyy 域名 + 只启用电影和电视剧**：

```javascript
{ bd: 'new-domain.com', cats: ['movie', 'series'] }
```

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
| `BASE_DOMAIN` | `0996zp.com` | jpyy 站点默认域名 |
| `DISCOVERY_URL` | `https://jpyy.com` | 域名发现源 |
| `TMDB_API_KEY` | 内置 | TMDB API 密钥 |

---

## 接口文档

所有接口遵循 [Stremio Addon SDK 规范](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api.md)。

### Manifest

```http
GET /manifest.json
```

返回 Addon 清单。**目录数量取决于配置**：

| 源 | Catalog ID | 类型 | 名称 |
|----|-----------|------|------|
| **jpyy** | `jinpai-movie` / `movie` | movie | jpyy - 电影 |
| **jpyy** | `jinpai-series` / `series` | series | jpyy - 电视剧 |
| **jpyy** | `jinpai-variety` / `variety` | series | jpyy - 综艺 |
| **jpyy** | `jinpai-anime` / `anime` | series | jpyy - 动漫 |
| **jpyy** | `jinpai-short` / `short` | series | jpyy - 短剧 |
| **555** | `555-movie` | movie | 555 - 电影 |
| **555** | `555-series` | series | 555 - 剧集 |
| **555** | `555-anime` | series | 555 - 动漫 |
| **555** | `555-variety` | series | 555 - 综艺 |
| **555** | `555-short` | series | 555 - 短剧 |
| **555** | `555-sports` | series | 555 - 体育 |
| **555** | `555-new` | series | 555 - 今日更新 |

**ID 前缀**：

- 启用 jpyy → `['tt', 'jp']`
- 启用 555 → `['dy555']`

### Catalog · 浏览

```http
GET /catalog/:type/:id.json?skip=0
```

**注意**：555 源**无分页**，`skip > 0` 时返回空数组。

### Catalog · 搜索

```http
GET /catalog/:type/:id/search=:query.json
```

**注意**：555 源**无搜索**，只有 jpyy 支持。

### Meta

```http
GET /meta/:type/:id.json
```

| ID 格式 | 来源 | 说明 | 示例 |
|---------|------|------|------|
| `jpXXXXX` | jpyy | 站内电影 | `jp146870` |
| `jpXXXXX:S:E` | jpyy | 站内剧集 | `jp146932:1:1` |
| `ttXXXXXXX` | jpyy | IMDb 电影 | `tt0109830` |
| `ttXXXXXXX:S:E` | jpyy | IMDb 剧集 | `tt0455275:4:5` |
| `dy555XXXXX` | 555 | 555 电影 | `dy55512345` |
| `dy555XXXXX:S:E` | 555 | 555 剧集 | `dy55512345:1:1` |

### Stream

```http
GET /stream/:type/:id.json
```

**555 源特点**：
- 多源聚合（每个线路返回一个 stream）
- `stream.name` = 影片名称
- `stream.title` = 线路名称（如"线路1"）

### 调试接口

| 端点 | 说明 |
|------|------|
| `/debug/domains` | jpyy 域名状态 |
| `/debug/domains?action=clear` | 清空 jpyy 域名缓存 |
| `/debug/domains?action=api` | 测试 jpyy 官方域名 API |
| `/debug/cache` | 缓存统计 |
| `/debug/555` | 555 站点状态 |
| `/debug/555?action=clear` | 清空 555 挑战 cookie 缓存 |

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
| **VodName** | - | 7 天 | - |
| **Stream** | 60s | 3 分钟 | 1 分钟 |
| **Search** | 60s | 10 分钟 | 5 分钟 |
| **IMDb 映射** | - | 7 天 | - |
| **TMDB 元数据** | - | 7 天 | - |
| **TMDB 缩略图** | - | 7 天 | - |
| **当前域名** | - | 7 天 | - |
| **555 Catalog** | 60s | 5 分钟 | 5 分钟 |
| **555 Detail** | 60s | 30 分钟 | 10 分钟 |
| **555 Episodes** | 60s | 30 分钟 | - |
| **555 Stream** | 60s | 3 分钟 | 1 分钟 |
| **555 挑战 cookie** | - | 400s | - |

### Redis 冷却降级机制

当 Redis 连续 3 次响应超过 500ms 或失败时，进入 **60 秒冷却期**，期间仅使用内存缓存。

---

## ID 格式

### jpyy 源

```
jp146870           → 电影
jp146932:1:1       → 剧集：第 1 季第 1 集
tt0109830          → 阿甘正传（IMDb 电影）
tt0455275:4:5      → 越狱 第 4 季第 5 集（IMDb 剧集）
```

### 555 源

555 源使用 `dy555` 前缀（**不含冒号**）：

```
dy55512345         → 电影
dy55512345:1:1     → 剧集：第 1 季第 1 集（season 恒为 1）
```

> **为什么用 `dy555` 而不是 `555:`？**
> 
> Stremio 客户端用 `:` 识别 season/episode 分隔符。若用 `555:` 前缀，则 `555:12345:1:1` 会被解析为 `baseId=555, season=12345, episode=1`，错乱。

---

## 域名动态追踪

### jpyy 源

**三层策略**：

```
请求失败
    ↓
① 内存缓存（实例级，7 天内有效）
    ↓ 未命中
② Redis 缓存（跨实例，7 天 TTL）
    ↓ 未命中
③ jpyy.com 官方 API 获取域名列表
    │   GET /api/mw-movie/anonymous/website/get/domain?websiteSeoId=86
    │   Headers: sign, t, deviceId, client-type
    ↓ 失败
④ jpyy.com HTML 提取（兜底）
    ↓ 失败
⑤ 硬编码备用域名（最终兜底）
```

**API 签名算法**：

```
sign = SHA1(MD5(sorted_params + "&key=" + SIGN_KEY + "&t=" + t))
```

### 555 源

**域名来源**：

```
① 用户配置 d555（最高优先级，失败不切换）
    ↓ 未配置
② 内存记录的成功域名（实例级）
    ↓ 未命中
③ 硬编码默认域名 555zxdy.cc
    ↓ 失败
④ 硬编码备用域名列表
```

**手动清空**：

```bash
curl "https://your-domain.vercel.app/debug/555?action=clear"
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

---

## 555 源说明

> ⚠️ **555 源为实验性支持，不纳入长期维护，后期可能随时删除。**

### 支持的功能

| 功能 | 状态 |
|------|------|
| 分类浏览 | ✅ |
| 详情解析 | ✅ |
| 剧集列表（多源） | ✅ |
| 播放地址解析 | ✅ |
| 多源 Stream 聚合 | ✅ |
| JS 挑战自动求解 | ✅ |
| 搜索 | ❌（站点验证码限制） |
| IMDb 映射 | ❌（依赖搜索） |
| 域名动态追踪 | ❌（用硬编码 + 用户配置） |

### 技术特点

**1. 多源聚合**

555 站点的同一影片有多个线路（"线路1"、"线路2"、...）。每个线路有独立的剧集列表。本 Addon：

- `parseEpisodes555` 返回**按源分组**结构
- `mergeEpisodesFromSources` 合并成"按集分组、每集带所有源"
- Stream 流程遍历所有源，每个源生成一个 stream

**2. JS 挑战求解**

555 站点有 JS 反爬挑战（MD5 暴力搜索）：

```javascript
var C="5971483.31c722db25b288157883b1a012d3ada5",D=3,P="000";
// 暴力搜索 n，使 md5(C + ":" + n).slice(0, D) === P
```

求解器：
- 纯 JS 实现，无依赖
- D=3 时耗时 5-60ms（迭代约 4000 次）
- 解出的 cookie 存入 Redis（TTL 400s）

**3. 缓存隔离**

所有 555 缓存 key 带 `555:` 前缀，与 jpyy 完全隔离。

### 未实现功能的原因

| 功能 | 原因 |
|------|------|
| 搜索 | 受限于苹果 CMS 搜索验证码（`verify_check`），需要已通过验证的 `PHPSESSID` |
| IMDb 映射 | 依赖搜索功能 |
| 采集 API | 站点管理员已关闭 |
| 域名动态追踪 | 用户决定用硬编码 + 用户配置 |

### 后期规划

- 保持现状，**不主动维护**
- 如果站点结构变更导致解析失败，**可能直接删除该源**
- 用户如遇到 555 源问题，建议**关闭该源**，使用 jpyy 源

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
node health.js

# 测线上
BASE_URL=https://wangqifei0x00.eu.org node health.js

# 跳过缓存测试
SKIP_CACHE_TEST=1 node health.js
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

确认 `manifest.js` 的 `catalogs` 中已声明 `extra` 字段（jpyy 需要）：

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

555 源无搜索，`extra` 只保留 `skip`。

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

### Q4：jpyy 站点不可达（Connect Timeout）？

可能域名被墙。切换到备用域名：

```bash
# 查看当前域名
curl "https://your-domain/debug/domains" | jq .current

# 清空域名缓存，强制重新探测
curl "https://your-domain/debug/domains?action=clear"
```

### Q5：555 源解析失败？

**排查步骤**：

```bash
# 1. 检查 555 状态
curl "https://your-domain/debug/555" | jq .

# 2. 清空挑战 cookie 缓存
curl "https://your-domain/debug/555?action=clear"

# 3. 手动访问站点验证
# 浏览器打开 https://www.555zxdy.cc
```

**如果站点结构变更** → 可能需要在 `parser-555.js` 中更新正则。

**如果站点长期不可达** → 建议在配置页面关闭 555 源。

### Q6：如何关闭 555 源？

**方法 1**：配置页面

访问 `/configure`，取消勾选「555 电影」，生成安装链接。

**方法 2**：URL 参数

```
https://your-domain/manifest.json?cfg=eyJzcmNzIjpbImpweXkiXX0
```

（`eyJzcmNzIjpbImpweXkiXX0` = `{"srcs":["jpyy"]}`）

**方法 3**：修改 `config.js` 默认值

```javascript
// 把默认源改为只有 jpyy
enabledSources = ['jpyy'];
```

### Q7：如何降低 Redis 用量？

- 增大缓存 TTL（如 Catalog 从 5 分钟改为 10 分钟）
- 减少写入频次（仅缓存成功响应）
- 升级 Upstash 套餐（免费额度 10k 命令/天）

### Q8：Vercel 返回 403 / Security Checkpoint？

**原因**：短时间内大量请求触发 Vercel 安全防护。

**解决**：
- 等待 10-30 分钟
- 用浏览器访问验证
- 请求时带完整浏览器头

**Stremio 客户端不会被拦**（有正常的 User-Agent）。

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
  ├─ VodName 顺带缓存
  └─ 多语言 IMDb 匹配

阶段 5 · 用户体验
  ├─ 配置页面
  ├─ 官方域名 API
  ├─ 类型筛选
  ├─ Stream 开关
  └─ Device ID 动态生成

阶段 6 · 多源扩展（实验性）
  ├─ 555 源支持
  ├─ JS 挑战求解
  ├─ 多源 Stream 聚合
  └─ 源开关配置
```

---

## 贡献

欢迎提交 Issue 与 Pull Request。若本项目对你有帮助，请给一个 ⭐️ Star。

**注意**：
- jpyy 源为主要维护对象
- 555 源为**实验性**，不接受复杂功能新增，**可能随时删除**

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