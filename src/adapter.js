/**
 * 站点适配器
 * 
 * 所有对站点的请求都经过这里
 * 带缓存（内存 + Upstash Redis）
 * 
 * @module adapter
 */
import { CONFIG } from './config.js';
import { getText, getJson } from './http.js';
import { Hash } from './helper.js';
import { parseCatalog, parseDetail, extractEpisodes } from './rsc.js';
import { getBaseDomain, markDomainFailed } from './domain-resolver.js';
import { getCache, setCache } from './cache.js';

// ==========================================
// 分类映射
// ==========================================

export const CATALOG_TYPE_MAP = {
  // ===== 完整 ID（manifest 声明）=====
  'jinpai-movie': { typeId: 1, itemType: 'movie' },
  'jinpai-series': { typeId: 2, itemType: 'series' },
  'jinpai-variety': { typeId: 3, itemType: 'series' },
  'jinpai-anime': { typeId: 4, itemType: 'series' },
  'jinpai-short': { typeId: 88, itemType: 'series' },

  // ===== 简写别名（兼容 Stremio 客户端特殊请求）=====
  'movie': { typeId: 1, itemType: 'movie' },
  'series': { typeId: 2, itemType: 'series' },
  'variety': { typeId: 3, itemType: 'series' },
  'anime': { typeId: 4, itemType: 'series' },
  'short': { typeId: 88, itemType: 'series' },
};

// ==========================================
// 辅助函数
// ==========================================

function extractYear(dateStr) {
  if (!dateStr) return null;
  const year = parseInt(String(dateStr).split('-')[0], 10);
  return isNaN(year) ? null : year;
}

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================
// 签名
// ==========================================

function signSearch(keyword, pageNum, pageSize = 24) {
  const t = Date.now();
  const signKey = `keyword=${keyword}&pageNum=${pageNum}&pageSize=${pageSize}&type=false&key=${CONFIG.API_KEY}&t=${t}`;
  const sign = Hash.sha1(Hash.md5(signKey));
  return { t, sign };
}

function signStream(vodId, nid) {
  const t = Date.now();
  const signKey = `clientType=1&id=${vodId}&nid=${nid}&key=${CONFIG.API_KEY}&t=${t}`;
  const sign = Hash.sha1(Hash.md5(signKey));
  return { t, sign };
}

// ==========================================
// Catalog（缓存 5 分钟）
// ==========================================

