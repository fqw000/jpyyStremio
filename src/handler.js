/**
 * Worker 入口
 * 
 * 支持 ID 格式：
 * - jp146870          (站内格式，影片级)
 * - jp146664:1:5      (站内格式，集级)
 * - tt0109830         (IMDb 格式，影片级)
 * - tt0455275:4:5     (IMDb 格式，集级)
 * 
 * 关键规范：
 * - Catalog 中剧集的 id 是影片级（jp146932），不带 :season:episode
 * - Meta 的 id 与请求一致
 * - Meta.videos[].id 是集级（jp146932:1:1）
 * - Stream 的 id 是集级（jp146932:1:1）
 */
import { generateManifest } from './manifest.js';
import { CONFIG } from './config.js';
import { fetchCatalog, fetchDetail, fetchEpisodes, searchVideos, fetchStream } from './adapter.js';
import { resolveImdbToVod } from './imdb-resolver.js';
import { searchTmdbByTitle, fetchSeasonThumbnails } from './tmdb.js';
import { probeAndUpdate, getDomainStatus, clearDomainCache } from './domain-resolver.js';
import { getCache, setCache } from './cache.js';

// ==========================================
// TMDB 缓存（改为 Redis）
// ==========================================

/**
 * 通过剧名查找 TMDB ID（带 Redis 缓存）
 * 
 * 缓存 Key: tmdbid:jp:{vodId}
 * TTL: 7 天（TMDB ID 稳定）
 */
async function getTmdbIdByJp(vodId, title, year) {
  const cacheKey = `tmdbid:jp:${vodId}`;
  const cached = await getCache(cacheKey);

  if (cached !== null && cached !== undefined) {
    console.log(`[TMDB Cache] ✅ HIT vodId=${vodId} → tmdbId=${cached}`);
    return cached;  // 可能是数字，也可能是 null（表示 TMDB 没找到）
  }

  console.log(`[TMDB Cache] ❌ MISS vodId=${vodId}, searching...`);
  const tmdbId = await searchTmdbByTitle(title, year);

  // ===== 写入 Redis（7 天）=====
  // 即使 tmdbId 为 null 也缓存，避免重复搜索不存在的剧
  await setCache(cacheKey, tmdbId, 604800);

  return tmdbId;
}

/**
 * 获取 TMDB 缩略图（带 Redis 缓存）
 * 
 * 缓存 Key: tmdbthumbs:{tmdbId}:{season}
 * TTL: 7 天（缩略图 URL 稳定）
 */
async function getTmdbThumbs(tmdbId, season) {
  const cacheKey = `tmdbthumbs:${tmdbId}:${season}`;
  const cached = await getCache(cacheKey);

  if (cached !== null && cached !== undefined) {
    console.log(`[TMDB Thumbs] ✅ HIT ${tmdbId}:${season}`);
    return cached;
  }

  console.log(`[TMDB Thumbs] ❌ MISS ${tmdbId}:${season}, fetching...`);
  const map = await fetchSeasonThumbnails(tmdbId, season);

  // ===== 写入 Redis（7 天）=====
  await setCache(cacheKey, map, 604800);

  return map;
}

