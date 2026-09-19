/**
 * HTTP 客户端
 * @module http
 */
import { CONFIG, DEFAULT_HEADERS } from './config.js';
import { Utils } from './helper.js';

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url, options = {}, timeout = CONFIG.REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * GET 请求返回文本
 */
export async function getText(url, headers = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { ...DEFAULT_HEADERS, ...headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < CONFIG.RETRY_COUNT) {
        await Utils.sleep(CONFIG.RETRY_DELAY * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

/**
 * GET 请求返回 JSON
 */
export async function getJson(url, headers = {}) {
  const text = await getText(url, headers);
  return JSON.parse(text);
}