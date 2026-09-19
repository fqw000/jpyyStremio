#!/usr/bin/env node

/**
 * 金牌影视 Stremio Addon · 完整测试脚本
 * 
 * 覆盖维度：
 * - 功能测试：Manifest / Catalog / Meta / Stream / Search
 * - 双 ID 测试：jp 格式 + tt 格式
 * - 缓存测试：冷/热请求耗时对比
 * - CDN 测试：x-vercel-cache 响应头
 * - 健康检查：/debug/domains、/debug/cache
 * - 分页测试：skip 参数
 * 
 * 使用方式：
 *   node test.js                             # 默认测本地
 *   BASE_URL=https://xxx node test.js        # 测线上
 *   TIMEOUT=60000 node test.js               # 自定义超时
 *   SKIP_CACHE_TEST=1 node test.js           # 跳过缓存测试(只测功能)
 * 
 * @module test
 */

// ==========================================
// 配置
// ==========================================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000', 10);
const SKIP_CACHE_TEST = process.env.SKIP_CACHE_TEST === '1';

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

const info = (msg, ...a) => log(C.blue, '[INFO]', msg, ...a);
const pass = (msg, ...a) => log(C.green, '[PASS]', msg, ...a);
const fail = (msg, ...a) => log(C.red, '[FAIL]', msg, ...a);
const warn = (msg, ...a) => log(C.yellow, '[WARN]', msg, ...a);
const debug = (msg, ...a) => log(C.gray, '[DEBUG]', msg, ...a);

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
// 核心测试引擎
// ==========================================

/**
 * 测试单个接口
 * @param {Object} opts - 测试选项
 * @param {string} opts.name - 测试名称
 * @param {string} opts.path - 请求路径
 * @param {Function} opts.validate - 验证函数
 * @param {boolean} [opts.showResponse] - 是否打印响应
 * @param {string} [opts.category] - 分类（功能/缓存/健康）
 * @returns {Promise<{ok: boolean, elapsed: number, data: any}>}
 */
async function testEndpoint(opts) {
  const { name, path, validate, showResponse = false, category = '功能' } = opts;

  stats.total++;
  const startTime = Date.now();

  console.log(`\n${C.cyan}────────────────────────────────────────────────────────${C.reset}`);
  info(`测试 [${category}]: ${C.bold}${name}${C.reset}`);
  debug(`URL: ${BASE_URL}${path}`);

  const result = { name, category, ok: false, elapsed: 0, error: null, summary: null };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    const resp = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Stremio/4.4.168',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timer);

    const elapsed = Date.now() - startTime;
    result.elapsed = elapsed;
    result.httpStatus = resp.status;
    result.cacheStatus = resp.headers.get('x-vercel-cache') || '-';
    result.age = resp.headers.get('age') || '-';

    debug(`HTTP ${resp.status} | 耗时 ${elapsed}ms | CDN: ${result.cacheStatus} | Age: ${result.age}`);

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

    const validation = validate(data);
    if (!validation.valid) {
      throw new Error(validation.reason || 'Validation failed');
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
// 测试用例
// ==========================================

/** 1. Manifest */
async function testManifest() {
  return testEndpoint({
    name: 'Manifest',
    path: '/manifest.json',
    category: '功能',
    validate: (d) => {
      if (!d.id) return { valid: false, reason: '缺少 id' };
      if (!Array.isArray(d.resources)) return { valid: false, reason: '缺少 resources' };
      if (!Array.isArray(d.catalogs)) return { valid: false, reason: '缺少 catalogs' };
      return {
        valid: true,
        summary: `id=${d.id}, resources=[${d.resources.join(',')}], catalogs=${d.catalogs.length}`,
      };
    },
  });
}

/** 2. Catalog 浏览（5 个目录） */
async function testCatalogs() {
  const catalogs = [
    { name: '电影', path: '/catalog/movie/jinpai-movie.json' },
    { name: '电视剧', path: '/catalog/series/jinpai-series.json' },
    { name: '综艺', path: '/catalog/series/jinpai-variety.json' },
    { name: '动漫', path: '/catalog/series/jinpai-anime.json' },
    { name: '短剧', path: '/catalog/series/jinpai-short.json' },
  ];

  for (const c of catalogs) {
    await testEndpoint({
      name: `Catalog · ${c.name}`,
      path: c.path,
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

/** 3. Catalog 分页 */
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

  // 验证两页数据不同
  if (r1.ok && r2.ok) {
    try {
      const p1 = await fetch(`${BASE_URL}/catalog/movie/jinpai-movie.json?skip=0`).then(r => r.json());
      const p2 = await fetch(`${BASE_URL}/catalog/movie/jinpai-movie.json?skip=48`).then(r => r.json());
      const n1 = p1.metas?.[0]?.name;
      const n2 = p2.metas?.[0]?.name;
      if (n1 && n2 && n1 === n2) {
        warn(`分页测试：skip=0 与 skip=48 首条相同（${n1}），可能未生效`);
        stats.warnings.push('分页可能未生效');
      } else {
        pass(`分页验证：两页数据不同（${n1} vs ${n2}）`);
      }
    } catch (e) {
      // ignore
    }
  }
}

/** 4. Catalog 搜索 */
async function testCatalogSearch() {
  await testEndpoint({
    name: 'Catalog 搜索 · 阿甘',
    path: `/catalog/movie/jinpai-movie/search=${encodeURIComponent('阿甘')}.json`,
    category: '功能',
    validate: (d) => {
      if (!Array.isArray(d.metas)) return { valid: false, reason: 'metas 非数组' };
      if (d.metas.length === 0) return { valid: false, reason: '搜索无结果' };
      return { valid: true, summary: `${d.metas.length} 条` };
    },
  });
}

/** 5. Meta · JP 电影 */
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

/** 6. Meta · JP 剧集 */
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
      // 关键：meta.id 必须是影片级（不带 :）
      if (d.meta.id.includes(':')) {
        return { valid: false, reason: `meta.id 应为影片级，实际为 ${d.meta.id}` };
      }
      const first = d.meta.videos[0];
      if (!first.id.includes(':')) {
        return { valid: false, reason: `videos[0].id 格式错误：${first.id}` };
      }
      return { valid: true, summary: `"${d.meta.name}"，${d.meta.videos.length} 集` };
    },
  });
}

/** 7. Meta · TT 电影 */
async function testMetaTtMovie() {
  return testEndpoint({
    name: 'Meta · TT 电影 (tt0109830)',
    path: '/meta/movie/tt0109830.json',
    category: '功能 · IMDb',
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空（TMDB 可能不可用）' };
      return { valid: true, summary: `"${d.meta.name}" (${d.meta.year || 'N/A'})` };
    },
  });
}

