import test from 'node:test';
import assert from 'node:assert/strict';
import { BiliApi, BiliApiError } from './bili-api.js';

const cookie = 'SESSDATA=session%2Cvalue; bili_jct=csrf-token; DedeUserID=42; DedeUserID__ckMd5=hash';
const setCookies = [
  'SESSDATA=session%2Cvalue; Path=/; Domain=.bilibili.com; Expires=Wed, 01 Jan 2031 00:00:00 GMT; HttpOnly; Secure',
  'bili_jct=csrf-token; Domain=bilibili.com',
  'DedeUserID=42; Domain=.bilibili.com',
  'DedeUserID__ckMd5=hash; Domain=bilibili.com',
  'sid=ignored; Domain=bilibili.com',
  'untrusted=ignored; Domain=evil.test',
];
function response(data, { code = 0, headers = new Headers(), status = 200, raw } = {}) {
  return { ok: status >= 200 && status < 300, status, headers, text: async () => raw ?? JSON.stringify({ code, data }) };
}
function mock(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    assert.ok(responses.length, '不应出现额外请求/自动重试');
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { api: new BiliApi({ fetch }), calls };
}
const rawComment = '{"rpid":9007199254740993123,"mid":42,"member":{"mid":"42","uname":"用户"},"content":{"message":"保留 9007199254740993123 与 \\\"rpid\\\":9007199254740993123"},"ctime":1700000000,"rcount":3}';
const expected = { id: '9007199254740993123', mid: '42', name: '用户', message: '保留 9007199254740993123 与 "rpid":9007199254740993123', ctime: 1700000000, replyCount: 3 };

