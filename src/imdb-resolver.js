/**
 * IMDb → 站点 vodId 解析器
 * 
 * 缓存改造：从内存 Map 改为 Redis
 * - imdb2vod:{imdbId}:{type}:{season} → 解析结果（TTL 7 天）
 * - meta:{imdbId}:{type} → TMDB/Cinemeta 元数据（TTL 7 天）
 * 
 * @module imdb-resolver
 */
import { CONFIG } from './config.js';
import { fetchImdbMeta } from './tmdb.js';
import { searchVideos } from './adapter.js';
import { getCache, setCache } from './cache.js';

// ==========================================
// 缓存配置
// ==========================================

/** 缓存 TTL：7 天 */
const CACHE_TTL = 7 * 24 * 60 * 60;

// ==========================================
// 主入口
// ==========================================

/**
 * 将 IMDb ID 解析为站点 vodId
 * 
 * @param {string} imdbId - IMDb ID（如 tt0109830）
 * @param {string} type - 'movie' 或 'series'
 * @param {number} season - 季数
 * @returns {Promise<Object|null>} { vodId, title, year, imdbId, season, tmdbId }
 */
export async function resolveImdbToVod(imdbId, type, season = 1) {
  console.log(`[IMDb→Vod] 🔍 Resolving: ${imdbId}, type=${type}, season=${season}`);

  // ===== 1. 检查 Redis 缓存 =====
  const cacheKey = `imdb2vod:${imdbId}:${type}:${season}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[IMDb→Vod] ✅ 缓存命中: ${imdbId} → vodId=${cached.vodId}`);
    return cached;
  }

  // ===== 2. 获取 IMDb 元数据 =====
  const meta = await getCachedMeta(imdbId, type);
  if (!meta || !meta.title) {
    console.error(`[IMDb→Vod] ❌ No meta for ${imdbId}`);
    return null;
  }

  console.log(`[IMDb→Vod] 📝 Meta: title="${meta.title}", year=${meta.year}`);

  // ===== 3. 搜索站点 =====
  const searchResults = await searchVideos(meta.title);
  if (searchResults.length === 0) {
    console.error(`[IMDb→Vod] ❌ No search results for "${meta.title}"`);
    return null;
  }

  console.log(`[IMDb→Vod] 📋 Search returned ${searchResults.length} candidates`);

  // ===== 4. 匹配 =====
  let matched = null;

  // 剧集：尝试按 season 匹配
  if (type === 'series' && meta.seasonCount > 0) {
    matched = findSeasonMatch(searchResults, season, meta.title);
    if (matched) {
      console.log(`[IMDb→Vod] 🎯 Season ${season} match: "${matched.vodName}" (vodId=${matched.vodId})`);
    }
  }

  // 兜底：普通匹配
  if (!matched) {
    matched = findBestMatch(searchResults, meta.title, meta.year);
    if (matched) {
      console.log(`[IMDb→Vod] 🎯 Best match: "${matched.vodName}" (vodId=${matched.vodId})`);
    }
  }

  if (!matched) {
    console.error(`[IMDb→Vod] ❌ No match for "${meta.title}"`);
    return null;
  }

  // ===== 5. 写入 Redis 缓存 =====
  const result = {
    vodId: matched.vodId,
    title: matched.vodName,
    year: matched.vodYear,
    imdbId: imdbId,
    tmdbId: meta.tmdbId || null,
    season: season,
  };
  await setCache(cacheKey, result, CACHE_TTL);

  console.log(`[IMDb→Vod] ✅ Resolved & cached: ${imdbId} → vodId=${result.vodId}`);
  return result;
}

// ==========================================
// 匹配逻辑
// ==========================================

/**
 * 查找指定 Season 对应的 vod
 */
function findSeasonMatch(results, targetSeason, baseTitle) {
  console.log(`[SeasonMatch] 🎬 Finding season ${targetSeason} in "${baseTitle}"`);

  const candidates = [];

  for (const r of results) {
    const seasonNum = extractSeasonNumber(r.vodName);
    if (seasonNum !== null) {
      const sim = similarity(baseTitle, r.vodName);
      if (sim > 0.3) {
        candidates.push({ ...r, season: seasonNum, similarity: sim });
        console.log(`[SeasonMatch]   - "${r.vodName}" → season=${seasonNum}, sim=${sim.toFixed(2)}`);
      }
    }
  }

  if (candidates.length === 0) return null;

  // 精确匹配目标 season
  const exact = candidates.find(c => c.season === targetSeason);
  if (exact) return exact;

  // 兜底：相似度最高的
  candidates.sort((a, b) => b.similarity - a.similarity);
  console.log(`[SeasonMatch] ⚠️ No exact season match, using best`);
  return candidates[0];
}

