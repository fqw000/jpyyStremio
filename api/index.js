/**
 * Vercel Edge Function 入口
 * 
 * 与 Cloudflare Workers 的差异：
 * - 使用 `export const config = { runtime: 'edge' }` 声明 Edge Runtime
 * - 使用 `export default async function handler(request)` 代替 `export default { fetch }`
 * - 环境变量从 `process.env` 读取（而不是 env 参数）
 * 
 * @module api/index
 */

// 导入主处理逻辑
import handler from '../src/handler.js';

// 声明使用 Edge Runtime（V8 isolate，和 Cloudflare Workers 一致）
export const config = {
  runtime: 'edge',
};

/**
 * Vercel Edge Function 主入口
 * 
 * @param {Request} request - 标准 Web Request 对象
 * @returns {Promise<Response>} 标准 Web Response 对象
 */
export default async function vercelHandler(request) {
  // Vercel Edge Runtime 与 Cloudflare Workers 的 fetch 签名一致
  // 直接复用原有 handler
  return await handler.fetch(request, process.env, null);
}