/**
 * 环境变量管理模块
 * 提供获取和设置环境变量的函数，支持 Cloudflare Workers 和 Node.js
 */
export class Envs {
  // 记录获取过的环境变量
  static accessedEnvVars = new Map();

  static VOD_ALLOWED_PLATFORMS = ['qiyi', 'bilibili1', 'imgo', 'youku', 'qq']; // vod允许的播放平台
  static ALLOWED_PLATFORMS = ['qiyi', 'bilibili1', 'imgo', 'youku', 'qq', 'renren', 'hanjutv', 'bahamut']; // 全部源允许的播放平台
  static ALLOWED_SOURCES = ['360', 'vod', 'tencent', 'youku', 'iqiyi', 'imgo', 'bilibili', 'renren', 'hanjutv', 'bahamut']; // 允许的源
  static bahamutKeepTraditional = false; // 巴哈姆特弹幕繁体标记判断
  static isReverseProxy = false; // 反向代理判断
  static reverseProxyUrl = ''; // 反向代理配置

  /**
   * 获取环境变量
   * @param {string} key 环境变量的键
   * @param {any} defaultValue 默认值
   * @param {'string' | 'number' | 'boolean'} type 类型
   * @param {boolean} encrypt 是否在 accessedEnvVars 中加密显示
   * @returns {any} 转换后的值
   */
  static get(key, defaultValue, type = 'string', encrypt = false) {
    let value;
    if (typeof env !== 'undefined' && env[key]) {
      value = env[key]; // Cloudflare Workers
    } else if (typeof process !== 'undefined' && process.env?.[key]) {
      value = process.env[key]; // Node.js
    } else {
      value = defaultValue;
    }

    let parsedValue;
    switch (type) {
      case 'number':
        parsedValue = Number(value);
        if (isNaN(parsedValue)) {
          throw new Error(`Environment variable ${key} must be a valid number`);
        }
        break;
      case 'boolean':
        // 确保 'false' 字符串被正确解析为 false
        parsedValue = String(value).toLowerCase() === 'true' || String(value) === '1';
        break;
      case 'string':
      default:
        parsedValue = String(value);
        break;
    }

    // 只有当 encrypt 为 true 且不是 PROXY_URL 或解析逻辑内部时，才进行加密，
    // 因为 PROXY_URL 的加密逻辑将在 load 函数的最后统一处理。
    const finalValue = encrypt ? this.encryptStr(parsedValue) : parsedValue;
    this.accessedEnvVars.set(key, finalValue);

    return parsedValue;
  }

  /**
   * 设置环境变量
   * @param {string} key 环境变量的键
   * @param {any} value 值
   */
  static set(key, value) {
    if (typeof process !== 'undefined') {
      process.env[key] = String(value);
    }
    this.accessedEnvVars.set(key, value);
  }

  /**
   * 基础加密函数 - 将字符串转换为星号
   * @param {string} str 输入字符串
   * @returns {string} 星号字符串
   */
  static encryptStr(str) {
    // 确保对非空字符串进行加密
    return str && str.length > 0 ? '*'.repeat(str.length) : '';
  }

  /**
   * 解析 VOD 服务器配置
   * @param {Object} env 环境对象
   * @returns {Array} 服务器列表
   */
  static resolveVodServers(env) {
    const defaultVodServers = '金蝉@https://zy.jinchancaiji.com,789@https://www.caiji.cyou,听风@https://gctf.tfdh.top';
    let vodServersConfig = this.get('VOD_SERVERS', defaultVodServers, 'string');

    if (!vodServersConfig || vodServersConfig.trim() === '') {
      return [];
    }

    return vodServersConfig
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map((item, index) => {
        if (item.includes('@')) {
          const [name, url] = item.split('@').map(s => s.trim());
          return { name: name || `vod-${index + 1}`, url };
        }
        return { name: `vod-${index + 1}`, url: item };
      })
      .filter(server => server.url && server.url.length > 0);
  }