/** 8. Meta · TT 剧集 */
async function testMetaTtSeries() {
  await testEndpoint({
    name: 'Meta · TT 剧集 (tt0455275)',
    path: '/meta/series/tt0455275.json',
    category: '功能 · IMDb',
    validate: (d) => {
      if (!d.meta) return { valid: false, reason: 'meta 为空' };
      if (!Array.isArray(d.meta.videos)) return { valid: false, reason: 'videos 非数组' };
      return { valid: true, summary: `"${d.meta.name}"，${d.meta.videos.length} 集` };
    },
  });
}

/** 9. Stream · JP 电影 */
async function testStreamJpMovie() {
  await testEndpoint({
    name: 'Stream · JP 电影',
    path: '/stream/movie/jp146870.json',
    category: '功能',
    validate: (d) => {
      if (!Array.isArray(d.streams)) return { valid: false, reason: 'streams 非数组' };
      if (d.streams.length === 0) return { valid: false, reason: 'streams 为空' };
      if (!d.streams[0].url) return { valid: false, reason: 'streams[0].url 为空' };
      return { valid: true, summary: `${d.streams.length} 个清晰度（最佳：${d.streams[0].title}）` };
    },
  });
}

/** 10. Stream · JP 剧集 */
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

/** 11. Stream · TT 电影 */
async function testStreamTtMovie() {
  await testEndpoint({
    name: 'Stream · TT 电影 (tt0109830)',
    path: '/stream/movie/tt0109830.json',
    category: '功能 · IMDb',
    validate: (d) => Array.isArray(d.streams) && d.streams.length > 0
      ? { valid: true, summary: `${d.streams.length} 个清晰度` }
      : { valid: false, reason: 'streams 为空（可能 IMDb 转换失败）' },
  });
}

/** 12. Search · 独立接口 */
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

/** 13. Debug · 域名状态 */
async function testDebugDomains() {
  await testEndpoint({
    name: 'Debug · 域名状态',
    path: '/debug/domains',
    category: '健康检查',
    validate: (d) => {
      if (!d.current) return { valid: false, reason: '缺少 current 字段' };
      return { valid: true, summary: `当前域名：${d.current}` };
    },
  });
}

/** 14. Debug · 缓存状态 */
async function testDebugCache() {
  await testEndpoint({
    name: 'Debug · 缓存状态',
    path: '/debug/cache',
    category: '健康检查',
    validate: (d) => {
      if (typeof d.l2Enabled !== 'boolean') return { valid: false, reason: '缺少 l2Enabled' };
      return {
        valid: true,
        summary: `Redis：${d.l2Enabled ? '✅ 已启用' : '❌ 未配置'}`,
      };
    },
  });
}

