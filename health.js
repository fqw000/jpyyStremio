#!/usr/bin/env node

/**
 * 金牌影视 + 555 · Stremio Addon 完整测试脚本
 *
 * 覆盖维度：
 * - 功能测试：Manifest / Catalog / Meta / Stream / Search
 * - 双 ID 测试：jp 格式 + tt 格式 + 555 格式
 * - 源开关测试：jpyy / 555 / 都关闭
 * - 配置测试：类别筛选、Stream 开关、自定义域名
 * - 健康检查：域名状态、缓存状态、555 状态
 * - CDN 测试：x-vercel-cache 响应头
 * - 缓存效果：冷/热请求耗时对比
 *
 * 使用方式：
 *   node test.js                                    # 测本地
 *   BASE_URL=https://xxx node test.js               # 测线上
 *   TIMEOUT=60000 node test.js                      # 自定义超时
 *   SKIP_CACHE_TEST=1 node test.js                  # 跳过缓存测试
 *
 * @module test
 */

// ==========================================
// 配置
// ==========================================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000', 10);
const SKIP_CACHE_TEST = process.env.SKIP_CACHE_TEST === '1';

/** 真实浏览器 UA */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ==========================================
// 终端着色
// ==========================================

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// ==========================================
// 统计
// ==========================================

const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  results: [],
  warnings: [],
};

// ==========================================
// 日志工具
// ==========================================

function log(color, prefix, msg, ...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${C.gray}[${t}]${C.reset} ${color}${prefix}${C.reset} ${msg}`, ...args);
}

const info = (m, ...a) => log(C.blue, '[INFO]', m, ...a);
const pass = (m, ...a) => log(C.green, '[PASS]', m, ...a);
const fail = (m, ...a) => log(C.red, '[FAIL]', m, ...a);
const warn = (m, ...a) => log(C.yellow, '[WARN]', m, ...a);
const debug = (m, ...a) => log(C.gray, '[DEBUG]', m, ...a);
const skip = (m, ...a) => log(C.yellow, '[SKIP]', m, ...a);

function separator(title = '') {
  const line = '═'.repeat(72);
  if (title) {
    console.log(`\n${C.cyan}${line}${C.reset}`);
    console.log(`${C.cyan}${C.bold}  ${title}${C.reset}`);
    console.log(`${C.cyan}${line}${C.reset}\n`);
  } else {
    console.log(`${C.cyan}${line}${C.reset}`);
  }
}

// ==========================================
// HTTP 请求封装
// ==========================================

async function request(path, options = {}) {
  const { timeout = TIMEOUT } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ==========================================
// 核心测试引擎
// ==========================================

async function testEndpoint(opts) {
  const {
    name,
    path,
    validate,
    category = '功能',
    showResponse = false,
    skipOnFail = false,
  } = opts;

  stats.total++;
  const startTime = Date.now();
  const result = { name, category, ok: false, elapsed: 0, error: null, summary: null, cacheStatus: '-' };

  separator();
  info(`测试 [${category}]: ${C.bold}${name}${C.reset}`);
  debug(`URL: ${BASE_URL}${path}`);

  if (skipOnFail) {
    // 未准备好（例如动态 ID 未获取），跳过
    stats.skipped++;
    stats.total--;
    skip(`${name} · 前置条件未满足，跳过`);
    return result;
  }

  try {
    const resp = await request(path);
    const elapsed = Date.now() - startTime;

    result.elapsed = elapsed;
    result.cacheStatus = resp.headers.get('x-vercel-cache') || '-';

    debug(`HTTP ${resp.status} | 耗时 ${elapsed}ms | CDN: ${result.cacheStatus}`);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON 解析失败: ${e.message}`);
    }

    if (showResponse) {
      debug(`响应: ${JSON.stringify(data, null, 2).slice(0, 1500)}`);
    }

    const validation = await validate(data);
    if (!validation || !validation.valid) {
      throw new Error((validation && validation.reason) || 'Validation failed');
    }

    pass(`${name} · ${validation.summary || 'OK'} (${elapsed}ms)`);
    result.ok = true;
    result.summary = validation.summary;
    stats.passed++;
    stats.results.push(result);
    return result;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    result.elapsed = elapsed;
    result.error = err.name === 'AbortError' ? `超时（>${TIMEOUT}ms）` : err.message;
    fail(`${name} · ${result.error}`);
    stats.failed++;
    stats.results.push(result);
    return result;
  }
}

// ==========================================
// 工具：生成 base64url 配置
// ==========================================

