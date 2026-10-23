import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaGenerator } from './persona-generator.js';

const route = { provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'low' };
const input = () => ({
  settings: { persona: '通用假人设：温和、简洁，喜欢讨论科学。' },
  account: { mid: 'fake-mid', name: '假账号', cookie: 'fake-cookie' },
  video: { aid: 'fake-aid', title: '通用测试标题', bvid: 'fake-bv' },
  comment: { id: 'fake-comment-id', message: '这是什么原理？', username: '假用户', root: 'fake-root' },
});
const good = JSON.stringify({ action: 'reply', reply: '可以先观察现象，再讨论原因。' });
const stop = { type: 'finish', reason: { kind: 'stop' } };
const delta = text => ({ type: 'text-delta', delta: text });
function rig(options = {}) {
  const table = options.table ?? new Map();
  if (!table.put) table.put = (key, value) => table.set(key, structuredClone(value));
  const prepared = [];
  const streams = [];
  let model = { ...route };
  let timestamp = Date.UTC(2026, 0, 1, 16, 0, 0);
  const llm = { prepareCall: async (config, signal) => {
    prepared.push({ config, signal });
    if (options.prepare) return options.prepare(config, signal);
    return { config: { ...config, tools: ['must-be-cleared'] }, stream: async function* (config) {
      streams.push(config);
      if (options.beforeStream) options.beforeStream(config);
      const chunks = typeof options.chunks === 'function' ? options.chunks() : (options.chunks ?? [delta(good), stop]);
      for (const chunk of chunks) yield chunk;
    } };
  } };
  const generator = createPersonaGenerator({ llm, table, getModel: options.getModel ?? (() => model),
    now: () => timestamp, timeoutMs: options.timeoutMs ?? 300 });
  return { ...generator, table, prepared, streams, setModel: value => { model = value; }, setNow: value => { timestamp = value; } };
}

test('最小提交、默认路由、禁用工具、delta/final 不双拼和持久化隐私', async () => {
  const r = rig({ chunks: [delta(good.slice(0, 14)), delta(good.slice(14)), { type: 'block-end', block: { type: 'text', text: good } }, stop] });
  const result = await r.generate(input());
  assert.deepEqual(result, { action: 'reply', reply: '可以先观察现象，再讨论原因。', source: 'ai', ...{ provider: route.provider, model: route.model }, cached: false, called: true });
  assert.deepEqual(r.prepared[0].config, { ...route, maxTokens: 1024 });
  const request = r.streams[0];
  assert.deepEqual(request.tools, []);
  assert.deepEqual(request.messages, [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ videoTitle: input().video.title, comment: input().comment.message }) }] }]);
  assert.ok(request.system.includes(input().settings.persona));
  assert.match(request.system, /不可信数据/);
  for (const secret of ['fake-mid', 'fake-aid', 'fake-comment-id', '假账号', 'fake-cookie', 'fake-bv', '假用户', 'fake-root']) {
    assert.ok(!JSON.stringify(request).includes(secret));
    assert.ok(!JSON.stringify([...r.table]).includes(secret));
  }
  const [[key, record]] = [...r.table];
  assert.match(key, /^[a-f\d]{64}$/);
  assert.deepEqual(Object.keys(record).sort(), ['at', 'calls', 'day', 'draft', 'model', 'provider', 'status']);
  assert.equal(record.day, '2026-01-02');
  assert.equal(record.status, 'done');
  assert.ok(!JSON.stringify(record).includes(input().settings.persona));
  assert.ok(!JSON.stringify(record).includes(input().comment.message));
  assert.deepEqual(r.stats(), { todayGenerations: 1 });
});

