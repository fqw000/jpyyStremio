/**
 * 全局配置
 * @module config
 */
export const CONFIG = {
  // 站点域名
  BASE_DOMAIN: 'x8kb9k8.com',

  // 域名发现源
  DISCOVERY_URL: 'https://jpyy.com',

  // 候选域名
  FALLBACK_DOMAINS: [
    'x8kb9k8.com',
    '0996zp.com',
  ],

  // API 配置
  API_KEY: 'cb808529bae6b6be45ecfab29a4889bc',
  TMDB_API_KEY: 'e5c3c7269a147fee368c3649ddd98875',
  DEVICE_ID: '63ffad23-a598-4f96-85d7-7bf5f3e4a0a2',

  // User-Agent
  USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',

  // 请求配置
  REQUEST_TIMEOUT: 15000,
  RETRY_COUNT: 2,
  RETRY_DELAY: 300,

  // 域名缓存
  DOMAIN_CACHE_TTL: 1800,

  // 分页
  PAGE_SIZE: 24,

  // 匹配阈值
  MATCH_THRESHOLD: 0.5,
};

export const DEFAULT_HEADERS = {
  'User-Agent': CONFIG.USER_AGENT,
  'Accept': '*/*',
  'DNT': '1',
};