  /**
   * 解析源排序
   * @param {Object} env 环境对象
   * @param {string} deployPlatform 部署平台
   * @returns {Array} 源排序数组
   */
  static resolveSourceOrder(env, deployPlatform) {
    let sourceOrder = this.get('SOURCE_ORDER', '360,vod,renren,hanjutv', 'string');

    // 重置巴哈姆特繁体标记
    this.bahamutKeepTraditional = false;

    const orderArr = sourceOrder
      .split(',')
      .map(s => s.trim())
      .map(s => {
        // 检查 bahamut@tc 或 bahamut@TC 标记
        if (s.toLowerCase() === 'bahamut@tc') {
          this.bahamutKeepTraditional = true; // 设置全局标记为保持繁体
          return 'bahamut'; // 返回标准的 bahamut 用于后续处理
        }
        return s;
      })
      .filter(s => this.ALLOWED_SOURCES.includes(s));

    this.accessedEnvVars.set('SOURCE_ORDER', orderArr);
    this.accessedEnvVars.set('bahamutKeepTraditional', this.bahamutKeepTraditional);

    return orderArr.length > 0 ? orderArr : ['360', 'vod', 'renren', 'hanjutv'];
  }

  /**
   * 解析平台排序
   * @param {Object} env 环境对象
   * @returns {Array} 平台排序数组
   */
  static resolvePlatformOrder(env) {
    const orderArr = this.get('PLATFORM_ORDER', '', 'string')
      .split(',')
      .map(s => s.trim())
      .filter(s => this.ALLOWED_PLATFORMS.includes(s));

    this.accessedEnvVars.set('PLATFORM_ORDER', orderArr);

    return orderArr.length > 0 ? [...orderArr, null] : [null];
  }

  /**
   * 解析剧集标题过滤正则
   * @param {Object} env 环境对象
   * @returns {RegExp} 过滤正则表达式
   */
  static resolveEpisodeTitleFilter(env) {
    const defaultFilter = '(特别|惊喜|纳凉)?企划|合伙人手记|超前(营业|vlog)?|速览|vlog|reaction|纯享|加更(版|篇)?|抢先(看|版|集|篇)?|抢鲜|预告|花絮(独家)?|' +
      '特辑|彩蛋|专访|幕后(故事|花絮|独家)?|直播(陪看|回顾)?|未播(片段)?|衍生|番外|会员(专享|加长|尊享|专属|版)?|片花|精华|看点|速看|解读|影评|解说|吐槽|盘点|拍摄花絮|制作花絮|幕后花絮|未播花絮|独家花絮|' +
      '花絮特辑|先导预告|终极预告|正式预告|官方预告|彩蛋片段|删减片段|未播片段|番外彩蛋|精彩片段|精彩看点|精彩回顾|精彩集锦|看点解析|看点预告|' +
      'NG镜头|NG花絮|番外篇|番外特辑|制作特辑|拍摄特辑|幕后特辑|导演特辑|演员特辑|片尾曲|插曲|高光回顾|背景音乐|OST|音乐MV|歌曲MV|前季回顾|' +
      '剧情回顾|往期回顾|内容总结|剧情盘点|精选合集|剪辑合集|混剪视频|独家专访|演员访谈|导演访谈|主创访谈|媒体采访|发布会采访|采访|陪看(记)?|' +
      '试看版|短剧|精编|Plus|独家版|特别版|短片|发布会|解忧局|走心局|火锅局|巅峰时刻|坞里都知道|福持目标坞民|观察室|上班那点事儿|' +
      '周top|赛段|直拍|REACTION|VLOG|全纪录|开播|先导|总宣|展演|集锦|旅行日记|精彩分享|剧情揭秘';

    // 读取环境变量，如果设置了则完全覆盖默认值
    const customFilter = this.get('EPISODE_TITLE_FILTER', '', 'string', false).trim();
    let keywords = customFilter || defaultFilter;

    this.accessedEnvVars.set('EPISODE_TITLE_FILTER', keywords);

    try {
      return new RegExp(`^(.*?)(?:${keywords})(.*?)$`);
    } catch (error) {
      console.warn(`Invalid EPISODE_TITLE_FILTER format, using default.`);
      return new RegExp(`^(.*?)(?:${defaultFilter})(.*?)$`);
    }
  }

/**
   * 解析代理配置：区分代理地址和反代地址
   * @param {string} proxyConfig 代理配置字符串
   * @returns {Object} { isReverse: boolean, url: string }
   */
  static parseProxyConfig(proxyConfig) {
    if (!proxyConfig) {
      return { isReverse: false, url: '' };
    }
    
    // 检查是否以 "RP@" 开头（反代模式）
    if (proxyConfig.startsWith('RP@')) {
      let reverseUrl = proxyConfig.substring(3).trim(); // 去除 "RP@" 前缀
      // 去除末尾多余的斜杠
      reverseUrl = reverseUrl.replace(/\/+$/, '');
      return { isReverse: true, url: reverseUrl };
    }
    
    // 代理模式
    return { isReverse: false, url: proxyConfig };
  }