function encodeConfig(config) {
  const json = JSON.stringify(config);
  return Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ==========================================
// 动态测试 ID（555 的 vodId 是动态的）
// ==========================================

const ctx = {
  jpyyMovieId: null,
  jpyySeriesId: null,
  jpyySeriesEpId: null,
  m555MovieId: null,       // 影片级：dy555{vodId}
  m555SeriesId: null,      // 影片级：dy555{vodId}
  m555SeriesEpId: null,    // 集级：dy555{vodId}:1:1
};

/**
 * 预取 555 测试 ID
 * 555 的 vodId 不固定，测试前从 catalog 取首条
 */
async function prefetch555TestIds() {
  info('预取 555 测试 ID...');

  try {
    const movieResp = await request('/catalog/movie/555-movie.json', { timeout: 20000 });
    if (movieResp.ok) {
      const data = await movieResp.json();
      if (data.metas && data.metas.length > 0) {
        // id 格式：dy555{vodId}
        ctx.m555MovieId = data.metas[0].id;
        debug(`555 电影测试 ID: ${ctx.m555MovieId} (${data.metas[0].name})`);
      }
    }
  } catch (e) {
    warn(`预取 555 电影 ID 失败: ${e.message}`);
  }

  try {
    const seriesResp = await request('/catalog/series/555-series.json', { timeout: 20000 });
    if (seriesResp.ok) {
      const data = await seriesResp.json();
      if (data.metas && data.metas.length > 0) {
        // id 格式：dy555{vodId}:1:1
        const fullId = data.metas[0].id;
        // 去掉末尾的 :1:1 得到影片级 ID
        ctx.m555SeriesEpId = fullId;
        ctx.m555SeriesId = fullId.replace(/:1:1$/, '');
        debug(`555 剧集测试 ID: ${ctx.m555SeriesId}，集级: ${ctx.m555SeriesEpId} (${data.metas[0].name})`);
      }
    }
  } catch (e) {
    warn(`预取 555 剧集 ID 失败: ${e.message}`);
  }
}

// ==========================================
// Manifest 测试
// ==========================================

/** 1. Manifest 默认配置 */
async function testManifestDefault() {
  return testEndpoint({
    name: 'Manifest · 默认配置',
    path: '/manifest.json',
    category: '功能',
    validate: (d) => {
      if (!d.id) return { valid: false, reason: '缺少 id' };
      if (!Array.isArray(d.resources)) return { valid: false, reason: '缺少 resources' };
      if (!Array.isArray(d.catalogs)) return { valid: false, reason: '缺少 catalogs' };

      if (!d.resources.includes('stream')) {
        return { valid: false, reason: '默认配置应包含 stream' };
      }

      // 默认应同时包含 jpyy 和 555
      const ids = d.catalogs.map(c => c.id);
      const hasJpyy = ids.some(id => id.startsWith('jinpai-'));
      const has555 = ids.some(id => id.startsWith('555-'));

      if (!hasJpyy) return { valid: false, reason: '缺少 jpyy 目录' };
      if (!has555) return { valid: false, reason: '缺少 555 目录' };

      // 默认 12 个目录：jpyy 5 + 555 7
      if (d.catalogs.length !== 12) {
        return { valid: false, reason: `默认应 12 个目录，实际 ${d.catalogs.length}` };
      }

      return {
        valid: true,
        summary: `id=${d.id}, resources=[${d.resources.join(',')}], catalogs=${d.catalogs.length} (jpyy+555)`,
      };
    },
  });
}

/** 2. Manifest 关闭 Stream */
async function testManifestNoStream() {
  const cfg = encodeConfig({ stream: false });
  return testEndpoint({
    name: 'Manifest · 关闭 Stream',
    path: `/manifest.json?cfg=${cfg}`,
    category: '配置',
    validate: (d) => {
      if (d.resources.includes('stream')) {
        return { valid: false, reason: '应不包含 stream' };
      }
      if (!d.resources.includes('catalog')) return { valid: false, reason: '应包含 catalog' };
      if (!d.resources.includes('meta')) return { valid: false, reason: '应包含 meta' };
      return { valid: true, summary: `resources=[${d.resources.join(',')}]` };
    },
  });
}

/** 3. Manifest 只启用 jpyy 的电影/电视剧 */
async function testManifestJpyyPartial() {
  const cfg = encodeConfig({
    srcs: ['jpyy'],
    cats: ['movie', 'series'],
  });
  return testEndpoint({
    name: 'Manifest · 只 jpyy 电影/电视剧',
    path: `/manifest.json?cfg=${cfg}`,
    category: '配置',
    validate: (d) => {
      if (!Array.isArray(d.catalogs)) return { valid: false, reason: '缺少 catalogs' };
      if (d.catalogs.length !== 2) {
        return { valid: false, reason: `应只有 2 个目录，实际 ${d.catalogs.length}` };
      }
      const names = d.catalogs.map(c => c.name);
      if (!names.some(n => n.includes('电影'))) return { valid: false, reason: '缺少电影' };
      if (!names.some(n => n.includes('电视剧'))) return { valid: false, reason: '缺少电视剧' };

      // 不应包含 555
      const ids = d.catalogs.map(c => c.id);
      if (ids.some(id => id.startsWith('555-'))) {
        return { valid: false, reason: '不应包含 555 目录' };
      }

      // idPrefixes 不应含 dy555
      if (d.idPrefixes && d.idPrefixes.includes('dy555')) {
        return { valid: false, reason: 'idPrefixes 不应含 dy555' };
      }

      return { valid: true, summary: `${d.catalogs.length} 个目录，idPrefixes=[${d.idPrefixes.join(',')}]` };
    },
  });
}

/** 4. Manifest 只 jpyy 动漫 */
async function testManifestJpyySingle() {
  const cfg = encodeConfig({
    srcs: ['jpyy'],
    cats: ['anime'],
  });
  return testEndpoint({
    name: 'Manifest · 只 jpyy 动漫',
    path: `/manifest.json?cfg=${cfg}`,
    category: '配置',
    validate: (d) => {
      if (d.catalogs.length !== 1) {
        return { valid: false, reason: `应只有 1 个目录，实际 ${d.catalogs.length}` };
      }
      return { valid: true, summary: `${d.catalogs[0].name}` };
    },
  });
}

/** 5. Manifest 只启用 555 */
async function testManifestOnly555() {
  const cfg = encodeConfig({ srcs: ['555'] });
  return testEndpoint({
    name: 'Manifest · 只启用 555',
    path: `/manifest.json?cfg=${cfg}`,
    category: '配置 · 555',
    validate: (d) => {
      const ids = d.catalogs.map(c => c.id);

      // 全部应是 555
      if (!ids.every(id => id.startsWith('555-'))) {
        return { valid: false, reason: '目录中混入了非 555 的条目' };
      }

      // 默认 7 个 555 分类
      if (d.catalogs.length !== 7) {
        return { valid: false, reason: `应有 7 个目录，实际 ${d.catalogs.length}` };
      }

      // idPrefixes 应只含 dy555
      if (!d.idPrefixes || !d.idPrefixes.includes('dy555')) {
        return { valid: false, reason: 'idPrefixes 缺少 dy555' };
      }
      if (d.idPrefixes.includes('tt') || d.idPrefixes.includes('jp')) {
        return { valid: false, reason: 'idPrefixes 不应含 tt/jp' };
      }

      return { valid: true, summary: `${d.catalogs.length} 个目录，idPrefixes=[${d.idPrefixes.join(',')}]` };
    },
  });
}

/** 6. Manifest 555 只启用部分分类 */
async function testManifest555Partial() {
  const cfg = encodeConfig({
    srcs: ['555'],
    c555: ['movie', 'series'],
  });
  return testEndpoint({
    name: 'Manifest · 555 只电影/剧集',
    path: `/manifest.json?cfg=${cfg}`,
    category: '配置 · 555',
    validate: (d) => {
      const ids = d.catalogs.map(c => c.id);
      if (d.catalogs.length !== 2) {
        return { valid: false, reason: `应有 2 个目录，实际 ${d.catalogs.length}` };
      }
      if (!ids.includes('555-movie')) return { valid: false, reason: '缺少 555-movie' };
      if (!ids.includes('555-series')) return { valid: false, reason: '缺少 555-series' };

      // 不应有 sports 等其他分类
      if (ids.includes('555-sports')) return { valid: false, reason: '不应含 555-sports' };

      return { valid: true, summary: `目录: [${ids.join(', ')}]` };
    },
  });
}

/** 7. Manifest 都关闭 → 兜底 */
async function testManifestAllOff() {
  const cfg = encodeConfig({ srcs: [] });
  return testEndpoint({
    name: 'Manifest · 都关闭兜底',
    path: `/manifest.json?cfg=${cfg}`,
    category: '配置 · 边界',
    validate: (d) => {
      // 兜底为 jpyy
      const ids = d.catalogs.map(c => c.id);
      const hasJpyy = ids.some(id => id.startsWith('jinpai-'));
      if (!hasJpyy) return { valid: false, reason: '兜底应保留 jpyy' };
      if (ids.some(id => id.startsWith('555-'))) {
        return { valid: false, reason: '不应含 555' };
      }
      return { valid: true, summary: `兜底: ${d.catalogs.length} 个 jpyy 目录` };
    },
  });
}

// ==========================================
// jpyy Catalog 测试
// ==========================================

async function testCatalogs() {
  const catalogs = [
    { name: '电影', path: '/catalog/movie/jinpai-movie.json' },
    { name: '电视剧', path: '/catalog/series/jinpai-series.json' },
    { name: '综艺', path: '/catalog/series/jinpai-variety.json' },
    { name: '动漫', path: '/catalog/series/jinpai-anime.json' },
    { name: '短剧', path: '/catalog/series/jinpai-short.json' },
  ];

  for (const cat of catalogs) {
    await testEndpoint({
      name: `Catalog · jpyy ${cat.name}`,
      path: cat.path,
      category: '功能',
      validate: (d) => {
        if (!Array.isArray(d.metas)) return { valid: false, reason: 'metas 非数组' };
        if (d.metas.length === 0) return { valid: false, reason: 'metas 为空' };
        const first = d.metas[0];
        if (!first.id || !first.type || !first.name) {
          return { valid: false, reason: '首条缺少必要字段' };
        }
        return { valid: true, summary: `${d.metas.length} 条，首条：${first.name}` };
      },
    });
  }
}

async function testCatalogPagination() {
  const r1 = await testEndpoint({
    name: 'Catalog 分页 · skip=0',
    path: '/catalog/movie/jinpai-movie.json?skip=0',
    category: '功能',
    validate: (d) => Array.isArray(d.metas)
      ? { valid: true, summary: `${d.metas.length} 条` }
      : { valid: false, reason: 'metas 非数组' },
  });

  const r2 = await testEndpoint({
    name: 'Catalog 分页 · skip=48',
    path: '/catalog/movie/jinpai-movie.json?skip=48',
    category: '功能',
    validate: (d) => Array.isArray(d.metas)
      ? { valid: true, summary: `${d.metas.length} 条` }
      : { valid: false, reason: 'metas 非数组' },
  });

  if (r1.ok && r2.ok) {
    try {
      const p1 = await (await request('/catalog/movie/jinpai-movie.json?skip=0')).json();
      const p2 = await (await request('/catalog/movie/jinpai-movie.json?skip=48')).json();
      const n1 = p1.metas?.[0]?.name;
      const n2 = p2.metas?.[0]?.name;
      if (n1 && n2 && n1 === n2) {
        warn(`分页测试：两页首条相同（${n1}），可能未生效`);
        stats.warnings.push('jpyy 分页可能未生效');
      } else {
        pass(`分页验证：两页数据不同（${n1} vs ${n2}）`);
      }
    } catch (e) { /* ignore */ }
  }
}

async function testCatalogSearch() {
  await testEndpoint({
    name: 'Catalog 搜索 · "阿甘"',
    path: `/catalog/movie/jinpai-movie/search=${encodeURIComponent('阿甘')}.json`,
    category: '功能',
    validate: (d) => {
      if (!Array.isArray(d.metas)) return { valid: false, reason: 'metas 非数组' };
      if (d.metas.length === 0) return { valid: false, reason: '搜索无结果' };
      return { valid: true, summary: `${d.metas.length} 条` };
    },
  });
}

// ==========================================
// 555 Catalog 测试
// ==========================================

/** 测试单个 555 catalog */
async function test555Catalog(catalogId, type, displayName) {
  await testEndpoint({
    name: `Catalog · 555 ${displayName}`,
    path: `/catalog/${type}/${catalogId}.json`,
    category: '功能 · 555',
    validate: (d) => {
      if (!Array.isArray(d.metas)) return { valid: false, reason: 'metas 非数组' };
      if (d.metas.length === 0) return { valid: false, reason: 'metas 为空' };

      const first = d.metas[0];
      if (!first.id || !first.name) {
        return { valid: false, reason: '首条缺少必要字段' };
      }

      // 校验 ID 前缀（dy555 无冒号前缀）
      if (!first.id.startsWith('dy555')) {
        return { valid: false, reason: `id 前缀错误: ${first.id}` };
      }

      // 校验类型
      if (first.type !== type) {
        return { valid: false, reason: `type 应为 ${type}，实际 ${first.type}` };
      }

      // 电影 ID 格式：dy555{vodId}（1 段）
      // 剧集 ID 格式：dy555{vodId}:1:1（3 段）
      if (type === 'movie') {
        const parts = first.id.split(':');
        if (parts.length !== 1) {
          return { valid: false, reason: `电影 id 应为 dy555{vodId}，实际 ${first.id}` };
        }
      } else {
        const parts = first.id.split(':');
        if (parts.length !== 3 || parts[1] !== '1' || parts[2] !== '1') {
          return { valid: false, reason: `剧集 id 应为 dy555{vodId}:1:1，实际 ${first.id}` };
        }
      }

      return { valid: true, summary: `${d.metas.length} 条，首条：${first.name}` };
    },
  });
}

async function test555Catalogs() {
  await test555Catalog('555-movie',   'movie',  '电影');
  await test555Catalog('555-series',  'series', '剧集');
  await test555Catalog('555-anime',   'series', '动漫');
  await test555Catalog('555-variety', 'series', '综艺');
  await test555Catalog('555-short',   'series', '短剧');
  await test555Catalog('555-sports',  'series', '体育');
  await test555Catalog('555-new',     'series', '今日更新');
}

/** 555 无分页：skip=48 应返回空 */
async function test555NoPagination() {
  await testEndpoint({
    name: 'Catalog · 555 无分页 (skip=48)',
    path: '/catalog/movie/555-movie.json?skip=48',
    category: '功能 · 555',
    validate: (d) => {
      if (!Array.isArray(d.metas)) return { valid: false, reason: 'metas 非数组' };
      if (d.metas.length !== 0) {
        return { valid: false, reason: `555 无分页，skip>0 应返回空，实际 ${d.metas.length} 条` };
      }
      return { valid: true, summary: '正确返回空数组（无分页）' };
    },
  });
}

// ==========================================
// jpyy Meta / Stream 测试
// ==========================================

async function testMetaJpMovie() {
  await testEndpoint({
    name: 'Meta · JP 电影',
    path: '/meta/movie/jp146870.json',
    category: '功能',
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空' };
      if (d.meta.type !== 'movie') return { valid: false, reason: `type 应为 movie` };
      return { valid: true, summary: `"${d.meta.name}" (${d.meta.year || 'N/A'})` };
    },
  });
}

