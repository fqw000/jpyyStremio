/**
 * 域名解析器
 * 
 * 策略：
 * - 默认使用 CONFIG.BASE_DOMAIN（不探测）
 * - 请求失败时触发探测
 * - 探测结果写入 Redis（跨实例共享，7 天 TTL）
 * 
 * @module domain-resolver
 */
import { CONFIG, DEFAULT_HEADERS } from './config.js';
import { getCache, setCache } from './cache.js';

// ==========================================
// 状态（内存，快速访问）
// ==========================================

/** 当前使用的域名 */
let currentDomain = CONFIG.BASE_DOMAIN;

/** 上次探测时间 */
let lastProbeAt = 0;

/** 探测进行中标志 */
let probing = false;

/** 内存中的域名统计 */
const domainStats = new Map();

/** 探测缓存 TTL：7 天 */
const PROBE_TTL = 7 * 24 * 60 * 60 * 1000;

/** Redis 缓存 Key */
const REDIS_KEY = 'domain:current';

/** Redis 缓存 TTL（秒）*/
const REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;

// ==========================================
// 主入口（同步，快速返回）
// ==========================================

/**
 * 获取当前使用的域名
 * 
 * 同步返回内存中的值，不阻塞
 * 
 * @returns {string}
 */
export function getBaseDomain() {
  return currentDomain || CONFIG.BASE_DOMAIN;
}

/**
 * 标记域名失败
 * 
 * @param {string} failedDomain - 失败的域名
 * @param {LogCollector} logger
 * @returns {Promise<string>}
 */
export async function markDomainFailed(failedDomain, logger = null) {
  const stat = domainStats.get(failedDomain) || { failCount: 0, successCount: 0 };
  stat.failCount++;
  domainStats.set(failedDomain, stat);

  console.log(`[Domain] ⚠️ ${failedDomain} 失败 (${stat.failCount} 次)`);

  if (failedDomain === currentDomain) {
    return await probeAndUpdate(logger);
  }

  return currentDomain;
}

// ==========================================
// 探测并更新（先读 Redis，再探测）
// ==========================================

/**
 * 探测并更新当前域名
 * 
 * 流程：
 * 1. 尝试从 Redis 读取（跨实例共享）
 * 2. 检查内存缓存是否有效
 * 3. 逐个探测候选域名
 * 4. 全部失败 → 跟踪发现源
 * 5. 探测成功 → 写入 Redis
 * 
 * @param {LogCollector} logger
 * @returns {Promise<string>}
 */
export async function probeAndUpdate(logger = null) {
  // ===== 0. Redis 锁：防止并发探测 =====
  const lockKey = 'domain:probe:lock';
  const lockAcquired = await getCache(lockKey);
  if (lockAcquired) {
    console.log(`[Domain] ⏳ 其他实例正在探测，等待...`);
    // 等待最多 5 秒
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      const cached = await getCache(REDIS_KEY);
      if (cached && cached.domain) {
        currentDomain = cached.domain;
        lastProbeAt = cached.ts || Date.now();
        return currentDomain;
      }
    }
    console.log(`[Domain] ⚠️ 等待超时，继续用当前域名`);
    return currentDomain;
  }

  // 获取锁（60 秒自动释放）
  await setCache(lockKey, { ts: Date.now() }, 60);

  // ===== 1. 先检查 Redis（跨实例共享）=====
  try {
    const redisCached = await getCache(REDIS_KEY);
    if (redisCached && redisCached.domain && redisCached.ts) {
      const age = Date.now() - redisCached.ts;
      if (age < PROBE_TTL) {
        currentDomain = redisCached.domain;
        lastProbeAt = redisCached.ts;
        console.log(`[Domain] ✅ Redis 缓存命中: ${currentDomain} (age=${Math.round(age/3600000)}h)`);
        return currentDomain;
      }
    }
  } catch (err) {
    console.warn(`[Domain] Redis 读取失败: ${err.message}`);
  }

  // ===== 2. 检查内存缓存 =====
  if (currentDomain && (Date.now() - lastProbeAt) < PROBE_TTL) {
    console.log(`[Domain] ✅ 内存缓存有效，跳过探测`);
    return currentDomain;
  }

  // ===== 3. 防止并发探测 =====
  if (probing) {
    console.log(`[Domain] ⏳ 探测进行中，等待...`);
    while (probing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return currentDomain;
  }

  probing = true;
  console.log(`[Domain] 🔍 开始探测可用域名...`);

  try {
    // ===== 4. 依次探测候选域名 =====
    const candidates = [
      CONFIG.BASE_DOMAIN,
      ...(CONFIG.FALLBACK_DOMAINS || []),
    ].filter(d => d && !d.includes('jpyy.com'));

    // 去重
    const uniqueCandidates = [...new Set(candidates)];

    for (const domain of uniqueCandidates) {
      if (await probeDomain(domain, logger)) {
        currentDomain = domain;
        lastProbeAt = Date.now();
        await saveToRedis(domain);
        console.log(`[Domain] ✅ 探测成功: ${domain}`);
        return domain;
      }
    }

    // ===== 5. 全部失败，跟踪发现源 =====
    console.log(`[Domain] ⚠️ 所有候选失败，尝试发现源`);
    const discovered = await discoverFromJpyy(logger);
    if (discovered) {
      currentDomain = discovered;
      lastProbeAt = Date.now();
      await saveToRedis(discovered);
      console.log(`[Domain] ✅ 发现新域名: ${discovered}`);
      return discovered;
    }

    // ===== 6. 全部失败，保持原域名 =====
    console.log(`[Domain] ❌ 探测全部失败，保持: ${currentDomain}`);
    return currentDomain;
  } finally {
    probing = false;
  }
}