  /**
   * 解析代理 URL，设置内部状态（this.isReverseProxy, this.reverseProxyUrl）
   * @param {Object} env 环境对象
   * @returns {string} 正向代理 URL（反代模式下返回空字符串）
   */
  static resolveProxyUrl(env) {
    // 必须使用 false 确保获取到原始值
    const proxyConfig = this.get('PROXY_URL', '', 'string', false); 
    
    // 解析配置：判断是代理还是反代
    const parsed = this.parseProxyConfig(proxyConfig);
    this.isReverseProxy = parsed.isReverse;
    
    if (this.isReverseProxy) {
      this.reverseProxyUrl = parsed.url;
      // 记录到 accessedEnvVars，为兼容旧的输出格式，这里先记录被加密的 reverseProxyUrl
      this.accessedEnvVars.set('proxyUrl', '');
      this.accessedEnvVars.set('reverseProxyUrl', this.encryptStr(this.reverseProxyUrl)); 
      return ''; // 反代模式下不使用代理，返回空字符串作为 proxyUrl 的值
    } else {
      // 记录到 accessedEnvVars，这里先记录明文的 proxyUrl
      this.accessedEnvVars.set('proxyUrl', parsed.url);
      this.accessedEnvVars.set('reverseProxyUrl', '');
      return parsed.url; // 代理模式，返回代理 URL 作为 proxyUrl 的值
    }
  }

  /**
   * 获取统一的代理/反代 URL 输出值，并记录到 accessedEnvVars
   * 【重要】此函数会覆盖 accessedEnvVars 中 proxyUrl/reverseProxyUrl 的记录，实现统一显示。
   * @returns {string} 根据模式加密或明文的 URL
   */
  static getUnifiedProxyUrlForOutput() {
    // 重新获取原始配置（未解析、未加密）用于最终输出判断
    const proxyConfig = this.get('PROXY_URL', '', 'string', false);
    
    // 重新解析配置，获取纯净的 URL
    const parsed = this.parseProxyConfig(proxyConfig);
    const finalUrl = parsed.url;
    
    let outputValue;
    // 使用 this.isReverseProxy 判断模式，该值已在 resolveProxyUrl 中设置
    if (this.isReverseProxy) {
      // 反代模式：加密显示
      outputValue = this.encryptStr(finalUrl);
    } else {
      // 代理模式：明文显示
      outputValue = finalUrl;
    }
    
    // 记录到 accessedEnvVars，使用 PROXY_URL 键，这是最终用户看到的值
    this.accessedEnvVars.set('PROXY_URL', outputValue);
    
    // 不希望被打印的兼容性键，这些键值仍然会保留在 Envs.load 返回的对象中供内部函数使用，但不会被 getAccessedEnvVars 打印
    this.accessedEnvVars.delete('proxyUrl');
    this.accessedEnvVars.delete('reverseProxyUrl');
    
    return outputValue;
  }

  /**
   * 获取记录的环境变量 JSON
   * @returns {Map<any, any>} JSON 字符串
   */
  static getAccessedEnvVars() {
    return this.accessedEnvVars;
  }