// ==========================================
// 通用请求处理
// ==========================================

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // ===== 解析用户配置（查询参数 cfg）=====
  const cfgB64 = url.searchParams.get('cfg');
  if (cfgB64) {
    try {
      // base64url 解码
      const base64 = cfgB64.replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(base64);
      // UTF-8 解码
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const json = new TextDecoder('utf-8').decode(bytes);
      const userConfig = JSON.parse(json);

      // 注入全局
      globalThis.__USER_CONFIG = userConfig;

      console.log(`[Config] 📦 用户配置: ${JSON.stringify(userConfig)}`);
    } catch (err) {
      console.warn(`[Config] ⚠️ 配置解析失败: ${err.message}`);
      globalThis.__USER_CONFIG = {};
    }
  } else {
    // 无配置参数时清空
    globalThis.__USER_CONFIG = {};
  }

  console.log(`[Worker] 📨 ${request.method} ${pathname}${url.search}`);

  // ===== 1. Manifest =====
  if (pathname === '/manifest.json') {
    probeAndUpdate().catch(err => {
      console.warn(`[Domain] 后台探测失败: ${err.message}`);
    });

    // ===== 动态生成 Manifest =====
    const enabledCategories = CONFIG.ENABLED_CATEGORIES || ['movie', 'series', 'variety', 'anime', 'short'];
    const enableStream = CONFIG.ENABLE_STREAM !== false;  // 默认启用 stream  
    const manifest = generateManifest(enabledCategories, { enableStream });

    console.log(`[Manifest] 📋 启用类型: ${enabledCategories.join(', ')}`);
    console.log(`[Manifest] 📋 目录数: ${manifest.catalogs.length}`);
    console.log(`[Manifest] 📋 Stream 功能: ${enableStream ? '启用' : '禁用'}`);
    return jsonResponse(manifest, 0);
  }

  // ===== 2. Catalog（浏览 / 搜索 / 分页） =====
  const catalogMatch = pathname.match(
    /^\/catalog\/(movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/
  );
  if (catalogMatch) {
    const catalogType = catalogMatch[1];
    const catalogId = catalogMatch[2];
    const extraPath = catalogMatch[3] || '';

    const extras = {};
    if (extraPath) {
      for (const part of extraPath.split('&')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) continue;
        const key = part.slice(0, eqIdx);
        const value = decodeURIComponent(part.slice(eqIdx + 1));
        extras[key] = value;
      }
    }

    console.log(`[Worker] 📦 Catalog extras: ${JSON.stringify(extras)}`);

    if (extras.search) {
      return await handleSearchInCatalog(catalogType, catalogId, extras.search, extras.skip);
    }

    const skip = extras.skip ? parseInt(extras.skip, 10) : 0;
    return await handleCatalog(catalogId, skip);
  }

  // ===== 3. Meta =====
  const metaMatch = pathname.match(/^\/meta\/(movie|series)\/([^/]+)\.json$/);
  if (metaMatch) {
    return await handleMeta(metaMatch[1], metaMatch[2]);
  }

  // ===== 4. Stream =====
  const streamMatch = pathname.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (streamMatch) {
    return await handleStream(streamMatch[1], streamMatch[2]);
  }

  // ===== 5. Search（独立，兼容旧版） =====
  const searchMatch = pathname.match(/^\/search\/([^/]+)\.json$/);
  if (searchMatch) {
    return await handleSearch(decodeURIComponent(searchMatch[1]));
  }

  // ===== 6. Debug 域名 =====
  if (pathname === '/debug/domains') {
    const action = url.searchParams.get('action');

    if (action === 'clear') {
      clearDomainCache();
      return jsonResponse({ message: 'Domain cache cleared', ...getDomainStatus() });
    }

    // ===== 新增：测试 API =====
    if (action === 'api') {
      const { testDomainApi } = await import('./domain-resolver.js');
      const result = await testDomainApi();
      return jsonResponse(result);
    }

    return jsonResponse(getDomainStatus());
  }

  // ===== 7. Debug 缓存 =====
  if (pathname === '/debug/cache') {
    const { getCacheStats } = await import('./cache.js');
    return jsonResponse(getCacheStats());
  }

  console.log(`[Worker] ❌ 404: ${pathname}`);
  return new Response('Not Found', { status: 404 });
}

// ==========================================
// ID 解析工具
// ==========================================

