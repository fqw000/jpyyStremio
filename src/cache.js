/**
 * 缓存（内存 + Upstash Redis 双层）
 * 
 * 分层策略：
 * - L1: 内存缓存（最快，实例级）
 * - L2: Upstash Redis（跨实例，< 10ms 生产环境）
 * 
 * 容错机制：
 * - Redis 请求 800ms 超时
 * - 连续慢/失败 3 次后，冷却 60 秒（跳过 Redis，只用内存）
 * - 冷却期间自动降级到站点请求
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
const REDIS_TIMEOUT = 800;

/** Redis 慢响应阈值（毫秒） */
const REDIS_SLOW_THRESHOLD = 500;

/** Redis 冷却时间（毫秒） */
const REDIS_COOLDOWN = 60000;

/** 触发冷却的连续慢/失败次数 */
const REDIS_SLOW_TRIGGER = 3;

// ==========================================
// Upstash 配置
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
// Redis 健康状态
// ==========================================

/** 连续慢/失败次数 */
let redisSlowCount = 0;

/** 冷却截止时间戳 */
let redisCooldownUntil = 0;

/**
 * Redis 是否处于冷却期
 */
function isRedisInCooldown() {
  return Date.now() < redisCooldownUntil;
}

/**
 * 记录慢/失败，达到阈值触发冷却
 */
function recordRedisSlow(elapsed, reason) {
  redisSlowCount++;
  if (redisSlowCount >= REDIS_SLOW_TRIGGER) {
    redisCooldownUntil = Date.now() + REDIS_COOLDOWN;
    console.warn(
      `[Cache] ⚠️ Redis ${reason} (${elapsed}ms × ${redisSlowCount})，` +
      `冷却 ${REDIS_COOLDOWN / 1000} 秒`
    );
    redisSlowCount = 0;
  }
}

/**
 * 记录成功，重置慢计数
 */
function recordRedisOk(elapsed) {
  if (elapsed <= REDIS_SLOW_THRESHOLD) {
    redisSlowCount = 0;
  } else {
    // 成功了但较慢，仍计入慢统计
    recordRedisSlow(elapsed, '慢响应');
  }
}

// ==========================================
// Upstash REST API（带冷却机制）
// ==========================================

async function redisCommand(...args) {
  if (!REDIS_ENABLED) return null;

  // 冷却期内直接跳过
  if (isRedisInCooldown()) {
    return null;
  }

  logRedisStatus();

  const startTime = Date.now();

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

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      recordRedisSlow(elapsed, 'HTTP 错误');
      return null;
    }

    const data = await res.json();

    // 判断性能
    recordRedisOk(elapsed);

    return data.result;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    recordRedisSlow(elapsed, '失败');
    return null;
  }
}

// ==========================================
// 对外接口
// ==========================================

export async function getCache(key) {
  // ===== L1: 内存 =====
  const mem = memCache.get(key);
  if (mem && Date.now() <= mem.expireAt) {
    return mem.data;
  }
  if (mem) memCache.delete(key);

  // ===== L2: Redis =====
  if (REDIS_ENABLED && !isRedisInCooldown()) {
    const raw = await redisCommand('GET', key);
    if (raw !== null && raw !== undefined) {
      try {
        const data = JSON.parse(raw);
        console.log(`[Cache] ✅ L2 HIT: ${key}`);

        // 写回 L1
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
  if (REDIS_ENABLED && !isRedisInCooldown()) {
    await redisCommand('SET', key, JSON.stringify(data), 'EX', ttlSeconds);
    console.log(`[Cache] ✅ L2 WRITE: ${key} (ttl=${ttlSeconds}s)`);
  }
}

export async function deleteCache(key) {
  memCache.delete(key);
  if (REDIS_ENABLED && !isRedisInCooldown()) {
    await redisCommand('DEL', key);
  }
}

export function clearCache() {
  const size = memCache.size;
  memCache.clear();
  console.log(`[Cache] 🧹 清空 L1 的 ${size} 个条目`);
}

export function getCacheStats() {
  return {
    l1Size: memCache.size,
    l1Keys: [...memCache.keys()].slice(0, 20),
    l2Enabled: REDIS_ENABLED,
    l2Url: UPSTASH_URL ? UPSTASH_URL.replace(/https:\/\/([^.]+).*/, 'https://$1***') : null,
    redisInCooldown: isRedisInCooldown(),
    redisCooldownRemain: isRedisInCooldown()
      ? Math.round((redisCooldownUntil - Date.now()) / 1000)
      : 0,
  };
}
