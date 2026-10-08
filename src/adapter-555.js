/**
 * 555 电影站适配器
 *
 * 网络请求 + 缓存，调用 parser-555.js 解析
 *
 * 缓存策略（与 jpyy 一致）：
 *   - Catalog:  300s
 *   - Detail:   1800s
 *   - Episodes: 1800s（独立缓存，Stream 流程专用）
 *   - Stream:   180s
 *
 * 域名策略：
 *   ① 用户配置 d555（最优先，失败不切换）
 *   ② 内存记录的成功域名（实例级）
 *   ③ 硬编码默认域名
 *   ④ 硬编码备用域名列表
 *
 * @module adapter-555
 */

import { getText } from './http.js';
import { getCache, setCache } from './cache.js';
import {
  parseCatalog555,
  parseDetail555,
  parseEpisodes555,
  parsePlayerUrl555,
  extractEpisodeNumber,
} from './parser-555.js';

import {
  isChallenge,
  parseChallenge,
  solveChallenge,
  getCachedCookie,
  setCachedCookie,
  extractVgFromResponse,
  buildCookieHeader,
} from './challenge-555.js';

// ==========================================
// 分类映射
// ==========================================

/**
 * catalogId → 站点 URL 路径
 * 全部使用预先拼好的 path，避免再走一层函数
 */
export const CATALOG_555_MAP = {
  '555-movie':   { path: '/vod/type/id/1.html',   typeId: '1' },
  '555-series':  { path: '/vod/type/id/2.html',   typeId: '2' },
  '555-anime':   { path: '/vod/type/id/3.html',   typeId: '3' },
  '555-variety': { path: '/vod/type/id/4.html',   typeId: '4' },
  '555-short':   { path: '/vod/type/id/45.html',  typeId: '45' },
  '555-sports':  { path: '/vod/type/id/39.html',  typeId: '39' },
  '555-new':     { path: '/label/new.html',       typeId: 'new' },
};

// ==========================================
// 域名管理
// ==========================================

/** 硬编码默认域名 */
const DEFAULT_DOMAIN_555 = '555zxdy.cc';

/** 硬编码备用域名（默认失败时依次尝试） */
const FALLBACK_DOMAINS_555 = [
  '555gy.cc',
  '555zxdy.cc',
  '555gy.cc',
];

/** 555 专用 UA（来自原始源码，对 555 站点更稳） */
const UA_555 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** 内存记录的当前可用域名（实例级，避免重复失败） */
let currentDomain555 = null;

/**
 * 读取用户配置的 555 域名
 */
function getUserDomain555() {
  const user = (typeof globalThis !== 'undefined' && globalThis.__USER_CONFIG) || {};
  return user.d555 || null;
}

/**
 * 获取当前使用的 555 域名（仅用于日志/调试）
 */
export function getCurrentDomain555() {
  return getUserDomain555() || currentDomain555 || DEFAULT_DOMAIN_555;
}

// ==========================================
// 挑战感知的单域名请求
// ==========================================

/**
 * 对单个域名发起"带挑战处理"的请求
 * 
 * 流程：
 *   1. 从 Redis 取缓存的 cookie
 *   2. 带 cookie 请求
 *   3. 若返回是挑战页 → 走挑战求解 → 带新 cookie 重试
 *   4. 若成功 → 从响应头捕获 __vg → 写回 Redis
 * 
 * @param {string} url - 完整 URL
 * @param {string} referer - Referer
 * @returns {Promise<{ html: string, url: string }>}
 */
