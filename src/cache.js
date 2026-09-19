/**
 * 缓存（内存 + Upstash Redis 双层）
 * 
 * 分层策略：
 * - L1: 内存缓存（最快，实例级，命中率低）
 * - L2: Upstash Redis（跨实例，< 10ms）
 * 
 * 读取流程：
 * getCache() → L1 命中返回 → L2 命中写回 L1 返回 → 都未命中返回 null
 * 
 * 写入流程：
 * setCache() → 写 L1 → 写 L2（异步，不阻塞）
 * 
 * @module cache
 */

/** L1: 内存缓存 */
const memCache = new Map();

/** L1 最大条目数 */
const MAX_MEM_SIZE = 200;

/** L1 缓存时长（秒），比 L2 短 */
const L1_TTL = 60;

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

if (REDIS_ENABLED) {
  console.log(`[Cache] ✅ Upstash Redis 已启用`);
} else {
  console.warn(`[Cache] ⚠️ Upstash 未配置，仅使用内存缓存`);
}

// ==========================================
// Upstash REST API
// ==========================================

/**
 * 执行 Redis 命令
 * 
 * 使用 Upstash REST API 的批处理格式：
 * POST {URL}
 * Body: ["SET", "key", "value", "EX", 3600]
 * 
 * @param {...string|number} args - Redis 命令参数
 * @returns {Promise<any>} 命令结果
 */
async function redisCommand(...args) {
  if (!REDIS_ENABLED) return null;

  try {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      console.warn(`[Cache] Redis 命令失败: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.result;
  } catch (err) {
    console.warn(`[Cache] Redis 命令异常: ${err.message}`);
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
    console.log(`[Cache] ✅ L1 HIT: ${key}`);
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
        console.warn(`[Cache] JSON 解析失败: ${err.message}`);
      }
    }
  }

  console.log(`[Cache] ❌ MISS: ${key}`);
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
    try {
      await redisCommand('SET', key, JSON.stringify(data), 'EX', ttlSeconds);
      console.log(`[Cache] ✅ L2 WRITE: ${key} (ttl=${ttlSeconds}s)`);
    } catch (err) {
      console.warn(`[Cache] L2 写入失败: ${err.message}`);
    }
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
 * 缓存状态
 */
export function getCacheStats() {
  return {
    l1Size: memCache.size,
    l1Keys: [...memCache.keys()].slice(0, 20),
    l2Enabled: REDIS_ENABLED,
    l2Url: UPSTASH_URL ? UPSTASH_URL.replace(/https:\/\/([^.]+).*/, 'https://$1***') : null,
  };
}
