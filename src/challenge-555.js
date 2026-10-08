/**
 * 555 站点 JS 反爬挑战求解器
 *
 * 挑战形式：
 *   var C="5971483.31c722db25b288157883b1a012d3ada5",D=3,P="000";
 *   暴力搜索 n，使 md5(C+":"+n) 前 D 位 === P
 *   成功后设 cookie: __vgp={prefix}.{n}
 *   服务端验证后 Set-Cookie: __vg={hash}
 *
 * @module challenge-555
 */

import { Hash } from './helper.js';
import { getCache, setCache } from './cache.js';

// ==========================================
// 常量
// ==========================================

/** Redis key：缓存解出的 cookie */
const COOKIE_CACHE_KEY = '555:challenge:cookie';

/** Cookie 缓存 TTL（秒）。__vgp 有效期 600s，这里取 400s 留余量 */
const COOKIE_CACHE_TTL = 400;

/** 暴力搜索上限（与挑战脚本一致） */
const MAX_N = 8000000;

// ==========================================
// 检测与解析
// ==========================================

/**
 * 判断响应 HTML 是否是挑战页
 */
export function isChallenge(html) {
  if (!html) return false;
  return /var\s+C\s*=\s*"[^"]+"\s*,\s*D\s*=\s*\d+\s*,\s*P\s*=\s*"[^"]*"/.test(html);
}

/**
 * 从挑战页 HTML 提取参数
 * 
 * @returns {{C: string, D: number, P: string} | null}
 */
export function parseChallenge(html) {
  if (!html) return null;

  const m = html.match(/var\s+C\s*=\s*"([^"]+)"\s*,\s*D\s*=\s*(\d+)\s*,\s*P\s*=\s*"([^"]*)"/);
  if (!m) return null;

  return {
    C: m[1],
    D: parseInt(m[2], 10),
    P: m[3],
  };
}

// ==========================================
// 求解
// ==========================================

/**
 * 求解挑战：暴力搜索 n
 * 
 * @param {string} C - 完整挑战串（含 "."）
 * @param {number} D - 前几位
 * @param {string} P - 匹配目标
 * @returns {{ n: number, vgp: string, iterations: number } | null}
 */
export function solveChallenge(C, D, P) {
  if (!C || !D || P === undefined || P === null) return null;

  const prefix = String(C).split('.')[0];
  const target = String(P).toLowerCase();
  const startTime = Date.now();
  const maxIter = Math.min(MAX_N, Math.pow(16, D) * 4); // 理论上限：16^D 期望 4 倍

  let n = 0;
  let found = false;

  for (; n < maxIter; n++) {
    const h = Hash.md5(C + ':' + n);
    if (h.slice(0, D) === target) {
      found = true;
      break;
    }
  }

  const elapsed = Date.now() - startTime;

  if (!found) {
    console.warn(`[555 挑战] ❌ 未找到解（迭代 ${maxIter} 次，耗时 ${elapsed}ms）`);
    return null;
  }

  return {
    n,
    vgp: `${prefix}.${n}`,
    iterations: n + 1,
    elapsed,
  };
}

// ==========================================
// Cookie 缓存
// ==========================================

/**
 * 从 Redis 读取缓存的 cookie
 * 
 * @returns {Promise<{ vgp: string, vg: string } | null>}
 */
export async function getCachedCookie() {
  const cached = await getCache(COOKIE_CACHE_KEY);
  if (cached && cached.vgp) {
    return cached;
  }
  return null;
}

/**
 * 写入 cookie 到 Redis
 */
export async function setCachedCookie(vgp, vg) {
  await setCache(COOKIE_CACHE_KEY, { vgp, vg }, COOKIE_CACHE_TTL);
}

/**
 * 清除缓存（调试用）
 */
export async function clearCookieCache() {
  await setCache(COOKIE_CACHE_KEY, null, 1);
}

// ==========================================
// 从响应头提取 __vg
// ==========================================

/**
 * 从响应头里提取 `Set-Cookie: __vg=xxx`
 * 
 * @param {Response} resp
 * @returns {string | null}
 */
export function extractVgFromResponse(resp) {
  try {
    const setCookie = resp.headers.get('set-cookie');
    if (!setCookie) return null;

    const m = setCookie.match(/__vg=([^;,\s]+)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * 组装 Cookie 头
 */
export function buildCookieHeader(vgp, vg) {
  const parts = [];
  if (vgp) parts.push(`__vgp=${vgp}`);
  if (vg) parts.push(`__vg=${vg}`);
  return parts.join('; ');
}