async function testMetaJpSeries() {
  await testEndpoint({
    name: 'Meta · JP 剧集',
    path: '/meta/series/jp146932.json',
    category: '功能',
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空' };
      if (d.meta.type !== 'series') return { valid: false, reason: `type 应为 series` };
      if (!Array.isArray(d.meta.videos) || d.meta.videos.length === 0) {
        return { valid: false, reason: 'videos 为空' };
      }
      if (d.meta.id.includes(':')) {
        return { valid: false, reason: `meta.id 应为影片级，实际为 ${d.meta.id}` };
      }
      const first = d.meta.videos[0];
      if (!first.id.includes(':')) {
        return { valid: false, reason: `videos[0].id 格式错误：${first.id}` };
      }
      return {
        valid: true,
        summary: `"${d.meta.name}"，${d.meta.videos.length} 集，首集 id=${first.id}`,
      };
    },
  });
}

async function testMetaTtMovie() {
  return testEndpoint({
    name: 'Meta · TT 电影 (tt0109830 阿甘正传)',
    path: '/meta/movie/tt0109830.json',
    category: '功能 · IMDb',
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空（TMDB 可能不可用）' };
      return { valid: true, summary: `"${d.meta.name}" (${d.meta.year || 'N/A'})` };
    },
  });
}