async function fetchWithChallenge(url, referer) {
  // ===== 1. 先尝试用缓存 cookie 请求 =====
  const cached = await getCachedCookie();
  if (cached && cached.vgp) {
    const headers = {
      'User-Agent': UA_555,
      'Referer': referer,
      'Cookie': buildCookieHeader(cached.vgp, cached.vg),
    };

    const resp = await rawFetch(url, headers);
    if (resp.ok) {
      const html = await resp.text();
      if (!isChallenge(html)) {
        // 缓存的 cookie 有效
        return { html, url };
      }
      console.log(`[555 挑战] ⚠️ 缓存的 cookie 已失效，重新求解`);
    }
  }

  // ===== 2. 无缓存或已失效，走挑战求解 =====
  // 第一次请求（可能直接返回内容，也可能返回挑战页）
  const firstResp = await rawFetch(url, {
    'User-Agent': UA_555,
    'Referer': referer,
  });

  if (!firstResp.ok) {
    throw new Error(`HTTP ${firstResp.status}`);
  }

  const firstHtml = await firstResp.text();

  // 情况 A：直接返回内容（罕见）
  if (!isChallenge(firstHtml)) {
    const vg = extractVgFromResponse(firstResp);
    if (vg) {
      // 没有 vgp 但有 vg，这不常见，但先记住
      console.log(`[555 挑战] ℹ️ 首次直接返回内容，捕获 __vg=${vg.slice(0, 8)}...`);
    }
    return { html: firstHtml, url };
  }

  // 情况 B：返回挑战页 → 求解
  const params = parseChallenge(firstHtml);
  if (!params) {
    throw new Error('555 挑战页解析失败');
  }

  console.log(`[555 挑战] 🧩 C=${params.C}, D=${params.D}, P="${params.P}"`);

  const solved = solveChallenge(params.C, params.D, params.P);
  if (!solved) {
    throw new Error('555 挑战求解失败');
  }

  console.log(`[555 挑战] ✅ 解出 n=${solved.n}（迭代 ${solved.iterations} 次，耗时 ${solved.elapsed}ms）`);

  // ===== 3. 带 vgp 重试 =====
  const secondResp = await rawFetch(url, {
    'User-Agent': UA_555,
    'Referer': referer,
    'Cookie': `__vgp=${solved.vgp}`,
  });

  if (!secondResp.ok) {
    throw new Error(`挑战后请求失败 HTTP ${secondResp.status}`);
  }

  const secondHtml = await secondResp.text();
  const vg = extractVgFromResponse(secondResp);

  // ===== 4. 缓存 cookie =====
  if (vg) {
    await setCachedCookie(solved.vgp, vg);
    console.log(`[555 挑战] 💾 Cookie 已缓存：vgp=${solved.vgp}, vg=${vg.slice(0, 8)}...`);
  } else {
    // 没有 vg 也缓存 vgp，下次直接用
    await setCachedCookie(solved.vgp, '');
    console.log(`[555 挑战] 💾 Cookie 已缓存（无 vg）：vgp=${solved.vgp}`);
  }

  return { html: secondHtml, url };
}

/**
 * 裸 fetch（带超时）
 */
async function rawFetch(url, headers, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// 域名切换（替换现有实现）
// ==========================================

async function fetch555WithFallback(path) {
  const userDomain = getUserDomain555();

  // ===== 用户配置域名：只试一次 =====
  if (userDomain) {
    const url = `https://${userDomain}${path}`;
    const referer = `https://${userDomain}/`;
    try {
      const { html } = await fetchWithChallenge(url, referer);
      return html;
    } catch (err) {
      console.warn(`[555] ❌ 用户配置域名失败 (${userDomain}): ${err.message}`);
      throw err;
    }
  }

  // ===== 未配置：依次尝试 =====
  const candidates = [
    currentDomain555,
    DEFAULT_DOMAIN_555,
    ...FALLBACK_DOMAINS_555,
  ].filter(Boolean);
  const unique = [...new Set(candidates)];

  let lastErr;
  for (const domain of unique) {
    const url = `https://${domain}${path}`;
    const referer = `https://${domain}/`;
    try {
      const { html } = await fetchWithChallenge(url, referer);
      if (currentDomain555 !== domain) {
        console.log(`[555] 🌐 域名切换: ${currentDomain555 || '(none)'} → ${domain}`);
        currentDomain555 = domain;
      }
      return html;
    } catch (err) {
      lastErr = err;
      if (currentDomain555 === domain) currentDomain555 = null;
      console.warn(`[555] ❌ 域名失败 (${domain}): ${err.message}`);
    }
  }

  throw lastErr || new Error('555: all domains failed');
}



// ==========================================
// Catalog（缓存 5 分钟）
// ==========================================

/**
 * 获取分类列表
 *
 * 555 站点无分页参数：skip > 0 时直接返回空数组，
 * 让 Stremio 客户端停止加载，避免返回重复数据。
 *
 * @param {string} catalogId - 例如 555-movie
 * @param {number} skip - 偏移量（本实现中只有 0 有意义）
 * @returns {Promise<Array<{vodId, vodName, vodPic, vodRemarks}>>}
 */
export async function fetchCatalog555(catalogId, skip = 0) {
  const cacheKey = `555:catalog:${catalogId}:${skip}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[555] ✅ Catalog 缓存命中: ${cacheKey} (${cached.length} 条)`);
    return cached;
  }

  console.log(`[555] 📂 fetchCatalog555: catalogId=${catalogId}, skip=${skip}`);

  const config = CATALOG_555_MAP[catalogId];
  if (!config) {
    console.warn(`[555] ⚠️ 未知 catalogId: ${catalogId}`);
    return [];
  }

  // 555 无分页：skip>0 直接返回空
  if (skip > 0) {
    console.log(`[555] ⚠️ skip=${skip} > 0，555 站点无分页，返回空`);
    return [];
  }

  const html = await fetch555WithFallback(config.path);
  const list = parseCatalog555(html);

  const result = Array.isArray(list)
    ? list.map(item => ({
        vodId: item.vodId,
        vodName: item.vodName,
        vodPic: item.vodPic,
        vodRemarks: item.vodRemarks,
      }))
    : [];

  await setCache(cacheKey, result, 300);
  console.log(`[555] ✅ Catalog 写入: ${cacheKey} (${result.length} 条)`);
  return result;
}

