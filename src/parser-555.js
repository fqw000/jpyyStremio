/**
 * 555 电影站 HTML 解析器
 *
 * 纯字符串处理，无网络、无缓存、无副作用
 * 所有函数均接收原始 HTML，返回结构化对象
 *
 * @module parser-555
 */

// ==========================================
// 工具函数
// ==========================================

/**
 * 清理 HTML 标签并压缩空白
 */
function cleanHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从名称中提取集数数字
 * 支持 "第1集"、"1"、"EP01"、"01" 等格式
 *
 * 导出供 adapter-555.js 复用
 */
export function extractEpisodeNumber(name) {
  if (!name) return NaN;
  const m = String(name).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}


// ==========================================
// 分类页解析
// ==========================================

/**
 * 解析分类页 HTML，提取影片卡片列表
 *
 * 卡片结构：
 *   <a href="/vod/detail/id/X.html" title="名" class="module-poster-item module-item">
 *     ...<div class="module-item-note">备注</div>
 *     ...<img ... data-original="真图" ... src="占位gif">
 *
 * @param {string} html
 * @returns {Array<{vodId: string, vodName: string, vodPic: string, vodRemarks: string}>}
 */
export function parseCatalog555(html) {
  if (!html) return [];

  const list = [];
  const seen = new Set();

  const re = /<a href="(\/vod\/detail\/id\/([^\/"]+)\.html)"\s+title="([^"]*)"[^>]*>[\s\S]{0,600}?<div class="module-item-note">([^<]*)<\/div>[\s\S]{0,600}?data-original="([^"]+)"/g;

  let m;
  while ((m = re.exec(html)) !== null) {
    const vodId = m[2];
    if (seen.has(vodId)) continue;
    seen.add(vodId);

    list.push({
      vodId,
      vodName: cleanHtml(m[3]),
      vodPic: m[5].trim(),
      vodRemarks: cleanHtml(m[4]),
    });
  }

  return list;
}

// ==========================================
// 详情页解析
// ==========================================

/**
 * 解析详情页 HTML，提取影片完整信息
 *
 * @param {string} html
 * @returns {{
 *   vodName: string,
 *   vodPic: string,
 *   vodContent: string,
 *   vodDirector: string,
 *   vodActor: string,
 *   vodYear: string,
 *   vodArea: string,
 *   vodClass: string,
 *   vodRemarks: string
 * } | null}
 */
export function parseDetail555(html) {
  if (!html) return null;

  const detail = {
    vodName: '',
    vodPic: '',
    vodContent: '',
    vodDirector: '',
    vodActor: '',
    vodYear: '',
    vodArea: '',
    vodClass: '',
    vodRemarks: '',
  };

  // ===== 标题 =====
  let m = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  if (m) detail.vodName = cleanHtml(m[1]);

  // ===== 海报 =====
  m = html.match(/module-info-poster[\s\S]{0,500}?data-original="([^"]+)"/);
  if (m) detail.vodPic = m[1].trim();

  // ===== 元信息（导演/主演/年份/地区/类型/备注）=====
  // 结构：<span class="module-info-item-title">导演：</span><div ...>值</div>
  const infoRe = /<span[^>]*class="module-info-item-title"[^>]*>([^<]*)<\/span>([\s\S]{0,400}?)(?=<span[^>]*class="module-info-item-title"|<\/div>\s*<\/div>\s*<\/div>)/g;
  let im;
  while ((im = infoRe.exec(html)) !== null) {
    const key = im[1].replace(/[：:]\s*$/, '').trim();
    const val = cleanHtml(im[2]).replace(/\/$/, '').trim();
    if (!val) continue;

    if (key === '导演') detail.vodDirector = val;
    else if (key === '主演' || key === '声优') detail.vodActor = val;
    else if (key === '年份') detail.vodYear = val;
    else if (key === '地区') detail.vodArea = val;
    else if (key === '类型' || key === '分类') detail.vodClass = val;
    else if (key === '备注') detail.vodRemarks = val;
  }

  // ===== 简介 =====
  m = html.match(/module-info-introduction-content[^>]*>\s*<p>([\s\S]*?)<\/p>/);
  if (m) {
    detail.vodContent = cleanHtml(m[1]);
  }
  // 兜底：meta description
  if (!detail.vodContent) {
    m = html.match(/<meta\s+name="description"\s+content="([\s\S]*?)"\s*>/);
    if (m) {
      let desc = cleanHtml(m[1]);
      const pi = desc.indexOf('剧情:');
      if (pi >= 0) desc = desc.substring(pi + 3).trim();
      detail.vodContent = desc;
    }
  }

  // 名称都拿不到，视为解析失败
  if (!detail.vodName) return null;

  return detail;
}

// ==========================================
// 剧集列表解析
// ==========================================

