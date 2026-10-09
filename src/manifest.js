/**
 * Stremio Addon Manifest
 */
// export const MANIFEST = {
//   id: 'com.vercel.jinpai',
//   version: '1.0.0',
//   name: 'jpyy',
//   description: '基于 Vercel Edge Functions 的 Stremio 影视插件，对接 jpyy.com 影视站，提供目录浏览、搜索、元数据获取和流媒体播放功能, 支持电影、电视剧、综艺、动漫和短剧等类型.兼容站内 ID 与 IMDb ID 双格式。仅供学习、演示使用！',
//   logo: 'https://s2.loli.net/2023/06/10/xIeQpSEKYM2c8zU.png',
//   // background: '#000000', 
//   resources: ['catalog', 'meta', 'stream'
//   ],

//   types: ['movie', 'series'
//   ],

//   catalogs: [
//     {
//       type: 'movie',
//       id: 'movie',
//       name: '自用接口 - 电影',
//       extra: [
//         { name: 'search', isRequired: false },  // 搜索支持
//         { name: 'skip', isRequired: false },
//       ]
//     },
//     {
//       type: 'series',
//       id: 'series',
//       name: '自用接口 - 电视剧',
//       extra: [
//         { name: 'search', isRequired: false },  // 搜索支持
//         { name: 'skip', isRequired: false },  // catalog懒加载支持
//       ]
//     },
//     {
//       type: 'series', 
//       id: 'variety', 
//       name: '自用接口 - 综艺',
//       extra: [
//         { name: 'search', isRequired: false },  // 搜索支持
//         { name: 'skip', isRequired: false },  // catalog懒加载支持
//       ]
//     },
//     {
//       type: 'series', 
//       id: 'anime', 
//       name: '自用接口 - 动漫',
//       extra: [
//         { name: 'search', isRequired: false },  // 搜索支持
//         { name: 'skip', isRequired: false },  // catalog懒加载支持
//       ]
//     },
//     {
//       type: 'series', 
//       id: 'short', 
//       name: '自用接口 - 短剧',
//       extra: [
//         { name: 'search', isRequired: false },  // 搜索支持
//         { name: 'skip', isRequired: false },  // catalog懒加载支持
//       ]
//     },
//   ],

//   idPrefixes: ['tt', 'jp'],
// };

/**
 * 目录定义（完整版）
 */
const ALL_CATALOGS = [
  { type: 'movie', id: 'jinpai-movie', name: 'jpyy - 电影', key: 'movie' },
  { type: 'series', id: 'jinpai-series', name: 'jpyy - 电视剧', key: 'series' },
  { type: 'series', id: 'jinpai-variety', name: 'jpyy - 综艺', key: 'variety' },
  { type: 'series', id: 'jinpai-anime', name: 'jpyy - 动漫', key: 'anime' },
  { type: 'series', id: 'jinpai-short', name: 'jpyy - 短剧', key: 'short' },
];

/**
 * 555 目录定义
 * 
 * 注意：
 * - 555 站点无搜索接口，extra 里只有 skip，没有 search
 * - 555 站点的 movie 分类可能夹杂剧集，但按用户要求一律按 catalog 定义走
 */
const ALL_555_CATALOGS = [
  { type: 'movie',  id: '555-movie',   name: '555 - 电影',     key: 'movie' },
  { type: 'series', id: '555-series',  name: '555 - 剧集',     key: 'series' },
  { type: 'series', id: '555-anime',   name: '555 - 动漫',     key: 'anime' },
  { type: 'series', id: '555-variety', name: '555 - 综艺',     key: 'variety' },
  { type: 'series', id: '555-short',   name: '555 - 短剧',     key: 'short' },
  { type: 'series', id: '555-sports',  name: '555 - 体育',     key: 'sports' },
  { type: 'series', id: '555-new',     name: '555 - 今日更新', key: 'new' },
];

/**
 * 生成 Manifest（根据用户配置动态生成）
 * 
 * @param {string[]} enabledCategories - jpyy 启用的类型
 * @param {Object} options - 选项
 * @param {boolean} [options.enableStream=true] - 是否启用 stream 功能
 * @param {boolean} [options.enableJpyy=true] - 是否启用 jpyy 源
 * @param {boolean} [options.enable555=true] - 是否启用 555 源
 * @param {string[]} [options.categories555] - 555 启用的分类
 * @returns {Object}
 */
export function generateManifest(enabledCategories, options = {}) {
  const {
    enableStream = true,
    enableJpyy = true,
    enable555 = true,
    categories555 = ['movie', 'series', 'anime', 'variety', 'short', 'sports', 'new'],
  } = options;

  const jpyyEnabled = enabledCategories || ['movie', 'series', 'variety', 'anime', 'short'];

  // ===== jpyy 目录 =====
  const jpyyCatalogs = enableJpyy
    ? ALL_CATALOGS
        .filter(c => jpyyEnabled.includes(c.key))
        .map(({ key, ...rest }) => ({
          ...rest,
          extra: [
            { name: 'search', isRequired: false },
            { name: 'skip', isRequired: false },
          ],
        }))
    : [];

  // ===== 555 目录 =====
  const catalogs555 = enable555
    ? ALL_555_CATALOGS
        .filter(c => categories555.includes(c.key))
        .map(({ key, ...rest }) => ({
          ...rest,
          extra: [
            // 555 无搜索，只保留 skip
            { name: 'skip', isRequired: false },
          ],
        }))
    : [];

  const catalogs = [...jpyyCatalogs, ...catalogs555];

  // ===== resources 固定包含 stream =====
  // 原因：stream 开关只控制 jpyy 的 stream，555 的 stream 始终由 addon 提供，
  // 因此 manifest 必须始终声明 stream，否则 555 的 stream 请求无法到达。
  const resources = ['catalog', 'meta', 'stream'];

  // ===== idPrefixes =====
  const idPrefixes = [];
  if (enableJpyy) idPrefixes.push('tt', 'jp');
  if (enable555) idPrefixes.push('dy555');

  // ===== 名称与描述（按启用源动态拼接）=====
  const sourceNames = [];
  if (enableJpyy) sourceNames.push('jpyy');
  if (enable555) sourceNames.push('555');
  const nameSuffix = sourceNames.length > 0 ? sourceNames.join(' + ') : '无源';

  const descParts = [];
  if (enableJpyy) descParts.push('金牌影视（支持 IMDb 映射、搜索）');
  if (enable555) descParts.push('555 电影（分类浏览、多线路）');

  return {
    id: 'com.local.jinpai',          // ⚠️ 保持不变，避免已安装用户需重新安装
    version: '1.1.0',
    name: nameSuffix,               // 动态拼接
    description: `${descParts.join('；')}。仅供学习、演示使用！`,
    logo: 'https://obs.3688baihuo.com/upload/site_ico/20260531-1/92da5ddc802c076de628be1b70e6fb90_180x180.png',

    resources,
    types: ['movie', 'series'],
    catalogs,
    idPrefixes,

    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },

    config: [
      { key: 'bd',   title: '金牌影视域名',   type: 'text',    required: false },
      { key: 'tk',   title: 'TMDB API Key',  type: 'text',    required: false },
      { key: 'stream', title: '启用 Stream',  type: 'boolean', required: false },
      { key: 'srcs', title: '启用的源',       type: 'text',    required: false },
      { key: 'd555', title: '555 域名',       type: 'text',    required: false },
      { key: 'c555', title: '555 启用的分类',  type: 'text',    required: false },
    ],
  };
}


/**
 * 默认 Manifest（全类型）
 */
export const MANIFEST = generateManifest();