  /**
   * 初始化环境变量
   * @param {Object} env 环境对象
   * @param {string} deployPlatform 部署平台
   * @returns {Object} 配置对象
   */
  static load(env = {}, deployPlatform = 'node') {
    return {
      vodAllowedPlatforms: this.VOD_ALLOWED_PLATFORMS,
      allowedPlatforms: this.ALLOWED_PLATFORMS,
      token: this.get('TOKEN', '87654321', 'string', true), // token，默认为87654321
      otherServer: this.get('OTHER_SERVER', 'https://api.danmu.icu', 'string'), // 第三方弹幕服务器
      vodServers: this.resolveVodServers(env), // vod站点配置，格式：名称@URL,名称@URL
      vodReturnMode: this.get('VOD_RETURN_MODE', 'fastest', 'string').toLowerCase(), // vod返回模式：all（所有站点）或 fastest（最快的站点）
      vodRequestTimeout: this.get('VOD_REQUEST_TIMEOUT', '10000', 'string'), // vod超时时间（默认10秒）
      bilibliCookie: this.get('BILIBILI_COOKIE', '', 'string', true), // b站cookie
      youkuConcurrency: Math.min(this.get('YOUKU_CONCURRENCY', 8, 'number'), 16), // 优酷并发配置
      sourceOrderArr: this.resolveSourceOrder(env, deployPlatform), // 源排序
      platformOrderArr: this.resolvePlatformOrder(env), // 自动匹配优选平台
      episodeTitleFilter: this.resolveEpisodeTitleFilter(env), // 剧集标题正则过滤
      blockedWords: this.get('BLOCKED_WORDS', '', 'string'), // 屏蔽词列表
      groupMinute: Math.min(this.get('GROUP_MINUTE', 1, 'number'), 30), // 分钟内合并去重（默认 1，最大值30，0表示不去重）
      proxyUrl: this.resolveProxyUrl(env), // 代理/反代地址
      PROXY_URL: this.getUnifiedProxyUrlForOutput(), // 代理/反代地址
      reverseProxyUrl: this.isReverseProxy ? this.reverseProxyUrl : '', // 代理/反代地址
      isReverseProxy: this.isReverseProxy, // 是否为反向代理模式
      bahamutKeepTraditional: this.bahamutKeepTraditional, // 巴哈姆特弹幕是否保持繁体
      tmdbApiKey: this.get('TMDB_API_KEY', '', 'string', true), // TMDB API KEY
      redisUrl: this.get('UPSTASH_REDIS_REST_URL', '', 'string', true), // upstash redis url
      redisToken: this.get('UPSTASH_REDIS_REST_TOKEN', '', 'string', true), // upstash redis url
      rateLimitMaxRequests: this.get('RATE_LIMIT_MAX_REQUESTS', 3, 'number'), // 限流配置：时间窗口内最大请求次数（默认 3，0表示不限流）
      enableEpisodeFilter: this.get('ENABLE_EPISODE_FILTER', false, 'boolean'), // 集标题过滤开关配置（默认 false，禁用过滤）
      logLevel: this.get('LOG_LEVEL', 'info', 'string'), // 日志级别配置（默认 info，可选值：error, warn, info）
      searchCacheMinutes: this.get('SEARCH_CACHE_MINUTES', 1, 'number'), // 搜索结果缓存时间配置（分钟，默认 1）
      commentCacheMinutes: this.get('COMMENT_CACHE_MINUTES', 1, 'number'), // 弹幕缓存时间配置（分钟，默认 1）
      convertTopBottomToScroll: this.get('CONVERT_TOP_BOTTOM_TO_SCROLL', false, 'boolean'), // 顶部/底部弹幕转换为浮动弹幕配置（默认 false，禁用转换）
      convertColorToWhite: this.get('CONVERT_COLOR_TO_WHITE', false, 'boolean'), // 彩色弹幕转换为纯白弹幕配置（默认 false，禁用转换）
      danmuOutputFormat: this.get('DANMU_OUTPUT_FORMAT', 'json', 'string'), // 弹幕输出格式配置（默认 json，可选值：json, xml）
      strictTitleMatch: this.get('STRICT_TITLE_MATCH', false, 'boolean') // 严格标题匹配模式配置（默认 false，宽松模糊匹配）
    };
  }
}
