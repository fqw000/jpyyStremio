/**
 * IMDb → 站点 vodId 解析器
 * 
 * 核心特性：
 * - 多语言搜索：从 TMDB 获取所有别名，逐个尝试
 * - 多别名匹配：用所有候选标题与搜索结果对比，取最高分
 * - Redis 缓存：所有中间结果跨实例共享
 * 
 * @module imdb-resolver
 */
import { CONFIG } from './config.js';
import { fetchImdbMeta, fetchAlternativeTitles } from './tmdb.js';
import { searchVideos } from './adapter.js';
import { getCache, setCache } from './cache.js';

// ==========================================
// 缓存配置
// ==========================================

/** 缓存 TTL：7 天 */
const CACHE_TTL = 7 * 24 * 60 * 60;

/** 搜索别名的数量上限（避免过多请求） */
const MAX_SEARCH_TITLES = 5;

// ==========================================
// 主入口
// ==========================================

/**
 * 将 IMDb ID 解析为站点 vodId
 * 
 * @param {string} imdbId - IMDb ID
 * @param {string} type - 'movie' 或 'series'
 * @param {number} season - 季数
 * @returns {Promise<Object|null>}
 */
export async function resolveImdbToVod(imdbId, type, season = 1) {
  console.log(`[IMDb→Vod] 🔍 Resolving: ${imdbId}, type=${type}, season=${season}`);

  // ===== 1. Redis 缓存 =====
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

  // ===== 3. 收集所有候选标题 =====
  const candidateTitles = await collectCandidateTitles(meta, type);
  if (candidateTitles.length === 0) {
    console.error(`[IMDb→Vod] ❌ No candidate titles`);
    return null;
  }

  // ===== 4. 多标题搜索 =====
  const { results, searchedTitles } = await searchWithMultipleTitles(
    candidateTitles,
    type
  );

  if (results.length === 0) {
    console.error(`[IMDb→Vod] ❌ No search results`);
    return null;
  }

  console.log(`[IMDb→Vod] 📋 Total candidates: ${results.length}，搜索过: ${searchedTitles.length} 个标题`);

  // ===== 5. 匹配（用所有候选标题）=====
  let matched = null;

  // 剧集：先尝试按 season 匹配
  if (type === 'series' && meta.seasonCount > 0) {
    matched = findSeasonMatch(results, season, candidateTitles);
    if (matched) {
      console.log(`[IMDb→Vod] 🎯 Season ${season} match: "${matched.vodName}"`);
    }
  }

  // 兜底：普通匹配
  if (!matched) {
    matched = findBestMatch(results, candidateTitles, meta.year);
    if (matched) {
      console.log(`[IMDb→Vod] 🎯 Best match: "${matched.vodName}"`);
    }
  }

  if (!matched) {
    console.error(`[IMDb→Vod] ❌ No match for "${meta.title}"`);
    return null;
  }

  // ===== 6. 写入缓存 =====
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
// 候选标题收集
// ==========================================

/**
 * 收集所有候选标题
 * 
 * 优先级：
 * 1. 纯中文标题（最可能与站点匹配）
 * 2. 中文混合标题（如 "3体"）
 * 3. 原始标题（TMDB 返回的名字）
 * 4. 英文别名
 * 5. 其他语言别名
 * 
 * @param {Object} meta - TMDB/Cinemeta 元数据
 * @param {string} type - 'movie' 或 'series'
 * @returns {Promise<string[]>} 排序后的候选标题
 */
async function collectCandidateTitles(meta, type) {
  const candidates = new Set();

  // 原始标题
  if (meta.title) candidates.add(meta.title.trim());
  if (meta.originalTitle && meta.originalTitle !== meta.title) {
    candidates.add(meta.originalTitle.trim());
  }

  // TMDB 别名
  if (meta.tmdbId) {
    try {
      const altTitles = await fetchAlternativeTitles(meta.tmdbId, type);
      for (const alt of altTitles) {
        if (alt && alt.trim()) candidates.add(alt.trim());
      }
    } catch (err) {
      console.warn(`[Candidates] 获取别名失败: ${err.message}`);
    }
  }

  // ===== 排序：按优先级 =====
  const sorted = [...candidates].sort((a, b) => {
    return getTitlePriority(b) - getTitlePriority(a);
  });

  // ===== 限制数量 =====
  const limited = sorted.slice(0, MAX_SEARCH_TITLES);

  console.log(`[Candidates] 📋 ${limited.length} 个标题: ${limited.join(' | ')}`);

  return limited;
}

/**
 * 计算标题优先级
 * 
 * 优先级从高到低：
 * 3 = 纯中文（最可能与站点匹配）
 * 2 = 中文为主（含少量非中文字符）
 * 1 = 原始标题（不做降级）
 * 0 = 其他（英文、其他语言）
 * 
 * @param {string} title
 * @returns {number}
 */
function getTitlePriority(title) {
  if (!title) return -1;

  const chineseCount = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalLength = title.length;

  // 纯中文
  if (/^[\u4e00-\u9fa5]+$/.test(title)) return 3;

  // 中文占比 > 50%
  if (chineseCount / totalLength > 0.5) return 2;

  return 0;
}

// ==========================================
// 多标题搜索
// ==========================================

/**
 * 用多个候选标题搜索站点
 * 
 * 策略：
 * - 搜索所有候选标题（最多 MAX_SEARCH_TITLES 个）
 * - 合并去重
 * - 不提前终止（Redis 缓存让成本可控）
 * 
 * @param {string[]} candidateTitles - 候选标题数组
 * @param {string} type - 'movie' 或 'series'
 * @returns {Promise<{results: Array, searchedTitles: string[]}>}
 */
async function searchWithMultipleTitles(candidateTitles, type) {
  const allResults = [];
  const seenIds = new Set();
  const searchedTitles = [];

  for (const keyword of candidateTitles) {
    if (!keyword || keyword.length < 2) continue;

    try {
      const results = await searchVideos(keyword);
      searchedTitles.push(keyword);

      if (Array.isArray(results) && results.length > 0) {
        for (const r of results) {
          if (r.vodId && !seenIds.has(r.vodId)) {
            seenIds.add(r.vodId);
            allResults.push(r);
          }
        }

        console.log(`[MultiSearch]   "${keyword}" → ${results.length} 条`);
      } else {
        console.log(`[MultiSearch]   "${keyword}" → 0 条`);
      }
    } catch (err) {
      console.warn(`[MultiSearch]   "${keyword}" 搜索失败: ${err.message}`);
    }
  }

  return { results: allResults, searchedTitles };
}

// ==========================================
// 匹配逻辑
// ==========================================

/**
 * 查找指定 Season 对应的 vod
 * 
 * @param {Array} results - 搜索结果
 * @param {number} targetSeason - 目标季数
 * @param {string[]} candidateTitles - 候选标题数组
 * @returns {Object|null}
 */
function findSeasonMatch(results, targetSeason, candidateTitles) {
  console.log(`[SeasonMatch] 🎬 Finding season ${targetSeason}`);

  const candidates = [];

  for (const r of results) {
    const seasonNum = extractSeasonNumber(r.vodName);
    if (seasonNum !== null) {
      // 计算与所有候选标题的最高相似度
      const maxSim = Math.max(
        ...candidateTitles.map(t => similarity(t, r.vodName))
      );

      if (maxSim > 0.3) {
        candidates.push({ ...r, season: seasonNum, similarity: maxSim });
        console.log(`[SeasonMatch]   - "${r.vodName}" → season=${seasonNum}, sim=${maxSim.toFixed(2)}`);
      }
    }
  }

  if (candidates.length === 0) return null;

  const exact = candidates.find(c => c.season === targetSeason);
  if (exact) return exact;

  candidates.sort((a, b) => b.similarity - a.similarity);
  console.log(`[SeasonMatch] ⚠️ No exact season match, using best`);
  return candidates[0];
}

/**
 * 从标题中提取季数
 */
function extractSeasonNumber(title) {
  if (!title) return null;

  const cnMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  const cnMatch = title.match(/第([一二三四五六七八九十])季/);
  if (cnMatch) return cnMap[cnMatch[1]] || null;

  const numMatch = title.match(/第\s*(\d+)\s*季/);
  if (numMatch) return parseInt(numMatch[1], 10);

  const enMatch = title.match(/season\s*(\d+)/i);
  if (enMatch) return parseInt(enMatch[1], 10);

  const sMatch = title.match(/\bS(\d+)\b/);
  if (sMatch) {
    const num = parseInt(sMatch[1], 10);
    if (num < 100) return num;
  }

  return null;
}

/**
 * 普通匹配：基于所有候选标题和年份
 * 
 * 关键：对每个结果，计算它与所有候选标题的相似度，取最大值。
 * 这样即使主标题不匹配，只要某个别名匹配，也能成功。
 * 
 * @param {Array} results - 搜索结果
 * @param {string[]} candidateTitles - 候选标题数组
 * @param {number|null} targetYear - 目标年份
 * @returns {Object|null}
 */
function findBestMatch(results, candidateTitles, targetYear) {
  console.log(`[BestMatch] 🎯 Matching against ${candidateTitles.length} titles`);

  let best = null;
  let bestScore = 0;

  for (const r of results) {
    // ===== 关键：取与所有候选标题的最高相似度 =====
    let maxSim = 0;
    let matchedTitle = '';
    for (const t of candidateTitles) {
      const sim = similarity(t, r.vodName);
      if (sim > maxSim) {
        maxSim = sim;
        matchedTitle = t;
      }
    }

    // 年份加分
    let yearBonus = 0;
    if (targetYear && r.vodYear) {
      const diff = Math.abs(targetYear - r.vodYear);
      if (diff === 0) yearBonus = 0.3;
      else if (diff === 1) yearBonus = 0.15;
      else if (diff > 3) yearBonus = -0.3;
    }

    // 精确匹配加分
    let exactBonus = 0;
    for (const t of candidateTitles) {
      if (r.vodName === t) {
        exactBonus = 0.5;
        break;
      }
      if (r.vodName.includes(t) || t.includes(r.vodName)) {
        exactBonus = Math.max(exactBonus, 0.2);
      }
    }

    const score = maxSim + yearBonus + exactBonus;

    if (score > 0.3) {
      console.log(`[BestMatch]   - "${r.vodName}" (${r.vodYear || '?'}) matched="${matchedTitle}" sim=${maxSim.toFixed(2)}, score=${score.toFixed(2)}`);
    }

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
 * 计算字符串相似度
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
// 元数据缓存
// ==========================================

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
