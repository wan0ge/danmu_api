import { globals } from '../configs/globals.js';
import { log } from './log-util.js';
import { normalizeSpaces } from './common-util.js';
import { addAnime } from './cache-util.js';
import { simplized } from '../utils/zh-util.js';

// =====================
// 源合并处理工具
// =====================

// 定义组合ID的分隔符 (URL Safe)
export const MERGE_DELIMITER = '$$$';
// 定义前端显示的源连接符
export const DISPLAY_CONNECTOR = '&';

/**
 * 文本清洗工具函数
 * 将文本转为简体，移除干扰标识，并对季数、章节进行标准化处理，用于提高匹配精度
 * @param {string} text 原始文本
 * @returns {string} 清洗后的文本
 */
function cleanText(text) {
  if (!text) return '';
  // 繁体转简体
  let clean = simplized(text);
  // 语义标准化：The Final Season -> 最终季
  clean = clean.replace(/(?:The\s+)?Final\s+Season/gi, '最终季');
  // 季数标准化：Season 2, S2 -> 第2季
  clean = clean.replace(/(?:Season|S)\s*(\d+)/gi, '第$1季');
  // 中文数字标准化：第二季 -> 第2季
  const cnNums = {'一':'1', '二':'2', '三':'3', '四':'4', '五':'5', '六':'6', '七':'7', '八':'8', '九':'9', '十':'10'};
  clean = clean.replace(/第([一二三四五六七八九十])季/g, (m, num) => `第${cnNums[num]}季`);
  // 章节Part标准化：Part.2, Part 2, P2 -> 第2部分
  clean = clean.replace(/(?:Part|P)[\s.]*(\d+)/gi, '第$1部分');
  // 罗马数字标准化：III -> 第3季 (仅匹配单词边界)
  clean = clean.replace(/(\s|^)(IV|III|II|I)(\s|$)/g, (match, p1, roman, p2) => {
      const rMap = {'I':'1', 'II':'2', 'III':'3', 'IV':'4'};
      return `${p1}第${rMap[roman]}季${p2}`;
  });
  // 配音版本的标准化
  clean = clean.replace(/(\(|（)?(普通话|国语|中文配音|中配)版?(\)|）)?/g, '中配版');
  clean = clean.replace(/(\(|（)?(日语|日配|原版)版?(\)|）)?/g, '');
  // 移除源标识如 【dandan】
  clean = clean.replace(/【.*?】/g, '');
  // 移除地区限制标识如 (仅限台湾地区)
  clean = clean.replace(/(\(|（)仅限.*?地区(\)|）)/g, '');
  // 移除常见标点符号 (避免 "不行！" 和 "不行。" 被判为不同)
  clean = clean.replace(/[!！?？,，.。、~～:：\-–—]/g, ' ');
  // 压缩空格并转小写
  return clean.replace(/\s+/g, ' ').toLowerCase().trim();
}

/**
 * 移除标题中的所有括号内容
 * 用于提取主标题进行比对，规避副标题翻译差异（如：(※不是不可能！？) vs (※似乎可行？)）
 * @param {string} text 清洗后的文本
 * @returns {string} 移除括号后的文本
 */
function removeParentheses(text) {
  if (!text) return '';
  // 移除 () 和 （） 及其内部的所有内容
  return text.replace(/(\(|（).*?(\)|）)/g, '').trim();
}

/**
 * 清洗并提取真实的 ID/URL
 * 用于从组合或带前缀的字符串中还原出原始的请求 ID
 * @param {string} urlStr 原始 URL 字符串
 * @returns {string} 清洗后的 ID 或 完整 URL
 */
function sanitizeUrl(urlStr) {
  if (!urlStr) return '';
  
  // 去除可能存在的组合后缀，只取当前部分
  let clean = String(urlStr).split(MERGE_DELIMITER)[0].trim();

  // 自动修复被错误截断协议头的 URL
  if (clean.startsWith('//')) {
    return 'https:' + clean;
  }

  // 尝试解析 "source:id" 格式
  const match = clean.match(/^([^:]+):(.+)$/);
  if (match) {
    const prefix = match[1].toLowerCase();
    const body = match[2];

    // 如果前缀是 http/https，说明是原始 URL，保留
    if (prefix === 'http' || prefix === 'https') {
      return clean;
    }

    // 如果 body 是 http 开头，直接返回
    if (/^https?:\/\//i.test(body)) {
      return body;
    }
    
    // 如果 body 是 // 开头，自动补全协议
    if (body.startsWith('//')) {
      return 'https:' + body;
    }

    // 普通 ID
    return body;
  }

  return clean;
}

/**
 * 解析日期字符串为对象
 * @param {string} dateStr 日期字符串
 * @returns {Object} { year: number|null, month: number|null }
 */
function parseDate(dateStr) {
  if (!dateStr) return { year: null, month: null };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { year: null, month: null };
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1
  };
}

/**
 * 计算编辑距离 (Levenshtein Distance)
 * 用于衡量两个字符串的差异程度（对顺序敏感）
 * @param {string} s1 字符串1
 * @param {string} s2 字符串2
 * @returns {number} 编辑距离
 */
function editDistance(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1.charAt(i - 1) === s2.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
}

/**
 * 计算 Dice 相似度系数 (基于字符集合)
 * 用于解决长标题意译差异（如 "我怎么可能" vs "我们不可能"），对语序不敏感
 * @param {string} s1 字符串1
 * @param {string} s2 字符串2
 * @returns {number} Dice 系数 (0.0 - 1.0)
 */
function calculateDiceSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  
  // 将字符串转换为去重的字符集合 (移除空格)
  const set1 = new Set(s1.replace(/\s/g, ''));
  const set2 = new Set(s2.replace(/\s/g, ''));
  
  if (set1.size === 0 && set2.size === 0) return 1.0;
  if (set1.size === 0 || set2.size === 0) return 0.0;

  // 计算交集大小
  let intersection = 0;
  for (const char of set1) {
    if (set2.has(char)) {
      intersection++;
    }
  }

  // Dice 公式: 2 * |A∩B| / (|A| + |B|)
  return (2.0 * intersection) / (set1.size + set2.size);
}

/**
 * 计算两个字符串的综合相似度 (0.0 - 1.0)
 * 结合了 编辑距离（顺序敏感）和 Dice系数（字符重合度），并预先进行清洗
 * @param {string} str1 字符串1
 * @param {string} str2 字符串2
 * @returns {number} 相似度得分 (取多种算法的最大值)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  // 使用增强的 cleanText 进行预处理
  const s1 = cleanText(str1);
  const s2 = cleanText(str2);
  
  // 1. 精确匹配
  if (s1 === s2) return 1.0;
  
  // 2. 包含关系 (给予较高基础分)
  if (s1.includes(s2) || s2.includes(s1)) {
    const lenRatio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
    return 0.8 + (lenRatio * 0.2); 
  }
  
  // 3. 编辑距离得分
  const distance = editDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  const editScore = maxLength === 0 ? 1.0 : 1.0 - (distance / maxLength);

  // 4. Dice 系数得分 (处理长标题意译)
  const diceScore = calculateDiceSimilarity(s1, s2);

  // 返回两种算法中较高的分数
  return Math.max(editScore, diceScore);
}

/**
 * 检测主副标题结构冲突
 * 采用轻量级清洗策略，保留原始分隔符以精准识别 "主标题 + 副标题" 结构
 * @param {string} titleA 标题A
 * @param {string} titleB 标题B
 * @returns {boolean} true 表示存在结构冲突(禁止合并)
 */