async function testMetaTtSeries() {
  await testEndpoint({
    name: 'Meta · TT 剧集 (tt13016388 3 Body Problem)',
    path: '/meta/series/tt13016388.json',
    category: '功能 · IMDb',
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空（多语言匹配失败）' };
      if (!Array.isArray(d.meta.videos)) return { valid: false, reason: 'videos 非数组' };
      return {
        valid: true,
        summary: `"${d.meta.name}"，${d.meta.videos.length} 集`,
      };
    },
  });
}

async function testStreamJpMovie() {
  await testEndpoint({
    name: 'Stream · JP 电影',
    path: '/stream/movie/jp146870.json',
    category: '功能',
    validate: (d) => {
      if (!Array.isArray(d.streams)) return { valid: false, reason: 'streams 非数组' };
      if (d.streams.length === 0) return { valid: false, reason: 'streams 为空' };
      if (!d.streams[0].url) return { valid: false, reason: 'streams[0].url 为空' };
      return {
        valid: true,
        summary: `${d.streams.length} 个清晰度（最佳：${d.streams[0].title}）`,
      };
    },
  });
}

async function testStreamJpSeries() {
  await testEndpoint({
    name: 'Stream · JP 剧集 S1E1',
    path: '/stream/series/jp146932%3A1%3A1.json',
    category: '功能',
    validate: (d) => Array.isArray(d.streams) && d.streams.length > 0
      ? { valid: true, summary: `${d.streams.length} 个清晰度` }
      : { valid: false, reason: 'streams 为空' },
  });
}