export async function fetchCatalog(catalogId, skip = 0) {
  const cacheKey = `catalog:${catalogId}:${skip}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[Adapter] ✅ Catalog 缓存命中: ${cacheKey} (${cached.length} 条)`);
    return cached;
  }

  console.log(`[Adapter] 📂 fetchCatalog: catalogId=${catalogId}, skip=${skip}`);

  const config = CATALOG_TYPE_MAP[catalogId];
  if (!config) {
    console.warn(`[Adapter] ⚠️ 未知 catalogId: ${catalogId}`);
    return [];
  }

  const { typeId } = config;
  const pageSize = 48;
  const page = Math.floor(skip / pageSize) + 1;

  const domain = getBaseDomain();
  const url = `https://${domain}/vod/show/id/${typeId}/page/${page}`;

  let text;
  try {
    text = await getText(url, { 'RSC': '1', 'Referer': `https://${domain}/` });
  } catch (err) {
    if (err.message.includes('403') || err.name === 'AbortError') {
      console.log(`[Adapter] ⚠️ 域名失败 (${domain})，尝试切换...`);
      const newDomain = await markDomainFailed(domain);
      if (newDomain && newDomain !== domain) {
        const newUrl = `https://${newDomain}/vod/show/id/${typeId}/page/${page}`;
        text = await getText(newUrl, { 'RSC': '1', 'Referer': `https://${newDomain}/` });
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  const list = parseCatalog(text);
  if (!Array.isArray(list)) {
    console.warn(`[Adapter] ⚠️ parseCatalog 返回非数组`);
    return [];
  }

  const result = list.map(item => ({
    vodId: String(item.vodId || ''),
    vodName: item.vodName?.trim() || '',
    vodPic: item.vodPic?.trim() || '',
    vodYear: extractYear(item.vodPubdate),
    vodTotal: item.vodTotal || 0,
    vodSeries: (item.vodTotal || 0) > 0 ? 1 : 0,
    vodClass: item.vodClass?.trim() || '',
    vodActor: item.vodActor?.trim() || '',
    vodBlurb: cleanHtml(item.vodContent || ''),
    vodPubdate: item.vodPubdate || '',
  }));

  await setCache(cacheKey, result, 300);
  return result;
}

// ==========================================
// Detail（缓存 30 分钟）
// ==========================================

export async function fetchDetail(vodId) {
  const cacheKey = `detail:${vodId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[Adapter] ✅ Detail 缓存命中: ${vodId}`);
    return cached;
  }

  console.log(`[Adapter] 📄 fetchDetail: vodId=${vodId}`);

  const domain = getBaseDomain();
  const url = `https://${domain}/detail/${vodId}?_rsc=xsbs6`;

  const text = await getText(url, { 'RSC': '1', 'Referer': `https://${domain}/` });
  const detail = parseDetail(text);
  if (!detail) return null;

  const episodes = extractEpisodes(detail);
  const vodTotal = parseInt(detail.vodTotal) || 0;

  const result = {
    vodId: String(detail.vodId || vodId),
    vodName: detail.vodName?.trim() || '',
    vodSub: detail.vodSub?.trim() || '',
    vodContent: cleanHtml(detail.vodContent || ''),
    vodPic: detail.vodPic?.trim() || '',
    vodPicSlide: detail.vodPicSlide?.trim() || '',
    vodDirector: detail.vodDirector?.trim() || '',
    vodActor: detail.vodActor?.trim() || '',
    vodPubdate: detail.vodPubdate || '',
    vodYear: detail.vodYear ? parseInt(detail.vodYear, 10) : extractYear(detail.vodPubdate),
    vodClass: detail.vodClass?.trim() || '',
    vodScore: detail.vodScore || detail.vodDoubanScore || null,
    vodArea: detail.vodArea?.trim() || '',
    vodLang: detail.vodLang?.trim() || '',
    vodDuration: detail.vodDuration?.trim() || '',
    vodRemarks: detail.vodRemarks?.trim() || '',
    vodSerial: detail.vodSerial?.trim() || '',
    vodTotal,
    vodSeries: vodTotal > 0 ? 1 : 0,
    episodes,
  };

  await setCache(cacheKey, result, 1800);
  return result;
}

// ==========================================
// Episodes（独立缓存，Stream 流程专用）
// ==========================================

/**
 * 获取剧集列表（独立缓存，直连站点）
 * 
 * 优化说明：
 * - 不再级联调用 fetchDetail
 * - 直接请求站点详情页，只提取 episodes
 * - 独立缓存 30 分钟
 * 
 * 优势：
 * - Stream 流程不再依赖 detail 缓存
 * - Redis 读取体积更小（episodes 约 1KB，detail 约 10KB）
 * - 缓存 miss 时只回源一次，不影响 detail
 * 
 * @param {string} vodId
 * @returns {Promise<Array<{nid: string, name: string}>>}
 */
export async function fetchEpisodes(vodId) {
  const cacheKey = `episodes:${vodId}`;

  // ===== 1. 检查独立 episodes 缓存 =====
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[Adapter] ✅ Episodes 缓存命中: ${vodId} (${cached.length} 集)`);
    return cached;
  }

  // ===== 2. 检查 detail 缓存（Meta 可能已经缓存过）=====
  const detailCached = await getCache(`detail:${vodId}`);
  if (detailCached && Array.isArray(detailCached.episodes)) {
    const eps = detailCached.episodes;
    console.log(`[Adapter] ✅ 从 Detail 缓存提取 Episodes: ${vodId} (${eps.length} 集)`);
    // 回填独立 episodes 缓存，加速后续访问
    if (eps.length > 0) {
      await setCache(cacheKey, eps, 1800);
    }
    return eps;
  }

  // ===== 3. 都未命中，直连站点 =====
  console.log(`[Adapter] 📺 fetchEpisodes: vodId=${vodId}`);

  const domain = getBaseDomain();
  const url = `https://${domain}/detail/${vodId}?_rsc=xsbs6`;

  const text = await getText(url, { 'RSC': '1', 'Referer': `https://${domain}/` });
  const detail = parseDetail(text);
  if (!detail) {
    console.warn(`[Adapter] ⚠️ parseDetail 返回 null`);
    return [];
  }

  const episodes = extractEpisodes(detail);

  if (episodes.length > 0) {
    await setCache(cacheKey, episodes, 1800);
    console.log(`[Adapter] ✅ Episodes 缓存写入: ${vodId} (${episodes.length} 集)`);
  }

  return episodes;
}

