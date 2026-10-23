import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, ReplyEngine, dayKey, selectReply, validateSettings } from './engine.js';

const BVID = 'BV1234567890';
const MID = '9007199254740993001';
const AID = '9007199254740993002';
const COMMENT_ID = '9007199254740993003';
const COOKIE = 'mock-cookie';
const NOW = Date.parse('2026-06-01T04:00:00Z');
const keyFor = id => `${MID}:${AID}:${id}`;
const comment = (overrides = {}) => ({
  id: COMMENT_ID, mid: '9007199254740993004', name: '读者', message: '测试评论',
  ctime: Math.floor(NOW / 1000) + 1, replyCount: 0, ...overrides,
});

function fixture(t, settings = {}) {
  let clock = NOW;
  let saved = validateSettings({ replyMode: 'template', bvids: [BVID], fallbackReply: '谢谢{user}，欢迎观看{title}', ...settings });
  const receipts = new Map();
  const events = [];
  const store = {
    settings: t.mock.fn(() => saved),
    saveSettings: t.mock.fn(async value => { saved = structuredClone(value); }),
    receipt: t.mock.fn(key => receipts.get(key)),
    entries: t.mock.fn(() => [...receipts.entries()]),
    put: t.mock.fn(async (key, value) => {
      events.push(`put:${value.status}`);
      receipts.set(key, structuredClone(value));
    }),
  };
  const api = {
    whoami: t.mock.fn(async () => ({ mid: MID, name: '作者' })),
    video: t.mock.fn(async () => ({ aid: AID, bvid: BVID, ownerMid: MID, title: '作品' })),
    comments: t.mock.fn(async () => ({ comments: [comment()], end: true })),
    // 发送前总会检查 thread，默认提供完整、显式的分页终止结构。
    thread: t.mock.fn(async () => ({ comments: [], end: true })),
    reply: t.mock.fn(async (...args) => {
      events.push('reply');
      assert.equal(receipts.get(keyFor(args[1]))?.status, 'uncertain', '网络发送之前必须持久化占位');
      return { id: '9007199254740993005' };
    }),
  };
  const getCookie = t.mock.fn(async () => COOKIE);
  const engine = new ReplyEngine({ api, store, getCookie, now: () => clock });
  return { engine, api, store, receipts, events, getCookie, setNow(value) { clock = value; } };
}

function assertNoSend(f) {
  assert.equal(f.api.reply.mock.callCount(), 0);
  assert.equal(f.store.put.mock.callCount(), 0);
  assert.equal(f.receipts.size, 0);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('配置验证拒绝非法 BV、非法轮询/发送间隔，接受合法边界', () => {
  for (const bvid of ['', 'av123', 'BV123', 'BV12345678901', 'BV123456789_', 123]) {
    assert.throws(() => validateSettings({ bvids: [bvid] }), /有效BV/);
  }
  for (const [field, min, max] of [['pollSeconds', 60, 3600], ['gapSeconds', 30, 3600]]) {
    for (const value of [min - 1, max + 1, min + 0.5, String(min), NaN, Infinity]) {
      assert.throws(() => validateSettings({ [field]: value }), new RegExp({pollSeconds:'轮询间隔',gapSeconds:'发送间隔'}[field]));
    }
    for (const value of [min, max]) assert.equal(validateSettings({ [field]: value })[field], value);
  }
  assert.deepEqual(validateSettings({ bvids: [BVID, BVID] }).bvids, [BVID]);
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.replyMode, 'persona');
  assert.equal(DEFAULT_SETTINGS.persona, '');
  assert.equal(DEFAULT_SETTINGS.maxReplyChars, 180);
  assert.equal(DEFAULT_SETTINGS.aiDailyLimit, 40);
});

test('非本人稿件不能开启；运行时所有权变化则拒绝并暂停', async t => {
  const f = fixture(t);
  f.api.video.mock.mockImplementation(async () => ({ aid: AID, ownerMid: '999', title: '其他稿件' }));
  await assert.rejects(f.engine.enable(), /不属于当前登录账号/);
  assert.equal(f.engine.status().enabled, false);
  assertNoSend(f);
  f.api.video.mock.mockImplementation(async () => ({ aid: AID, ownerMid: MID, title: '作品' }));
  await f.engine.enable();
  f.api.video.mock.mockImplementation(async () => ({ aid: AID, ownerMid: '999', title: '其他稿件' }));
  await assert.rejects(f.engine.run(true), /不属于当前登录账号/);
  assert.equal(f.engine.status().enabled, false);
  assert.equal(f.engine.status().busy, false);
  assert.match(f.engine.status().message, /不属于当前登录账号/);
  assertNoSend(f);
});

