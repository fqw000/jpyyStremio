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
    const result = type === 'movie'
      ? findData.movie_results?.[0]
      : findData.tv_results?.[0];

    if (!result) {
      console.log(`[TMDB] ⚠️ Not found in TMDB: ${imdbId}`);
      return null;
    }

    const tmdbId = result.id;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    console.log(`[TMDB] ✅ Found: tmdbId=${tmdbId}, title="${result.title || result.name}"`);

    // Step 2: 获取详细信息（包含季数）
    const detailUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${CONFIG.TMDB_API_KEY}&language=zh-CN`;
    const detailResp = await fetch(detailUrl);
    const detailData = detailResp.ok ? await detailResp.json() : null;

    // 构建返回数据
    const meta = {
      imdbId: imdbId,
      tmdbId: tmdbId,
      type: type,
      // 中文标题优先
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
      // 剧集特有
      seasonCount: detailData?.number_of_seasons || 0,
      episodeCount: detailData?.number_of_episodes || 0,
      seasons: detailData?.seasons?.map(s => ({
        seasonNumber: s.season_number,
        episodeCount: s.episode_count,
        name: s.name,
        airDate: s.air_date,
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
      const url = `${host}/${type}/${imdbId}.json`;
      console.log(`[Cinemeta] 🌐 Trying: ${url}`);

      const resp = await fetch(url);
      if (!resp.ok) {
        console.log(`[Cinemeta] ⚠️ HTTP ${resp.status} from ${host}`);
        continue;
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
        type: type,
        title: title,
        originalTitle: meta.name || '',
        year: meta.year ? parseInt(meta.year, 10) : null,
        overview: meta.description || '',
        poster: meta.poster || '',
        background: meta.background || meta.poster || '',
        rating: meta.imdbRating || 0,
        // Cinemeta 的 videos 包含季集信息
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