async function testStreamTtMovie() {
  await testEndpoint({
    name: 'Stream · TT 电影 (tt0109830)',
    path: '/stream/movie/tt0109830.json',
    category: '功能 · IMDb',
    validate: (d) => Array.isArray(d.streams) && d.streams.length > 0
      ? { valid: true, summary: `${d.streams.length} 个清晰度` }
      : { valid: false, reason: 'streams 为空（IMDb 转换失败）' },
  });
}

async function testStreamDisabled() {
  const cfg = encodeConfig({ stream: false });
  await testEndpoint({
    name: 'Stream · 关闭时返回空',
    path: `/stream/movie/jp146870.json?cfg=${cfg}`,
    category: '配置',
    validate: (d) => {
      if (!Array.isArray(d.streams)) return { valid: false, reason: 'streams 非数组' };
      if (d.streams.length !== 0) return { valid: false, reason: '应返回空数组' };
      return { valid: true, summary: '正确返回空 streams' };
    },
  });
}

async function testSearch() {
  await testEndpoint({
    name: 'Search · 独立接口',
    path: `/search/${encodeURIComponent('怒之杀')}.json`,
    category: '功能',
    validate: (d) => Array.isArray(d.results) && d.results.length > 0
      ? { valid: true, summary: `${d.results.length} 条` }
      : { valid: false, reason: 'results 为空' },
  });
}

// ==========================================
// 555 Meta / Stream 测试（动态 ID）
// ==========================================

async function test555MetaMovie() {
  const vodId = ctx.m555MovieId;   // 已含 dy555 前缀
  await testEndpoint({
    name: 'Meta · 555 电影',
    path: `/meta/movie/${encodeURIComponent(vodId || '')}.json`,
    category: '功能 · 555',
    skipOnFail: !vodId,
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空' };
      if (d.meta.type !== 'movie') return { valid: false, reason: `type 应为 movie，实际 ${d.meta.type}` };
      if (!d.meta.name) return { valid: false, reason: 'name 为空' };

      // meta.id 应为 dy555{vodId}（1 段，无冒号）
      if (!d.meta.id.startsWith('dy555')) {
        return { valid: false, reason: `id 前缀错误: ${d.meta.id}` };
      }
      if (d.meta.id.split(':').length !== 1) {
        return { valid: false, reason: `电影 meta.id 应为 1 段，实际 ${d.meta.id}` };
      }

      return { valid: true, summary: `"${d.meta.name}" (${d.meta.year || 'N/A'})` };
    },
  });
}