test('扫码申请只返回展示必需信息，使用正确路径且禁止重定向', async () => {
  const { api, calls } = mock(response({ qrcode_key: 'key', url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=key', refresh_token: 'secret' }));
  assert.deepEqual(await api.startQR(), { status: 'waiting', key: 'key', url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=key' });
  assert.equal(calls[0].url.pathname, '/x/passport-login/web/qrcode/generate');
  assert.equal(calls[0].init.redirect, 'error');
});
test('兼容实际接口的新account扫码入口，拒绝未知域名、路径及非HTTPS', async () => {
  const current='https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=key';
  const {api}=mock(response({qrcode_key:'key',url:current}));
  assert.equal((await api.startQR()).url,current);
  for(const url of [
    'https://evil.test/h5/account-h5/auth/scan-web?qrcode_key=key',
    'https://account.bilibili.com.evil.test/h5/account-h5/auth/scan-web',
    'http://account.bilibili.com/h5/account-h5/auth/scan-web',
    'https://account.bilibili.com/unrelated',
    'https://passport.bilibili.com/unrelated',
    'https://name:password@account.bilibili.com/h5/account-h5/auth/scan-web',
  ]) {
    const {api:bad}=mock(response({qrcode_key:'key',url}));
    await assert.rejects(bad.startQR(),{kind:'invalid-response'});
  }
});
test('扫码状态 waiting/scanned/expired 不返回凭证或成功 URL', async () => {
  const { api, calls } = mock(...[86101, 86090, 86038].map(code => response({ code, url: 'https://evil.test/secret', refresh_token: 'secret' })));
  for (const status of ['waiting', 'scanned', 'expired']) assert.deepEqual(await api.pollQR('key'), { status });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.pathname, '/x/passport-login/web/qrcode/poll');
  assert.equal(calls[0].url.searchParams.get('qrcode_key'), 'key');
});
test('扫码成功读取四种 Set-Cookie 白名单，不追踪 data.url', async () => {
  for (const headers of [{ getSetCookie: () => setCookies }, new Headers({ 'set-cookie': setCookies.join(', ') })]) {
    const { api, calls } = mock(response({ code: 0, url: 'https://evil.test/?SESSDATA=secret', refresh_token: 'secret' }, { headers }));
    assert.deepEqual(await api.pollQR('key'), { status: 'ok', cookies: cookie });
    assert.equal(calls.length, 1);
  }
});
test('缺少 cookie、错误 domain、重复凭证均失败，不从 URL 提取 cookie', async () => {
  for (const lines of [[], setCookies.map(line => line.replace(/Domain=\.?bilibili\.com/g, 'Domain=evil.test')), [...setCookies, 'bili_jct=other; Domain=bilibili.com']]) {
    const { api } = mock(response({ code: 0, url: `https://passport.bilibili.com/?${cookie}` }, { headers: { getSetCookie: () => lines } }));
    await assert.rejects(api.pollQR('key'), BiliApiError);
  }
});
test('未知扫码状态及顶层 API 错误必须抛出脱敏错误', async () => {
  for (const res of [response({ code: 123, message: 'secret' }), response(null, { code: -412 })]) {
    const { api, calls } = mock(res);
    await assert.rejects(api.pollQR('key'), error => error instanceof BiliApiError && !error.stack.includes('secret'));
    assert.equal(calls.length, 1);
  }
});
test('whoami/video 归一化字符串 ID，只发送白名单 cookie', async () => {
  const { api, calls } = mock(response({ isLogin: true, mid: 42, uname: '我' }), response({ aid: 99, bvid: 'BV117411r7R1', title: '标题', owner: { mid: 42 } }));
  assert.deepEqual(await api.whoami(`${cookie}; other=secret`), { mid: '42', name: '我' });
  assert.deepEqual(await api.video('BV117411r7R1', cookie), { aid: '99', bvid: 'BV117411r7R1', title: '标题', ownerMid: '42' });
  assert.equal(calls[0].url.pathname, '/x/web-interface/nav');
  assert.equal(calls[0].init.headers.Cookie, cookie);
  assert.equal(calls[1].url.pathname, '/x/web-interface/view');
});
test('评论路径/分页/标准结构及原始超大 rpid 无损，字符串不受预处理影响', async () => {
  const { api, calls } = mock(response(null, { raw: `{"code":0,"data":{"page":{"num":1,"size":20,"count":21},"replies":[${rawComment}]}}` }));
  assert.deepEqual(await api.comments('99', cookie), { comments: [expected], page: 1, end: false });
  assert.equal(calls[0].url.pathname, '/x/v2/reply');
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { type: '1', oid: '99', sort: '0', pn: '1', ps: '20' });
});
test('子评论 root 字符串与分页结束判定，包括 null 列表', async () => {
  const { api, calls } = mock(response({ page: { num: 2, size: 20, count: 21 }, replies: null }), response({ replies: [] }));
  assert.deepEqual(await api.thread('99', '9007199254740993123', cookie, 2), { comments: [], page: 2, end: true });
  assert.equal(calls[0].url.pathname, '/x/v2/reply/reply');
  assert.equal(calls[0].url.searchParams.get('root'), '9007199254740993123');
  assert.equal(calls[0].url.searchParams.get('pn'), '2');
  assert.equal((await api.comments('99', cookie)).end, true);
});
test('回复根评论发送相同 root/parent、csrf、oid、message；结果 ID 无损', async () => {
  const { api, calls } = mock(response(null, { raw: '{"code":0,"data":{"rpid":9007199254740993125}}' }));
  assert.deepEqual(await api.reply('99', '9007199254740993123', '测试 & +中文', cookie), { id: '9007199254740993125' });
  const { url, init } = calls[0];
  assert.equal(url.pathname, '/x/v2/reply/add');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), { type: '1', oid: '99', root: '9007199254740993123', parent: '9007199254740993123', message: '测试 & +中文', plat: '1', csrf: 'csrf-token' });
});
test('一级评论显式 root=parent=0，无 csrf 或不安全数字 ID 时不发送', async () => {
  const { api, calls } = mock(response({ rpid_str: '100' }));
  await api.reply(99, 0, '测试', cookie);
  assert.equal(new URLSearchParams(calls[0].init.body).get('parent'), '0');
  await assert.rejects(api.reply('99', '1', '测试', 'SESSDATA=secret'), { kind: 'missing-csrf' });
  await assert.rejects(api.reply('99', 9007199254740992, '测试', cookie), { kind: 'invalid-id' });
  await assert.rejects(api.comments('99', cookie, 0), { kind: 'invalid-page' });
  assert.equal(calls.length, 1);
});
test('所有 API 失败/风控/验证码均抛出且不重试、不附带原始响应', async () => {
  for (const res of [response(null, { code: -412 }), response(null, { code: -509 }), response(null, { code: 12015 }), response({ need_captcha: true, rpid: 100 }), response({ v_voucher: 'secret', rpid: 100 }), response({ gaia_res_type: 1, rpid: 100 })]) {
    const { api, calls } = mock(res);
    await assert.rejects(api.reply('99', '1', '测试', cookie), error => error instanceof BiliApiError && !JSON.stringify(error).includes('secret'));
    assert.equal(calls.length, 1);
  }
});
test('HTTP 错误不读 body；网络和非法 JSON 错误不泄漏内容或 cause', async () => {
  const http = response(null, { status: 403 });
  http.text = async () => { assert.fail('HTTP 错误不应读取 body'); };
  const { api } = mock(http, new Error('SESSDATA=secret'), response(null, { raw: '{secret-body' }));
  await assert.rejects(api.whoami(cookie), { kind: 'http-error', httpStatus: 403 });
  for (const kind of ['network-error', 'invalid-json']) await assert.rejects(api.whoami(cookie), error => error.kind === kind && !error.stack.includes('secret') && error.cause === undefined);
});
test('请求和 body 读取超时都抛出且 abort，不重试（mock 忽略 signal 仍超时）', async () => {
  for (const bodyTimeout of [false, true]) {
    let calls = 0;
    let signal;
    const api = new BiliApi({ timeoutMs: 10, fetch: async (_, init) => {
      calls++;
      signal = init.signal;
      if (!bodyTimeout) return new Promise(() => {});
      return { ok: true, headers: new Headers(), text: () => new Promise(() => {}) };
    } });
    await assert.rejects(api.whoami(cookie), { kind: 'timeout' });
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
  }
});
