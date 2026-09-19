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
- [常见问题](#常见问题)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 核心特性

- **完整功能** — 支持 `catalog`、`meta`、`stream`、`search` 四大接口，与 Stremio 官方规范对齐
- **双 ID 体系** — 同时兼容站内 ID (`jp146932`) 与 IMDb ID (`tt0109830`)，与其他 Addon 无缝协作
- **剧集精解** — 正确处理「每季独立条目」的资源站数据模型，剧集列表、分集播放准确无误
- **多级缓存** — 内存 → Redis → CDN 三层缓存，有效降低源站压力，提升响应速度
- **动态域名** — 自动追踪站点最新域名，即使资源站域名变更也不影响使用
- **跨实例缓存** — 通过 Upstash Redis 实现边缘函数的共享缓存，避免重复请求
- **零配置部署** — 克隆、配置环境变量、一键部署到 Vercel

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
│         静态缓存 · 全球节点 · 就近响应（HIT）            │
└──────────────────────────────────────────────────────┘
                        │ MISS
                        ▼
┌──────────────────────────────────────────────────────┐
│              Vercel Edge Function                     │
│  ┌──────────────────────────────────────────────┐    │
│  │              Handler 层                       │    │
│  │    路由解析 · 请求分发 · 响应封装              │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │              Adapter 层                       │    │
│  │   站点请求 · RSC 解析 · 签名生成               │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │             Resolver 层                       │    │
│  │   IMDb 解析 · 剧集匹配 · 缩略图获取            │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │              Cache 层                         │    │
│  │        L1 内存 · L2 Upstash Redis             │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│              资源站 (x8kb9k8.com)                     │
│        域名由 jpyy.com 动态发现，自动跟随变更           │
└──────────────────────────────────────────────────────┘
```

---

## 项目结构

```
jpyyVecel/
├── api/
│   └── index.js              # Vercel Edge Function 入口
├── src/
│   ├── handler.js            # 主处理逻辑（路由分发）
│   ├── adapter.js            # 站点适配器（搜索/详情/流媒体）
│   ├── manifest.js           # Stremio 清单
│   ├── config.js             # 全局配置
│   ├── cache.js              # 多级缓存（内存 + Redis）
│   ├── domain-resolver.js    # 域名动态追踪
│   ├── imdb-resolver.js      # IMDb → 站内 ID 解析
│   ├── tmdb.js               # TMDB / Cinemeta 集成
│   ├── rsc.js                # Next.js RSC 流解析
│   ├── http.js               # HTTP 客户端（超时/重试）
│   └── helper.js             # 工具函数（Hash / Utils）
├── vercel.json               # Vercel 路由配置
├── package.json
|-- health.js                 # 完整测试脚本
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
   - **Region**：`ap-southeast-1`（新加坡，离用户最近）
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
| `BASE_DOMAIN` | `x8kb9k8.com` | 资源站默认域名 |
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

### Catalog · 浏览

```http
GET /catalog/:type/:id.json?skip=0
```

| 参数 | 说明 |
|------|------|
| `type` | `movie` 或 `series` |
| `id` | 目录 ID（如 `jinpai-movie`） |
| `skip` | 分页偏移量 |

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
| **L1** | 内存 Map | < 1ms | 实例级（几十秒到几分钟） |
| **L2** | Upstash Redis | < 10ms | 跨实例（几小时到几天） |
| **L3** | Vercel CDN | < 100ms | 全局（按 TTL） |

### 各接口缓存 TTL

| 数据 | 内存 | Redis | CDN |
|------|------|-------|-----|
| **Catalog** | 60s | 5 分钟 | 5 分钟 |
| **Meta** | 60s | 30 分钟 | 10 分钟 |
| **Stream** | 60s | 10 分钟 | 1 分钟 |
| **Search** | 60s | 10 分钟 | 5 分钟 |
| **IMDb 映射** | - | 7 天 | - |
| **TMDB 元数据** | - | 7 天 | - |
| **域名** | - | 7 天 | - |

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
tt0455275:4:5
    ↓ 查询 TMDB 获取标题「越狱」
    ↓ 搜索站点匹配「越狱 第四季」
    ↓ 得到 vodId=132032
    ↓ 查询详情找到第 5 集 nid
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

### 手动清空缓存

```bash
curl "https://your-domain.vercel.app/debug/domains?action=clear"
```

---

## 常见问题

### Q1：Stremio 中搜索无结果？

确认 `manifest.json` 的 `catalogs` 中已声明 `extra` 字段：

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
curl -I "https://your-domain/catalog/movie/jinpai-movie.json" | grep -i cache
```

若 `x-vercel-cache: MISS` 持续出现，检查：
- 是否配置 `Cache-Control` 响应头
- 是否使用自定义域名（`*.vercel.app` 默认不缓存）

### Q4：如何降低 Redis 用量？

- 增大缓存 TTL（如 Catalog 从 5 分钟改为 10 分钟）
- 减少写入频次（仅缓存成功响应）
- 升级 Upstash 套餐（免费额度 10k 命令/天）

### Q5：Stremio 中视频无法播放？

- 检查流地址是否有效（`curl -I <url>`）
- 确认 Stremio 支持 HLS 格式
- 若需要代理头，可添加 `behaviorHints.proxyHeaders`

---

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Vercel Edge Functions (V8 Isolate) |
| 语言 | JavaScript (ES Module) |
| 缓存 | Upstash Redis + Vercel CDN |
| 元数据 | TMDB API + Cinemeta |
| 协议 | Stremio Addon SDK |
| 依赖 | 零第三方依赖（仅原生 fetch） |

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
  └─ 多级缓存

阶段 4 · 性能优化
  ├─ CDN 缓存
  ├─ Redis 跨实例缓存
  └─ Episodes 独立缓存
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