async function test555MetaSeries() {
  const vodId = ctx.m555SeriesId;   // 影片级，含 dy555 前缀
  await testEndpoint({
    name: 'Meta · 555 剧集',
    path: `/meta/series/${encodeURIComponent(vodId || '')}.json`,
    category: '功能 · 555',
    skipOnFail: !vodId,
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空' };
      if (d.meta.type !== 'series') {
        return { valid: false, reason: `type 应为 series，实际 ${d.meta.type}` };
      }

      // 关键：meta.id 必须是影片级（不含冒号）
      const metaIdParts = d.meta.id.split(':');
      if (metaIdParts.length !== 1) {
        return { valid: false, reason: `meta.id 应为 dy555{vodId}（1 段），实际 ${d.meta.id}` };
      }
      if (!d.meta.id.startsWith('dy555')) {
        return { valid: false, reason: `meta.id 前缀应为 dy555，实际 ${d.meta.id}` };
      }

      if (!Array.isArray(d.meta.videos) || d.meta.videos.length === 0) {
        return { valid: false, reason: 'videos 为空' };
      }

      // 校验集级 ID：dy555{vodId}:1:{ep}（3 段）
      const first = d.meta.videos[0];
      const parts = first.id.split(':');
      if (parts.length !== 3) {
        return { valid: false, reason: `集级 id 应为 3 段，实际 ${first.id}` };
      }
      if (!parts[0].startsWith('dy555')) {
        return { valid: false, reason: `前缀应为 dy555，实际 ${parts[0]}` };
      }
      if (parts[1] !== '1') {
        return { valid: false, reason: `season 段应为 1，实际 ${parts[1]}` };
      }
      if (first.season !== 1) {
        return { valid: false, reason: `season 字段应为 1，实际 ${first.season}` };
      }

      return {
        valid: true,
        summary: `"${d.meta.name}"，${d.meta.videos.length} 集，首集 id=${first.id}`,
      };
    },
  });
}

async function test555StreamMovie() {
  const vodId = ctx.m555MovieId;
  await testEndpoint({
    name: 'Stream · 555 电影',
    path: `/stream/movie/${encodeURIComponent(vodId || '')}.json`,
    category: '功能 · 555',
    skipOnFail: !vodId,
    validate: (d) => {
      if (!Array.isArray(d.streams)) return { valid: false, reason: 'streams 非数组' };
      if (d.streams.length === 0) return { valid: false, reason: 'streams 为空' };
      if (!d.streams[0].url) return { valid: false, reason: 'streams[0].url 为空' };

      // 校验 name 为影片名称（不是固定的 '555'）
      if (!d.streams[0].name || d.streams[0].name === '555') {
        return { valid: false, reason: `stream.name 应为影片名称，实际 ${d.streams[0].name}` };
      }

      return {
        valid: true,
        summary: `${d.streams.length} 个流，name="${d.streams[0].name}"，源="${d.streams[0].title}"`,
      };
    },
  });
}

async function test555StreamSeries() {
  const vodId = ctx.m555SeriesId;
  if (!vodId) {
    stats.skipped++;
    skip('Stream · 555 剧集 S1E1 · 缺少测试 ID');
    return;
  }
  // vodId 格式：dy555{vodId}，需要拼上 :1:1
  const fullId = `${vodId}:1:1`;
  await testEndpoint({
    name: 'Stream · 555 剧集 S1E1',
    path: `/stream/series/${encodeURIComponent(fullId)}.json`,
    category: '功能 · 555',
    validate: (d) => {
      if (!Array.isArray(d.streams)) return { valid: false, reason: 'streams 非数组' };
      if (d.streams.length === 0) return { valid: false, reason: 'streams 为空' };
      if (!d.streams[0].url) return { valid: false, reason: 'streams[0].url 为空' };

      // 校验 name 为影片名称
      if (!d.streams[0].name || d.streams[0].name === '555') {
        return { valid: false, reason: `stream.name 应为影片名称，实际 ${d.streams[0].name}` };
      }

      return {
        valid: true,
        summary: `${d.streams.length} 个流，name="${d.streams[0].name}"，源="${d.streams[0].title}"`,
      };
    },
  });
}

// ==========================================
// 健康检查
// ==========================================

async function testDebugDomains() {
  await testEndpoint({
    name: '健康检查 · 域名状态',
    path: '/debug/domains',
    category: '健康检查',
    validate: (d) => {
      if (!d.current) return { valid: false, reason: '缺少 current 字段' };
      return { valid: true, summary: `当前域名：${d.current}` };
    },
  });
}