function checkTitleSubtitleConflict(titleA, titleB) {
    if (!titleA || !titleB) return false;

    // 轻量清洗：仅移除年份、标签和来源后缀，保留标题内部的空格和标点
    const lightClean = (str) => {
        if (!str) return '';
        let s = str;
        // 尝试繁简转换
        try { s = simplized(s); } catch (e) {}
        
		// 移除常见的非标题性元数据后缀 (续篇、TV版、无修等)
		s = s.replace(/(\(|（)(续篇|TV版|无修|未删减|完整版)(\)|）)/gi, '');
		
        // 移除年份标记及其后续内容
        s = s.replace(/(\(|（)\d{4}(\)|）).*$/i, '');
        // 移除【xxx】格式标签
        s = s.replace(/【.*?】/g, '');
        // 移除来源后缀
        s = s.replace(/\s*from\s+.*$/i, '');

        return s.trim().toLowerCase();
    };

    const t1 = lightClean(titleA);
    const t2 = lightClean(titleB);

    if (t1 === t2) return false;

    // 确定长短标题
    const [short, long] = t1.length < t2.length ? [t1, t2] : [t2, t1];

    // 检查长标题是否以短标题起始
    if (long.startsWith(short)) {
        if (long.length === short.length) return false;

        // 获取衔接处的字符
        const nextChar = long[short.length];

        // 校验分隔符：匹配任意空白符(\s)、冒号、连字符或括号起始
        const separatorRegex = /^[\s:：\-–—(（\[【]/;

        if (separatorRegex.test(nextChar)) {
             // 移除开头的分隔符，提取副标题内容
             const subtitle = long.slice(short.length).replace(separatorRegex, '').trim();
             
             // 如果副标题有效长度超过2个字符，视为不同作品
             if (subtitle.length > 2) {
                 return true;
             }
        }
    }

    return false;
}

/**
 * 提取标题和类型中的季度/类型标识
 * 支持提取：第N季, Season N, Part N, OVA, OAD, 剧场版, 续篇, 以及末尾数字
 * 同时从 typeDesc (类型描述) 中提取特征，解决标题未写明但类型明确的情况
 * @param {string} title 标题文本
 * @param {string} typeDesc 类型描述 (可选)
 * @returns {Set<string>} 标识集合
 */
function extractSeasonMarkers(title, typeDesc = '') {
  const markers = new Set();
  // 使用 cleanText 确保繁简统一
  const t = cleanText(title);
  const type = cleanText(typeDesc || '');

  const patterns = [
    { regex: /(?:第)?(\d+)[季期部]/, prefix: 'S' }, 
    { regex: /season\s*(\d+)/, prefix: 'S' }, 
    { regex: /s(\d+)/, prefix: 'S' },         
    { regex: /part\s*(\d+)/, prefix: 'P' },   
    { regex: /(ova|oad)/, val: 'OVA' },
    { regex: /(剧场版|movie|film|电影)/, val: 'MOVIE' },
    { regex: /(续篇|续集)/, val: 'SEQUEL' },
    { regex: /sp/, val: 'SP' },
    { regex: /[^0-9](\d)$/, prefix: 'S' } 
  ];

  patterns.forEach(p => {
    const match = t.match(p.regex);
    if (match) {
      if (p.prefix) {
        markers.add(`${p.prefix}${parseInt(match[1])}`);
      } else {
        markers.add(p.val);
      }
    }
  });

  // 从 Type 字段中补全标记
  if (type.includes('剧场版') || type.includes('movie') || type.includes('film') || type.includes('电影')) markers.add('MOVIE');
  if (type.includes('ova') || type.includes('oad')) markers.add('OVA');
  if (type.includes('sp') || type.includes('special')) markers.add('SP');

  const cnNums = {'一':1, '二':2, '三':3, '四':4, '五':5, 'final': 99};
  for (const [cn, num] of Object.entries(cnNums)) {
    if (t.includes(`第${cn}季`)) markers.add(`S${num}`);
  }

  return markers;
}

/**
 * 获取严格的媒体类型标识
 * 仅匹配“电影”和“电视剧”，逻辑独立
 * @param {string} title 
 * @param {string} typeDesc 
 * @returns {string|null} 'MOVIE' | 'TV' | null
 */
function getStrictMediaType(title, typeDesc) {
    // 关键：保留原始文本中的【】等符号
    const fullText = (title + ' ' + (typeDesc || '')).toLowerCase();
    
    // 严格匹配，不包含 "剧场版" 或 "连载" 等宽泛词，只针对 "电影" 和 "电视剧"
    const hasMovie = fullText.includes('电影');
    const hasTV = fullText.includes('电视剧');

    if (hasMovie && !hasTV) return 'MOVIE';
    if (hasTV && !hasMovie) return 'TV';
    return null;
}

/**
 * 检查是否满足“剧场版”结构豁免条件
 * 核心逻辑：若涉及剧场版，且双方标题均为“主标题+空格+副标题”结构，视为同一单品
 * @param {string} titleA 标题A
 * @param {string} titleB 标题B
 * @param {string} typeDescA 类型描述A
 * @param {string} typeDescB 类型描述B
 * @returns {boolean} true 表示满足豁免条件
 */
function checkTheatricalExemption(titleA, titleB, typeDescA, typeDescB) {
    // 1. 范围限制：必须包含“剧场版”
    const isTheatrical = (typeDescA || '').includes('剧场版') || (typeDescB || '').includes('剧场版');
    if (!isTheatrical) return false;

    // 2. 轻量级清洗 (保留中间空格)
    const lightClean = (str) => {
        if (!str) return '';
        let s = str;
        try { s = simplized(s); } catch (e) {}
        s = s.replace(/(\(|（)\d{4}(\)|）).*$/i, ''); // 移除年份
        s = s.replace(/【.*?】/g, ''); // 移除标签
        s = s.replace(/\s*from\s+.*$/i, ''); // 移除来源
        return s.trim();
    };

    const t1 = lightClean(titleA);
    const t2 = lightClean(titleB);

    // 3. 结构校验：主标题 + 分隔符(空格/NBSP/全角) + 副标题
    const spaceStructureRegex = /.+[\s\u00A0\u3000].+/;
    return spaceStructureRegex.test(t1) && spaceStructureRegex.test(t2);
}

/**
 * 校验媒体类型是否冲突
 * 逻辑策略：
 * 1. 如果类型明确互斥（一个电影，一个电视剧），且
 * 2. 如果双方都有具体的集数数据，按集数差异判断。
 * 3. 如果任意一方集数数据缺失（count=0），为了安全起见，直接判定为冲突（信任标题标签）。
 * @param {string} titleA 
 * @param {string} titleB 
 * @param {string} typeDescA 
 * @param {string} typeDescB 
 * @param {number} countA 集数A
 * @param {number} countB 集数B
 * @returns {boolean} true 表示冲突(禁止合并)，false 表示无冲突
 */
function checkMediaTypeMismatch(titleA, titleB, typeDescA, typeDescB, countA, countB) {
    const mediaA = getStrictMediaType(titleA, typeDescA);
    const mediaB = getStrictMediaType(titleB, typeDescB);

    // 1. 如果没有检测到明确的互斥类型，放行
    if (!mediaA || !mediaB || mediaA === mediaB) return false;

    // 2. 豁免逻辑：剧场版结构匹配
    if (checkTheatricalExemption(titleA, titleB, typeDescA, typeDescB)) {
        return false;
    }

    // 2. 检查集数数据的有效性
    const hasValidCounts = countA > 0 && countB > 0;

    if (hasValidCounts) {
        // 如果双方都有集数，计算差异
        // 电影通常 1-2 集，电视剧通常 > 5 集，差异阈值设为 5 是合理的
        const diff = Math.abs(countA - countB);
        if (diff > 5) {
            return true; // 冲突
    }
        return false;
    }

    // 3. 数据缺失防御
    // 如果类型互斥（Movie vs TV），且不知道具体集数（count=0），
    // 绝对不能因为 (0-0=0) 就放行。必须信任标题中的显式标签，判定为冲突。
    return true; 
}

/**
 * 校验季度/续作标记是否冲突
 * @param {string} titleA 标题A
 * @param {string} titleB 标题B
 * @param {string} typeA 类型A
 * @param {string} typeB 类型B
 * @returns {boolean} true 表示冲突(禁止合并)，false 表示无冲突
 */
function checkSeasonMismatch(titleA, titleB, typeA, typeB) {
  const markersA = extractSeasonMarkers(titleA, typeA);
  const markersB = extractSeasonMarkers(titleB, typeB);

  // 两者都无标记 -> 无冲突
  if (markersA.size === 0 && markersB.size === 0) return false;

  // 1. 如果两者都有标记，必须有交集，不能互斥
  if (markersA.size > 0 && markersB.size > 0) {
    for (const m of markersA) {
        // 如果 A 的标记在 B 中不存在，且 B 也有同类标记(如都是S开头的季数)，则视为冲突
        if (m.startsWith('S') && !markersB.has(m) && Array.from(markersB).some(b => b.startsWith('S'))) return true;
    }
    return false; 
  }

  // 2. 一方有标记，一方无标记 -> 冲突
  if (markersA.size !== markersB.size) {
      // 豁免逻辑：剧场版结构匹配 (解决 "无标记 vs MOVIE" 问题)
      if (checkTheatricalExemption(titleA, titleB, typeA, typeB)) {
          return false;
      }
      return true; // 确实冲突
  }

  return false;
}

/**
 * 检查两个标题是否包含相同的季度/季数标记
 * 用于在年份不匹配时进行“豁免”判断
 * @param {string} titleA 标题A
 * @param {string} titleB 标题B
 * @param {string} typeA 类型A
 * @param {string} typeB 类型B
 * @returns {boolean} 是否包含相同的明确季度标记（如都包含 S1）
 */
function hasSameSeasonMarker(titleA, titleB, typeA, typeB) {
  const markersA = extractSeasonMarkers(titleA, typeA);
  const markersB = extractSeasonMarkers(titleB, typeB);

  const seasonsA = Array.from(markersA).filter(m => m.startsWith('S'));
  const seasonsB = Array.from(markersB).filter(m => m.startsWith('S'));

  if (seasonsA.length > 0 && seasonsB.length > 0) {
    return seasonsA.some(sa => seasonsB.includes(sa));
  }
  return false;
}

/**
 * 校验日期匹配度
 * @param {Object} dateA 日期对象A
 * @param {Object} dateB 日期对象B
 * @returns {number} 匹配得分 (-1 表示硬性不匹配)
 */
function checkDateMatch(dateA, dateB) {
  if (!dateA.year || !dateB.year) return 0;
  const yearDiff = Math.abs(dateA.year - dateB.year);

  // 年份相差 > 1，硬性抛弃
  if (yearDiff > 1) return -1;

  // 年份相同
  if (yearDiff === 0) {
    if (dateA.month && dateB.month) {
      const monthDiff = Math.abs(dateA.month - dateB.month);
      // 月份差异大也不扣分 (可能是占位符 01-01)
      if (monthDiff > 2) return 0;
      return monthDiff === 0 ? 0.2 : 0.1;
    }
    return 0.1;
  }
  return 0;
}

/**
 * 验证合并覆盖率是否合规
 * 防止出现大量落单的情况（如剧场版强行匹配TV版）
 * 针对 animeko 源进行豁免（因为可能包含未放送集数，总集数差异大）
 * @param {number} mergedCount 成功匹配的集数
 * @param {number} totalA 主源总集数
 * @param {number} totalB 副源总集数
 * @param {string} sourceA 主源名称
 * @param {string} sourceB 副源名称
 * @returns {boolean} 是否合规
 */
function isMergeRatioValid(mergedCount, totalA, totalB, sourceA, sourceB) {
    // Animeko 豁免逻辑
    if (sourceA === 'animeko' || sourceB === 'animeko') {
        return true;
    }

    const maxTotal = Math.max(totalA, totalB);
    if (maxTotal === 0) return false;

    // 计算覆盖率
    const ratio = mergedCount / maxTotal;

    // 如果总集数较多（>5），且匹配率极低（<18%），视为异常关联
    // 例如：12集动画只匹配了2集 (16.7% < 18%)，应驳回
    if (maxTotal > 5 && ratio < 0.18) {
        return false;
    }
    
    return true;
}

/**
 * 在副源列表中寻找最佳匹配的动画对象
 * 采用“双重对比策略”：同时计算“完整标题相似度”和“去括号主标题相似度”，取最大值。
 * 并结合类型信息进行更精准的冲突检测（如剧场版vsTV版）。
 * @param {Object} primaryAnime 主源动画对象
 * @param {Array} secondaryList 副源动画列表
 * @returns {Object|null} 匹配的动画对象或 null
 */
export function findSecondaryMatch(primaryAnime, secondaryList) {
  if (!secondaryList || secondaryList.length === 0) return null;

  // 原始标题 (rawPrimaryTitle): 包含【电视剧】等所有信息，专供冲突检测使用
  const rawPrimaryTitle = primaryAnime.animeTitle || '';
  
  // 计算标题 (primaryTitleForSim): 剔除年份和类型标签，专供相似度计算使用
  // 保证 calculateSimilarity 接收到的是纯净的名称
  let primaryTitleForSim = rawPrimaryTitle.replace(/\(\d{4}\).*$/, '');
  primaryTitleForSim = primaryTitleForSim.replace(/【(电影|电视剧)】/g, '').trim();

  const primaryDate = parseDate(primaryAnime.startDate);
  // 优先使用 episodeCount 属性（即使 links 尚未加载）
  const primaryCount = primaryAnime.episodeCount || (primaryAnime.links ? primaryAnime.links.length : 0);

  let bestMatch = null;
  let maxScore = 0;

  for (const secAnime of secondaryList) {
    const rawSecTitle = secAnime.animeTitle || '';
    const secDate = parseDate(secAnime.startDate);

    // 同样对副源进行逻辑分离
    let secTitleForSim = rawSecTitle.replace(/\(\d{4}\).*$/, '');
    secTitleForSim = secTitleForSim.replace(/【(电影|电视剧)】/g, '').trim();

    const secCount = secAnime.episodeCount || (secAnime.links ? secAnime.links.length : 0);
    
    // 严格冲突检测 (使用 rawTitle)
    // 只要标题一个是电影一个是电视剧，且没有集数证明它们一样，就直接跳过
    if (checkMediaTypeMismatch(rawPrimaryTitle, rawSecTitle, primaryAnime.typeDescription, secAnime.typeDescription, primaryCount, secCount)) {
        continue;
    }

    // 主副标题结构冲突检测
    const hasStructureConflict = checkTitleSubtitleConflict(rawPrimaryTitle, rawSecTitle);

    // 豁免检测 (使用 clean 后的 simTitle)
    const isSeasonExactMatch = hasSameSeasonMarker(primaryTitleForSim, secTitleForSim, primaryAnime.typeDescription, secAnime.typeDescription);

    // 日期校验
    const dateScore = checkDateMatch(primaryDate, secDate);
    if (!isSeasonExactMatch && dateScore === -1) {
        continue;
    }

    // 季度冲突检测 (使用 clean 后的 simTitle)
    if (checkSeasonMismatch(primaryTitleForSim, secTitleForSim, primaryAnime.typeDescription, secAnime.typeDescription)) {
        continue; 
    }

    // 核心相似度计算 (使用 clean 后的 simTitle)
    let scoreFull = calculateSimilarity(primaryTitleForSim, secTitleForSim);
    
    // 去除括号再次对比
    const baseA = removeParentheses(primaryTitleForSim);
    const baseB = removeParentheses(secTitleForSim);
    let scoreBase = calculateSimilarity(baseA, baseB);

    // 取两者的最大值作为最终得分
    let score = Math.max(scoreFull, scoreBase);
    
    // 如果存在结构冲突（一个有副标题一个没有），给予适量惩罚 (例如 -0.15)
    if (hasStructureConflict) {
        score -= 0.15;
    }

    if (dateScore !== -1) {
        score += dateScore;
    }

    if (score > maxScore) {
      maxScore = score;
      bestMatch = secAnime;
    }
  }

  return maxScore >= 0.6 ? bestMatch : null;
}

/**
 * 提取集数信息
 * 增强正则以支持紧凑格式，并预先进行去噪清洗
 * 同时判断该集是否属于特殊集 (Special/OVA/Season标识等)
 * @param {string} title 分集标题
 * @returns {Object} { isMovie: boolean, num: number|null, isSpecial: boolean }
 */
function extractEpisodeInfo(title) {
  // 使用 cleanText 移除干扰前缀和地区文字
  const t = cleanText(title || "");
  
  // 1. 判断是否是剧场版
  const isMovie = /剧场版|movie|film/i.test(t);
  
  let num = null;
  // 2. 判断是否是特殊集 (S1, O1, SP, Special)
  // 区别于 EP29 或 第29集 这种正片
  const isSpecial = /^(s|o|sp|special)\d/i.test(t);

  // 3. 提取数字
  
  // 策略 A: 强前缀 (EP, O, S, Part, 第)
  const strongPrefixMatch = t.match(/(?:ep|o|s|part|第)\s*(\d+(\.\d+)?)/i);
  if (strongPrefixMatch) {
    num = parseFloat(strongPrefixMatch[1]);
  } else {
    // 策略 B: 弱前缀 (行首或空格)
    // 必须有后缀分隔符 (话/集/空格/行尾) 或者数字是独立的
    const weakPrefixMatch = t.match(/(?:^|\s)(\d+(\.\d+)?)(?:话|集|\s|$)/);
    if (weakPrefixMatch) {
      num = parseFloat(weakPrefixMatch[1]);
    }
  }

  return { isMovie, num, isSpecial };
}

/**
 * 判断集标题是否属于特定的特殊类型（Opening/Ending/Interview/Bloopers）
 * 用于实现特殊集的独立匹配逻辑
 * @param {string} title 集标题
 * @returns {string|null} 特殊类型标识 ('opening' | 'ending' | 'interview' | 'Bloopers' | null)
 */
function getSpecialEpisodeType(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  
  if (t.includes('opening')) return 'opening';
  if (t.includes('ending')) return 'ending';
  if (t.includes('interview')) return 'interview';
  if (t.includes('Bloopers')) return 'Bloopers';
  
  return null;
}

/**
 * 过滤无效剧集 (预告/花絮等)
 * 完全依赖传入的正则，不再内置硬编码规则
 * @param {Array} links 剧集链接列表
 * @param {RegExp} filterRegex 过滤正则
 * @returns {Array} 包含原始索引的有效剧集列表
 */
function filterEpisodes(links, filterRegex) {
  if (!links) return [];
  
  // 如果没有传入过滤正则（例如全局开关关闭），则不执行过滤，仅保留索引映射
  if (!filterRegex) {
    return links.map((link, index) => ({ link, originalIndex: index }));
  }

  return links
    .map((link, index) => ({ link, originalIndex: index }))
    .filter(item => {
      const title = item.link.title || item.link.name || "";
      return !filterRegex.test(title);
    });
}

/**
 * 寻找最佳对齐偏移量
 * 解决策略：滑动窗口 + 匹配集数权重 + 类型惩罚 + 数字一致性
 * 引入覆盖率权重，防止少量的巧合匹配战胜大量的正确匹配
 * @param {Array} primaryLinks 主源链接列表
 * @param {Array} secondaryLinks 副源链接列表
 * @returns {number} 最佳偏移量
 */
function findBestAlignmentOffset(primaryLinks, secondaryLinks) {
  if (primaryLinks.length === 0 || secondaryLinks.length === 0) return 0;

  let bestOffset = 0;
  let maxScore = -999;
  
  // 计算主源和副源的正片起始集数（忽略特殊集）
  // 用于计算相对集数偏移量，解决不同命名规范的对齐问题
  let minNormalA = null;
  let minNormalB = null;

  for (const item of primaryLinks) {
      const info = extractEpisodeInfo(item.link.title);
      if (info.num !== null && !info.isSpecial) {
          if (minNormalA === null || info.num < minNormalA) minNormalA = info.num;
      }
  }
  for (const item of secondaryLinks) {
      const info = extractEpisodeInfo(item.link.title);
      if (info.num !== null && !info.isSpecial) {
          if (minNormalB === null || info.num < minNormalB) minNormalB = info.num;
      }
  }

  // 只有当双方都有正片集数时，才计算季度偏移量
  const seasonShift = (minNormalA !== null && minNormalB !== null) ? (minNormalA - minNormalB) : null;

  // 限制滑动范围 (假设差异 +/- 15 集)
  const maxShift = Math.min(Math.max(primaryLinks.length, secondaryLinks.length), 15); 

  for (let offset = -maxShift; offset <= maxShift; offset++) {
    let totalTextScore = 0;
    let rawTextScoreSum = 0; // 记录原始文本相似度总和，用于一致性验证
    let matchCount = 0;
    let numericDiffs = new Map();

    for (let i = 0; i < secondaryLinks.length; i++) {
      const pIndex = i + offset;
      
      if (pIndex >= 0 && pIndex < primaryLinks.length) {
        const titleA = primaryLinks[pIndex].link.title || "";
        const titleB = secondaryLinks[i].link.title || "";
        const infoA = extractEpisodeInfo(titleA);
        const infoB = extractEpisodeInfo(titleB);

        // 1. 类型惩罚 (关键：阻止剧场版与正片匹配)
        let pairScore = 0;
        if (infoA.isMovie !== infoB.isMovie) {
            pairScore -= 5.0; // 强惩罚
        }

        // 1.1 特殊集类型惩罚/奖励 (Opening/Ending/Interview/Bloopers)
        const specialTypeA = getSpecialEpisodeType(titleA);
        const specialTypeB = getSpecialEpisodeType(titleB);
        if (specialTypeA || specialTypeB) {
            if (specialTypeA !== specialTypeB) {
                pairScore -= 10.0; 
            } else {
                pairScore += 3.0; 
            }
        }

        // 1.2 集类型一致性奖励 (Type Consistency Bonus)
        // 优先匹配同类型集数（同为正片或同为特殊集）
        if (infoA.isSpecial === infoB.isSpecial) {
             pairScore += 3.0;
        }

        // 1.3 相对集数对齐奖励 (Start-of-Season Alignment Bonus)
        // 基于首集差异动态计算偏移量，处理不同源的集数命名习惯差异
        if (seasonShift !== null && !infoA.isSpecial && !infoB.isSpecial) {
            if ((infoA.num - infoB.num) === seasonShift) {
                pairScore += 5.0; // 极强奖励
            }
        }

        // 2. 文本相似度
        const sim = calculateSimilarity(titleA, titleB);
        pairScore += sim;
        rawTextScoreSum += sim;

        // 3. 数字完全匹配加分
        // 如果提取出的数字完全相等 (Diff=0)，给予高额加分
        if (infoA.num !== null && infoB.num !== null && infoA.num === infoB.num) {
            pairScore += 2.0; 
        }

        totalTextScore += pairScore;

        // 4. 数字差值记录
        if (infoA.num !== null && infoB.num !== null) {
            const diff = infoB.num - infoA.num;
            const diffKey = diff.toFixed(4); // 避免浮点误差
            const count = numericDiffs.get(diffKey) || 0;
            numericDiffs.set(diffKey, count + 1);
        }

        matchCount++;
      }
    }

    if (matchCount > 0) {
      // 基础平均分
      let finalScore = totalTextScore / matchCount;

      // 5. 计算数字一致性加分
      let maxFrequency = 0;
      for (const count of numericDiffs.values()) {
          if (count > maxFrequency) maxFrequency = count;
      }
      
      const consistencyRatio = maxFrequency / matchCount;
      const avgRawTextScore = rawTextScoreSum / matchCount;

      // 仅当文本相似度达标时才给予一致性奖励，防止数字凑巧对齐但内容不符
      if (consistencyRatio > 0.6 && avgRawTextScore > 0.33) {
          finalScore += 2.0; 
      }

      // 6. 覆盖率权重
      const coverageBonus = Math.min(matchCount * 0.15, 1.5);
      finalScore += coverageBonus;

      // 7. 绝对数字匹配累积奖励
      // 确保数字完全一致的匹配拥有最高优先级
      const zeroDiffCount = numericDiffs.get("0.0000") || 0;
      if (zeroDiffCount > 0) {
          finalScore += zeroDiffCount * 2.0; 
      }

      // 选择逻辑
      if (finalScore > maxScore) {
        maxScore = finalScore;
        bestOffset = offset;
      }
    }
  }

  // 只有当得分 > 0.3 时才采用偏移，否则默认对齐
  return maxScore > 0.3 ? bestOffset : 0;
}

/**
 * 生成符合 int32 范围的安全 ID
 * 通过哈希组合 ID 并映射到 10亿~21亿 区间，避免溢出并减少冲突
 * @param {string|number} id1 原始ID 1
 * @param {string|number} id2 原始ID 2
 * @param {string} salt 盐值（通常为配置组签名，用于区分不同合并组）
 * @returns {number} 安全的 Int32 ID
 */
function generateSafeMergedId(id1, id2, salt = '') {
    // 将 salt 加入哈希计算字符串中，确保唯一性
    const str = `${id1}_${id2}_${salt}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    // 取绝对值并映射到 1,000,000,000 (10亿) ~ 2,147,483,647 (int32 max) 之间
    return (Math.abs(hash) % 1000000000) + 1000000000;
}

/**
 * 执行源合并逻辑
 * 遍历配置的源配置组，支持一主多从的链式合并，并实现了主源轮替逻辑
 * @param {Array} curAnimes 当前所有的动画条目列表
 */
export async function applyMergeLogic(curAnimes) {
  const groups = globals.mergeSourcePairs; // 此时已是 {primary, secondaries[]} 结构
  if (!groups || groups.length === 0) return;

  log("info", `[Merge] 启动源合并策略，配置: ${JSON.stringify(groups)}`);

  // 获取过滤正则
  let epFilter = globals.episodeTitleFilter;
  if (epFilter && typeof epFilter === 'string') {
      try { epFilter = new RegExp(epFilter, 'i'); } catch (e) { epFilter = null; }
  }

  const newMergedAnimes = [];
  
  // 全局去重签名集合，用于防止不同配置组生成完全相同的内容
  const generatedSignatures = new Set();
  // 全局被消耗的ID集合，用于在最后统一清理原始条目
  const globalConsumedIds = new Set();

  for (const group of groups) {
    // 每次处理一个新组时，创建一个局部已处理集合
    // 允许不同组使用同一个原始动漫条目，但在同一个组的逻辑内防止重复使用
    const groupConsumedIds = new Set();

    // 构建完整的优先级列表：[主源, 副源1, 副源2, ...]
    const fullPriorityList = [group.primary, ...group.secondaries];
    const groupFingerprint = fullPriorityList.join('&');

    // 开始主源轮替逻辑
    // 依次尝试将列表中的每个源作为"主源"，去匹配列表后面的所有"副源"
    for (let i = 0; i < fullPriorityList.length - 1; i++) {
      const currentPrimarySource = fullPriorityList[i];
      const availableSecondaries = fullPriorityList.slice(i + 1);

      // 获取该源所有结果
      const allSourceItems = curAnimes.filter(a => a.source === currentPrimarySource);
      
      // 计算剩余的源中，实际上有多少个源是有数据的（且未在本组被消耗）
      const activeRemainingSourcesCount = availableSecondaries.filter(secSrc => {
          return curAnimes.some(a => a.source === secSrc && !groupConsumedIds.has(a.animeId));
      }).length;
      
      // 如果源本身就没有任何结果
      if (allSourceItems.length === 0) {
        // 如果后续还有足够（>=2）的源可能配对，则报告轮替
        if (activeRemainingSourcesCount >= 1 && (activeRemainingSourcesCount + (allSourceItems.length > 0 ? 1 : 0)) >= 2) {
             if (activeRemainingSourcesCount >= 2) {
                 log("info", `[Merge] 轮替: 源 [${currentPrimarySource}] 无可用结果，尝试下一顺位.`);
             }
        }
        continue; 
      }

      // 获取当前轮次的主源候选列表（排除已被本组处理过的条目）
      const primaryItems = allSourceItems.filter(a => !groupConsumedIds.has(a.animeId));

      // 如果 primaryItems 为空，说明该源的数据已经被之前的合并消耗掉了，静默跳过
      if (primaryItems.length === 0) {
        continue;
      }

      for (const pAnime of primaryItems) {
        const cachedPAnime = globals.animes.find(a => String(a.animeId) === String(pAnime.animeId));
        
        if (!cachedPAnime?.links) {
             log("warn", `[Merge] 主源数据不完整，跳过: ${pAnime.animeTitle}`);
             continue;
        }

        const logTitleA = pAnime.animeTitle.replace(/\s*from\s+.*$/i, '');
        let derivedAnime = JSON.parse(JSON.stringify(cachedPAnime));
        
        const actualMergedSources = []; 
        const contentSignatureParts = [pAnime.animeId];
        let hasMergedAny = false;

        // 尝试匹配后续的副源
        for (const secSource of availableSecondaries) {
          // 确保日志映射数组只针对当前副源匹配
          const mappingEntries = [];

          // 排除掉那些已经被标记为本组合并消耗掉的副源
          const secondaryItems = curAnimes.filter(a => a.source === secSource && !groupConsumedIds.has(a.animeId));
          if (secondaryItems.length === 0) continue;

          // 寻找匹配 
          const match = findSecondaryMatch(pAnime, secondaryItems);
          
          if (match) {
            const cachedMatch = globals.animes.find(a => String(a.animeId) === String(match.animeId));
            if (!cachedMatch?.links) continue;

            const logTitleB = cachedMatch.animeTitle.replace(/\s*from\s+.*$/i, '');
            const filteredPLinksWithIndex = filterEpisodes(derivedAnime.links, epFilter);
            const filteredMLinksWithIndex = filterEpisodes(cachedMatch.links, epFilter);
            const offset = findBestAlignmentOffset(filteredPLinksWithIndex, filteredMLinksWithIndex);
            
            if (offset !== 0) {
              log("info", `[Merge] 集数自动对齐 (${secSource}): Offset=${offset} (P:${filteredPLinksWithIndex.length}, S:${filteredMLinksWithIndex.length})`);
            }

            derivedAnime.animeId = generateSafeMergedId(derivedAnime.animeId, match.animeId, groupFingerprint);
            derivedAnime.bangumiId = String(derivedAnime.animeId);

            let mergedCount = 0;
            const matchedPIndices = new Set(); 

            // 执行合并
            for (let k = 0; k < filteredMLinksWithIndex.length; k++) {
              const pIndex = k + offset; 
              const sourceLink = filteredMLinksWithIndex[k].link;
              const sTitleShort = sourceLink.name || sourceLink.title || `Index ${k}`;
              
              if (pIndex >= 0 && pIndex < derivedAnime.links.length) {
                const targetLink = derivedAnime.links[pIndex];
                const pTitleShort = targetLink.name || targetLink.title || `Index ${pIndex}`;
                
                // 特殊集校验
                const specialP = getSpecialEpisodeType(targetLink.title);
                const specialS = getSpecialEpisodeType(sourceLink.title);
                if (specialP !== specialS) {
                    mappingEntries.push({
                          idx: pIndex,
                          text: `   [略过] ${pTitleShort} =/= ${sTitleShort} (特殊集类型不匹配)`
                    });
                    continue;
                }
                
                // ID 合并
                const idB = sanitizeUrl(sourceLink.url);
                let currentUrl = targetLink.url;
                const secPart = `${secSource}:${idB}`;
                
                if (!currentUrl.includes(MERGE_DELIMITER)) {
                    if (!currentUrl.startsWith(currentPrimarySource + ':')) {
                       currentUrl = `${currentPrimarySource}:${currentUrl}`;
                    }
                }
                targetLink.url = `${currentUrl}${MERGE_DELIMITER}${secPart}`;
                
                mappingEntries.push({
                      idx: pIndex,
                      text: `   [匹配] ${pTitleShort} <-> ${sTitleShort}`
                });
                matchedPIndices.add(pIndex);
                
                // 标题更新
                if (targetLink.title) {
                    let sLabel = secSource;
                    if (sourceLink.title) {
                        const sMatch = sourceLink.title.match(/^【([^】\d]+)(?:\d*)】/);
                        if (sMatch) sLabel = sMatch[1].trim();
                    }
                    targetLink.title = targetLink.title.replace(
                        /^【([^】]+)】/, 
                        (match, content) => `【${content}${DISPLAY_CONNECTOR}${sLabel}】`
                    );
                }
                mergedCount++;
              } else {
                  // [副源落单]
                  mappingEntries.push({
                      idx: pIndex, 
                      text: `   [落单] (主源越界) <-> ${sTitleShort}`
                  });
              }
            }
            
            // 检查主源是否有落单集数
            for (let j = 0; j < derivedAnime.links.length; j++) {
                if (!matchedPIndices.has(j)) {
                    const targetLink = derivedAnime.links[j];
                    const pTitleShort = targetLink.name || targetLink.title || `Index ${j}`;
                    mappingEntries.push({
                        idx: j,
                        text: `   [落单] ${pTitleShort} <-> (副源缺失或被略过)`
                    });
                }
            }

            // 最终校验：合并覆盖率是否达标
            if (mergedCount > 0) {
              if (isMergeRatioValid(mergedCount, filteredPLinksWithIndex.length, filteredMLinksWithIndex.length, currentPrimarySource, secSource)) {
                  log("info", `[Merge] 关联成功: [${currentPrimarySource}] ${logTitleA} <-> [${secSource}] ${logTitleB} (本次合并 ${mergedCount} 集)`);
                  if (mappingEntries.length > 0) {
                      mappingEntries.sort((a, b) => a.idx - b.idx);
                      log("info", `[Merge] [${secSource}] 映射详情:\n${mappingEntries.map(e => e.text).join('\n')}`);
                  }
                  
                  // 标记该副源动漫已被消耗，不能再作为后续轮次的主源（本组内）
                  groupConsumedIds.add(match.animeId);
                  // 同时也标记为全局消耗，用于最终清理
                  globalConsumedIds.add(match.animeId);

                  hasMergedAny = true;
                  actualMergedSources.push(secSource);
                  contentSignatureParts.push(match.animeId);
              } else {
                  log("info", `[Merge] 关联取消: [${currentPrimarySource}] ${logTitleA} <-> [${secSource}] ${logTitleB} (匹配率过低: ${mergedCount}/${Math.max(filteredPLinksWithIndex.length, filteredMLinksWithIndex.length)})`);
              }
            }
          }
        } // end loop availableSecondaries

        if (hasMergedAny) {
          const signature = contentSignatureParts.join('|');
          if (generatedSignatures.has(signature)) {
               log("info", `[Merge] 检测到重复的合并结果 (Signature: ${signature})，已自动隐去冗余条目。`);
               continue;
          }
          generatedSignatures.add(signature);

          const joinedSources = actualMergedSources.join(DISPLAY_CONNECTOR);
          // 标题中展示所有参与合并的源
          derivedAnime.animeTitle = derivedAnime.animeTitle.replace(`from ${currentPrimarySource}`, `from ${currentPrimarySource}${DISPLAY_CONNECTOR}${joinedSources}`);
          
          derivedAnime.source = currentPrimarySource;
          
          addAnime(derivedAnime);
          newMergedAnimes.push(derivedAnime);
          
          // 标记当前主源动漫已被消耗
          groupConsumedIds.add(pAnime.animeId);
          globalConsumedIds.add(pAnime.animeId);
        }
      } // end loop primaryItems
    } // end loop fullPriorityList (Rotation)
  } // end loop groups

  // 将合并后的结果插入到列表最顶部
  if (newMergedAnimes.length > 0) {
     curAnimes.unshift(...newMergedAnimes);
  }
  
  // 清理已被合并消耗的原始条目（全局清理）
  for (let i = curAnimes.length - 1; i >= 0; i--) {
    const item = curAnimes[i];
    if (item._isMerged || globalConsumedIds.has(item.animeId)) {
      curAnimes.splice(i, 1);
    }
  }
}

/**
 * 合并两个弹幕列表并按时间排序
 * @param {Array} listA 弹幕列表A
 * @param {Array} listB 弹幕列表B
 * @returns {Array} 合并后的弹幕列表
 */
export function mergeDanmakuList(listA, listB) {
  const final = [...(listA || []), ...(listB || [])];
  
  const getTime = (item) => {
    if (!item) return 0;
    if (item.t !== undefined && item.t !== null) return Number(item.t);
    if (item.p && typeof item.p === 'string') {
      const pTime = parseFloat(item.p.split(',')[0]);
      return isNaN(pTime) ? 0 : pTime;
    }
    return 0;
  };

  final.sort((a, b) => {
    return getTime(a) - getTime(b);
  });
  
  return final;
}
