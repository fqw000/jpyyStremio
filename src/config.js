/**
 * 全局配置
 * 
 * 支持从 URL 查询参数覆盖默认配置
 * 用户配置通过 globalThis.__USER_CONFIG 注入
 * 
 * @module config
 */

/**
 * 获取用户配置
 * 
 * @returns {Object}
 */
function getUserConfig() {
  return (typeof globalThis !== 'undefined' && globalThis.__USER_CONFIG) || {};
}

/**
 * 计算最终配置
 */
function buildConfig() {
  const user = getUserConfig();

  // ===== 解析支持类型 =====
  // user.cats 可能是：
  //   undefined     → 全部启用（默认）
  //   ['movie']     → 只启用电影
  //   []            → 全部禁用（异常情况）
  const ALL_CATEGORIES = ['movie', 'series', 'variety', 'anime', 'short'];
  let enabledCategories;

  if (Array.isArray(user.cats)) {
    if (user.cats.length === 0) {
      // 用户取消所有，强制至少保留电影
      enabledCategories = ['movie'];
    } else {
      enabledCategories = user.cats.filter(c => ALL_CATEGORIES.includes(c));
      if (enabledCategories.length === 0) {
        enabledCategories = ['movie'];  // 兜底
      }
    }
  } else {
    // 未配置 → 全部启用
    enabledCategories = ALL_CATEGORIES;
  }

  return {
    // ===== 资源站配置 =====
    //  资源站的查找方式是 通过fofa 查找 `body="obs.3688baihuo.com/upload/site_ico"` 的站点
    BASE_DOMAIN: user.bd || '0996zp.com',
    DISCOVERY_URL: 'https://jpyy.com',
    FALLBACK_DOMAINS: [
      user.bd || '0996zp.com',
      // 'www.' + (user.bd || '0996zp.com'), // 兼容部分站点需要 www 前缀
      'lwdys.com',
      'x8kb9k8.coßm',
      'jpyy5.com'
    ].filter(Boolean),

    // ===== API 密钥 =====
    API_KEY: 'cb808529bae6b6be45ecfab29a4889bc',
    TMDB_API_KEY: user.tk || 'e5c3c7269a147fee368c3649ddd98875',
    DEVICE_ID: '63ffad23-a598-4f96-85d7-7bf5f3e4a0a2',

    // ===== 功能开关 =====
    ENABLE_IMDB: user.imdb !== false,

    // ===== 支持类型（新增）=====
    ENABLED_CATEGORIES: enabledCategories,

    // ===== 网络配置 =====
    USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    REQUEST_TIMEOUT: 5000,
    RETRY_COUNT: 1,
    RETRY_DELAY: 300,

    // ===== 缓存配置 =====
    DOMAIN_CACHE_TTL: 21600,

    // ===== 分页 =====
    PAGE_SIZE: 24,

    // ===== 匹配阈值 =====
    MATCH_THRESHOLD: 0.5,
  };
}

/** 缓存的配置 */
let _configCache = null;
let _configCacheKey = '';

/**
 * 获取当前配置
 * 
 * 检测用户配置是否变化，变化则重新计算
 */
export function getConfig() {
  const user = getUserConfig();
  const key = JSON.stringify(user);

  if (!_configCache || key !== _configCacheKey) {
    _configCache = buildConfig();
    _configCacheKey = key;
    console.log(`[Config] 🔄 配置已更新: ${key}`);
  }

  return _configCache;
}

/**
 * 兼容现有代码的 CONFIG 导出
 * 
 * 使用 Proxy 让每次属性访问都通过 getConfig()，
 * 从而支持运行时配置变化。
 */
export const CONFIG = new Proxy({}, {
  get(target, prop) {
    const config = getConfig();
    return config[prop];
  },
  has(target, prop) {
    return prop in getConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(getConfig());
  },
  getOwnPropertyDescriptor(target, prop) {
    return {
      enumerable: true,
      configurable: true,
      value: getConfig()[prop],
    };
  },
});

/**
 * 默认请求头
 */
export const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'DNT': '1',
};