test('默认关闭，发送模式不读取账号、不扫描、不发送', async t => {
  const f = fixture(t);
  assert.equal(f.engine.status().enabled, false);
  assert.deepEqual(await f.engine.run(true), { skipped: '自动回复未开启' });
  assert.equal(f.getCookie.mock.callCount(), 0);
  assert.equal(f.api.comments.mock.callCount(), 0);
  assertNoSend(f);
});

test('预览给出候选但不发送、不写 receipt，开启后预览也不发送', async t => {
  const f = fixture(t);
  for (const enabled of [false, true]) {
    if (enabled) await f.engine.enable();
    const result = await f.engine.run();
    assert.deepEqual(result.candidates.map(c => [c.commentId, c.reply]), [[COMMENT_ID, '谢谢读者，欢迎观看作品']]);
    assertNoSend(f);
  }
});

test('配置落库期间不能并发开启或覆盖配置，持久化失败后仍可重试', async t => {
  const f=fixture(t), gate=deferred();
  f.store.saveSettings.mock.mockImplementation(async()=>gate.promise);
  const saving=f.engine.configure({...f.engine.settings,fallbackReply:'新规则'});
  await assert.rejects(f.engine.enable(),/任务正在执行/);
  await assert.rejects(f.engine.configure({...f.engine.settings,fallbackReply:'并发规则'}),/任务执行中/);
  assert.equal(f.engine.status().enabled,false);
  gate.resolve();await saving;
  assert.equal(f.engine.settings.fallbackReply,'新规则');
  assert.equal(f.engine.configuring,false);
  f.store.saveSettings.mock.mockImplementation(async()=>{throw new Error('存储失败');});
  await assert.rejects(f.engine.configure(f.engine.settings),/存储失败/);
  assert.equal(f.engine.configuring,false);
  assertNoSend(f);
});
test('关键词按配置顺序首次命中、忽略大小写，模板单遍替换与回退', () => {
  const settings = validateSettings({
    replyMode: 'template',
    rules: [{ keyword: ' TEST ', reply: '第一:{user}:{title}:{other}' }, { keyword: 'test评论', reply: '第二' }],
    fallbackReply: '默认:{user}',
  });
  assert.equal(selectReply(settings, comment({ message: 'TeSt评论', name: '{title}' }), { title: '{user}' }), '第一:{title}:{user}:{other}');
  assert.equal(selectReply(settings, comment(), { title: '作品' }), '默认:读者');
  assert.equal(selectReply(validateSettings({ replyMode: 'template' }), comment(), { title: '作品' }), '');
  assert.equal(selectReply({ ...settings, fallbackReply: '{title}' }, comment(), { title: '字'.repeat(600) }).length, 500);
});

test('持久化 uncertain 占位先于网络，成功后记录 sent 且保留字符串 ID', async t => {
  const f = fixture(t);
  await f.engine.enable();
  const result = await f.engine.run(true);
  assert.equal(result.sent, 1);
  assert.deepEqual(f.events, ['put:uncertain', 'reply', 'put:sent']);
  assert.deepEqual(f.api.reply.mock.calls[0].arguments, [AID, COMMENT_ID, '谢谢读者，欢迎观看作品', COOKIE]);
  assert.deepEqual(f.receipts.get(keyFor(COMMENT_ID)), {
    at: NOW, bvid: BVID, commentId: COMMENT_ID, status: 'sent', reply: '谢谢读者，欢迎观看作品', replyId: '9007199254740993005',
  });
  assert.deepEqual(f.api.thread.mock.calls[0].arguments, [AID, COMMENT_ID, COOKIE, 1]);
});

test('发送异常保留 uncertain、暂停；重新开启也不得重复尝试', async t => {
  const f = fixture(t);
  f.api.reply.mock.mockImplementation(async () => { throw new Error('模拟网络超时'); });
  await f.engine.enable();
  await assert.rejects(f.engine.run(true), /模拟网络超时/);
  assert.equal(f.engine.status().enabled, false);
  assert.equal(f.engine.status().busy, false);
  assert.equal(f.receipts.get(keyFor(COMMENT_ID)).status, 'uncertain');
  assert.equal(f.engine.status().todayAttempts, 1);
  await f.engine.run(true);
  f.setNow(NOW + 120000);
  await f.engine.enable();
  assert.deepEqual((await f.engine.run(true)).candidates, []);
  assert.equal(f.api.reply.mock.callCount(), 1);
  assert.equal(f.store.put.mock.callCount(), 1);
});

