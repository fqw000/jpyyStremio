/**
 * 域名解析器
 * 
 * 获取策略（优先级从高到低）：
 * 1. 内存缓存（实例级）
 * 2. Redis 缓存（跨实例，7 天 TTL）
 * 3. jpyy.com 官方 API（签名请求）
 * 4. jpyy.com 重定向/HTML 提取（兜底）
 * 5. 硬编码备用域名
 * 
 * @module domain-resolver
 */
import { CONFIG, DEFAULT_HEADERS } from './config.js';
import { Hash } from './helper.js';
import { getCache, setCache } from './cache.js';

// ==========================================
// 常量
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
const REDIS_LOCK_KEY = 'domain:probe:lock';

/** Redis 缓存 TTL（秒）*/
const REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;

//  配置基础域名
const BASE_DOMAIN = 'jpyy.com';


/** 域名 API 配置 */
const DOMAIN_API = {
  url: `https://${BASE_DOMAIN}/api/mw-movie/anonymous/website/get/domain`,
  params: { websiteSeoId: 86 },
  signKey: 'cb808529bae6b6be45ecfab29a4889bc',
  // deviceId: '39cb57bc-f77b-42c8-84e8-25fe857385d1',
  deviceId: getUUID(),  // 动态生成（每实例独立）

};

/* 生成 UUID v4
* 
* 用途：动态生成 Device ID，避免所有用户共享同一 ID
* 每次 Worker 实例启动时生成一次（冷启动时刷新）
* 
* @returns {string} UUID 字符串
*/
function getUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==========================================
// 主入口（同步，快速返回）
// ==========================================

/**
 * 获取用户配置的域名（最高优先级）
 * 
 * 用户通过 /configure 页面的 ?cfg={bd:xxx} 配置
 * 
 * @returns {string|null}
 */
function getUserDomain() {
  const userConfig = (typeof globalThis !== 'undefined' && globalThis.__USER_CONFIG) || {};
  return userConfig.bd || null;
}

/**
 * 获取当前使用的域名
 * 
 * 优先级：
 *   ① 用户配置 bd（最高）
 *   ② 自动探测结果
 *   ③ 硬编码兜底
 * 
 * @returns {string}
 */
export function getBaseDomain() {
  // ① 用户配置优先
  const userDomain = getUserDomain();
  if (userDomain) {
    return userDomain;
  }

  // ② 探测结果
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
  // ===== 用户配置的域名 → 不触发自动切换 =====
  const userDomain = getUserDomain();
  if (userDomain) {
    console.log(`[Domain] 👤 用户配置域名失败: ${userDomain}（跳过自动切换）`);
    return userDomain;
  }

  const stat = domainStats.get(failedDomain) || { failCount: 0, successCount: 0 };
  stat.failCount++;
  domainStats.set(failedDomain, stat);

  console.log(`[Domain] ⚠️ ${failedDomain} 失败 (${stat.failCount} 次)`);

  if (failedDomain === currentDomain) {
    return await probeAndUpdate(logger, true);   // ← force=true
  }

  return currentDomain;
}

// ==========================================
// 探测并更新（分层策略）
// ==========================================

/**
 * 探测并更新当前域名
 * 
 * @param {LogCollector} logger
 * @returns {Promise<string>}
 */
