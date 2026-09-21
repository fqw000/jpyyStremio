/**
 * 缓存（内存 + Upstash Redis 双层）
 * 
 * 分层策略：
 * - L1: 内存缓存（最快，实例级，命中率低）
 * - L2: Upstash Redis（跨实例，< 10ms）
 * 
 * 容错设计：
 * - Redis 请求超时 3 秒
 * - Redis 失败时静默降级到内存缓存
 * - 不打印重复日志（避免日志污染）
 * 
 * @module cache
 */

/** L1: 内存缓存 */
const memCache = new Map();

/** L1 最大条目数 */
const MAX_MEM_SIZE = 200;

/** L1 缓存时长（秒），比 L2 短 */
const L1_TTL = 60;

/** Redis 请求超时（毫秒） */
const REDIS_TIMEOUT = 1500;

// ==========================================
// Upstash 配置（从环境变量读取）
// ==========================================

const UPSTASH_URL = typeof process !== 'undefined'
  ? process.env?.UPSTASH_REDIS_REST_URL
  : null;

const UPSTASH_TOKEN = typeof process !== 'undefined'
  ? process.env?.UPSTASH_REDIS_REST_TOKEN
  : null;

const REDIS_ENABLED = !!(UPSTASH_URL && UPSTASH_TOKEN);

/** 日志只打印一次 */
let redisLogPrinted = false;

function logRedisStatus() {
  if (redisLogPrinted) return;
  redisLogPrinted = true;

  if (REDIS_ENABLED) {
    console.log(`[Cache] ✅ Upstash Redis 已启用`);
  } else {
    console.warn(`[Cache] ⚠️ Upstash 未配置，仅使用内存缓存`);
  }
}

// ==========================================
// Upstash REST API（带超时 + 静默降级）
// ==========================================

/**
 * 执行 Redis 命令
 * 
 * 容错策略：
 * - 3 秒超时
 * - 失败时静默返回 null（不打印错误）
 * - 只在首次使用时打印一次启用日志
 * 
 * @param {...string|number} args - Redis 命令参数
 * @returns {Promise<any>} 命令结果，失败返回 null
 */
async function redisCommand(...args) {
  if (!REDIS_ENABLED) return null;

  // 首次调用时打印一次启用日志
  logRedisStatus();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT);

    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = await res.json();
    return data.result;
  } catch (err) {
    // 静默失败：网络抖动、超时、上游异常等
    // 不打印日志，避免污染输出
    return null;
  }
}

// ==========================================
// 对外接口
// ==========================================

/**
 * 获取缓存
 * 
 * @param {string} key - 缓存键
 * @returns {Promise<any|null>}
 */
export async function getCache(key) {
  // ===== L1: 内存 =====
  const mem = memCache.get(key);
  if (mem && Date.now() <= mem.expireAt) {
    return mem.data;
  }
  if (mem) memCache.delete(key);

  // ===== L2: Redis =====
  if (REDIS_ENABLED) {
    const raw = await redisCommand('GET', key);
    if (raw !== null && raw !== undefined) {
      try {
        const data = JSON.parse(raw);
        console.log(`[Cache] ✅ L2 HIT: ${key}`);

        // 写回 L1（加速后续命中）
        memCache.set(key, {
          data,
          expireAt: Date.now() + L1_TTL * 1000,
        });

        return data;
      } catch (err) {
        // JSON 解析失败，忽略
      }
    }
  }

  return null;
}

/**
 * 写入缓存
 * 
 * @param {string} key - 缓存键
 * @param {any} data - 数据
 * @param {number} ttlSeconds - TTL（秒）
 */
export async function setCache(key, data, ttlSeconds = 3600) {
  // ===== L1: 内存 =====
  memCache.set(key, {
    data,
    expireAt: Date.now() + Math.min(ttlSeconds, L1_TTL) * 1000,
  });

  if (memCache.size > MAX_MEM_SIZE) {
    const firstKey = memCache.keys().next().value;
    memCache.delete(firstKey);
  }

  // ===== L2: Redis =====
  if (REDIS_ENABLED) {
    await redisCommand('SET', key, JSON.stringify(data), 'EX', ttlSeconds);
    console.log(`[Cache] ✅ L2 WRITE: ${key} (ttl=${ttlSeconds}s)`);
  }
}

/**
 * 删除缓存
 */
export async function deleteCache(key) {
  memCache.delete(key);
  if (REDIS_ENABLED) {
    await redisCommand('DEL', key);
  }
}

/**
 * 清空所有缓存（仅当前实例 L1）
 */
export function clearCache() {
  const size = memCache.size;
  memCache.clear();
  console.log(`[Cache] 🧹 清空 L1 的 ${size} 个条目（L2 需手动在 Upstash 清空）`);
}

/**
 * 缓存状态（调试用）
 */
export function getCacheStats() {
  return {
    l1Size: memCache.size,
    l1Keys: [...memCache.keys()].slice(0, 20),
    l2Enabled: REDIS_ENABLED,
    l2Url: UPSTASH_URL ? UPSTASH_URL.replace(/https:\/\/([^.]+).*/, 'https://$1***') : null,
  };
}
