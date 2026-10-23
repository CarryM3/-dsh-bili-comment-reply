import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BiliApiError} from './bili-api.js';
import {DEFAULT_SETTINGS} from './engine.js';

const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
test('插件信息在中文和英文DSH中均显示中文，发布包只包含运行文件',async()=>{
  const pkg=await json('./package.json');
  assert.equal(pkg.version,'1.2.0');
  assert.equal(pkg.repository.url,'git+https://github.com/CarryM3/-dsh-bili-comment-reply.git');
  const en=await json('./locale/en.json');
  for(const locale of ['zh','zh-CN']) assert.deepEqual(await json(`./locale/${locale}.json`),en);
  assert.equal(en.meta.title,'B站评论助手');
  assert.match(en.meta.description,/[\u4e00-\u9fff]/);
  assert.ok(!pkg.files.includes('*.js'));
  assert.ok(!pkg.files.some(v=>/test|node_modules|\.env|credential/.test(v)));
  assert.ok(pkg.files.includes('host.js'));
  assert.ok(pkg.files.includes('persona-generator.js'));
  assert.equal(DEFAULT_SETTINGS.persona,'','发布包不能内置任何用户的人设');
  assert.equal(DEFAULT_SETTINGS.personaName,'');
  for(const file of ['host.js','engine.js','client.js','persona-generator.js']) {
    const text=await readFile(new URL(`./${file}`,import.meta.url),'utf8');
    assert.ok(!/[A-Z]:[\\/](?:Users[\\/]|[^'"\n]*[\\/]temp[\\/])/i.test(text),'用户私有路径不得进入发布源码');
  }
});
test('所有B站接口错误均提供中文提示，不向界面泄漏内部英文错误标记',()=>{
  for(const kind of ['api-error','http-error','timeout','network-error','risk-control','not-logged-in','invalid-response','invalid-json','invalid-id','invalid-page','invalid-cookie','missing-login-cookies','invalid-fetch','invalid-timeout','invalid-key','qr-error','invalid-bvid','invalid-message','missing-csrf','unknown-kind']) {
    const error=new BiliApiError(kind);
    assert.match(error.message,/[\u4e00-\u9fff]/);
    assert.ok(!error.message.includes(kind));
    assert.equal(error.kind,kind,'供内部程序判断的错误标记保持稳定');
  }
});