test('validateModel 只准备调用，不生成、不计费且不修改路由', async () => {
  const r = rig({ getModel: async () => ({ ...route, extra: '不应透传' }) });
  assert.deepEqual(await r.validateModel(), route);
  assert.equal(r.prepared.length, 1);
  assert.equal(r.streams.length, 0);
  assert.equal(r.table.size, 0);
  assert.deepEqual(r.stats(), { todayGenerations: 0 });
  const bad = rig({ getModel: () => ({ provider: '', model: 'x' }) });
  await assert.rejects(bad.validateModel(), /默认模型配置无效/);
  assert.equal(bad.prepared.length, 0);
});

test('期望路由授权闸在 prepare 前拒绝任何路由变化', async () => {
  for (const changed of [{ ...route, provider: 'other' }, { ...route, model: 'other' }, { ...route, reasoningEffort: 'high' }, { provider: route.provider, model: route.model }]) {
    const r = rig();
    await assert.rejects(r.validateModel(changed), /默认模型已变化，请重新确认/);
    await assert.rejects(r.generate({ ...input(), expectedModel: changed }), /默认模型已变化，请重新确认/);
    assert.equal(r.prepared.length, 0);
    assert.equal(r.table.size, 0);
  }
  const r = rig();
  assert.deepEqual(await r.validateModel(route), route);
  assert.equal((await r.generate({ ...input(), expectedModel: route })).called, true);
});

test('skip 缓存复用，不准备网络且不耗额度', async () => {
  const r = rig({ chunks: [delta('{"action":"skip","reply":""}'), stop] });
  assert.equal((await r.generate(input())).action, 'skip');
  const cached = await r.generate({ ...input(), settings: { ...input().settings, aiDailyLimit: 0 } });
  assert.equal(cached.cached, true);
  assert.equal(cached.called, false);
  assert.equal(r.prepared.length, 1);
  assert.equal(r.stats().todayGenerations, 1);
});

test('pending 预算在 prepare 和 stream 之前落盘，额度在新实例中持续有效', async () => {
  let r;
  r = rig({ prepare: async () => {
    assert.equal([...r.table.values()][0].status, 'pending');
    assert.equal([...r.table.values()][0].calls, 1);
    return { config: {}, stream: async function* () { yield delta(good); yield stop; } };
  } });
  await r.generate({ ...input(), settings: { ...input().settings, aiDailyLimit: 1 } });
  const next = rig({ table: r.table });
  const changed = input();
  changed.comment.id = 'another';
  changed.settings.aiDailyLimit = 1;
  await assert.rejects(next.generate(changed), /额度已用完/);
  assert.equal(next.prepared.length, 0);
});

