import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyEngine, validateSettings } from './engine.js';

const BVID = 'BV1234567890';
const MID = '42';
const AID = '99';
const NOW = Date.parse('2026-06-01T04:00:00Z');
const MODEL = { provider: 'p', model: 'm' };
const keyFor = id => `${MID}:${AID}:${id}`;
const comment = (id = '101', overrides = {}) => ({
  id, mid: '43', name: '测试读者', message: '普通评论，没有关键词',
  ctime: Math.floor(NOW / 1000) + 1, replyCount: 0, ...overrides,
});
const draft = (overrides = {}) => ({
  action: 'reply', reply: '这是模拟角色生成的回复', source: 'ai',
  ...MODEL, cached: false, called: true, ...overrides,
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(t, options = {}) {
  let clock = NOW;
  let saved = validateSettings({
    replyMode: 'persona', bvids: [BVID], persona: '虚构的友善讲解员，简短回答普通问题。',
    maxReplyChars: 180, aiDailyLimit: 40, ...options,
  });
  const receipts = new Map(), events = [];
  const store = {
    settings: () => saved,
    saveSettings: t.mock.fn(async value => { saved = structuredClone(value); }),
    receipt: key => receipts.get(key),
    entries: () => [...receipts.entries()],
    put: t.mock.fn(async (key, value) => {
      events.push(`put:${value.status}`);
      receipts.set(key, structuredClone(value));
    }),
  };
  const account = { mid: MID, name: '测试作者' };
  const video = { aid: AID, bvid: BVID, ownerMid: MID, title: '测试作品' };
  const api = {
    whoami: t.mock.fn(async () => account),
    video: t.mock.fn(async () => video),
    comments: t.mock.fn(async () => ({ comments: [comment()], end: true })),
    thread: t.mock.fn(async () => ({ comments: [], end: true })),
    reply: t.mock.fn(async (_aid, id, reply) => {
      assert.equal(receipts.get(keyFor(id))?.status, 'uncertain');
      assert.equal(receipts.get(keyFor(id))?.reply, reply);
      events.push('reply');
      return { id: '201' };
    }),
  };
  const prepareAI = t.mock.fn(async () => ({ ...MODEL }));
  const generateReply = t.mock.fn(async () => draft());
  const engine = new ReplyEngine({ api, getCookie: async () => 'mock-cookie', store,
    now: () => clock, generateReply, prepareAI });
  t.after(() => engine.dispose());
  return { engine, api, store, receipts, events, account, video, prepareAI, generateReply,
    setNow(value) { clock = value; } };
}

function noSend(f) {
  assert.equal(f.api.reply.mock.callCount(), 0);
  assert.equal(f.store.put.mock.callCount(), 0);
}

for (const missing of ['persona', 'prepareAI', 'generateReply', 'model']) {
  test(`角色路径缺少 ${missing} 时拒绝开启且零生成`, async t => {
    const f = fixture(t, missing === 'persona' ? { persona: '   ' } : {});
    if (missing === 'prepareAI' || missing === 'generateReply') f.engine[missing] = undefined;
    if (missing === 'model') f.prepareAI.mock.mockImplementation(async () => { throw new Error('未配置可用模型'); });
    await assert.rejects(f.engine.enable({ model: MODEL }), /角色设定|模型/);
    assert.equal(f.engine.status().enabled, false);
    assert.equal(f.generateReply.mock.callCount(), 0);
    noSend(f);
  });
}

test('无关键词和 fallback 也能开启；保存批准模型并将 AI 文本持久化后发送', async t => {
  const f = fixture(t, { fallbackReply: '' });
  const requested = { provider: 'requested', model: 'requested-model' };
  assert.deepEqual(f.engine.settings.rules, []);
  await f.engine.enable({ model: requested });
  assert.deepEqual(f.prepareAI.mock.calls[0].arguments, [requested]);
  assert.deepEqual(f.engine.approvedModel, MODEL);
  assert.equal(f.generateReply.mock.callCount(), 0);
  const result = await f.engine.run(true);
  assert.equal(result.sent, 1);
  assert.equal(f.generateReply.mock.callCount(), 1);
  const [input] = f.generateReply.mock.calls[0].arguments;
  assert.deepEqual(input.expectedModel, MODEL);
  assert.deepEqual(input.comment, comment());
  assert.deepEqual(input.video, f.video);
  assert.deepEqual(input.account, f.account);
  assert.deepEqual(input.settings, f.engine.settings);
  assert.equal(input.settings.maxReplyChars, 180);
  assert.equal(input.settings.aiDailyLimit, 40);
  assert.ok(input.signal instanceof AbortSignal);
  assert.deepEqual(f.events, ['put:uncertain', 'reply', 'put:sent']);
  assert.equal(f.api.reply.mock.calls[0].arguments[2], draft().reply);
  assert.equal(f.receipts.get(keyFor('101')).reply, draft().reply);
  assert.equal(result.candidates[0].source, 'ai');
  assert.equal(result.candidates[0].model, 'p/m');
});

for (const enabled of [false, true]) {
  test(`角色预览最多3条、不传批准模型且不发送（开启=${enabled}）`, async t => {
    const f = fixture(t);
    f.api.comments.mock.mockImplementation(async () => ({ comments: Array.from({ length: 6 }, (_, i) => comment(String(101 + i))), end: true }));
    if (enabled) await f.engine.enable({ model: MODEL });
    const result = await f.engine.run(false);
    assert.equal(result.candidates.length, 3);
    assert.equal(result.aiCalls, 3);
    assert.equal(f.generateReply.mock.callCount(), 3);
    for (const call of f.generateReply.mock.calls) assert.equal(call.arguments[0].expectedModel, undefined);
    assert.equal(f.prepareAI.mock.callCount(), enabled ? 1 : 0);
    noSend(f);
  });
}

test('cached skip 不占生成预算，每轮最多3次 uncached 生成', async t => {
  const f = fixture(t);
  f.api.comments.mock.mockImplementation(async () => ({ comments: Array.from({ length: 9 }, (_, i) => comment(String(101 + i))), end: true }));
  f.generateReply.mock.mockImplementation(async ({ comment: item }) => draft({
    action: 'skip', reply: '', cached: Number(item.id) < 105, called: Number(item.id) >= 105,
  }));
  const result = await f.engine.run();
  assert.deepEqual(result.candidates, []);
  assert.equal(result.aiCalls, 3);
  assert.equal(result.truncated, true);
  assert.equal(f.generateReply.mock.callCount(), 7);
  noSend(f);
});

test('发送前竞态发现作者已回复，仍必须遵守每轮最多3次生成', async t => {
  const f = fixture(t);
  f.api.comments.mock.mockImplementation(async () => ({ comments: Array.from({ length: 6 }, (_, i) => comment(String(101 + i))), end: true }));
  // 一级评论初始没有回复，生成后最终检查才发现作者刚刚回复。
  f.api.thread.mock.mockImplementation(async () => ({ comments: [comment('201', { mid: MID })], end: true }));
  await f.engine.enable({ model: MODEL });
  await f.engine.run(true);
  assert.equal(f.generateReply.mock.callCount(), 3);
  noSend(f);
});

test('cached 回复的预览也最多3条且不消耗调用预算', async t => {
  const f = fixture(t);
  f.api.comments.mock.mockImplementation(async () => ({ comments: Array.from({ length: 6 }, (_, i) => comment(String(101 + i))), end: true }));
  f.generateReply.mock.mockImplementation(async () => draft({ cached: true, called: false }));
  const result = await f.engine.run();
  assert.equal(result.candidates.length, 3);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.candidates.every(item => item.cached));
  noSend(f);
});

test('自己、已发送/uncertain 和作者已回复的评论在生成前排除', async t => {
  const f = fixture(t);
  f.receipts.set(keyFor('102'), { at: NOW - 120000, status: 'sent' });
  f.receipts.set(keyFor('103'), { at: NOW - 120000, status: 'uncertain' });
  f.api.comments.mock.mockImplementation(async () => ({ comments: [
    comment('101', { mid: MID }), comment('102'), comment('103'), comment('104', { replyCount: 1 }),
  ], end: true }));
  f.api.thread.mock.mockImplementation(async () => ({ comments: [comment('201', { mid: MID })], end: true }));
  await f.engine.enable({ model: MODEL });
  assert.deepEqual((await f.engine.run(true)).candidates, []);
  assert.equal(f.generateReply.mock.callCount(), 0);
  noSend(f);
});

for (const limit of ['gap', 'daily']) {
  test(`${limit} 限额在生成之前拦截`, async t => {
    const f = fixture(t, { dailyLimit: 1 });
    f.receipts.set(keyFor('old'), { at: NOW - (limit === 'gap' ? 1000 : 120000), status: 'sent' });
    if (limit === 'gap') f.engine.settings.dailyLimit = 20;
    await f.engine.enable({ model: MODEL });
    const result = await f.engine.run(true);
    assert.match(result.limited, limit === 'gap' ? /发送间隔/ : /今日发送尝试上限/);
    assert.equal(f.generateReply.mock.callCount(), 0);
    assert.equal(f.api.comments.mock.callCount(), 0);
    noSend(f);
  });
}

test('模型异常不回退已有模板，并暂停发送', async t => {
  const f = fixture(t, { fallbackReply: '禁止用此模板回退', rules: [{ keyword: '普通', reply: '禁止规则回退' }] });
  f.generateReply.mock.mockImplementation(async () => { throw new Error('模拟模型失败'); });
  await f.engine.enable({ model: MODEL });
  await assert.rejects(f.engine.run(true), /模拟模型失败/);
  assert.equal(f.engine.status().enabled, false);
  assert.equal(f.engine.status().busy, false);
  noSend(f);
});

for (const action of ['pause', 'dispose', 'configure']) {
  test(`${action} 在模型 await 期间 abort 并阻止旧结果发送`, async t => {
    const f = fixture(t), entered = deferred(), release = deferred();
    let signal;
    f.generateReply.mock.mockImplementation(async input => {
      signal = input.signal;
      entered.resolve();
      await release.promise;
      return draft();
    });
    await f.engine.enable({ model: MODEL });
    const running = f.engine.run(true);
    await entered.promise;
    assert.equal(signal.aborted, false);
    if (action === 'configure') {
      await assert.rejects(f.engine.configure({ ...f.engine.settings, persona: '另一个完全虚构的角色' }), /任务执行中/);
    } else f.engine[action]();
    assert.equal(signal.aborted, true);
    release.resolve();
    assert.deepEqual(await running, { paused: true });
    assert.equal(f.engine.status().enabled, false);
    assert.equal(f.engine.status().busy, false);
    noSend(f);
  });
}

test('角色配置修改后必须重新开启，重新生成使用新角色', async t => {
  const f = fixture(t);
  await f.engine.enable({ model: MODEL });
  await f.engine.configure({ ...f.engine.settings, persona: '另一个虚构的耐心科普角色' });
  assert.equal(f.engine.status().enabled, false);
  assert.deepEqual(await f.engine.run(true), { skipped: '自动回复未开启' });
  assert.equal(f.generateReply.mock.callCount(), 0);
  await f.engine.enable({ model: MODEL });
  await f.engine.run(true);
  assert.equal(f.generateReply.mock.calls[0].arguments[0].settings.persona, '另一个虚构的耐心科普角色');
});

for (const reply of ['', '   ', '字'.repeat(181), null]) {
  test(`AI 返回非法文本必须二次校验并暂停（${reply === null ? 'null' : `长度${reply.length}`}）`, async t => {
    const f = fixture(t, { fallbackReply: '不能回退' });
    f.generateReply.mock.mockImplementation(async () => draft({ reply }));
    await f.engine.enable({ model: MODEL });
    await assert.rejects(f.engine.run(true), /AI回复格式或长度/);
    assert.equal(f.engine.status().enabled, false);
    noSend(f);
  });
}

test('AI 回复按 Unicode 字符计数，180个字符允许发送', async t => {
  const f = fixture(t);
  const reply = '😀'.repeat(180);
  f.generateReply.mock.mockImplementation(async () => draft({ reply }));
  await f.engine.enable({ model: MODEL });
  assert.equal((await f.engine.run(true)).sent, 1);
  assert.equal(f.api.reply.mock.calls[0].arguments[2], reply);
});
