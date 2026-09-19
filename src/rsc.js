/**
 * Next.js RSC 流解析器
 * @module rsc
 */

/**
 * 解析 RSC 流文本
 */
export function parseRSC(text) {
  if (!text || typeof text !== 'string') return [];

  const lines = text.split('\n');
  const chunks = [];
  let currentKey = null;
  let currentContent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\d+):\s*(.*)$/);
    if (match) {
      if (currentContent !== null) {
        chunks.push({ key: currentKey, content: currentContent });
      }
      currentKey = match[1];
      currentContent = match[2];
    } else if (currentContent !== null) {
      currentContent += '\n' + line;
    }
  }

  if (currentContent !== null) {
    chunks.push({ key: currentKey, content: currentContent });
  }

  const results = [];
  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(chunk.content);
      if (Array.isArray(parsed) && parsed.length >= 4) {
        results.push(parsed[parsed.length - 1]);
      } else if (typeof parsed === 'object' && parsed !== null) {
        results.push(parsed);
      }
    } catch {
      // 忽略解析失败
    }
  }

  return results;
}

/**
 * 从 RSC 流提取分类目录
 * 实际路径: payload.videoList.data.list
 */
export function parseCatalog(text) {
  const payloads = parseRSC(text);
  for (const payload of payloads) {
    if (payload?.videoList?.data?.list) {
      return payload.videoList.data.list;
    }
    if (payload?.data?.list) return payload.data.list;
    if (Array.isArray(payload?.list)) return payload.list;
  }
  return null;
}

/**
 * 从 RSC 流提取影片详情
 * 实际路径: payload.data.data
 */
export function parseDetail(text) {
  const payloads = parseRSC(text);
  for (const payload of payloads) {
    // 主格式: { data: { data: { vodId, ... } } }
    if (payload?.data?.data?.vodId) {
      return payload.data.data;
    }
    // 兼容其他格式
    if (payload?.data?.vodId) return payload.data;
    if (payload?.vodId) return payload;
  }
  return null;
}

/**
 * 从详情中提取剧集列表
 * 说明：
 * - 电影：episodeList = [{ nid, name: "蓝光" }]（只有一条）
 * - 剧集：episodeList = [{ nid, name: "1" }, { nid, name: "2" }, ...]
 * 
 * @param {Object} detail - 从 parseDetail 拿到的详情对象
 * @returns {Array<{nid: string, name: string}>}
 */
export function extractEpisodes(detail) {
  if (!detail) return [];

  const episodeList = detail.episodeList;
  if (!Array.isArray(episodeList) || episodeList.length === 0) {
    return [];
  }

  return episodeList.map(item => ({
    nid: String(item.nid || ''),
    name: String(item.name || ''),
  })).filter(ep => ep.nid);
}