test('北京时间日期在 UTC 16:00 换日', () => {
  assert.equal(dayKey(Date.parse('2026-06-01T15:59:59.999Z')), '2026-06-01');
  assert.equal(dayKey(Date.parse('2026-06-01T16:00:00Z')), '2026-06-02');
});

test('日限额计入当日全部尝试，跨北京时间午夜后恢复', async t => {
  const f = fixture(t, { dailyLimit: 1, gapSeconds: 30 });
  const midnight = Date.parse('2026-06-01T16:00:00Z');
  f.setNow(midnight - 1);
  f.api.comments.mock.mockImplementation(async () => ({ comments: [comment({ ctime: Math.floor(midnight / 1000) + 1 })], end: true }));
  f.receipts.set(keyFor('old'), { at: midnight - 60000, status: 'uncertain' });
  await f.engine.enable();
  assert.equal(f.engine.status().todayAttempts, 1);
  assert.deepEqual(await f.engine.run(true), { limited: '已达今日发送尝试上限' });
  assertNoWrites(f);
  f.setNow(midnight);
  assert.equal(f.engine.status().todayAttempts, 0);
  assert.equal((await f.engine.run(true)).sent, 1);
});

function assertNoWrites(f) {
  assert.equal(f.api.reply.mock.callCount(), 0);
  assert.equal(f.store.put.mock.callCount(), 0);
}

test('发送间隔在边界前阻止，恰好达到间隔允许发送', async t => {
  const f = fixture(t, { gapSeconds: 60 });
  f.receipts.set(keyFor('old'), { at: NOW - 59999, status: 'sent' });
  await f.engine.enable();
  assert.deepEqual(await f.engine.run(true), { limited: '等待发送间隔' });
  assertNoWrites(f);
  f.setNow(NOW + 1);
  assert.equal((await f.engine.run(true)).sent, 1);
});

test('开启发生在秒中间时，排除同秒历史评论', async t => {
  const f = fixture(t);
  f.setNow(NOW + 500);
  const second = Math.floor(NOW / 1000);
  f.api.comments.mock.mockImplementation(async () => ({ comments: [comment({ id: '201', ctime: second }), comment({ id: '202', ctime: second + 1 })], end: true }));
  await f.engine.enable();
  assert.equal(f.engine.status().since, second + 1);
  assert.equal((await f.engine.run(true)).sent, 1);
  assert.equal(f.api.reply.mock.calls[0].arguments[1], '202');
});

test('发送只处理开启后新评论，旧评论仍可预览', async t => {
  const f = fixture(t);
  const since = Math.floor(NOW / 1000);
  f.api.comments.mock.mockImplementation(async () => ({ comments: [comment({ id: '101', ctime: since - 1 }), comment({ id: '102', ctime: since + 1 })], end: true }));
  await f.engine.enable();
  assert.deepEqual((await f.engine.run(false)).candidates.map(c => c.commentId), ['101', '102']);
  assertNoSend(f);
  assert.equal((await f.engine.run(true)).sent, 1);
  assert.equal(f.api.reply.mock.calls[0].arguments[1], '102');
});

test('跳过自己、已有 receipt 和作者已回复的线程，仅发送未回复线程', async t => {
  const f = fixture(t);
  f.receipts.set(keyFor('102'), { at: NOW - 120000, status: 'sent' });
  f.api.comments.mock.mockImplementation(async () => ({ comments: [
    comment({ id: '101', mid: MID }), comment({ id: '102' }),
    comment({ id: '103', replyCount: 1 }), comment({ id: '104', replyCount: 1 }),
  ], end: true }));
  f.api.thread.mock.mockImplementation(async (_aid, id) => ({ comments: id === '103' ? [comment({ mid: MID })] : [], end: true }));
  await f.engine.enable();
  assert.equal((await f.engine.run(true)).sent, 1);
  assert.equal(f.api.reply.mock.calls[0].arguments[1], '104');
  assert.deepEqual(f.api.thread.mock.calls.map(c => c.arguments[1]), ['103', '104', '104']);
});

