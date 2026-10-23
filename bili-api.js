// 社区接口依据：https://github.com/bilibili-plugins/bilibili-api-collect/tree/master/docs
// 仅供 Node host 使用：cookies 不得经客户端接口、日志或工具结果返回。
const API = 'https://api.bilibili.com';
const PASSPORT = 'https://passport.bilibili.com';
const COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5'];
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

export class BiliApiError extends Error {
  constructor(kind, { code, httpStatus } = {}) {
    const labels={
      'api-error':'B站接口拒绝请求','http-error':'B站网络请求失败','timeout':'B站请求超时',
      'network-error':'B站网络连接失败','risk-control':'B站要求风控验证，请停止自动操作并在B站处理',
      'not-logged-in':'B站登录已失效，请重新扫码','invalid-response':'B站响应格式已变化，请更新插件后重试',
      'invalid-json':'B站返回的内容无法解析','invalid-id':'评论或稿件编号无效','invalid-page':'分页参数无效',
      'invalid-cookie':'登录凭证格式无效，请重新扫码','missing-login-cookies':'扫码响应缺少登录凭证，请重新扫码',
      'invalid-fetch':'网络请求组件不可用','invalid-timeout':'请求超时设置无效','invalid-key':'扫码会话无效，请重新生成二维码',
      'qr-error':'B站扫码状态异常，请重新生成二维码','invalid-bvid':'稿件BV号无效',
      'invalid-message':'回复内容为空或超过长度限制','missing-csrf':'登录验证信息缺失，请重新扫码',
    };
    super(`${labels[kind] || 'B站接口异常，请稍后重试'}${Number.isSafeInteger(code)?`（错误码 ${code}）`:Number.isSafeInteger(httpStatus)?`（状态码 ${httpStatus}）`:''}`);
    this.name = 'BiliApiError';
    this.kind = kind;
    if (Number.isSafeInteger(code)) this.code = code;
    if (Number.isSafeInteger(httpStatus)) this.httpStatus = httpStatus;
  }
}
const fail = (kind, details) => { throw new BiliApiError(kind, details); };

// 先按 JSON token 扫描字符串/数字，再转换超安全整数；绝不改写字符串里的数字。
function parseJSON(text) {
  return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
    if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) return JSON.stringify(token);
    return token;
  }));
}
function id(value, zero = false) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('invalid-id');
  if (!['number', 'string', 'bigint'].includes(typeof value)) fail('invalid-id');
  const result = String(value);
  if (!/^(0|[1-9]\d*)$/.test(result) || (!zero && result === '0')) fail('invalid-id');
  return result;
}
function pageNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('invalid-page');
  return value;
}
function number(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-response');
  return value;
}
function string(value) {
  if (typeof value !== 'string') fail('invalid-response');
  return value;
}
function cookieParts(cookie) {
  if (typeof cookie !== 'string' || /[\r\n]/.test(cookie)) fail('invalid-cookie');
  const parts = new Map();
  for (const part of cookie.split(';')) {
    const match = /^\s*([^=\s]+)=([^;]*)$/.exec(part);
    if (match && COOKIE_NAMES.includes(match[1])) {
      if (!COOKIE_VALUE.test(match[2]) || parts.has(match[1])) fail('invalid-cookie');
      parts.set(match[1], match[2]);
    }
  }
  return parts;
}
function cookieHeader(parts) {
  return COOKIE_NAMES.filter(name => parts.has(name)).map(name => `${name}=${parts.get(name)}`).join('; ');
}
function readCookies(headers) {
  // Node getSetCookie 保留各头；兼容旧 fetch 的合并头，不能按 Expires 中的逗号拆分。
  const lines = typeof headers?.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers?.get?.('set-cookie') || '').split(/,(?=\s*[^\s;,=]+=)/);
  const parts = new Map();
  for (const line of lines.flatMap(line => line.split(/,(?=\s*[^\s;,=]+=)/))) {
    const segments = line.split(';');
    const match = /^\s*([^=\s]+)=([^;]*)$/.exec(segments.shift());
    if (!match || !COOKIE_NAMES.includes(match[1])) continue;
    const domain = segments.find(segment => /^\s*domain\s*=/i.test(segment));
    if (domain && !/^\s*domain\s*=\s*\.?bilibili\.com\s*$/i.test(domain)) continue;
    if (!COOKIE_VALUE.test(match[2]) || parts.has(match[1])) fail('invalid-cookie');
    parts.set(match[1], match[2]);
  }
  if (COOKIE_NAMES.some(name => !parts.has(name))) fail('missing-login-cookies');
  return cookieHeader(parts);
}
function comment(item) {
  if (!item || typeof item !== 'object') fail('invalid-response');
  return {
    id: id(item.rpid_str ?? item.rpid),
    mid: id(item.member?.mid ?? item.mid),
    name: string(item.member?.uname),
    message: string(item.content?.message),
    ctime: number(item.ctime),
    replyCount: number(item.rcount ?? item.count ?? 0),
  };
}
function listing(data, requestedPage) {
  if (!data || (data.replies != null && !Array.isArray(data.replies))) fail('invalid-response');
  const comments = (data.replies ?? []).map(comment);
  const page = data.page?.num == null ? requestedPage : pageNumber(data.page.num);
  const size = data.page?.size == null ? 20 : pageNumber(data.page.size);
  const count = data.page?.count;
  if (count != null) number(count);
  return { comments, page, end: count != null ? BigInt(page) * BigInt(size) >= BigInt(count) || comments.length === 0 : comments.length < size };
}

