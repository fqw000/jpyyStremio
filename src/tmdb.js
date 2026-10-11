/**
 * 外部元数据 API（TMDB + Cinemeta）
 * 
 * 用途：根据 IMDb ID 获取中文标题、年份、季数等信息
 * 主：TMDB（需要 API Key）
 * 备：Cinemeta（无需 Key）
 * 
 * @module tmdb
 */
import { CONFIG } from './config.js';

// ==========================================
// TMDB API
// ==========================================

/**
 * 通过 IMDb ID 从 TMDB 查询元数据
 * 
 * @param {string} imdbId - IMDb ID（如 tt0109830）
 * @param {string} type - 'movie' 或 'series'
 * @returns {Promise<Object|null>} 元数据对象
 */
export async function fetchFromTMDB(imdbId, type) {
  console.log(`[TMDB] 🔍 findByImdbId: ${imdbId}, type=${type}`);

  if (!CONFIG.TMDB_API_KEY) {
    console.warn('[TMDB] ⚠️ No API key configured');
    return null;
  }

  try {
    // Step 1: 通过 IMDb ID 查找 TMDB 数据
    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${CONFIG.TMDB_API_KEY}&external_source=imdb_id&language=zh-CN`;
    console.log(`[TMDB] 🌐 Find URL: ${findUrl.slice(0, 80)}...`);

    const findResp = await fetch(findUrl);
    if (!findResp.ok) {
      console.error(`[TMDB] ❌ Find failed: HTTP ${findResp.status}`);
      return null;
    }

    const findData = await findResp.json();

    let result = type === 'movie'
      ? findData.movie_results?.[0]
      : findData.tv_results?.[0];

    // ★ type fallback：用户传的 type 与 TMDB 实际类型不符时自动纠正
    let effectiveType = type;
    if (!result) {
      const fallbackResult = type === 'movie'
        ? findData.tv_results?.[0]
        : findData.movie_results?.[0];
      if (fallbackResult) {
        result = fallbackResult;
        effectiveType = type === 'movie' ? 'series' : 'movie';
        console.log(`[TMDB] 🔄 Type fallback: ${type} → ${effectiveType}`);
      }
    }

    if (!result) {
      console.log(`[TMDB] ⚠️ Not found in TMDB: ${imdbId}`);
      return null;
    }

    const tmdbId = result.id;
    const mediaType = effectiveType === 'movie' ? 'movie' : 'tv';

    console.log(`[TMDB] ✅ Found: tmdbId=${tmdbId}, title="${result.title || result.name}"`);

    // Step 2: 获取详细信息（季数 + 演员）
    const detailUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${CONFIG.TMDB_API_KEY}&language=zh-CN&append_to_response=credits`;
    const detailResp = await fetch(detailUrl);
    const detailData = detailResp.ok ? await detailResp.json() : null;

    // 提取主要演员（前 15 位，用于匹配打分）
    const cast = (detailData?.credits?.cast || [])
      .slice(0, 15)
      .map(c => c.name)
      .filter(Boolean);

    // 构建返回数据
    const meta = {
      imdbId: imdbId,
      tmdbId: tmdbId,
      type: effectiveType,               // ★ 修正后的类型
      title: result.title || result.name || '',
      originalTitle: result.original_title || result.original_name || '',
      year: extractYear(result.release_date || result.first_air_date),
      overview: result.overview || '',
      poster: result.poster_path
        ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
        : '',
      background: result.backdrop_path
        ? `https://image.tmdb.org/t/p/original${result.backdrop_path}`
        : '',
      rating: result.vote_average || 0,
      cast: (detailData?.credits?.cast || [])     // ★ 演员列表
        .slice(0, 15).map(c => c.name).filter(Boolean),
      seasonCount: detailData?.number_of_seasons || 0,
      episodeCount: detailData?.number_of_episodes || 0,
      seasons: detailData?.seasons?.map(s => ({
        seasonNumber: s.season_number,
        episodeCount: s.episode_count,
        name: s.name,
        airDate: s.air_date,           // ★ 已存在，用于提取 seasonYear
      })) || [],
    };

    console.log(`[TMDB] 📊 Meta: title="${meta.title}", year=${meta.year}, seasons=${meta.seasonCount}`);
    return meta;
  } catch (err) {
    console.error(`[TMDB] ❌ Error: ${err.message}`);
    return null;
  }
}

