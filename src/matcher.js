/**
 * 多信号加权匹配器
 * 
 * 信号：
 *   - 标题相似度：归一化 → 分词 Jaccard + 拼音辅助
 *   - 演员交集：强校验
 *   - 年份相似度：软校验（剧集优先用目标季年份）
 *   - 季数硬门槛：候选标注季且不等 → 淘汰
 * 
 * @module matcher
 */

import { pinyin } from 'pinyin-pro';

// ==========================================
// 标题归一化
// ==========================================

const NOISE_WORDS = [
  '国语', '粤语', '英语', '双语', '原声', '普通话',
  '中字', '中文字幕', '简体', '繁体', '简繁', '繁中',
  '高清', '超清', '蓝光', '完整版', '未删减', '加长版', '导演剪辑版',
  'bluray', 'blu-ray', 'hdtv', 'webrip', 'web-dl', 'webdl',
  'hdrip', 'dvdrip', 'remux', 'hevc', 'x264', 'x265',
];

export function normalizeTitle(title) {
  if (!title) return '';
  let s = String(title).toLowerCase();

  // 全角 → 半角
  s = s.replace(/[\uff01-\uff5e]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );

  // 移除括号内容
  s = s.replace(/[（(【\[《][^）)】\]》]*[）)】\]》]/g, ' ');

  // 移除季标记
  s = s.replace(/第\s*[一二三四五六七八九十百\d]+\s*[季部]/g, ' ');
  s = s.replace(/season\s*\d+/gi, ' ');
  s = s.replace(/\bs\d+\b/gi, ' ');

  // 移除噪声词
  for (const w of NOISE_WORDS) s = s.split(w).join(' ');

  // 只保留中文 / 英文 / 数字
  s = s.replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');

  return s.replace(/\s+/g, ' ').trim();
}

// ==========================================
// 拼音
// ==========================================

/**
 * 转无声调拼音，只保留字母数字
 */
export function toPinyin(text) {
  if (!text) return '';
  try {
    const result = pinyin(text, { toneType: 'none' });
    return String(result).toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch {
    return '';
  }
}

// ==========================================
// 分词 + 集合相似度
// ==========================================

export function tokenize(text) {
  const tokens = new Set();
  if (!text) return tokens;

  const latin = text.match(/[a-z]+|\d+/g) || [];
  for (const m of latin) tokens.add(m);

  const cn = text.match(/[\u4e00-\u9fa5]/g) || [];
  if (cn.length === 1) {
    tokens.add(cn[0]);
  } else {
    for (let i = 0; i < cn.length - 1; i++) {
      tokens.add(cn[i] + cn[i + 1]);
    }
  }
  return tokens;
}

function charBigram(s) {
  const tokens = new Set();
  if (!s) return tokens;
  if (s.length === 1) {
    tokens.add(s);
    return tokens;
  }
  for (let i = 0; i < s.length - 1; i++) {
    tokens.add(s.slice(i, i + 2));
  }
  return tokens;
}

export function jaccard(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of small) if (large.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ==========================================
// 标题相似度
// ==========================================

export function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;

  // 包含关系
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length >= nb.length ? na : nb;
    const ratio = shorter.length / longer.length;
    return Math.max(0.85 * ratio + 0.15, 0.75);
  }

  // 原文 Jaccard
  const baseSim = jaccard(tokenize(na), tokenize(nb));
  if (baseSim >= 0.7) return baseSim;

  // 拼音补充（打折，因为同音字多）
  const pa = toPinyin(na);
  const pb = toPinyin(nb);
  if (pa && pb) {
    const pinyinSim = pa === pb ? 1.0 : jaccard(charBigram(pa), charBigram(pb));
    return Math.max(baseSim, pinyinSim * 0.85);
  }

  return baseSim;
}

export function bestTitleSimilarity(targetTitles, candidateTitle) {
  if (!targetTitles || targetTitles.length === 0) return 0;
  let best = 0;
  for (const t of targetTitles) {
    const sim = titleSimilarity(t, candidateTitle);
    if (sim > best) best = sim;
  }
  return best;
}

// ==========================================
// 演员
// ==========================================

/**
 * 归一化人名：中文转拼音，其他降级为字母数字
 */
export function normalizeName(name) {
  if (!name) return '';
  const s = String(name).toLowerCase().replace(/\s+/g, '');
  if (/[\u4e00-\u9fa5]/.test(s)) {
    return toPinyin(s);
  }
  return s.replace(/[^a-z0-9]/g, '');
}

