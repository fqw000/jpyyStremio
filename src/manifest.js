/**
 * Stremio Addon Manifest
 */
export const MANIFEST = {
  id: 'com.vercel.jinpai',
  version: '1.0.0',
  name: 'jpyy',
  description: '基于 Vercel Edge Functions 的 Stremio 影视插件，对接 jpyy.com 影视站，提供目录浏览、搜索、元数据获取和流媒体播放功能, 支持电影、电视剧、综艺、动漫和短剧等类型.兼容站内 ID 与 IMDb ID 双格式。仅供学习、演示使用！',
  logo: 'https://s2.loli.net/2023/06/10/xIeQpSEKYM2c8zU.png',
  // background: '#000000', 
  resources: ['catalog', 'meta', 'stream'
  ],

  types: ['movie', 'series'
  ],

  catalogs: [
    {
      type: 'movie',
      id: 'movie',
      name: '自用接口 - 电影',
      extra: [
        { name: 'search', isRequired: false },  // 搜索支持
        { name: 'skip', isRequired: false },
      ]
    },
    {
      type: 'series',
      id: 'series',
      name: '自用接口 - 电视剧',
      extra: [
        { name: 'search', isRequired: false },  // 搜索支持
        { name: 'skip', isRequired: false },  // catalog懒加载支持
      ]
    },
    {
      type: 'series', 
      id: 'variety', 
      name: '自用接口 - 综艺',
      extra: [
        { name: 'search', isRequired: false },  // 搜索支持
        { name: 'skip', isRequired: false },  // catalog懒加载支持
      ]
    },
    {
      type: 'series', 
      id: 'anime', 
      name: '自用接口 - 动漫',
      extra: [
        { name: 'search', isRequired: false },  // 搜索支持
        { name: 'skip', isRequired: false },  // catalog懒加载支持
      ]
    },
    {
      type: 'series', 
      id: 'short', 
      name: '自用接口 - 短剧',
      extra: [
        { name: 'search', isRequired: false },  // 搜索支持
        { name: 'skip', isRequired: false },  // catalog懒加载支持
      ]
    },
  ],

  idPrefixes: ['tt', 'jp'],
};