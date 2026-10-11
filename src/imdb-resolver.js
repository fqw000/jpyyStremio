/**
 * IMDb → 站点 vodId 解析器
 * 
 * 关键设计：
 *   - inflight 并发去重：meta/stream 同时请求只解析一次
 *   - 从 meta.type 读取修正后的类型
 *   - seasonYear：剧集优先用目标季的播出年匹配
 * 
 * @module imdb-resolver
 */

import { CONFIG } from './config.js';
import { fetchImdbMeta, fetchAlternativeTitles } from './tmdb.js';
import { searchVideos } from './adapter.js';
import { getCache, setCache } from './cache.js';
import {
  scoreCandidate,
  parseCastString,
  THRESHOLDS,
} from './matcher.js';

// ==========================================
// 配置
// ==========================================

const CACHE_TTL = 7 * 24 * 60 * 60;
const MAX_SEARCH_TITLES = 6;

/** ★ 进行中的解析（并发去重） */
const inflight = new Map();

// ==========================================
// 主入口
// ==========================================

export async function resolveImdbToVod(imdbId, type, season = 1) {
  const cacheKey = `imdb2vod:${imdbId}:${type}:${season}`;

  // ===== 1. Redis 缓存 =====
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[IMDb→Vod] ✅ 缓存命中: vodId=${cached.vodId}`);
    return cached;
  }

  // ===== 2. 进行中去重 =====
  if (inflight.has(cacheKey)) {
    console.log(`[IMDb→Vod] ⏳ 等待进行中的解析: ${cacheKey}`);
    return inflight.get(cacheKey);
  }

  const promise = doResolve(imdbId, type, season, cacheKey)
    .finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, promise);
  return promise;
}

// ==========================================
// 实际解析逻辑
// ==========================================

async function doResolve(imdbId, type, season, cacheKey) {
  // ===== 1. 元数据 =====
  const meta = await getCachedMeta(imdbId, type);
  if (!meta || !meta.title) {
    console.error(`[IMDb→Vod] ❌ 无元数据`);
    return null;
  }

  // ★ 使用 meta.type（TMDB/Cinemeta fallback 后的真实类型）
  const effectiveType = meta.type || type;
  if (effectiveType !== type) {
    console.log(`[IMDb→Vod] 🔄 使用元数据修正类型: ${type} → ${effectiveType}`);
  }

  // ★ 从 meta.seasons 提取目标季的播出年
  const seasonYear = extractSeasonYear(meta, effectiveType === 'series' ? season : null);

  console.log(
    `[IMDb→Vod] 📝 "${meta.title}" (${meta.year || '?'}) ` +
    `type=${effectiveType} cast=${meta.cast?.length || 0}` +
    (seasonYear ? ` seasonYear=${seasonYear}` : '')
  );

  // ===== 2. 候选标题 =====
  const candidateTitles = await collectCandidateTitles(meta, effectiveType);
  if (candidateTitles.length === 0) {
    console.error(`[IMDb→Vod] ❌ 无候选标题`);
    return null;
  }

  // ===== 3. 多标题搜索 =====
  const { results } = await searchWithMultipleTitles(candidateTitles);
  if (results.length === 0) {
    console.error(`[IMDb→Vod] ❌ 无搜索结果`);
    return null;
  }
  console.log(`[IMDb→Vod] 📋 候选结果数: ${results.length}`);

  // ===== 4. 目标 =====
  const target = {
    titles: candidateTitles,
    year: meta.year,
    seasonYear,                                          // ★ 目标季年份
    cast: meta.cast || [],
    type: effectiveType,
    season: effectiveType === 'series' ? season : null,
  };

  // ===== 5. 严格模式 =====
  let winner = pickBest(target, results, {
    minScore: THRESHOLDS.MIN_FINAL_SCORE,
    minTitleSim: THRESHOLDS.MIN_TITLE_SIM,
    skipCastCheck: false,
  });

  // ===== 6. 宽松兜底 =====
  if (!winner) {
    console.log(`[IMDb→Vod] ⚠️ 严格模式无结果，启用宽松兜底...`);
    winner = pickBest(target, results, {
      minScore: 0.40,
      minTitleSim: 0.30,
      skipCastCheck: true,
    });
  }

  if (!winner) {
    console.error(`[IMDb→Vod] ❌ 两种模式均无匹配`);
    return null;
  }

  // ===== 7. 缓存 =====
  const result = {
    vodId: winner.item.vodId,
    title: winner.item.vodName,
    year: winner.item.vodYear,
    imdbId,
    tmdbId: meta.tmdbId || null,
    season,
    type: effectiveType,       // ★ 回报类型，方便 handler 判断
  };

  await setCache(cacheKey, result, CACHE_TTL);
  console.log(
    `[IMDb→Vod] ✅ vodId=${result.vodId} ` +
    `score=${winner.detail.score.toFixed(2)} ` +
    `(title=${winner.detail.titleSim.toFixed(2)}, ` +
    `cast=${winner.detail.castEvaluated ? winner.detail.castSim.toFixed(2) : 'n/a'}, ` +
    `year=${winner.detail.yearEvaluated ? winner.detail.yearSim.toFixed(2) : 'n/a'})`
  );

  return result;
}

// ==========================================
// 季年份提取
// ==========================================

/**
 * 从 meta.seasons 提取目标季的播出年
 * 
 * 用途：站内每季独立 vodId，同剧不同季的 vodYear 可能不同
 * 用目标季年份匹配能有效区分。
 * 
 * Cinemeta 无 seasons 数组 → 返回 null，只用整剧年份。
 */
function extractSeasonYear(meta, season) {
  if (!season || !Array.isArray(meta.seasons) || meta.seasons.length === 0) {
    return null;
  }
  const s = meta.seasons.find(x => x.seasonNumber === season);
  if (!s || !s.airDate) return null;
  const year = parseInt(String(s.airDate).split('-')[0], 10);
  return isNaN(year) ? null : year;
}

// ==========================================
// 打分选择
// ==========================================

function pickBest(target, results, opts = {}) {
  const minScore = opts.minScore ?? THRESHOLDS.MIN_FINAL_SCORE;
  const minTitleSim = opts.minTitleSim ?? THRESHOLDS.MIN_TITLE_SIM;
  const skipCastCheck = opts.skipCastCheck ?? false;

  let best = null;
  let bestDetail = null;

  for (const r of results) {
    const candidate = {
      title: r.vodName || '',
      year: r.vodYear ? parseInt(r.vodYear, 10) : null,
      cast: parseCastString(r.vodActor || r.actor || ''),
    };

    const detail = scoreCandidate(target, candidate, {
      minTitleSim,
      skipCastCheck,
    });

    if (detail.titleSim > 0.4) {
      console.log(
        `[Match]   "${candidate.title}" (${candidate.year || '?'}) ` +
        `title=${detail.titleSim.toFixed(2)} ` +
        `cast=${detail.castEvaluated ? detail.castSim.toFixed(2) : 'n/a'} ` +
        `year=${detail.yearEvaluated ? detail.yearSim.toFixed(2) : 'n/a'} ` +
        `→ ${detail.rejected ? `❌ ${detail.reason}` : `score=${detail.score.toFixed(2)}`}`
      );
    }

    if (detail.rejected) continue;
    if (detail.score < minScore) continue;

    if (!bestDetail || detail.score > bestDetail.score) {
      best = r;
      bestDetail = detail;
    }
  }

  if (!best) return null;
  return { item: best, detail: bestDetail };
}

// ==========================================
// 候选标题
// ==========================================

async function collectCandidateTitles(meta, type) {
  const candidates = new Set();

  if (meta.title) candidates.add(meta.title.trim());
  if (meta.originalTitle && meta.originalTitle !== meta.title) {
    candidates.add(meta.originalTitle.trim());
  }

  if (meta.tmdbId) {
    try {
      const altTitles = await fetchAlternativeTitles(meta.tmdbId, type);
      for (const alt of altTitles) {
        if (alt && alt.trim()) candidates.add(alt.trim());
      }
    } catch (err) {
      console.warn(`[Candidates] 别名获取失败: ${err.message}`);
    }
  }

  const sorted = [...candidates].sort(
    (a, b) => getTitlePriority(b) - getTitlePriority(a)
  );

  const limited = sorted.slice(0, MAX_SEARCH_TITLES);
  console.log(`[Candidates] 📋 ${limited.length} 个: ${limited.join(' | ')}`);
  return limited;
}

/**
 * 标题优先级：纯中文 > 中文为主 > 其他
 * 不构造"第X季"变体（避免稀释搜索）
 */
function getTitlePriority(title) {
  if (!title) return -1;
  const cnCount = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
  const total = title.length;
  if (/^[\u4e00-\u9fa5]+$/.test(title)) return 3;
  if (cnCount / total > 0.5) return 2;
  return 0;
}

// ==========================================
// 多标题搜索（并行）
// ==========================================

async function searchWithMultipleTitles(candidateTitles) {
  const allResults = [];
  const seenIds = new Set();
  const searchedTitles = [];

  const searchTasks = candidateTitles
    .filter(k => k && k.length >= 2)
    .map(async keyword => {
      try {
        const results = await searchVideos(keyword);
        return { keyword, results: Array.isArray(results) ? results : [] };
      } catch (err) {
        console.warn(`[MultiSearch] "${keyword}" 失败: ${err.message}`);
        return { keyword, results: [] };
      }
    });

  const settled = await Promise.all(searchTasks);

  for (const { keyword, results } of settled) {
    searchedTitles.push(keyword);
    console.log(`[MultiSearch]   "${keyword}" → ${results.length} 条`);
    for (const r of results) {
      if (r.vodId && !seenIds.has(r.vodId)) {
        seenIds.add(r.vodId);
        allResults.push(r);
      }
    }
  }

  return { results: allResults, searchedTitles };
}

// ==========================================
// 元数据缓存
// ==========================================

async function getCachedMeta(imdbId, type) {
  const cacheKey = `meta:${imdbId}:${type}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[MetaCache] ✅ HIT: ${cacheKey}`);
    return cached;
  }

  console.log(`[MetaCache] ❌ MISS: ${cacheKey}`);
  const meta = await fetchImdbMeta(imdbId, type);
  if (meta) await setCache(cacheKey, meta, CACHE_TTL);
  return meta;
}

// ==========================================
// 调试
// ==========================================

export function clearImdbCache() {
  console.log('[IMDb→Vod] ⚠️ 请通过 Upstash 控制台清空 Redis 缓存');
}

export function getCacheStats() {
  return { message: '缓存已迁移到 Redis，请查看 Upstash 控制台' };
}