// ==========================================
// Cinemeta API（备用）
// ==========================================

/**
 * 通过 IMDb ID 从 Cinemeta 查询元数据
 * 
 * @param {string} imdbId - IMDb ID
 * @param {string} type - 'movie' 或 'series'
 * @returns {Promise<Object|null>}
 */
export async function fetchFromCinemeta(imdbId, type) {
  console.log(`[Cinemeta] 🔍 findByImdbId: ${imdbId}, type=${type}`);

  const hosts = [
    'https://v3-cinemeta.strem.io',
    'https://cinemeta-live.strem.fun',
  ];

  for (const host of hosts) {
    try {
      // ★ 先按原 type 试，失败则 fallback
      let effectiveType = type;
      let url = `${host}/${type}/${imdbId}.json`;
      console.log(`[Cinemeta] 🌐 Trying: ${url}`);

      let resp = await fetch(url);
      if (!resp.ok) {
        const fallbackType = type === 'movie' ? 'series' : 'movie';
        const fallbackUrl = `${host}/${fallbackType}/${imdbId}.json`;
        console.log(`[Cinemeta] 🔄 Fallback: ${fallbackUrl}`);
        const fallbackResp = await fetch(fallbackUrl);
        if (fallbackResp.ok) {
          resp = fallbackResp;
          effectiveType = fallbackType;
          url = fallbackUrl;
        } else {
          console.log(`[Cinemeta] ⚠️ HTTP ${resp.status} from ${host}`);
          continue;
        }
      }

      const data = await resp.json();
      const meta = data?.meta;
      if (!meta) {
        console.log(`[Cinemeta] ⚠️ No meta from ${host}`);
        continue;
      }

      // 优先使用中文别名
      let title = meta.name || '';
      if (Array.isArray(meta.aliases)) {
        const cnAlias = meta.aliases.find(a =>
          typeof a === 'string' && /[\u4e00-\u9fa5]/.test(a)
        );
        if (cnAlias) {
          console.log(`[Cinemeta] 🇨🇳 Using Chinese alias: "${cnAlias}"`);
          title = cnAlias;
        }
      }

      const result = {
        imdbId: imdbId,
        type: effectiveType,             // ★ 修正后的类型
        title: title,
        originalTitle: meta.name || '',
        year: meta.year ? parseInt(meta.year, 10) : null,
        overview: meta.description || '',
        poster: meta.poster || '',
        background: meta.background || meta.poster || '',
        rating: meta.imdbRating || 0,
        cast: Array.isArray(meta.cast)          // ★ 演员列表
          ? meta.cast.slice(0, 15)
              .map(c => typeof c === 'string' ? c : c?.name)
              .filter(Boolean)
          : [],
        videos: meta.videos || [],
        seasonCount: meta.seasonCount || 0,
      };

      console.log(`[Cinemeta] ✅ Found: "${result.title}", year=${result.year}`);
      return result;
    } catch (err) {
      console.error(`[Cinemeta] ❌ Error from ${host}: ${err.message}`);
    }
  }

  console.error(`[Cinemeta] ❌ All hosts failed for ${imdbId}`);
  return null;
}

// ==========================================
// 统一入口
// ==========================================

/**
 * 获取 IMDb 元数据（TMDB 优先，Cinemeta 备用）
 * 
 * @param {string} imdbId - IMDb ID
 * @param {string} type - 'movie' 或 'series'
 * @returns {Promise<Object|null>}
 */