/**
 * 解析详情页的剧集列表（按源分组）
 *
 * 返回结构：
 *   [
 *     {
 *       sid: '1',
 *       name: '线路1',
 *       episodes: [
 *         { nid: '1', name: '第01集' },
 *         { nid: '2', name: '第02集' },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 *
 * 注意：
 *   - 同一 vod 的不同源，同一集的 nid 可能相同也可能不同
 *   - 按源分组后，每个源内部按集数排序
 *
 * @param {string} html
 * @returns {Array<{sid: string, name: string, episodes: Array<{nid: string, name: string}>}>}
 */
export function parseEpisodes555(html) {
  if (!html) return [];

  // ===== 1. 提取源名称（按出现顺序）=====
  const sourceNames = [];
  const sourceNameSeen = new Set();
  const tabRe = /data-dropdown-value="([^"]+)"/g;
  let tm;
  while ((tm = tabRe.exec(html)) !== null) {
    const name = cleanHtml(tm[1]);
    if (name && !sourceNameSeen.has(name)) {
      sourceNameSeen.add(name);
      sourceNames.push(name);
    }
  }

  // ===== 2. 提取所有剧集条目，按 sid 分组 =====
  const sourceMap = new Map(); // sid → { sid, name, episodes: [] }
  const re = /href="\/vod\/play\/id\/[^\/"]+\/sid\/(\d+)\/nid\/(\d+)\.html"[^>]*>[\s\S]{0,200}?<span>([^<]*)<\/span>/g;
  let em;
  while ((em = re.exec(html)) !== null) {
    const sid = em[1];
    const nid = em[2];
    const name = cleanHtml(em[3]);
    if (!sid || !nid || !name) continue;

    if (!sourceMap.has(sid)) {
      sourceMap.set(sid, { sid, name: '', episodes: [] });
    }
    sourceMap.get(sid).episodes.push({ nid, name });
  }

  // ===== 3. 为每个源分配名称 =====
  // sid 通常是 1,2,3... 按数字排序
  const sourceList = Array.from(sourceMap.values()).sort(
    (a, b) => parseInt(a.sid, 10) - parseInt(b.sid, 10)
  );

  sourceList.forEach((src, index) => {
    // 源名称优先级：tab 名称 > 兜底"线路N"
    src.name = sourceNames[index] || `线路${index + 1}`;

    // 源内部按集数排序
    src.episodes.sort((a, b) => {
      const na = extractEpisodeNumber(a.name);
      const nb = extractEpisodeNumber(b.name);
      const aNaN = isNaN(na);
      const bNaN = isNaN(nb);
      if (aNaN && bNaN) return a.name.localeCompare(b.name);
      if (aNaN) return 1;
      if (bNaN) return -1;
      return na - nb;
    });
  });

  return sourceList;
}

/**
 * 从详情页 HTML 中提取线路名称列表
 * 通常第一个线路是最优的
 *
 * @param {string} html
 * @returns {string[]}
 */
export function parseRouteNames555(html) {
  if (!html) return [];

  const names = [];
  const re = /data-dropdown-value="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = cleanHtml(m[1]);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

// ==========================================
// 播放页解析
// ==========================================

/**
 * 解析播放页，提取真实播放地址
 *
 * 页面结构：
 *   <script>var player_aaaa = {"encrypt": 0|1|2, "url": "...", "from": "..."}</script>
 *
 * encrypt 说明：
 *   0 → URL 明文
 *   1 → base64
 *   2 → base64 → urldecode
 *
 * @param {string} html
 * @returns {string} 真实播放地址，解析失败返回空字符串
 */
export function parsePlayerUrl555(html) {
  if (!html) return '';

  // ===== 提取 player_aaaa =====
  const um = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/)
    || html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);

  if (!um) return '';

  let pd;
  try {
    pd = JSON.parse(um[1]);
  } catch (e) {
    return '';
  }
  if (!pd || !pd.url) return '';

  const raw = String(pd.url);
  const enc = parseInt(pd.encrypt || 0, 10);

  // ===== 解密 =====
  let real = '';

  if (enc === 2) {
    // base64 → urldecode
    real = safeBase64Decode(raw);
    if (real) {
      try { real = decodeURIComponent(real); } catch (e) { /* 保持原样 */ }
    }
  } else if (enc === 1) {
    // base64
    real = safeBase64Decode(raw);
  } else {
    // 明文
    real = raw;
  }

  // ===== 校验 =====
  if (/^https?:\/\//.test(real)) return real;
  if (/^https?:\/\//.test(raw)) return raw;

  return '';
}

/**
 * 安全的 Base64 解码
 * 兼容 Node.js / 浏览器 / Vercel Edge / Cloudflare Workers
 */
function safeBase64Decode(str) {
  if (!str) return '';
  try {
    // 清洗非法字符
    const cleaned = String(str).replace(/[^A-Za-z0-9+/=]/g, '');

    if (typeof atob === 'function') {
      // 浏览器 / Vercel Edge / Cloudflare Workers 都有 atob
      const binary = atob(cleaned);
      // 转 UTF-8（处理中文等多字节字符）
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }

    // Node.js 兜底
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(cleaned, 'base64').toString('utf-8');
    }
  } catch (e) {
    // 忽略
  }
  return '';
}