export async function probeAndUpdate(logger = null, force = false) {
  // ===== 0. 用户配置了域名 → 跳过所有探测 =====
  const userDomain = getUserDomain();
  if (userDomain) {
    console.log(`[Domain] 👤 使用用户配置域名: ${userDomain}（跳过探测）`);
    return userDomain;
  }

  // ===== 1. Redis 锁 ======
  const lockAcquired = await getCache(REDIS_LOCK_KEY);
  if (lockAcquired) {
    console.log(`[Domain] ⏳ 其他实例正在探测，等待...`);
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

  await setCache(REDIS_LOCK_KEY, { ts: Date.now() }, 60);

  // ===== 2. 检查 Redis 缓存 =====
  // ===== 2. 检查 Redis 缓存 =====
  // force=true 时跳过（已确认当前域名失效，缓存不可信）
  if (!force) {
    try {
      const redisCached = await getCache(REDIS_KEY);
      if (redisCached && redisCached.domain && redisCached.ts) {
        const age = Date.now() - redisCached.ts;
        if (age < PROBE_TTL) {
          currentDomain = redisCached.domain;
          lastProbeAt = redisCached.ts;
          console.log(`[Domain] ✅ Redis 缓存命中: ${currentDomain} (age=${Math.round(age / 3600000)}h)`);
          return currentDomain;
        }
      }
    } catch (err) {
      console.warn(`[Domain] Redis 读取失败: ${err.message}`);
    }
  } else {
    console.log(`[Domain] 🔄 force=true，跳过 Redis 缓存，强制重新探测`);
  }

  // ===== 3. 检查内存缓存 =====
  if (!force && currentDomain && (Date.now() - lastProbeAt) < PROBE_TTL) {
    console.log(`[Domain] ✅ 内存缓存有效，跳过探测`);
    return currentDomain;
  }

  if (probing) {
    while (probing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return currentDomain;
  }

  probing = true;
  console.log(`[Domain] 🔍 开始探测可用域名...`);

  try {
    // ===== 4. 并行探测本地候选域名（优先，省一次 API 请求）=====
    const candidates = [
      CONFIG.BASE_DOMAIN,
      ...(CONFIG.FALLBACK_DOMAINS || []),
    ].filter(d => d && !d.includes('jpyy.com'));

    const uniqueCandidates = [...new Set(candidates)];

    if (uniqueCandidates.length > 0) {
      console.log(`[Domain] 🚀 并行探测 ${uniqueCandidates.length} 个本地候选（取最先成功）...`);
      const localOk = await probeFirstSuccess(uniqueCandidates, logger);

      if (localOk) {
        currentDomain = localOk;
        lastProbeAt = Date.now();
        await saveToRedis(localOk);
        console.log(`[Domain] ✅ 本地候选成功: ${localOk}`);
        return localOk;
      }
      console.log(`[Domain] ⚠️ 本地候选 ${uniqueCandidates.length} 个域名全部失败`);
    }

    // ===== 5. 本地全失败，通过官方 API 获取域名列表 =====
    const apiDomains = await fetchDomainsFromApi(logger);

    if (apiDomains && apiDomains.length > 0) {
      console.log(`[Domain] 🚀 并行探测 ${apiDomains.length} 个 API 域名（取最先成功）...`);
      const apiOk = await probeFirstSuccess(apiDomains, logger);

      if (apiOk) {
        currentDomain = apiOk;
        lastProbeAt = Date.now();
        await saveToRedis(apiOk);
        console.log(`[Domain] ✅ API 探测成功: ${apiOk}`);
        return apiOk;
      }
      console.log(`[Domain] ⚠️ API 返回的 ${apiDomains.length} 个域名全部失败`);
    }

    // ===== 6. 最终兜底：jpyy.com HTML 提取 =====
    console.log(`[Domain] ⚠️ 所有方式失败，尝试 HTML 提取`);
    const discovered = await discoverFromJpyyHtml(logger);
    if (discovered) {
      currentDomain = discovered;
      lastProbeAt = Date.now();
      await saveToRedis(discovered);
      console.log(`[Domain] ✅ HTML 发现: ${discovered}`);
      return discovered;
    }

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
// 【新增】通过官方 API 获取域名列表
// ==========================================

/**
 * 生成 API 签名
 * 
 * 算法：SHA1(MD5(sorted_params + "&key=" + SIGN_KEY + "&t=" + t))
 * 
 * @param {Object} params - 请求参数
 * @param {number} t - 时间戳
 * @returns {string}
 */
function generateDomainApiSign(params, t) {
  // 1. 参数按 key 排序并拼接
  const keys = Object.keys(params).sort();
  const paramStr = keys.map(k => `${k}=${params[k]}`).join('&');

  // 2. 拼接完整签名串
  const signStr = `${paramStr}&key=${DOMAIN_API.signKey}&t=${t}`;

  // 3. 双层哈希
  return Hash.sha1(Hash.md5(signStr));
}

/**
 * 通过官方 API 获取域名列表
 * 
 * @param {LogCollector} logger
 * @returns {Promise<string[]>}
 */
async function fetchDomainsFromApi(logger = null) {
  const t = Date.now();
  const params = DOMAIN_API.params;
  const sign = generateDomainApiSign(params, t);

  const qs = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = `${DOMAIN_API.url}?${qs}`;

  console.log(`[Domain API] 🔍 请求: ${url}`);
  console.log(`[Domain API] 🔐 sign=${sign.slice(0, 16)}... t=${t}`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Authorization': '',
        'sign': sign,
        't': String(t),
        'deviceId': DOMAIN_API.deviceId,
        'client-type': '1',
        'User-Agent': CONFIG.USER_AGENT,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`[Domain API] ❌ HTTP ${resp.status}`);
      return [];
    }

    const data = await resp.json();

    if (data.code !== 200) {
      console.warn(`[Domain API] ❌ code=${data.code}, msg=${data.msg}`);
      return [];
    }

    // ===== 解析域名列表 =====
    // data.data 可能是数组或对象
    let domains = [];

    if (Array.isArray(data.data)) {
      domains = data.data;
    } else if (typeof data.data === 'string') {
      domains = [data.data];
    } else if (data.data && typeof data.data === 'object') {
      // 可能是 { domain: 'xxx', domains: [...] }
      if (data.data.domain) domains.push(data.data.domain);
      if (Array.isArray(data.data.domains)) domains.push(...data.data.domains);
    }

    // ===== 清洗 =====
    const cleaned = domains
      .filter(d => typeof d === 'string' && d.length > 0)
      .map(d => d.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
      .filter(d => !d.includes('jpyy.com'))  // 排除发现源
      .filter((d, i, arr) => arr.indexOf(d) === i);  // 去重

    console.log(`[Domain API] ✅ 返回 ${cleaned.length} 个域名: ${cleaned.slice(0, 5).join(', ')}${cleaned.length > 5 ? '...' : ''}`);

    return cleaned;
  } catch (err) {
    console.warn(`[Domain API] ❌ 请求失败: ${err.message}`);
    return [];
  }
}

/**
 * 探测单个域名是否可用
 *
 * 判定标准（避免 HEAD/重定向误判）：
 *   1. GET 请求真实业务路径（分类页第一页），而非首页
 *   2. 跟随重定向（307 → 真实目的地）
 *   3. 只认 HTTP 200
 *
 * 不读响应体，只取 status，保持轻量。
 */
async function probeDomain(domain, logger) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(`https://${domain}/vod/show/id/1/page/1`, {
      method: 'GET',
      headers: {
        ...DEFAULT_HEADERS,
        'RSC': '1',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const status = resp.status;
    const alive = status === 200;
    console.log(`[Domain] ${alive ? '✅' : '❌'} ${domain} (HTTP ${status})`);
    return alive;
  } catch (err) {
    console.log(`[Domain] ❌ ${domain} - ${err.message}`);
    return false;
  }
}


/**
 * 并行探测多个域名，返回"最先成功响应"的域名
 *
 * 与 Promise.all + find 的区别：
 *   - Promise.all 要等所有探测完成（含失败/超时）
 *   - 本函数一旦有域名成功，立即 resolve，不等其他
 *
 * 效果：
 *   - 探测总耗时 ≈ 最快成功域名的耗时
 *   - 选中的也是响应最快的域名（后续业务请求更快）
 *
 * @param {string[]} domains - 候选域名列表
 * @param {LogCollector} logger
 * @returns {Promise<string|null>} - 第一个成功的域名，全部失败返回 null
 */
async function probeFirstSuccess(domains, logger) {
  if (!domains || domains.length === 0) return null;

  return new Promise((resolve) => {
    let pending = domains.length;
    let settled = false;

    const tryResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    domains.forEach(async (domain) => {
      let ok = false;
      try {
        ok = await probeDomain(domain, logger);
      } catch (e) {
        ok = false;
      }

      if (ok) {
        tryResolve(domain);
      }

      pending--;
      if (pending === 0) {
        // 全部完成，若还没有成功则返回 null
        tryResolve(null);
      }
    });
  });
}



// ==========================================
// HTML 兜底方案
// ==========================================

/**
 * 从 jpyy.com HTML 提取域名（兜底方案）
 * 
 * @param {LogCollector} logger
 * @returns {Promise<string|null>}
 */
async function discoverFromJpyyHtml(logger) {
  console.log(`[Domain HTML] 🔍 访问发现源: ${CONFIG.DISCOVERY_URL}`);

  try {
    // 尝试重定向
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
          console.log(`[Domain HTML] 🌐 重定向发现: ${newDomain}`);
          return newDomain;
        }
      }
    }

    // HTML 提取
    const html = await fetch(CONFIG.DISCOVERY_URL, {
      headers: DEFAULT_HEADERS,
    }).then(r => r.text());

    const domains = extractDomainsFromHtml(html);
    for (const domain of domains) {
      if (domain.includes('jpyy.com')) continue;
      if (await probeDomain(domain, logger)) {
        console.log(`[Domain HTML] 🌐 HTML 提取: ${domain}`);
        return domain;
      }
    }

    return null;
  } catch (err) {
    console.log(`[Domain HTML] ❌ 发现源访问失败: ${err.message}`);
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
  console.log('[Domain] 🧹 内存缓存已清空');
}

/**
 * 【新增】手动测试 API 获取
 * 
 * 可在 handler.js 中加 /debug/domains?action=api 调用
 * 
 * @returns {Promise<{domains: string[], t: number, sign: string}>}
 */
export async function testDomainApi() {
  const t = Date.now();
  const params = DOMAIN_API.params;
  const sign = generateDomainApiSign(params, t);
  const domains = await fetchDomainsFromApi(null);

  return { domains, t, sign };
}