function parseId(rawEncodedId) {
  const rawId = decodeURIComponent(rawEncodedId);

  let baseId = rawId;
  let season = 1;
  let episode = 1;
  let hasSeasonEpisode = false;

  if (rawId.includes(':')) {
    const parts = rawId.split(':');
    baseId = parts[0];
    season = parseInt(parts[1], 10) || 1;
    episode = parseInt(parts[2], 10) || 1;
    hasSeasonEpisode = true;
  }

  if (baseId.startsWith('tt')) {
    return { source: 'imdb', imdbId: baseId, season, episode, hasSeasonEpisode, rawId };
  }

  if (baseId.startsWith('jp')) {
    return { source: 'jp', vodId: baseId.replace(/^jp/, ''), season, episode, hasSeasonEpisode, rawId };
  }

  return { source: 'jp', vodId: baseId.replace(/^jp/, ''), season, episode, hasSeasonEpisode, rawId };
}

// ==========================================
// Catalog 搜索处理
// ==========================================

async function handleSearchInCatalog(type, catalogId, query, skipStr) {
  const skip = skipStr ? parseInt(skipStr, 10) : 0;
  console.log(`[Catalog Search] 🔍 type=${type}, catalogId=${catalogId}, query="${query}", skip=${skip}`);

  const pageSize = 24;
  const page = Math.floor(skip / pageSize) + 1;

  const items = await searchVideos(query, page, pageSize);

  const metas = items.map(item => {
    const isSeries = item.vodTotal > 0 || item.vodSeries > 0;
    const id = isSeries ? `jp${item.vodId}:1:1` : `jp${item.vodId}`;
    return {
      id,
      type: isSeries ? 'series' : 'movie',
      name: item.vodName,
      poster: item.vodPic || '',
      year: item.vodYear ? String(item.vodYear) : '',
    };
  });

  const filtered = metas.filter(m => m.type === type);

  console.log(`[Catalog Search] ✅ ${filtered.length} results (type=${type}, skip=${skip})`);
  return jsonResponse({ metas: filtered }, 300);
}

// ==========================================
// Catalog 浏览处理
// ==========================================

async function handleCatalog(catalogId, skip = 0) {
  console.log(`[Catalog] 📂 catalogId=${catalogId}, skip=${skip}`);

  const items = await fetchCatalog(catalogId, skip);
  const isMovieCatalog = catalogId === 'jinpai-movie';

  const metas = items.map(item => {
    const isSeries = !isMovieCatalog || item.vodTotal > 0;
    const id = isSeries ? `jp${item.vodId}:1:1` : `jp${item.vodId}`;
    return {
      id,
      type: isSeries ? 'series' : 'movie',
      name: item.vodName,
      poster: item.vodPic || '',
      year: item.vodYear ? String(item.vodYear) : '',
      cast: item.vodActor ? item.vodActor.split(/[,，]/).map(a => a.trim()).filter(Boolean) : [],
      genres: item.vodClass ? item.vodClass.split(/[,，]/).map(g => g.trim()).filter(Boolean) : [],
      releaseInfo: item.vodPubdate ? (isSeries ? `${item.vodPubdate}-` : String(item.vodPubdate)) : '',
    };
  });

  console.log(`[Catalog] ✅ ${catalogId}: ${metas.length} metas (skip=${skip})`);
  return jsonResponse({ metas }, 300);
}

// ==========================================
// Meta 处理
// ==========================================