export function parseCastString(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str.map(s => String(s).trim()).filter(Boolean);
  return String(str)
    .split(/[,，、\/|]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function castSimilarity(targetCast, candidateCast) {
  if (!targetCast || !candidateCast) return 0;
  if (targetCast.length === 0 || candidateCast.length === 0) return 0;

  const tSet = new Set();
  for (const n of targetCast.slice(0, 12)) {
    const norm = normalizeName(n);
    if (norm) tSet.add(norm);
  }
  const cSet = new Set();
  for (const n of candidateCast.slice(0, 20)) {
    const norm = normalizeName(n);
    if (norm) cSet.add(norm);
  }
  if (tSet.size === 0 || cSet.size === 0) return 0;

  let inter = 0;
  for (const n of tSet) if (cSet.has(n)) inter++;
  return inter / tSet.size;
}

// ==========================================
// 年份
// ==========================================

export function yearSimilarity(targetYear, candidateYear) {
  if (!targetYear || !candidateYear) return 0;
  const diff = Math.abs(targetYear - candidateYear);
  if (diff === 0) return 1.0;
  if (diff === 1) return 0.7;
  if (diff === 2) return 0.4;
  if (diff === 3) return 0.15;
  return 0;
}

// ==========================================
// 季数提取
// ==========================================

const CN_NUM = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

export function extractSeasonNumber(title) {
  if (!title) return null;
  const s = String(title);

  const cn = s.match(/第([一二三四五六七八九十])季/);
  if (cn) return CN_NUM[cn[1]] || null;

  const num = s.match(/第\s*(\d+)\s*季/);
  if (num) return parseInt(num[1], 10);

  const en = s.match(/season\s*(\d+)/i);
  if (en) return parseInt(en[1], 10);

  const sn = s.match(/\bS(\d{1,2})\b/);
  if (sn) {
    const n = parseInt(sn[1], 10);
    if (n >= 1 && n < 100) return n;
  }
  return null;
}

// ==========================================
// 权重 & 阈值
// ==========================================

export const WEIGHTS = {
  movie:  { title: 0.50, cast: 0.35, year: 0.15 },
  series: { title: 0.50, cast: 0.35, year: 0.15 },
};

export const THRESHOLDS = {
  MIN_TITLE_SIM: 0.35,
  MIN_FINAL_SCORE: 0.55,
  CAST_MISMATCH_TITLE_FLOOR: 0.80,
  SEASON_MATCH_BONUS: 0.10,
};

// ==========================================
// 综合打分
// ==========================================

/**
 * 对单个候选打分
 * 
 * @param {Object} target
 * @param {string[]} target.titles     - 候选标题（别名数组）
 * @param {number}   target.year       - 整剧首播年（备用）
 * @param {number}   target.seasonYear - 目标季播出年（优先）
 * @param {number}   target.season     - 目标季号（剧集）
 * @param {string[]} target.cast       - 演员列表
 * @param {string}   target.type       - 'movie' | 'series'
 * 
 * @param {Object} candidate
 * @param {string}   candidate.title
 * @param {number}   candidate.year
 * @param {string[]} candidate.cast
 * 
 * @param {Object} [options]
 * @param {number}  [options.minTitleSim]
 * @param {boolean} [options.skipCastCheck]
 */
export function scoreCandidate(target, candidate, options = {}) {
  const minTitleSim = options.minTitleSim ?? THRESHOLDS.MIN_TITLE_SIM;
  const skipCastCheck = options.skipCastCheck ?? false;
  const w = WEIGHTS[target.type] || WEIGHTS.movie;

  // ===== 1. 标题 =====
  const titleSim = bestTitleSimilarity(target.titles, candidate.title);
  if (titleSim < minTitleSim) {
    return { score: 0, titleSim, castSim: 0, yearSim: 0,
             rejected: true, reason: 'title_below_min' };
  }

  // ===== 2. 季数硬门槛（剧集）=====
  // 站内每季是独立 vodId，选错季后果严重 → 硬淘汰
  // 候选未标季 → 保持中立（可能是单季剧/合并 vodId）
  let seasonBonus = 0;
  if (target.type === 'series' && target.season != null) {
    const candSeason = extractSeasonNumber(candidate.title);
    if (candSeason != null) {
      if (candSeason !== target.season) {
        return {
          score: 0, titleSim, castSim: 0, yearSim: 0,
          rejected: true,
          reason: `season_mismatch(${candSeason}≠${target.season})`,
        };
      }
      seasonBonus = THRESHOLDS.SEASON_MATCH_BONUS;
    }
  }

  // ===== 3. 演员（强校验）=====
  let castSim = 0;
  let castEvaluated = false;
  if (!skipCastCheck && target.cast?.length > 0 && candidate.cast?.length > 0) {
    castSim = castSimilarity(target.cast, candidate.cast);
    castEvaluated = true;
    if (castSim === 0 && titleSim < THRESHOLDS.CAST_MISMATCH_TITLE_FLOOR) {
      return {
        score: 0, titleSim, castSim, yearSim: 0,
        rejected: true, reason: 'cast_mismatch',
      };
    }
  }

  // ===== 4. 年份（剧集优先 seasonYear）=====
  const targetYear = (target.type === 'series' && target.seasonYear != null)
    ? target.seasonYear
    : target.year;

  let yearSim = 0;
  let yearEvaluated = false;
  if (targetYear != null && candidate.year != null) {
    yearSim = yearSimilarity(targetYear, candidate.year);
    yearEvaluated = true;
  }

  // ===== 5. 加权归一化 =====
  const signals = [{ score: titleSim, weight: w.title }];
  if (castEvaluated) signals.push({ score: castSim, weight: w.cast });
  if (yearEvaluated) signals.push({ score: yearSim, weight: w.year });

  const totalW = signals.reduce((s, x) => s + x.weight, 0);
  const weighted = signals.reduce((s, x) => s + x.score * x.weight, 0);
  let score = totalW > 0 ? weighted / totalW : 0;

  // 季数匹配奖励
  score = Math.min(1, score + seasonBonus);

  return {
    score, titleSim, castSim, yearSim,
    castEvaluated, yearEvaluated, seasonBonus,
    rejected: false, reason: 'ok',
  };
}