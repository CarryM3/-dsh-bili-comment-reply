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

// 社区文档真实层级：data.arc_audits[].Archive 与 data.page.{pn,ps,count}。
const archive = (overrides = {}) => ({ Archive: {
  aid: 1906473802, bvid: 'BV1MU411S7iJ', mid: 0,
  title: 'Linux小寄巧: 原地卸载内核然后尝试救活!',
  cover: '//i0.hdslb.com/bfs/archive/b76c0b574862f5a8e8eb133f5f33fcbcd602401a.jpg', ...overrides,
}, Videos: null, stat: { aid: 1906473802 }, state_panel: 0 });
const submissionsData = (items = [archive()], pn = 1, count = 21) => ({
  class: null, arc_audits: items, page: { pn, ps: 20, count }, play_type: 1,
});

test('submissions 使用 Cookie 本人创作中心已发布筛选，不接收 mid、不请求公开空间', async () => {
  const { api, calls } = mock(response(submissionsData()));
  const result = await api.submissions(`${cookie}; other=secret`);
  assert.deepEqual(result, {
    items: [{ aid: '1906473802', bvid: 'BV1MU411S7iJ', title: archive().Archive.title,
      cover: 'https://i0.hdslb.com/bfs/archive/b76c0b574862f5a8e8eb133f5f33fcbcd602401a.jpg' }],
    page: 1, pageSize: 20, total: 21, end: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://member.bilibili.com');
  assert.equal(calls[0].url.pathname, '/x/web/archives');
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { status: 'pubed', pn: '1', ps: '20', coop: '1', interactive: '1' });
  assert.equal(calls[0].init.headers.Cookie, cookie);
  assert.equal(calls[0].init.headers.Referer, 'https://member.bilibili.com/');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'error');
});
test('submissions 多稿件数字/字符串 ID 与 BV 前缀归一化，标题纯文本，必需字段始终存在', async () => {
  const { api } = mock(response(submissionsData([
    archive({ aid: '1956170305', bvid: ' bv1Ay411i7Ph ', mid: '42', title: '<em>标题</em>\u0000 &amp; 文字', cover: undefined }),
    archive({ aid: 910326709, bvid: 'BV1GM4y1a7Vn', mid: 43, cover: null }),
  ], 2, 22)));
  assert.deepEqual(await api.submissions(cookie, 2), {
    items: [
      { aid: '1956170305', bvid: 'BV1Ay411i7Ph', title: '标题 &amp; 文字', cover: '', ownerMid: '42' },
      { aid: '910326709', bvid: 'BV1GM4y1a7Vn', title: archive().Archive.title, cover: '', ownerMid: '43' },
    ], page: 2, pageSize: 20, total: 22, end: true,
  });
});
test('submissions 原始 JSON 超大 aid/mid 跨分页无损且不改写标题数字', async () => {
  const raw = pn => `{"code":0,"data":{"arc_audits":[{"Archive":{"aid":9007199254740993123,"bvid":"BV1MU411S7iJ","mid":9007199254740993125,"title":"9007199254740993123","cover":""}}],"page":{"pn":${pn},"ps":20,"count":21}}}`;
  const { api, calls } = mock(response(null, { raw: raw(1) }), response(null, { raw: raw(2) }));
  for (const page of [1, 2]) {
    const result = await api.submissions(cookie, page);
    assert.equal(result.items[0].aid, '9007199254740993123');
    assert.equal(result.items[0].ownerMid, '9007199254740993125');
    assert.equal(result.items[0].title, '9007199254740993123');
    assert.equal(result.end, page === 2);
    assert.equal(calls[page - 1].url.searchParams.get('pn'), String(page));
  }
});
test('submissions 空数组与 null 列表是终页', async () => {
  for (const items of [[], null]) {
    const { api } = mock(response(submissionsData(items, 1, 0)));
    assert.deepEqual(await api.submissions(cookie), { items: [], page: 1, pageSize: 20, total: 0, end: true });
  }
});
test('submissions 非法结构、分页及必需字段拒绝，不伪装成空列表', async () => {
  for (const data of [null, {}, [], { page: { pn: 1, ps: 20, count: 0 } },
    submissionsData({}), { ...submissionsData(), page: null },
    { ...submissionsData(), page: { pn: 2, ps: 20, count: 21 } },
    { ...submissionsData(), page: { pn: 1, ps: 10, count: 21 } },
    { ...submissionsData(), page: { pn: 1, ps: 20, count: -1 } },
    submissionsData([{}]), submissionsData([archive({ aid: 0 })]),
    submissionsData([archive({ aid: '1e5' })]), submissionsData([archive({ bvid: 'bad' })]),
    submissionsData([archive({ title: null })]), submissionsData([archive({ mid: -1 })]),
    submissionsData(Array.from({ length: 21 }, () => archive())),
  ]) {
    const { api, calls } = mock(response(data));
    await assert.rejects(api.submissions(cookie), BiliApiError);
    assert.equal(calls.length, 1);
  }
});
test('submissions 缺少登录或分页参数错误时零请求', async () => {
  const { api, calls } = mock();
  for (const value of [undefined, null, '', 'DedeUserID=42']) await assert.rejects(api.submissions(value), { kind: 'not-logged-in' });
  for (const page of [0, -1, 1.5, '2', { mid: '42' }, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(api.submissions(cookie, page), { kind: 'invalid-page' });
  await assert.rejects(api.submissions('SESSDATA=secret\r\nheader=x'), { kind: 'invalid-cookie' });
  assert.equal(calls.length, 0);
});
test('submissions 登录失效、风控、网络与非法响应均脱敏失败且不重试或回退', async () => {
  for (const res of [response(null, { code: -101 }), response(null, { code: -412 }), response(null, { code: -509 }),
    response({ need_captcha: true }), response({ gaia_res_type: 1 }), response({ v_voucher: cookie }),
    response(null, { status: 403 }), response(null, { raw: cookie }), new Error(cookie),
  ]) {
    const { api, calls } = mock(res);
    await assert.rejects(api.submissions(cookie), error => error instanceof BiliApiError
      && !error.stack.includes('session%2Cvalue') && !JSON.stringify(error).includes('csrf-token') && error.cause === undefined);
    assert.equal(calls.length, 1);
  }
});
test('submissions cover 只保留 hdslb 图片 HTTPS，兼容协议相对和 HTTP', async () => {
  const good = [
    ['https://i0.hdslb.com/bfs/archive/a.jpg', 'https://i0.hdslb.com/bfs/archive/a.jpg'],
    ['//i1.hdslb.com/bfs/archive/a.png', 'https://i1.hdslb.com/bfs/archive/a.png'],
    ['http://i2.hdslb.com/bfs/archive/a.webp', 'https://i2.hdslb.com/bfs/archive/a.webp'],
    ['https://i0.hdslb.com/bfs/archive/a.jpg@320w_200h.webp', 'https://i0.hdslb.com/bfs/archive/a.jpg@320w_200h.webp'],
  ];
  const bad = ['', undefined, null, {}, '/bfs/archive/a.jpg', 'not a url', 'javascript:alert(1)',
    'data:image/png;base64,x', 'https://evil.test/a.jpg', 'https://hdslb.com.evil.test/a.jpg',
    'https://evilhdslb.com/a.jpg', 'https://i0.hdslb.com@evil.test/a.jpg',
    'https://user:password@i0.hdslb.com/a.jpg', 'https://i0.hdslb.com:444/a.jpg',
    'ftp://i0.hdslb.com/a.jpg', 'https://i0.hdslb.com/a.svg', 'https://i0.hdslb.com/a.html',
    'https://i0.hdslb.com/a.jpg\n', 'https://i0.hdslb.com\\@evil.test/a.jpg'];
  for (const [cover, expectedCover] of [...good, ...bad.map(value => [value, ''])]) {
    const { api } = mock(response(submissionsData([archive({ cover })])));
    assert.equal((await api.submissions(cookie)).items[0].cover, expectedCover, String(cover));
  }
});

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
