/**
 * Vercel Edge Function 入口
 * 
 * 职责：
 * - 为所有日志自动添加时间戳
 * - 转交请求给 src/handler.js 处理
 * 
 * @module api/index
 */

// ==========================================
// 全局日志时间戳补丁（只执行一次）
// ==========================================

if (!globalThis.__logPatched) {
  globalThis.__logPatched = true;

  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _error = console.error.bind(console);

  const ts = () => {
    const d = new Date();
    // 时:分:秒.毫秒
    return `[${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}]`;
  };

  console.log = (...args) => _log(ts(), ...args);
  console.warn = (...args) => _warn(ts(), ...args);
  console.error = (...args) => _error(ts(), ...args);
}

// ==========================================
// Vercel Edge Runtime 配置
// ==========================================

export const config = {
  runtime: 'edge',
};

// ==========================================
// 主入口
// ==========================================

import handler from '../src/handler.js';

export default async function vercelHandler(request) {
  return await handler.fetch(request, process.env, null);
}