async function testDebugCache() {
  await testEndpoint({
    name: '健康检查 · 缓存状态',
    path: '/debug/cache',
    category: '健康检查',
    validate: (d) => {
      if (typeof d.l2Enabled !== 'boolean') return { valid: false, reason: '缺少 l2Enabled' };
      const status = d.l2Enabled
        ? (d.redisInCooldown ? `Redis 冷却中（剩余 ${d.redisCooldownRemain}s）` : 'Redis ✅')
        : 'Redis 未配置';
      return { valid: true, summary: `${status}，L1 缓存 ${d.l1Size} 条` };
    },
  });
}

async function testDebug555() {
  await testEndpoint({
    name: '健康检查 · 555 状态',
    path: '/debug/555',
    category: '健康检查 · 555',
    validate: (d) => {
      if (!d.currentDomain && !d.defaultDomain) {
        return { valid: false, reason: '缺少域名字段' };
      }
      return {
        valid: true,
        summary: `当前域名：${d.currentDomain}，默认：${d.defaultDomain}`,
      };
    },
  });
}

// ==========================================
// 缓存效果测试
// ==========================================

async function testCacheEffect() {
  if (SKIP_CACHE_TEST) {
    info('跳过缓存测试（SKIP_CACHE_TEST=1）');
    return;
  }

  separator('💾 缓存效果测试');

  const testPath = '/catalog/movie/555-movie.json';

  info('第 1 次请求（可能回源）...');
  const r1 = await testEndpoint({
    name: '缓存 · 555 Catalog 第 1 次',
    path: testPath,
    category: '缓存',
    validate: (d) => Array.isArray(d.metas)
      ? { valid: true, summary: `${d.metas.length} 条` }
      : { valid: false, reason: 'metas 非数组' },
  });

  await new Promise(r => setTimeout(r, 2000));

  info('第 2 次请求（应命中缓存）...');
  const r2 = await testEndpoint({
    name: '缓存 · 555 Catalog 第 2 次',
    path: testPath,
    category: '缓存',
    validate: (d) => Array.isArray(d.metas)
      ? { valid: true, summary: `${d.metas.length} 条` }
      : { valid: false, reason: 'metas 非数组' },
  });

  console.log('');
  if (r1.ok && r2.ok) {
    const speedup = r1.elapsed / r2.elapsed;
    const cacheStatus = r2.cacheStatus;

    console.log(`${C.bold}缓存效果分析：${C.reset}`);
    console.log(`  第 1 次耗时：${r1.elapsed}ms (CDN: ${r1.cacheStatus})`);
    console.log(`  第 2 次耗时：${r2.elapsed}ms (CDN: ${r2.cacheStatus})`);

    if (cacheStatus === 'HIT') {
      pass(`CDN 缓存生效（x-vercel-cache: HIT）`);
    } else if (speedup > 2) {
      pass(`速度提升 ${speedup.toFixed(1)}x`);
    } else {
      warn(`缓存未明显生效（CDN: ${cacheStatus}，加速 ${speedup.toFixed(1)}x）`);
      stats.warnings.push('CDN 缓存未生效');
    }
  }
}

// ==========================================
// 主入口
// ==========================================

