import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {apply} from './host.js';

// 仅在显式提供已安装DSH模块时执行，不把个人安装路径或真实数据写进仓库。
const jsonModule=process.env.DSH_STORAGE_JSON_MODULE;
const domainModule=process.env.DSH_STORAGE_DOMAIN_MODULE;
for(const storedVersion of [1,2])test(`真实DSH JSON后端可打开v${storedVersion}配置并保留旧去重及AI预算`,{
  skip:!jsonModule||!domainModule,
},async()=>{
  const {JsonStorageBackend}=await import(jsonModule);
  const {DomainFacility}=await import(domainModule);
  const base=resolve(process.cwd(),'node_modules','.cache');await mkdir(base,{recursive:true});
  const root=await mkdtemp(join(base,'bili-storage-smoke-'));
  assert.equal(dirname(root),base);assert.ok(basename(root).startsWith('bili-storage-smoke-'));
  const backend=new JsonStorageBackend(root),effects=[];
  let facility,tool;
  const old={bvids:['BV1234567890'],rules:[{keyword:'旧规则',reply:'旧回复'}],fallbackReply:'',pollSeconds:120,gapSeconds:60,dailyLimit:20};
  const receipt={at:Date.now()-100000,bvid:'BV1234567890',commentId:'7',status:'sent',reply:'历史回复',replyId:'71'};
  const legacyDraft={at:Date.now(),day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),calls:2,status:'done',provider:'fixture-provider',model:'fixture-model',draft:{action:'reply',reply:'旧草稿'}};
  try {
    const unit=await backend.kv.open({name:'bili_comment_reply',version:storedVersion,tables:storedVersion===1?['receipts']:['receipts','drafts'],hasGlobal:true});
    await unit.setGlobal(old);await unit.putRecord('receipts','42:99:7',receipt);
    if(storedVersion===2)await unit.putRecord('drafts','legacy-draft',legacyDraft);
    await unit.close();
    const ctx={
      emit:()=>{},logger:{warn:()=>{},error:()=>{}},storage:{backend:{get:name=>{assert.equal(name,'json');return backend;}}},
      credentials:{resolve:async()=>{assert.fail('模拟试聊不读取真实B站凭证');},describe:async()=>({configured:false}),unset:async()=>{}},
      agentDefaultModel:{currentSelection:()=>({provider:'fixture-provider',model:'fixture-model'})},
      llm:{prepareCall:async config=>({config,stream:async function*(){yield {type:'text-delta',index:0,text:JSON.stringify({action:'reply',reply:'通用模型试聊草稿'})};yield {type:'finish',reason:{kind:'stop'}};}})},
      connection:{fetch:{register:()=>()=>{}}},tools:{register:value=>{tool=value;return ()=>{};}},
      provide:()=>{},effect:fn=>{effects.push(fn());},
    };
    facility=new DomainFacility(ctx,{backend:'json'});ctx.storageDomain=facility;
    await apply(ctx);
    const before=await tool.execute({action:'status'});
    assert.equal(before.enabled,false);assert.equal(before.settings.replyMode,'persona');assert.equal(before.settings.persona,'');
    assert.deepEqual(before.settings.bvids,old.bvids);assert.equal(before.history.length,1);assert.equal(before.history[0].replyId,'71');
    await tool.execute({action:'configure',settings:{...before.settings,personaName:'合成测试角色',persona:'说话友好简洁，不编造事实。'}});
    const draft=await tool.execute({action:'sample',comment:'仅用于测试的公开模拟评论'});
    assert.equal(draft.action,'reply');assert.equal(draft.source,'ai');
    const after=await tool.execute({action:'status'});assert.equal(after.todayGenerations,storedVersion===1?1:3);assert.equal(after.history.length,1);assert.equal(after.enabled,false);
    for(const effect of effects.splice(0).reverse())await effect();
    const persisted=JSON.parse(await readFile(join(root,'bili_comment_reply.json'),'utf8'));
    assert.equal(persisted.unit.version,storedVersion,'增量字段和新表不能强改已有文件格式版本');
    assert.deepEqual(persisted.tables.receipts['42:99:7'],receipt);
    assert.equal(Object.keys(persisted.tables.drafts).length,storedVersion===1?1:2);
    if(storedVersion===2)assert.deepEqual(persisted.tables.drafts['legacy-draft'],legacyDraft);
    const reopened=await backend.kv.open({name:'bili_comment_reply',version:storedVersion,tables:['receipts','drafts'],hasGlobal:true});
    const snapshot=await reopened.loadAll();assert.equal(snapshot.global.personaName,'合成测试角色');assert.equal(Object.keys(snapshot.tables.drafts).length,storedVersion===1?1:2);await reopened.close();
  }finally {
    for(const effect of effects.reverse())await effect();
    await facility?.closeAll();await backend.close();
    // 仅删除本测试刚创建且经过绝对路径边界校验的唯一临时目录。
    if(dirname(root)!==base||!basename(root).startsWith('bili-storage-smoke-'))throw new Error('测试目录边界校验失败');
    await rm(root,{recursive:true,force:true});
  }
});