// ==========================================
// Search（缓存 10 分钟）
// ==========================================

export async function searchVideos(keyword, page = 1, pageSize = 24) {
  const cleanKeyword = (keyword || '').trim().toLowerCase();
  const cacheKey = `search:${cleanKeyword}:${page}:${pageSize}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[Adapter] ✅ Search 缓存命中: "${keyword}" (${cached.length} 条)`);
    return cached;
  }

  console.log(`[Adapter] 🔍 searchVideos: keyword="${keyword}", page=${page}`);

  if (!keyword || !keyword.trim()) return [];

  const trimmedKeyword = keyword.trim();
  const { t, sign } = signSearch(trimmedKeyword, page, pageSize);
  const encodedKeyword = encodeURIComponent(trimmedKeyword);

  const domain = getBaseDomain();
  const url = `https://${domain}/api/mw-movie/anonymous/video/searchByWord?keyword=${encodedKeyword}&pageNum=${page}&pageSize=${pageSize}&type=false`;

  try {
    const data = await getJson(url, {
      'Referer': `https://${domain}/`,
      'sign': sign,
      't': String(t),
    });

    if (!data || data.code !== 200) {
      console.error(`[Adapter] ❌ Search API error: code=${data?.code}`);
      return [];
    }

    const list = data?.data?.result?.list || [];
    const result = list.map(item => ({
      vodId: String(item.vodId || ''),
      vodName: item.vodName?.trim() || '',
      vodPic: item.vodPic?.trim() || '',
      vodYear: extractYear(item.vodPubdate || item.vodYear),
      vodTotal: item.vodTotal || 0,
      vodSeries: (item.vodTotal || 0) > 0 || (item.vodSeries || 0) > 0 ? 1 : 0,
    }));

    await setCache(cacheKey, result, 600);
    return result;
  } catch (err) {
    console.error(`[Adapter] ❌ searchVideos failed: ${err.message}`);
    return [];
  }
}

// ==========================================
// Stream（缓存 3 分钟）
// ==========================================

/**
 * 获取流媒体播放地址
 * 
 * 缓存策略：
 * - TTL：**180 秒（3 分钟）**（保守，因为 URL 有时效）
 * - 原因：Stream URL 含 auth_key 或 sign，通常 1-4 小时内有效
 * - 3 分钟确保用户点击播放时 URL 仍然有效
 * 
 * @param {string|number} vodId
 * @param {string|number} nid
 * @returns {Promise<Array<{url: string, quality: string, resolution: number}>>}
 */
export async function fetchStream(vodId, nid) {
  const cacheKey = `stream:${vodId}:${nid}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[Adapter] ✅ Stream 缓存命中: ${vodId}:${nid}`);
    return cached;
  }

  console.log(`[Adapter] 🎬 fetchStream: vodId=${vodId}, nid=${nid}`);

  const domain = getBaseDomain();
  const { t, sign } = signStream(vodId, nid);
  const url = `https://${domain}/api/mw-movie/anonymous/v2/video/episode/url?clientType=1&id=${vodId}&nid=${nid}`;

  const data = await getJson(url, {
    'Referer': `https://${domain}/`,
    'deviceid': CONFIG.DEVICE_ID,
    'sign': sign,
    't': String(t),
  });

  if (!data || data.code !== 200) return [];

  const list = data?.data?.list || [];
  const result = list
    .filter(item => item.url)
    .map(item => ({
      url: item.url,
      quality: item.resolutionName || (item.resolution ? `${item.resolution}P` : 'HD'),
      resolution: item.resolution || 0,
    }))
    .sort((a, b) => b.resolution - a.resolution);

  if (result.length > 0) {
    // ===== TTL 180 秒（3 分钟）=====
    await setCache(cacheKey, result, 180);
  }

  return result;
}