test('长线程扫描十页仍未结束时保守跳过，不发送', async t => {
  const f = fixture(t);
  f.api.comments.mock.mockImplementation(async () => ({ comments: [comment({ replyCount: 201 })], end: true }));
  f.api.thread.mock.mockImplementation(async () => ({ comments: [], end: false }));
  await f.engine.enable();
  assert.deepEqual((await f.engine.run(true)).candidates, []);
  assert.deepEqual(f.api.thread.mock.calls.map(c => c.arguments[3]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assertNoSend(f);
});

test('发送前最终 thread 检查发现作者已回复则跳过', async t => {
  const f = fixture(t);
  f.api.thread.mock.mockImplementation(async () => ({ comments: [comment({ mid: MID })], end: true }));
  await f.engine.enable();
  await f.engine.run(true);
  assertNoSend(f);
});

for (const action of ['pause', 'dispose']) {
  for (const stage of ['thread', 'put']) {
    test(`${action} 在 ${stage} 异步等待期间关闭发送闸门`, async t => {
      const f = fixture(t);
      const entered = deferred();
      const release = deferred();
      if (stage === 'thread') {
        f.api.thread.mock.mockImplementation(async () => {
          entered.resolve();
          await release.promise;
          return { comments: [], end: true };
        });
      } else {
        f.store.put.mock.mockImplementation(async (key, value) => {
          f.receipts.set(key, structuredClone(value));
          if (value.status === 'uncertain') { entered.resolve(); await release.promise; }
        });
      }
      await f.engine.enable();
      const running = f.engine.run(true);
      await entered.promise;
      f.engine[action]();
      release.resolve();
      assert.deepEqual(await running, { paused: true });
      assert.equal(f.api.reply.mock.callCount(), 0);
      assert.equal(f.engine.status().enabled, false);
      assert.equal(f.engine.status().busy, false);
      if (stage === 'put') assert.equal(f.receipts.get(keyFor(COMMENT_ID)).status, 'cancelled');
      else assert.equal(f.store.put.mock.callCount(), 0);
      assert.deepEqual(await f.engine.run(true), { skipped: '自动回复未开启' });
      if (action === 'dispose') await assert.rejects(f.engine.enable(), /插件已停止/);
    });
  }
}

for (const action of ['pause', 'dispose', 'configure']) {
  test(`enable 等待身份期间 ${action} 不得被稍后完成的开启覆盖`, async t => {
    const f = fixture(t);
    const entered = deferred();
    const release = deferred();
    f.api.whoami.mock.mockImplementation(async () => { entered.resolve(); await release.promise; return { mid: MID, name: '作者' }; });
    const enabling = f.engine.enable();
    const rejected = assert.rejects(enabling, /开启操作已取消/);
    await entered.promise;
    if (action === 'configure') await f.engine.configure({ replyMode: 'template', bvids: [BVID], fallbackReply: '新配置' });
    else f.engine[action]();
    release.resolve();
    await rejected;
    assert.equal(f.engine.status().enabled, false);
    assertNoSend(f);
  });
}

test('占位持久化失败不得发送，并暂停引擎', async t => {
  const f = fixture(t);
  f.store.put.mock.mockImplementation(async () => { throw new Error('模拟磁盘写入失败'); });
  await f.engine.enable();
  await assert.rejects(f.engine.run(true), /模拟磁盘写入失败/);
  assert.equal(f.api.reply.mock.callCount(), 0);
  assert.equal(f.engine.status().enabled, false);
  assert.equal(f.engine.status().busy, false);
});

test('configure 成功或验证失败都先暂停，成功后必须重新开启', async t => {
  const f = fixture(t);
  await f.engine.enable();
  await f.engine.configure({ replyMode: 'template', bvids: [BVID], fallbackReply: '更新后的回复' });
  assert.equal(f.engine.status().enabled, false);
  assert.equal(f.engine.settings.fallbackReply, '更新后的回复');
  assert.equal(f.store.saveSettings.mock.callCount(), 1);
  await f.engine.run(true);
  assertNoSend(f);
  await f.engine.enable();
  await assert.rejects(f.engine.configure({ replyMode: 'template', gapSeconds: 1 }), /发送间隔/);
  assert.equal(f.engine.status().enabled, false);
  assert.equal(f.store.saveSettings.mock.callCount(), 1);
});

test('configure 在任务执行中仍先暂停，拒绝修改并拦截待发送请求', async t => {
  const f = fixture(t);
  const entered = deferred();
  const release = deferred();
  f.api.thread.mock.mockImplementation(async () => { entered.resolve(); await release.promise; return { comments: [], end: true }; });
  await f.engine.enable();
  const running = f.engine.run(true);
  await entered.promise;
  await assert.rejects(f.engine.configure({ replyMode: 'template' }), /任务执行中/);
  assert.equal(f.engine.status().enabled, false);
  release.resolve();
  assert.deepEqual(await running, { paused: true });
  assert.equal(f.store.saveSettings.mock.callCount(), 0);
  assertNoSend(f);
});