async function handleMeta(routeType, rawEncodedId) {
  const parsed = parseId(rawEncodedId);
  console.log(`[Meta] 🔍 source=${parsed.source}, rawId=${parsed.rawId}`);

  // ===== IMDb → vodId =====
  let resolvedMeta = null;
  if (parsed.source === 'imdb') {
    resolvedMeta = await resolveImdbToVod(parsed.imdbId, routeType, parsed.season);
    if (!resolvedMeta) {
      return jsonResponse({ meta: null });
    }
    parsed.vodId = resolvedMeta.vodId;
  }

  // ===== 获取详情 =====
  const detail = await fetchDetail(parsed.vodId);
  if (!detail) {
    return jsonResponse({ meta: null });
  }

  const isSeries = detail.vodTotal > 0 || routeType === 'series' || parsed.hasSeasonEpisode;
  const metaId = parsed.source === 'imdb' ? parsed.imdbId : `jp${parsed.vodId}`;

  // ===== 构建 Meta =====
  const meta = {
    id: metaId,
    type: isSeries ? 'series' : 'movie',
    name: detail.vodName,
    description: detail.vodContent || '暂无描述',
    poster: detail.vodPic || '',
    background: detail.vodPicSlide || detail.vodPic || '',
    year: detail.vodYear ? String(detail.vodYear) : '',
    director: detail.vodDirector ? detail.vodDirector.split(/[,，]/).map(d => d.trim()).filter(Boolean) : [],
    cast: detail.vodActor
      ? detail.vodActor.split(/[,，]/).map(a => a.trim()).filter(Boolean).slice(0, 10)
      : [],
    genres: detail.vodClass
      ? detail.vodClass.split(/[,，]/).map(g => g.trim()).filter(Boolean)
      : [],

    releaseInfo: detail.vodYear ? String(detail.vodYear) : '',
  };

  if (detail.vodScore) {
    meta.imdbRating = String(detail.vodScore);
  }

  // ===== 电影 =====
  if (!isSeries) {
    meta.videos = [{
      id: metaId,
      title: detail.vodName,
      thumbnail: detail.vodPic || '',
    }];
    console.log(`[Meta] ✅ Built: "${meta.name}" (movie)`);
    return jsonResponse({ meta }, 600);
  }

  // ===== 剧集 =====
  if (isSeries && detail.episodes.length > 0) {
    const numericEpisodes = detail.episodes
      .map(ep => ({ ...ep, num: parseInt(ep.name, 10), isNumeric: /^\d+$/.test(ep.name) }))
      .filter(ep => ep.isNumeric && ep.num > 0)
      .sort((a, b) => a.num - b.num);

    if (numericEpisodes.length > 0) {
      const videoIdPrefix = parsed.source === 'imdb'
        ? `${parsed.imdbId}:${parsed.season || 1}`
        : `jp${parsed.vodId}:1`;
      const videoSeason = parsed.source === 'imdb' ? (parsed.season || 1) : 1;
      const fallbackThumbnail = detail.vodPic || '';

      // ===== 获取每集缩略图（Redis 缓存）=====
      let thumbnails = {};

      try {
        if (parsed.source === 'imdb' && resolvedMeta?.tmdbId) {
          thumbnails = await getTmdbThumbs(resolvedMeta.tmdbId, videoSeason);
        } else if (parsed.source === 'jp') {
          const tmdbId = await getTmdbIdByJp(parsed.vodId, detail.vodName, detail.vodYear);
          if (tmdbId) {
            thumbnails = await getTmdbThumbs(tmdbId, videoSeason);
          }
        }
      } catch (err) {
        console.warn(`[Meta] ⚠️ Thumbnail fetch failed: ${err.message}`);
      }

      meta.videos = numericEpisodes.map(ep => {
        const thumbnail = thumbnails[ep.num] || fallbackThumbnail;
        return {
          id: `${videoIdPrefix}:${ep.num}`,
          season: videoSeason,
          episode: ep.num,
          title: `第${ep.num}集`,
          thumbnail: thumbnail,
          released: new Date().toISOString(),
        };
      });

      const withThumb = meta.videos.filter(v => v.thumbnail !== fallbackThumbnail).length;
      console.log(`[Meta] 🖼️ ${withThumb}/${meta.videos.length} unique thumbnails`);
    }
  }

  console.log(`[Meta] ✅ Built: "${meta.name}" (${meta.type}), videos=${meta.videos?.length || 0}`);
  return jsonResponse({ meta }, 600);
}

// ==========================================
// Stream 处理（改用 fetchEpisodes）
// ==========================================

