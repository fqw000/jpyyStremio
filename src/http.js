/**
 * HTTP 客户端
 * 
 * 特性：
 * - 超时控制（默认 8 秒）
 * - 失败重试（超时和 403 不重试）
 * - 详细的调试日志（含请求 URL）
 * 
 * @module http
 */
import { CONFIG, DEFAULT_HEADERS } from './config.js';
import { Utils } from './helper.js';

/**
 * 带超时的 fetch
 * 
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {number} timeout - 超时毫秒数
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = CONFIG.REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const startTime = Date.now();

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - startTime;
    console.log(`[HTTP] ✅ ${res.status} (${elapsed}ms)`);
    return res;
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - startTime;
    console.error(`[HTTP] ❌ ${err.name}: ${err.message} (${elapsed}ms)`);
    throw err;
  }
}

/**
 * GET 请求返回文本
 * 
 * 重试策略：
 * - 超时（AbortError）→ 不重试
 * - 403 → 不重试
 * - 其他错误 → 重试
 * 
 * @param {string} url - 请求 URL
 * @param {Object} headers - 请求头
 * @returns {Promise<string>}
 */
export async function getText(url, headers = {}) {
  const mergedHeaders = { ...DEFAULT_HEADERS, ...headers };
  let lastErr;

  for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
    try {
      // ===== 请求 URL 日志（关键）=====
      console.log(`[HTTP] 🌐 ${url}${attempt > 0 ? ` (retry ${attempt})` : ''}`);

      const res = await fetchWithTimeout(url, {
        headers: mergedHeaders,
        redirect: 'follow',
      });

      if (!res.ok) {
        if (res.status === 403) {
          console.error(`[HTTP] ⛔ 403 Forbidden，不重试`);
          throw new Error(`HTTP 403 Forbidden`);
        }
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.text();
    } catch (err) {
      lastErr = err;

      if (err.name === 'AbortError') {
        console.log(`[HTTP] ⏱️ 超时，不重试`);
        throw err;
      }

      if (err.message.includes('403')) {
        throw err;
      }

      if (attempt < CONFIG.RETRY_COUNT) {
        console.log(`[HTTP] ⏳ ${CONFIG.RETRY_DELAY}ms 后重试...`);
        await Utils.sleep(CONFIG.RETRY_DELAY);
      }
    }
  }

  throw lastErr;
}

/**
 * GET 请求返回 JSON
 * 
 * @param {string} url - 请求 URL
 * @param {Object} headers - 请求头
 * @returns {Promise<Object>}
 */
export async function getJson(url, headers = {}) {
  const text = await getText(url, headers);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[HTTP] ❌ JSON 解析失败: ${e.message}`);
    throw e;
  }
}