export async function fetchImdbMeta(imdbId, type) {
  console.log(`[Meta] 🌍 Fetching IMDb meta: ${imdbId} (${type})`);

  // 优先 TMDB
  const tmdbMeta = await fetchFromTMDB(imdbId, type);
  if (tmdbMeta && tmdbMeta.title) {
    return tmdbMeta;
  }

  // 备用 Cinemeta
  console.log(`[Meta] ⚠️ TMDB failed, trying Cinemeta...`);
  const cinemetaMeta = await fetchFromCinemeta(imdbId, type);
  if (cinemetaMeta && cinemetaMeta.title) {
    return cinemetaMeta;
  }

  console.error(`[Meta] ❌ All meta sources failed for ${imdbId}`);
  return null;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 从日期字符串提取年份
 */
function extractYear(dateStr) {
  if (!dateStr) return null;
  const year = parseInt(String(dateStr).split('-')[0], 10);
  return isNaN(year) ? null : year;
}

/**
 * 通过剧名在 TMDB 搜索剧集
 * 
 * @param {string} title - 剧名
 * @param {number|null} year - 年份
 * @returns {Promise<number|null>} tmdbId 或 null
 */
export async function searchTmdbByTitle(title, year = null) {
  if (!title || !CONFIG.TMDB_API_KEY) return null;

  console.log(`[TMDB] 🔍 Searching by title: "${title}" (${year || 'no year'})`);

  try {
    const encoded = encodeURIComponent(title);
    const url = `https://api.themoviedb.org/3/search/tv?query=${encoded}&api_key=${CONFIG.TMDB_API_KEY}&language=zh-CN${year ? `&first_air_date_year=${year}` : ''}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[TMDB] ❌ Search HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const results = data.results || [];

    if (results.length === 0) {
      console.log(`[TMDB] ⚠️ No results for "${title}"`);
      return null;
    }

    // 优先精确匹配年份
    let matched = null;
    if (year) {
      matched = results.find(r => {
        const y = r.first_air_date ? parseInt(r.first_air_date.split('-')[0], 10) : null;
        return y === year;
      });
    }

    // 其次用第一个结果
    if (!matched) matched = results[0];

    const tmdbId = matched.id;
    console.log(`[TMDB] ✅ Matched: tmdbId=${tmdbId}, name="${matched.name}", year=${matched.first_air_date}`);

    return tmdbId;
  } catch (err) {
    console.error(`[TMDB] ❌ Search error: ${err.message}`);
    return null;
  }
}

/**
 * 获取一季所有剧集的缩略图
 * 
 * @param {number} tmdbId - TMDB 剧集 ID
 * @param {number} season - 季数
 * @returns {Promise<Object>} { [episodeNumber]: thumbnailUrl }
 */
export async function fetchSeasonThumbnails(tmdbId, season) {
  if (!tmdbId || !CONFIG.TMDB_API_KEY) return {};

  console.log(`[TMDB] 🖼️ Fetching season ${season} thumbnails: tmdbId=${tmdbId}`);

  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${CONFIG.TMDB_API_KEY}&language=zh-CN`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[TMDB] ❌ Season HTTP ${resp.status}`);
      return {};
    }

    const data = await resp.json();
    const map = {};

    for (const ep of (data.episodes || [])) {
      if (ep.still_path) {
        // w300：适合缩略图的分辨率
        map[ep.episode_number] = `https://image.tmdb.org/t/p/w300${ep.still_path}`;
      }
    }

    console.log(`[TMDB] ✅ Found ${Object.keys(map).length}/${data.episodes?.length || 0} thumbnails`);
    return map;
  } catch (err) {
    console.error(`[TMDB] ❌ Season error: ${err.message}`);
    return {};
  }
}

// ==========================================
// 获取所有候选标题（含别名）
// ==========================================

/**
 * 从 TMDB 获取所有别名标题
 * 
 * 用于解决「英文原名匹配不到中文资源」的问题。
 * 
 * API:
 *   - 电影: GET /3/movie/{id}/alternative_titles
 *   - 剧集: GET /3/tv/{id}/alternative_titles
 * 
 * @param {number} tmdbId - TMDB ID
 * @param {string} type - 'movie' 或 'series'
 * @returns {Promise<string[]>} 别名标题数组（已去重）
 */
export async function fetchAlternativeTitles(tmdbId, type) {
  if (!tmdbId || !CONFIG.TMDB_API_KEY) return [];

  console.log(`[TMDB Alt] 🔍 Fetching alternative titles: tmdbId=${tmdbId}, type=${type}`);

  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/alternative_titles?api_key=${CONFIG.TMDB_API_KEY}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[TMDB Alt] HTTP ${resp.status}`);
      return [];
    }

    const data = await resp.json();

    // 电影和剧集的返回结构不同
    const titles = data.titles || data.results || [];
    if (!Array.isArray(titles)) return [];

    // 提取所有 title，去重
    const set = new Set();
    for (const item of titles) {
      const t = (item.title || '').trim();
      if (t) set.add(t);
    }

    const result = [...set];
    console.log(`[TMDB Alt] ✅ Found ${result.length} alternative titles`);
    return result;
  } catch (err) {
    console.warn(`[TMDB Alt] ❌ Error: ${err.message}`);
    return [];
  }
}