/** 15. 缓存效果对比（关键） */
async function testCacheEffect() {
  if (SKIP_CACHE_TEST) {
    info('跳过缓存测试（SKIP_CACHE_TEST=1）');
    return;
  }

  separator('💾 缓存效果测试');

  const testPath = '/catalog/movie/jinpai-movie.json';

  info('第 1 次请求（可能回源）...');
  const r1 = await testEndpoint({
    name: '缓存 · 第 1 次请求',
    path: testPath,
    category: '缓存',
    validate: (d) => Array.isArray(d.metas)
      ? { valid: true, summary: `${d.metas.length} 条 | ${d.metas ? 'OK' : ''}` }
      : { valid: false, reason: 'metas 非数组' },
  });

  // 等 2 秒让 CDN 缓存写入
  await new Promise(r => setTimeout(r, 2000));

  info('第 2 次请求（应命中缓存）...');
  const r2 = await testEndpoint({
    name: '缓存 · 第 2 次请求',
    path: testPath,
    category: '缓存',
    validate: (d) => Array.isArray(d.metas)
      ? { valid: true, summary: `${d.metas.length} 条` }
      : { valid: false, reason: 'metas 非数组' },
  });

  // 分析缓存效果
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
      warn(`缓存未明显生效（CDN: ${cacheStatus}，速度提升 ${speedup.toFixed(1)}x）`);
      stats.warnings.push('CDN 缓存未生效');
    }
  }
}

// ==========================================
// 主入口
// ==========================================

async function main() {
  console.clear();
  separator('🎬 金牌影视 Stremio Addon · 完整测试');
  console.log(`${C.bold}目标地址：${C.reset}${C.cyan}${BASE_URL}${C.reset}`);
  console.log(`${C.bold}超时设置：${C.reset}${TIMEOUT}ms`);
  console.log(`${C.bold}开始时间：${C.reset}${new Date().toLocaleString()}`);
  console.log('');

  // 预检：服务可达性
  info('检查服务可达性...');
  try {
    const ping = await fetch(`${BASE_URL}/manifest.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (ping.ok) {
      pass(`服务可达（HTTP ${ping.status}）`);
    } else {
      warn(`服务返回 HTTP ${ping.status}`);
    }
  } catch (err) {
    fail(`服务不可达：${err.message}`);
    fail(`请确认：`);
    fail(`  1. 已运行 "npx vercel dev" 或部署到生产`);
    fail(`  2. BASE_URL 正确（当前：${BASE_URL}）`);
    process.exit(1);
  }

  const startTime = Date.now();

  // ===== 功能测试 =====
  separator('📋 功能测试');
  await testManifest();
  await testCatalogs();
  await testCatalogPagination();
  await testCatalogSearch();

  // ===== IMDb 测试 =====
  separator('🌍 IMDb ID 测试');
  await testMetaTtMovie();
  await testMetaTtSeries();
  await testStreamTtMovie();

  // ===== Meta / Stream 测试 =====
  separator('🎯 Meta / Stream 测试');
  await testMetaJpMovie();
  await testMetaJpSeries();
  await testStreamJpMovie();
  await testStreamJpSeries();
  await testSearch();

  // ===== 健康检查 =====
  separator('🏥 健康检查');
  await testDebugDomains();
  await testDebugCache();

  // ===== 缓存测试 =====
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
      console.log(`${C.yellow}⚠️ 功能测试失败${C.reset}`);
      console.log(`   可能原因：站点不可访问、域名失效、网络问题`);
      console.log(`   ${C.cyan}建议：检查 /debug/domains 确认域名可用${C.reset}\n`);
    }

    if (categories['功能 · IMDb'] > 0) {
      console.log(`${C.yellow}⚠️ IMDb 相关测试失败${C.reset}`);
      console.log(`   可能原因：TMDB API 不可用、影片未在站点收录`);
      console.log(`   ${C.cyan}建议：TT 格式为可选功能，不影响 JP 格式使用${C.reset}\n`);
    }

    if (categories['健康检查'] > 0) {
      console.log(`${C.yellow}⚠️ 健康检查失败${C.reset}`);
      console.log(`   可能原因：Debug 接口未注册、部署不完整`);
      console.log(`   ${C.cyan}建议：检查 handler.js 中的 /debug/* 路由${C.reset}\n`);
    }

    if (categories['缓存'] > 0) {
      console.log(`${C.yellow}⚠️ 缓存测试失败${C.reset}`);
      console.log(`   可能原因：Upstash 未配置、CDN 未生效`);
      console.log(`   ${C.cyan}建议：检查 /debug/cache 的 l2Enabled 字段${C.reset}\n`);
    }
  }

  separator();
  console.log('');

  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${C.red}测试脚本异常：${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});