test('失败仍计费，错误完全脱敏；同日重试累加，跨北京时间日重置', async () => {
  const r = rig({ prepare: () => { throw new Error('fake-cookie 和角色设定及provider原始错误'); } });
  for (let calls = 1; calls <= 2; calls++) {
    await assert.rejects(r.generate(input()), error => {
      assert.equal(error.message, 'AI 生成失败，请检查模型配置后人工重试。');
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal([...r.table.values()][0].calls, calls);
    assert.equal([...r.table.values()][0].status, 'failed');
  }
  assert.ok(!JSON.stringify([...r.table]).includes('fake-cookie'));
  assert.equal(r.stats().todayGenerations, 2);
  r.setNow(Date.UTC(2026, 0, 2, 16));
  assert.equal(r.stats().todayGenerations, 0);
  await assert.rejects(r.generate(input()));
  assert.equal([...r.table.values()][0].calls, 1);
  assert.equal([...r.table.values()][0].day, '2026-01-03');
});

test('默认每日额度为40，failed记录同样计入预算', async () => {
  const r = rig();
  r.table.put('previous-failure', { at: Date.UTC(2026, 0, 1, 16), day: '2026-01-02', calls: 40,
    status: 'failed', provider: route.provider, model: route.model });
  await assert.rejects(r.generate(input()), /额度已用完/);
  assert.equal(r.prepared.length, 0);
  assert.deepEqual(r.stats(), { todayGenerations: 40 });
});

test('异步持久化完成之前不得调用 prepare', async () => {
  const records = new Map();
  let stored = false;
  const table = {
    get: async key => records.get(key),
    put: async (key, value) => {
      await new Promise(resolve => setImmediate(resolve));
      records.set(key, structuredClone(value));
      stored = true;
    },
    entries: () => records.entries(),
  };
  const r = rig({ table, prepare: async () => {
    assert.equal(stored, true);
    assert.equal([...records.values()][0].status, 'pending');
    return { config: {}, stream: async function* () { yield delta(good); yield stop; } };
  } });
  await r.generate(input());
  assert.equal([...records.values()][0].status, 'done');
});

test('validateModel 对忽略 signal 的 prepare 同样限时', async () => {
  let signal;
  const r = rig({ timeoutMs: 15, prepare: (_, providedSignal) => {
    signal = providedSignal;
    return new Promise(() => {});
  } });
  await assert.rejects(r.validateModel(), /生成超时/);
  assert.equal(signal.aborted, true);
  assert.equal(r.streams.length, 0);
  assert.equal(r.table.size, 0);
});

test('崩溃 pending 不自动重试、不增加调用', async () => {
  const r = rig();
  await r.generate(input());
  const [[key, value]] = [...r.table];
  r.table.put(key, { ...value, status: 'pending' });
  await assert.rejects(r.generate(input()), /修改人设或稍后人工处理/);
  assert.equal(r.prepared.length, 1);
  assert.equal(r.stats().todayGenerations, 1);
});

test('最终 text block 和完整 JSON 围栏可用', async () => {
  const r = rig({ chunks: [{ type: 'block-end', block: { type: 'text', text: '```json\n' + good + '\n```' } }, stop] });
  assert.equal((await r.generate(input())).action, 'reply');
});

for (const [name, chunks] of [
  ['工具 delta', [delta(good), { type: 'tool-call-delta' }, stop]],
  ['工具 block', [{ type: 'block-end', block: { type: 'tool-call' } }, stop]],
  ['未完成', [delta(good)]],
  ['流错误', [delta(good), { type: 'error', error: 'fake-secret' }]],
  ['流中止', [delta(good), { type: 'aborted' }, stop]],
  ['流token耗尽', [delta(good), { type: 'max-tokens' }, stop]],
  ['max tokens', [delta(good), { type: 'finish', reason: { kind: 'max-tokens' } }]],
  ['aborted', [delta(good), { type: 'finish', reason: { kind: 'aborted' } }]],
  ['混杂正文', [delta('解释：' + good), stop]],
  ['额外 JSON 字段', [delta('{"action":"reply","reply":"你好","extra":true}'), stop]],
  ['空回复', [delta('{"action":"reply","reply":"  "}'), stop]],
  ['控制字符', [delta(JSON.stringify({ action: 'reply', reply: '第一行\n第二行' })), stop]],
  ['URL', [delta('{"action":"reply","reply":"访问 https://example.com"}'), stop]],
  ['裸域名', [delta('{"action":"reply","reply":"访问 example.com/path"}'), stop]],
  ['超长', [delta(JSON.stringify({ action: 'reply', reply: '字'.repeat(181) })), stop]],
]) {
  test(`拒绝${name}，保留 failed 和计费`, async () => {
    const r = rig({ chunks });
    await assert.rejects(r.generate(input()), /模型输出无效/);
    assert.equal([...r.table.values()][0].status, 'failed');
    assert.equal(r.stats().todayGenerations, 1);
  });
}

test('按 Unicode 码点计字，不截断', async () => {
  const r = rig({ chunks: [delta('{"action":"reply","reply":"😀😀"}'), stop] });
  assert.equal((await r.generate({ ...input(), settings: { ...input().settings, maxReplyChars: 2 } })).reply, '😀😀');
});

test('非法配置无网络、无记录', async () => {
  for (const settings of [{ persona: '' }, { persona: '假人设', maxReplyChars: 1.2 }, { persona: '假人设', aiDailyLimit: -1 }]) {
    const r = rig();
    await assert.rejects(r.generate({ ...input(), settings }), /配置或输入无效/);
    assert.equal(r.prepared.length, 0);
    assert.equal(r.table.size, 0);
  }
});

test('角色、模型、评论、标题、账号、视频、字数、推理档位分别隔离缓存', async () => {
  const r = rig();
  await r.generate(input());
  const cases = [
    value => { value.settings.persona += '多一点幽默'; },
    value => { value.comment.message += '请说明'; },
    value => { value.comment.id += '-2'; },
    value => { value.video.title += '第二期'; },
    value => { value.account.mid += '-2'; },
    value => { value.video.aid += '-2'; },
    value => { value.settings.maxReplyChars = 100; },
  ];
  for (const change of cases) {
    const value = input();
    change(value);
    assert.equal((await r.generate(value)).cached, false);
  }
  for (const updated of [{ ...route, model: 'other' }, { ...route, provider: 'other' }, { ...route, reasoningEffort: 'high' }]) {
    r.setModel(updated);
    assert.equal((await r.generate(input())).cached, false);
  }
  assert.equal(r.table.size, 11);
});

test('外部取消无需等待忽略 signal 的迭代器，晚到结果不覆盖 failed', async () => {
  let release;
  let internalSignal;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const late = new Promise(resolve => { release = resolve; });
  const r = rig({ prepare: async (_, signal) => {
    internalSignal = signal;
    return { config: {}, stream: async function* () { started(); await late; yield delta(good); yield stop; } };
  } });
  const controller = new AbortController();
  const task = r.generate({ ...input(), signal: controller.signal });
  await ready;
  controller.abort('fake-secret');
  await assert.rejects(task, /生成已取消/);
  assert.equal(internalSignal.aborted, true);
  assert.equal([...r.table.values()][0].status, 'failed');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...r.table.values()][0].status, 'failed');
});

