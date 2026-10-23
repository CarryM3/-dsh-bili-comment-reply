import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyEngine,validateSettings} from './engine.js';
const ids=n=>Array.from({length:n},(_,i)=>`BV${String(i+1).padStart(10,'0')}`);
test('多选支持超过旧版10个稿件，超过1000个明确拒绝',()=>{
  assert.equal(validateSettings({bvids:ids(1000)}).bvids.length,1000);
  assert.throws(()=>validateSettings({bvids:ids(1001)}),/最多1000/);
});
test('大量选择每轮只检查10个并轮转，避免首个稿件长期占用检查',async()=>{
  const bvids=ids(12),scanned=[];
  const engine=new ReplyEngine({
    getCookie:async()=>'fixture-only',
    store:{settings:()=>validateSettings({replyMode:'template',bvids,fallbackReply:'谢谢'}),saveSettings:async()=>{},receipt:()=>undefined,entries:()=>[],put:async()=>{assert.fail('没有评论不能写发送记录');}},
    api:{whoami:async()=>({mid:'42',name:'作者'}),video:async bvid=>{scanned.push(bvid);return {bvid,aid:'99',title:bvid,ownerMid:'42'};},comments:async()=>({comments:[],end:true}),reply:async()=>{assert.fail('没有评论不能发送');}},
  });
  await engine.enable();scanned.length=0;
  await engine.run(true);assert.deepEqual(scanned,bvids.slice(0,10));
  scanned.length=0;await engine.run(true);
  assert.deepEqual(scanned,[...bvids.slice(10),...bvids.slice(0,8)]);
  engine.dispose();
});