async function handleStream(routeType, rawEncodedId) {
  // ===== 防御：Stream 功能被禁用 =====
  if (CONFIG.ENABLE_STREAM === false) {
    console.log(`[Stream] ⚠️ Stream 功能已禁用（用户配置）`);
    return jsonResponse({ streams: [] });
  }

  const parsed = parseId(rawEncodedId);
  console.log(`[Stream] 🔍 source=${parsed.source}, rawId=${parsed.rawId}`);

  let vodId = parsed.vodId;
  let episode = parsed.episode;

  // ===== IMDb → vodId =====
  if (parsed.source === 'imdb') {
    console.log(`[Stream] 🌐 IMDb format: ${parsed.imdbId}, S${parsed.season}E${parsed.episode}`);

    const resolved = await resolveImdbToVod(parsed.imdbId, routeType, parsed.season);
    if (!resolved) {
      console.log(`[Stream] ❌ Cannot resolve ${parsed.imdbId}`);
      return jsonResponse({ streams: [] });
    }

    vodId = resolved.vodId;
    console.log(`[Stream] ✅ IMDb → vodId: ${vodId}`);
  }

  // ===== 获取剧集列表（独立缓存，比 fetchDetail 更轻）=====
  const episodes = await fetchEpisodes(vodId);
  if (!episodes || episodes.length === 0) {
    console.log(`[Stream] ❌ No episodes for ${vodId}`);
    return jsonResponse({ streams: [] });
  }

  // ===== 找 nid =====
  let nid = null;

  if (parsed.hasSeasonEpisode && episode > 0) {
    const targetEp = episodes.find(ep => parseInt(ep.name, 10) === episode);
    if (targetEp) {
      nid = targetEp.nid;
      console.log(`[Stream] 🎯 Matched ep ${episode}: nid=${nid}`);
    } else {
      console.log(`[Stream] ⚠️ Ep ${episode} not found, using first`);
      nid = episodes[0].nid;
    }
  } else {
    nid = episodes[0].nid;
    console.log(`[Stream] 🎯 Using first: nid=${nid}`);
  }

  if (!nid) {
    return jsonResponse({ streams: [] });
  }

  // ===== 获取播放地址（缓存 10 分钟）=====
  const streams = await fetchStream(vodId, nid);
  if (streams.length === 0) {
    console.log(`[Stream] ⚠️ No streams`);
    return jsonResponse({ streams: [] });
  }

  const stremioStreams = streams.map(s => {
    const isHls = s.url.includes('.m3u8');
    return {
      name: 'JPYY',
      title: `${s.quality}`,
      url: s.url,
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `jp-${vodId}`,
      },
      ...(isHls && { type: 'hls' }),
    };
  });

  console.log(`[Stream] ✅ Returning ${stremioStreams.length} streams`);
  return jsonResponse({ streams: stremioStreams }, 60);
}

// ==========================================
// Search 处理（兼容独立接口）
// ==========================================

async function handleSearch(query) {
  console.log(`[Search] 🔍 Query: "${query}"`);
  const items = await searchVideos(query);

  const results = items.map(item => {
    const isSeries = item.vodTotal > 0 || item.vodSeries > 0;
    const id = `jp${item.vodId}`;
    return {
      id,
      type: isSeries ? 'series' : 'movie',
      name: item.vodName,
      poster: item.vodPic || '',
      year: item.vodYear ? String(item.vodYear) : '',
    };
  });

  console.log(`[Search] ✅ Returning ${results.length} results`);
  return jsonResponse({ results }, 300);
}

// ==========================================
// 辅助函数
// ==========================================

function jsonResponse(data, cacheSeconds = 0) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };

  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`;
  } else {
    headers['Cache-Control'] = 'public';
  }

  return new Response(JSON.stringify(data, null, 2), { headers });
}

//  ==========================================
// Base64 URL 解码（兼容 Node.js 和浏览器）
//  ==========================================
function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }
  // Node.js
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// ==========================================
// Cloudflare Workers 入口
// ==========================================

export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx);
  },
};