// ==========================================
// Detail（缓存 30 分钟）
// ==========================================

/**
 * 获取影片详情
 *
 * 返回结构：
 *   {
 *     vodId, vodName, vodPic, vodContent, ...
 *     sources: [
 *       { sid: '1', name: '线路1', episodes: [{ nid, name }] },
 *       ...
 *     ]
 *   }
 *
 * @param {string} vodId
 * @returns {Promise<Object|null>}
 */
export async function fetchDetail555(vodId) {
  const cacheKey = `555:detail:${vodId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[555] ✅ Detail 缓存命中: ${vodId}`);
    return cached;
  }

  console.log(`[555] 📄 fetchDetail555: vodId=${vodId}`);

  const html = await fetch555WithFallback(`/vod/detail/id/${vodId}.html`);
  const detail = parseDetail555(html);
  if (!detail) {
    console.warn(`[555] ⚠️ parseDetail555 返回 null`);
    return null;
  }

  const sources = parseEpisodes555(html);

  const result = {
    vodId: String(vodId),
    vodName: detail.vodName,
    vodPic: detail.vodPic,
    vodContent: detail.vodContent,
    vodDirector: detail.vodDirector,
    vodActor: detail.vodActor,
    vodYear: detail.vodYear ? (parseInt(detail.vodYear, 10) || null) : null,
    vodArea: detail.vodArea,
    vodClass: detail.vodClass,
    vodRemarks: detail.vodRemarks,
    sources,  // ★ 按源分组的剧集列表
  };

  await setCache(cacheKey, result, 1800);
  console.log(`[555] ✅ Detail 写入: ${vodId} (${sources.length} 个源)`);
  return result;
}


// ==========================================
// Episodes（独立缓存，Stream 流程专用）
// ==========================================

/**
 * 获取剧集列表（按集合并多源）
 *
 * 返回结构：
 *   [
 *     {
 *       episode: 1,
 *       name: '第01集',
 *       sources: [
 *         { sid: '1', nid: '1', sourceName: '线路1' },
 *         { sid: '2', nid: '1', sourceName: '线路2' },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 *
 * 用途：
 *   - Stream 流程中，为每一集找到所有源
 *   - 也可以给 meta 页面展示总集数
 *
 * @param {string} vodId
 * @returns {Promise<Array>}
 */
export async function fetchEpisodes555(vodId) {
  const cacheKey = `555:episodes:${vodId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[555] ✅ Episodes 缓存命中: ${vodId} (${cached.length} 集)`);
    return cached;
  }

  // ===== 从 detail 缓存提取 =====
  const detailCached = await getCache(`555:detail:${vodId}`);
  if (detailCached && Array.isArray(detailCached.sources)) {
    const merged = mergeEpisodesFromSources(detailCached.sources);
    if (merged.length > 0) {
      await setCache(cacheKey, merged, 1800);
    }
    console.log(`[555] ✅ 从 Detail 缓存提取 Episodes: ${vodId} (${merged.length} 集)`);
    return merged;
  }

  // ===== 回源 =====
  console.log(`[555] 📺 fetchEpisodes555: vodId=${vodId}`);
  const html = await fetch555WithFallback(`/vod/detail/id/${vodId}.html`);
  const sources = parseEpisodes555(html);
  const merged = mergeEpisodesFromSources(sources);

  if (merged.length > 0) {
    await setCache(cacheKey, merged, 1800);
  }
  return merged;
}