/**
 * 从标题中提取季数
 */
function extractSeasonNumber(title) {
  if (!title) return null;

  // 模式1：中文数字 "第X季"
  const cnMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  const cnMatch = title.match(/第([一二三四五六七八九十])季/);
  if (cnMatch) return cnMap[cnMatch[1]] || null;

  // 模式2：阿拉伯数字 "第X季"
  const numMatch = title.match(/第\s*(\d+)\s*季/);
  if (numMatch) return parseInt(numMatch[1], 10);

  // 模式3：英文 "Season X"
  const enMatch = title.match(/season\s*(\d+)/i);
  if (enMatch) return parseInt(enMatch[1], 10);

  // 模式4：缩写 "SX"
  const sMatch = title.match(/\bS(\d+)\b/);
  if (sMatch) {
    const num = parseInt(sMatch[1], 10);
    if (num < 100) return num;
  }

  return null;
}

/**
 * 普通匹配：基于标题相似度和年份
 */
function findBestMatch(results, targetTitle, targetYear) {
  console.log(`[BestMatch] 🎯 Matching "${targetTitle}" (${targetYear})`);

  let best = null;
  let bestScore = 0;

  for (const r of results) {
    const titleSim = similarity(targetTitle, r.vodName);

    let yearBonus = 0;
    if (targetYear && r.vodYear) {
      const diff = Math.abs(targetYear - r.vodYear);
      if (diff === 0) yearBonus = 0.3;
      else if (diff === 1) yearBonus = 0.15;
      else if (diff > 3) yearBonus = -0.3;
    }

    let exactBonus = 0;
    if (r.vodName === targetTitle) exactBonus = 0.5;
    else if (r.vodName.includes(targetTitle) || targetTitle.includes(r.vodName)) {
      exactBonus = 0.2;
    }

    const score = titleSim + yearBonus + exactBonus;

    console.log(`[BestMatch]   - "${r.vodName}" (${r.vodYear || '?'}) score=${score.toFixed(2)}`);

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  if (best && bestScore >= CONFIG.MATCH_THRESHOLD) {
    console.log(`[BestMatch] ✅ Winner: "${best.vodName}" (score=${bestScore.toFixed(2)})`);
    return best;
  }

  console.log(`[BestMatch] ❌ No match above threshold (${CONFIG.MATCH_THRESHOLD})`);
  return null;
}

/**
 * 计算字符串相似度（Levenshtein 距离归一化）
 */
function similarity(s1, s2) {
  if (!s1 || !s2) return 0;

  s1 = s1.toLowerCase().trim();
  s2 = s2.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  let [a, b] = [s1, s2];
  if (a.length < b.length) [a, b] = [b, a];

  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return 0;
  if (lenB === 0) return 0;

  let prev = new Array(lenB + 1);
  let curr = new Array(lenB + 1);
  for (let j = 0; j <= lenB; j++) prev[j] = j;

  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return 1 - prev[lenB] / Math.max(lenA, lenB);
}

// ==========================================
// 元数据缓存（Redis）
// ==========================================

/**
 * 获取 IMDb 元数据（带 Redis 缓存）
 * 
 * @param {string} imdbId - IMDb ID
 * @param {string} type - 'movie' 或 'series'
 * @returns {Promise<Object|null>}
 */
async function getCachedMeta(imdbId, type) {
  const cacheKey = `meta:${imdbId}:${type}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`[MetaCache] ✅ HIT: ${cacheKey}`);
    return cached;
  }

  console.log(`[MetaCache] ❌ MISS: ${cacheKey}, fetching...`);
  const meta = await fetchImdbMeta(imdbId, type);

  if (meta) {
    await setCache(cacheKey, meta, CACHE_TTL);
  }

  return meta;
}

// ==========================================
// 调试接口
// ==========================================

export function clearImdbCache() {
  console.log('[IMDb→Vod] ⚠️ clearImdbCache 已废弃（Redis 缓存需在 Upstash 控制台清空）');
}

export function getCacheStats() {
  return {
    message: '缓存已迁移到 Redis，请在 Upstash 控制台查看统计',
  };
}