/**
 * 保存域名到 Redis
 */
async function saveToRedis(domain) {
  try {
    await setCache(REDIS_KEY, { domain, ts: Date.now() }, REDIS_TTL_SECONDS);
    console.log(`[Domain] 💾 已写入 Redis: ${domain}`);
  } catch (err) {
    console.warn(`[Domain] Redis 写入失败: ${err.message}`);
  }
}

// ==========================================
// 探测单个域名
// ==========================================

async function probeDomain(domain, logger) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(`https://${domain}/`, {
      method: 'HEAD',
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timer);

    const status = resp.status;
    const alive = [200, 301, 302, 307, 308, 403].includes(status);
    console.log(`[Domain] ${alive ? '✅' : '❌'} ${domain} (HTTP ${status})`);
    return alive;
  } catch (err) {
    console.log(`[Domain] ❌ ${domain} - ${err.message}`);
    return false;
  }
}

// ==========================================
// 从 jpyy.com 发现
// ==========================================

async function discoverFromJpyy(logger) {
  console.log(`[Domain] 🔍 访问发现源: ${CONFIG.DISCOVERY_URL}`);

  try {
    // 1. 尝试重定向
    const redirectResp = await fetch(CONFIG.DISCOVERY_URL, {
      method: 'GET',
      headers: DEFAULT_HEADERS,
      redirect: 'manual',
    });

    if (redirectResp.status >= 300 && redirectResp.status < 400) {
      const location = redirectResp.headers.get('location');
      if (location) {
        const newDomain = extractDomain(location);
        if (newDomain && !newDomain.includes('jpyy.com')) {
          console.log(`[Domain] 🌐 重定向发现: ${newDomain}`);
          return newDomain;
        }
      }
    }

    // 2. HTML 提取
    const html = await fetch(CONFIG.DISCOVERY_URL, {
      headers: DEFAULT_HEADERS,
    }).then(r => r.text());

    const domains = extractDomainsFromHtml(html);
    for (const domain of domains) {
      if (domain.includes('jpyy.com')) continue;
      if (await probeDomain(domain, logger)) {
        console.log(`[Domain] 🌐 HTML 提取发现: ${domain}`);
        return domain;
      }
    }

    return null;
  } catch (err) {
    console.log(`[Domain] ❌ 发现源访问失败: ${err.message}`);
    return null;
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function extractDomainsFromHtml(html) {
  const excludes = ['jpyy.com', 'google', 'cloudflare', 'facebook', 'github', 'baidu', 'qq.com', '163.com'];
  const candidates = new Set();

  const regex = /\b([a-z0-9]+(?:-[a-z0-9]+)*\.(?:com|net|cc|xyz|top|vip|io|tv|me|club|site))\b/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const domain = match[1].toLowerCase();
    if (!excludes.some(ex => domain.includes(ex))) {
      candidates.add(domain);
    }
  }

  return [...candidates];
}

// ==========================================
// 调试接口
// ==========================================

export function getDomainStatus() {
  return {
    current: currentDomain,
    lastProbe: lastProbeAt ? new Date(lastProbeAt).toISOString() : 'never',
    probing,
    stats: Object.fromEntries(domainStats),
  };
}

export function clearDomainCache() {
  currentDomain = CONFIG.BASE_DOMAIN;
  lastProbeAt = 0;
  domainStats.clear();
  console.log('[Domain] 🧹 内存缓存已清空（Redis 缓存需在 Upstash 控制台清空 domain:current）');
}