/** 全部 ID 返回十进制字符串。fetch 必须为 Node host fetch，支持 text()/headers。 */
export class BiliApi {
  #fetch;
  #timeoutMs;
  constructor({ fetch: fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    if (typeof fetchImpl !== 'function') fail('invalid-fetch');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) fail('invalid-timeout');
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }
  async #request(origin, path, { query, cookie, form } = {}) {
    const url = new URL(path, origin);
    if (query) url.search = new URLSearchParams(query).toString();
    const headers = { Accept: 'application/json', Referer: 'https://www.bilibili.com/' };
    if (cookie !== undefined) headers.Cookie = cookieHeader(cookieParts(cookie));
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new BiliApiError('timeout')); }, this.#timeoutMs);
      });
      return await Promise.race([timeout, (async () => {
        const response = await this.#fetch(url.toString(), {
          method: form ? 'POST' : 'GET', headers, redirect: 'error', signal: controller.signal,
          ...(form ? { body: new URLSearchParams(form).toString() } : {}),
        });
        if (!response.ok) fail('http-error', { httpStatus: response.status });
        let json;
        try { json = parseJSON(await response.text()); } catch { fail('invalid-json'); }
        if (!json || !Number.isSafeInteger(json.code)) fail('invalid-response');
        if (json.code !== 0) fail('api-error', { code: json.code });
        return { data: json.data, headers: response.headers };
      })()]);
    } catch (error) {
      if (error instanceof BiliApiError) throw error;
      // 不保留第三方异常/cause：可能含 URL、请求头、csrf 或响应体。
      fail(controller.signal.aborted ? 'timeout' : 'network-error');
    } finally { clearTimeout(timer); }
  }
  async startQR() {
    const { data } = await this.#request(PASSPORT, '/x/passport-login/web/qrcode/generate');
    if (!data || typeof data.qrcode_key !== 'string' || !data.qrcode_key || typeof data.url !== 'string') fail('invalid-response');
    let url;
    try { url = new URL(data.url); } catch { fail('invalid-response'); }
    // B站新版本已将扫码页迁移至 account 子域；只接受两个已知的 HTTPS 扫码入口。
    const knownScanPage = (url.origin === PASSPORT && url.pathname === '/h5-app/passport/login/scan')
      || (url.origin === 'https://account.bilibili.com' && url.pathname === '/h5/account-h5/auth/scan-web');
    if (!knownScanPage || url.username || url.password) fail('invalid-response');
    return { status: 'waiting', key: data.qrcode_key, url: data.url };
  }
  async pollQR(key) {
    if (typeof key !== 'string' || !key || key.length > 256 || /[\r\n]/.test(key)) fail('invalid-key');
    const { data, headers } = await this.#request(PASSPORT, '/x/passport-login/web/qrcode/poll', { query: { qrcode_key: key } });
    const status = { 0: 'ok', 86101: 'waiting', 86090: 'scanned', 86038: 'expired' }[data?.code];
    if (!status) fail('qr-error', { code: data?.code });
    // 不读取、不返回、不跟踪成功 data.url 或 refresh_token。
    return status === 'ok' ? { status, cookies: readCookies(headers) } : { status };
  }
  async whoami(cookie) {
    const { data } = await this.#request(API, '/x/web-interface/nav', { cookie });
    if (data?.isLogin !== true) fail('not-logged-in');
    return { mid: id(data.mid), name: string(data.uname) };
  }
  async video(bvid, cookie) {
    if (typeof bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) fail('invalid-bvid');
    const { data } = await this.#request(API, '/x/web-interface/view', { cookie, query: { bvid } });
    if (!data) fail('invalid-response');
    return { aid: id(data.aid), bvid: string(data.bvid), title: string(data.title), ownerMid: id(data.owner?.mid) };
  }
  async comments(aid, cookie, page = 1) {
    const { data } = await this.#request(API, '/x/v2/reply', { cookie, query: { type: 1, oid: id(aid), sort: 0, pn: pageNumber(page), ps: 20 } });
    return listing(data, page);
  }
  async thread(aid, root, cookie, page = 1) {
    const { data } = await this.#request(API, '/x/v2/reply/reply', { cookie, query: { type: 1, oid: id(aid), root: id(root), pn: pageNumber(page), ps: 20 } });
    return listing(data, page);
  }
  /** 回复根评论；root=0 发一级评论。失败/验证码/风控直接抛出，不自动重试。 */
  async reply(aid, root, message, cookie) {
    const oid = id(aid);
    const rootId = id(root, true);
    if (typeof message !== 'string' || !message.trim() || [...message].length > 1000) fail('invalid-message');
    const csrf = cookieParts(cookie).get('bili_jct');
    if (!csrf) fail('missing-csrf');
    const { data } = await this.#request(API, '/x/v2/reply/add', { cookie, form: { type: 1, oid, root: rootId, parent: rootId, message, plat: 1, csrf } });
    if (!data) fail('invalid-response');
    if (data.need_captcha || data.gaia_res_type || data.v_voucher) fail('risk-control');
    return { id: id(data.rpid_str ?? data.rpid ?? data.reply?.rpid_str ?? data.reply?.rpid) };
  }
}
export default BiliApi;