test('超时中止忽略 signal 的 prepare，不挂死且晚到不调用 stream', async () => {
  let release;
  let internalSignal;
  let streamed = false;
  const r = rig({ timeoutMs: 15, prepare: (_, signal) => {
    internalSignal = signal;
    return new Promise(resolve => { release = () => resolve({ config: {}, stream: async function* () { streamed = true; yield delta(good); yield stop; } }); });
  } });
  await assert.rejects(r.generate(input()), /生成超时/);
  assert.equal(internalSignal.aborted, true);
  assert.equal([...r.table.values()][0].status, 'failed');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(streamed, false);
  assert.equal([...r.table.values()][0].status, 'failed');
});

test('超时也覆盖忽略 signal 的 stream.next', async () => {
  let observed;
  const r = rig({ timeoutMs: 15, prepare: async (_, signal) => {
    observed = signal;
    return { config: {}, stream: async function* () { await new Promise(() => {}); } };
  } });
  await assert.rejects(r.generate(input()), /生成超时/);
  assert.equal(observed.aborted, true);
  assert.equal([...r.table.values()][0].status, 'failed');
});

test('已取消的输入不请求模型', async () => {
  const r = rig();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(r.generate({ ...input(), signal: controller.signal }), /生成已取消/);
  assert.equal(r.prepared.length, 0);
});

test('全局 busy 锁跨实例拒绝并发，完成后释放', async () => {
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const a = rig({ prepare: async () => {
    entered();
    await gate;
    return { config: {}, stream: async function* () { yield delta(good); yield stop; } };
  } });
  const b = rig();
  const task = a.generate(input());
  await ready;
  await assert.rejects(a.generate(input()), /正在生成回复/);
  await assert.rejects(b.generate(input()), /正在生成回复/);
  assert.equal(b.prepared.length, 0);
  release();
  await task;
  assert.equal((await b.generate(input())).called, true);
});