/**
 * 把多个源的剧集列表合并成"按集分组、每集带所有源"的结构
 *
 * @param {Array<{sid, name, episodes: [{nid, name}]}>} sources
 * @returns {Array<{episode, name, sources: [{sid, nid, sourceName}]}>}
 */
function mergeEpisodesFromSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return [];

  // episodeName → { name, sources: [] }
  const episodeMap = new Map();

  for (const src of sources) {
    for (const ep of src.episodes) {
      // 用集名作为 key 聚合（同一集在不同源下 name 应该一致或相近）
      const key = ep.name;
      if (!episodeMap.has(key)) {
        episodeMap.set(key, {
          name: ep.name,
          sources: [],
        });
      }
      episodeMap.get(key).sources.push({
        sid: src.sid,
        nid: ep.nid,
        sourceName: src.name,
      });
    }
  }

  // 转换成数组，按集数排序
  const merged = Array.from(episodeMap.values());
  merged.sort((a, b) => {
    const na = extractEpisodeNumber(a.name);
    const nb = extractEpisodeNumber(b.name);
    const aNaN = isNaN(na);
    const bNaN = isNaN(nb);
    if (aNaN && bNaN) return a.name.localeCompare(b.name);
    if (aNaN) return 1;
    if (bNaN) return -1;
    return na - nb;
  });

  // 补上 episode 序号
  merged.forEach((ep, index) => {
    ep.episode = index + 1;
  });

  return merged;
}


// ==========================================
// Stream（缓存 3 分钟）
// ==========================================

/**
 * 获取真实播放地址
 *
 * 流程：
 *   1. 拼接播放页 URL：/vod/play/id/{vodId}/sid/{sid}/nid/{nid}.html
 *   2. 抓取 HTML
 *   3. 解析 player_aaaa，解密得到真实地址
 *
 * 返回格式与 jpyy 的 fetchStream 一致：
 *   [{ url, quality, resolution }]
 *
 * 555 无清晰度信息，quality 统一为 'HD'，resolution 为 0。
 *
 * 缓存：3 分钟（保守，因为真实 URL 有时效）
 *
 * @param {string} vodId
 * @param {string} sid - 线路 ID
 * @param {string} nid - 单集 ID
 * @returns {Promise<Array<{url: string, quality: string, resolution: number}>>}
 */
export async function fetchStream555(vodId, sid, nid) {
  const cacheKey = `555:stream:${vodId}:${sid}:${nid}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[555] ✅ Stream 缓存命中: ${vodId}:${sid}:${nid}`);
    return cached;
  }

  console.log(`[555] 🎬 fetchStream555: vodId=${vodId}, sid=${sid}, nid=${nid}`);

  const path = `/vod/play/id/${vodId}/sid/${sid}/nid/${nid}.html`;
  const html = await fetch555WithFallback(path);
  const url = parsePlayerUrl555(html);

  if (!url) {
    console.warn(`[555] ⚠️ 无法解析播放地址: ${vodId}:${sid}:${nid}`);
    return [];
  }

  // ===== 与 jpyy 格式对齐 =====
  const result = [{
    url,
    quality: 'HD',
    resolution: 0,
  }];

  await setCache(cacheKey, result, 180);
  console.log(`[555] ✅ Stream 写入: ${vodId}:${sid}:${nid} → ${url.slice(0, 80)}...`);
  return result;
}

// ==========================================
// 调试
// ==========================================

/**
 * 返回当前 adapter 状态（用于 /debug/555）
 */
export function get555Status() {
  return {
    currentDomain: getCurrentDomain555(),
    userDomain: getUserDomain555(),
    defaultDomain: DEFAULT_DOMAIN_555,
    fallbackDomains: FALLBACK_DOMAINS_555,
    memoryDomain: currentDomain555,
  };
}