async function main() {
  console.clear();
  separator('🎬 金牌影视 + 555 · Stremio Addon 完整测试');
  console.log(`${C.bold}目标地址：${C.reset}${C.cyan}${BASE_URL}${C.reset}`);
  console.log(`${C.bold}超时设置：${C.reset}${TIMEOUT}ms`);
  console.log(`${C.bold}开始时间：${C.reset}${new Date().toLocaleString()}`);
  console.log('');

  // ===== 预检：服务可达性 =====
  info('检查服务可达性...');
  try {
    const resp = await request('/manifest.json', { timeout: 5000 });
    if (resp.ok) {
      pass(`服务可达（HTTP ${resp.status}）`);
    } else {
      warn(`服务返回 HTTP ${resp.status}`);
    }
  } catch (err) {
    fail(`服务不可达：${err.message}`);
    fail('请确认：');
    fail('  1. 已运行 "npx vercel dev" 或部署到生产');
    fail(`  2. BASE_URL 正确（当前：${BASE_URL}）`);
    process.exit(1);
  }

  // ===== 预取 555 动态测试 ID =====
  await prefetch555TestIds();

  const startTime = Date.now();

  // ===== 1. Manifest 测试 =====
  separator('📋 Manifest 测试');
  await testManifestDefault();
  await testManifestNoStream();
  await testManifestJpyyPartial();
  await testManifestJpyySingle();
  await testManifestOnly555();
  await testManifest555Partial();
  await testManifestAllOff();

  // ===== 2. jpyy Catalog =====
  separator('🎯 jpyy Catalog 测试');
  await testCatalogs();
  await testCatalogPagination();
  await testCatalogSearch();

  // ===== 3. 555 Catalog =====
  separator('🎥 555 Catalog 测试');
  await test555Catalogs();
  await test555NoPagination();

  // ===== 4. IMDb 测试 =====
  separator('🌍 IMDb 测试');
  await testMetaTtMovie();
  await testMetaTtSeries();

  // ===== 5. jpyy Meta / Stream =====
  separator('📺 jpyy Meta / Stream 测试');
  await testMetaJpMovie();
  await testMetaJpSeries();
  await testStreamJpMovie();
  await testStreamJpSeries();
  await testStreamTtMovie();
  await testStreamDisabled();
  await testSearch();

  // ===== 6. 555 Meta / Stream =====
  separator('🎬 555 Meta / Stream 测试');
  await test555MetaMovie();
  await test555MetaSeries();
  await test555StreamMovie();
  await test555StreamSeries();

  // ===== 7. 健康检查 =====
  separator('🏥 健康检查');
  await testDebugDomains();
  await testDebugCache();
  await testDebug555();

  // ===== 8. 缓存测试 =====
  await testCacheEffect();

  const totalTime = Date.now() - startTime;

  // ===== 详细结果 =====
  separator('📋 详细结果');
  for (const r of stats.results) {
    const icon = r.ok ? `${C.green}✅${C.reset}` : `${C.red}❌${C.reset}`;
    const time = `${C.gray}(${r.elapsed}ms)${C.reset}`;
    const cache = r.cacheStatus && r.cacheStatus !== '-' ? ` ${C.gray}[CDN: ${r.cacheStatus}]${C.reset}` : '';
    console.log(`${icon} ${r.name} ${time}${cache}`);
    if (!r.ok) {
      console.log(`     ${C.red}${r.error}${C.reset}`);
    }
  }

  // ===== 汇总 =====
  separator('📊 测试汇总');
  console.log(`${C.bold}总计：${C.reset}  ${stats.total}`);
  console.log(`${C.green}${C.bold}通过：${C.reset}  ${stats.passed}`);
  console.log(`${C.red}${C.bold}失败：${C.reset}  ${stats.failed}`);
  if (stats.skipped > 0) {
    console.log(`${C.yellow}${C.bold}跳过：${C.reset}  ${stats.skipped}`);
  }
  console.log(`${C.bold}耗时：${C.reset}  ${totalTime}ms`);

  const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
  const color = passRate >= 80 ? C.green : passRate >= 50 ? C.yellow : C.red;
  console.log(`${C.bold}通过率：${C.reset} ${color}${passRate}%${C.reset}`);

  // ===== 警告 =====
  if (stats.warnings.length > 0) {
    separator('⚠️ 警告');
    for (const w of stats.warnings) {
      console.log(`  ${C.yellow}• ${w}${C.reset}`);
    }
  }

  // ===== 诊断建议 =====
  if (stats.failed > 0) {
    separator('💡 诊断建议');

    const failed = stats.results.filter(r => !r.ok);
    const categories = {};
    for (const r of failed) {
      categories[r.category] = (categories[r.category] || 0) + 1;
    }

    if (categories['功能'] > 0) {
      console.log(`${C.yellow}⚠️ jpyy 功能测试失败${C.reset}`);
      console.log('   可能原因：站点不可访问、域名失效、网络问题');
      console.log(`   ${C.cyan}建议：检查 /debug/domains 确认域名可用${C.reset}\n`);
    }

    if (categories['功能 · IMDb'] > 0) {
      console.log(`${C.yellow}⚠️ IMDb 相关测试失败${C.reset}`);
      console.log('   可能原因：TMDB API 不可用、影片未在站点收录');
      console.log(`   ${C.cyan}建议：TT 格式为可选功能，不影响 JP 格式${C.reset}\n`);
    }

    if (categories['功能 · 555'] > 0) {
      console.log(`${C.yellow}⚠️ 555 功能测试失败${C.reset}`);
      console.log('   可能原因：555 站点不可访问、域名失效、页面结构变更');
      console.log(`   ${C.cyan}建议：检查 /debug/555 确认域名，或手动访问站点验证${C.reset}\n`);
    }

    if (categories['配置'] > 0 || categories['配置 · 555'] > 0 || categories['配置 · 边界'] > 0) {
      console.log(`${C.yellow}⚠️ 配置测试失败${C.reset}`);
      console.log('   可能原因：manifest 动态生成逻辑异常、源开关未生效');
      console.log(`   ${C.cyan}建议：检查 src/manifest.js 的 generateManifest 函数${C.reset}\n`);
    }

    if (categories['健康检查'] > 0 || categories['健康检查 · 555'] > 0) {
      console.log(`${C.yellow}⚠️ 健康检查失败${C.reset}`);
      console.log('   可能原因：debug 接口未注册、部署不完整');
      console.log(`   ${C.cyan}建议：检查 handler.js 中的 /debug/* 路由${C.reset}\n`);
    }

    if (categories['缓存'] > 0) {
      console.log(`${C.yellow}⚠️ 缓存测试失败${C.reset}`);
      console.log('   可能原因：Upstash 未配置、CDN 未生效');
      console.log(`   ${C.cyan}建议：检查 /debug/cache 的 l2Enabled 字段${C.reset}\n`);
    }
  }

  separator();
  console.log('');

  process.exit(stats.failed > 0 ? 1 : 0);
}

// ==========================================
// 运行
// ==========================================

main().catch(err => {
  console.error(`${C.red}测试脚本异常：${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});