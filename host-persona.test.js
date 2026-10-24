import test from 'node:test';
import assert from 'node:assert/strict';
import {apply,inject} from './host.js';
import {DEFAULT_SETTINGS} from './engine.js';
import {BiliApi} from './bili-api.js';

// 所有角色及凭证均为通用合成样本，不读取用户本机人设或账号。
const MODEL={provider:'fixture-provider',model:'fixture-model'};
const PERSONA={...DEFAULT_SETTINGS,bvids:['BV1234567890'],personaName:'测试角色',persona:'表达简洁友善，遇到未知内容坦诚说明。'};
const DRAFT={action:'reply',reply:'这是模型生成的通用测试草稿'};
function request(action,input){return new Request('http://localhost/api/bili-comment-reply',{method:'POST',headers:{'Content-Type':'application/json','x-dsh-bili-ui':'1'},body:JSON.stringify({action,input})});}
async function fixture({initial,receipts=[],stream,prepare}={}){
  let value,route,tool,service,spec,selection={...MODEL},cookieReads=0;
  const tables=new Map([['receipts',new Map(receipts)],['drafts',new Map()]]),effects=[],calls=[],streams=[];
  const ctx={
    credentials:{resolve:async()=>{cookieReads++;return {value:'SESSDATA=fixture-secret; bili_jct=fixture-secret; DedeUserID=42'};},describe:async()=>({configured:true}),unset:async()=>{}},
    agentDefaultModel:{currentSelection:()=>selection},
    llm:{prepareCall:async(config,signal)=>{
      calls.push({config,signal});if(prepare)await prepare(config,signal);
      return {config,stream:options=>{streams.push(options);return stream?stream(options):(async function*(){yield {type:'text-delta',index:0,text:JSON.stringify(DRAFT)};yield {type:'finish',reason:{kind:'stop'}};})();}};
    }},
    storageDomain:{open:async input=>{spec=input;value=spec.global.schema.parse(structuredClone(initial??spec.global.initial));return {
      global:{get:()=>value,set:async v=>{value=spec.global.schema.parse(v);}},
      table:name=>{assert.ok(spec.tables[name]);const rows=tables.get(name);return {get:k=>rows.get(k),entries:()=>rows.entries(),put:async(k,v)=>rows.set(k,spec.tables[name].valueSchema.parse(v))};},close:async()=>{},
    };}},
    connection:{fetch:{register:r=>{route=r;return ()=>{};}}},tools:{register:t=>{tool=t;return ()=>{};}},
    provide:(name,s)=>{assert.equal(name,'biliCommentReply');service=s;},effect:fn=>{effects.push(fn());},
  };
  await apply(ctx);
  return {tool,service,route,tables,calls,streams,get spec(){return spec;},get cookieReads(){return cookieReads;},setModel:v=>{selection=v;},status:()=>tool.execute({action:'status'}),configure:(settings=PERSONA)=>tool.execute({action:'configure',settings}),ui:async(action,input)=>{const response=await route.fetch(request(action,input));return {status:response.status,...await response.json()};},close:async()=>{for(const effect of effects.reverse())await effect();}};
}
function ownAccount(t){
  t.mock.method(BiliApi.prototype,'whoami',async()=>({mid:'42',name:'合成账号'}));
  t.mock.method(BiliApi.prototype,'video',async bvid=>({aid:'99',bvid,title:'通用作品',ownerMid:'42'}));
}
async function approval(f){const {settings,model}=await f.status();return {confirmSelection:true,bvids:settings.bvids,settings,confirmAI:true,model};}

test('确认实例标识在同一后台内稳定，重建后变化且不写设置',async()=>{
  const a=await fixture(),b=await fixture();try{
    const first=await a.status(),again=await a.status(),other=await b.status();
    assert.equal(typeof first.confirmationEpoch,'string');assert.ok(first.confirmationEpoch);
    assert.equal(first.confirmationEpoch,again.confirmationEpoch);assert.notEqual(first.confirmationEpoch,other.confirmationEpoch);
    assert.equal(first.settings.confirmationEpoch,undefined);assert.equal(first.enabled,false);
  }finally{await a.close();await b.close();}
});
test('默认persona不需要关键词或默认答案即可保存并经UI确认开启',async t=>{
  ownAccount(t);const f=await fixture();try{
    assert.ok(inject.includes('llm'));assert.ok(inject.includes('agentDefaultModel'));
    const saved=await f.configure();assert.equal(saved.settings.replyMode,'persona');assert.deepEqual(saved.settings.rules,[]);assert.equal(saved.settings.fallbackReply,'');
    const before=await f.status();assert.equal(before.version,'1.2.2');assert.deepEqual(before.model,MODEL);assert.equal(before.todayGenerations,0);
    assert.ok(!f.tool.parameters.properties.action.enum.includes('enable'));
    const result=await f.ui('enable',await approval(f));assert.equal(result.status,200);assert.equal(result.value.enabled,true);
    assert.equal(f.calls.length,1);assert.equal(f.streams.length,0,'开启仅校验模型，不生成');
    await assert.rejects(f.tool.execute({action:'sample',comment:'假评论'}),/先暂停/);
    await f.tool.execute({action:'pause'});
  }finally{await f.close();}
});
test('缺少人设、AI确认或精确当前模型路由均不能开启',async t=>{
  ownAccount(t);const f=await fixture();try{
    await f.configure({...PERSONA,persona:''});assert.match((await f.ui('enable',await approval(f))).error,/角色设定/);
    await f.configure();const input=await approval(f);
    for(const patch of [{confirmAI:undefined},{confirmAI:false},{model:undefined},{model:{...MODEL,extra:true}},{model:{...MODEL,provider:'other-provider'}},{model:{...MODEL,reasoningEffort:'high'}}]){
      const result=await f.ui('enable',{...input,...patch});assert.equal(result.status,400);assert.match(result.error,/默认模型/);
    }
    f.setModel({...MODEL,model:'changed-model'});const stale=await f.ui('enable',input);assert.equal(stale.status,400);assert.match(stale.error,/默认模型/);
    assert.equal((await f.status()).enabled,false);assert.equal(f.cookieReads,0);assert.equal(f.calls.length,0);
  }finally{await f.close();}
});
test('sample真正经过模型流，只发送角色/标题/评论；UI工具复用缓存且不读Cookie或B站、不写receipt',async t=>{
  const guards=['whoami','video','comments','thread','reply','submissions'].map(name=>t.mock.method(BiliApi.prototype,name,async()=>{throw new Error('sample禁止访问B站');}));
  const f=await fixture();try{
    await f.configure();const result=await f.tool.execute({action:'sample',comment:'假评论'});
    assert.deepEqual(result,{...DRAFT,source:'ai',...MODEL,cached:false,called:true});assert.equal(f.calls.length,1);assert.equal(f.streams.length,1);
    assert.deepEqual(f.calls[0].config,{...MODEL,maxTokens:1024});
    const sent=f.streams[0];assert.ok(sent.system.includes(JSON.stringify(PERSONA.persona)));assert.deepEqual(sent.tools,[]);
    assert.deepEqual(sent.messages,[{role:'user',content:[{type:'text',text:JSON.stringify({videoTitle:'角色回复风格预览',comment:'假评论'})}]}]);
    assert.doesNotMatch(JSON.stringify(sent),/fixture-secret|SESSDATA|bili_jct|DedeUserID|account|ownerMid|"mid"|"aid"|"id"|personaName/);
    const cached=await f.ui('sample',{comment:'假评论'});assert.equal(cached.status,200);assert.equal(cached.value.cached,true);assert.equal(cached.value.called,false);
    assert.equal(f.calls.length,1);assert.equal((await f.status()).todayGenerations,1);assert.equal(f.tables.get('drafts').size,1);assert.equal(f.tables.get('receipts').size,0);
    assert.deepEqual((await f.status()).history,[]);assert.equal((await f.status()).todayAttempts,0);assert.equal(f.cookieReads,0);guards.forEach(mock=>assert.equal(mock.mock.callCount(),0));
  }finally{await f.close();}
});
test('sample评论接受1至2000字，非法输入与缺人设都不会调用模型',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.tool.execute({action:'sample',comment:'假评论'}),/角色设定/);await f.configure();
    for(const comment of [undefined,null,1,'','  ','字'.repeat(2001)])await assert.rejects(f.tool.execute({action:'sample',comment}),/1至2000/);
    assert.equal(f.calls.length,0);
    for(const comment of ['字','字'.repeat(2000)])assert.equal((await f.tool.execute({action:'sample',comment})).source,'ai');
    assert.equal(f.calls.length,2);assert.equal(f.cookieReads,0);
  }finally{await f.close();}
});
for(const action of ['configure','pause'])test(`${action}取消进行中的sample，不能提交完成草稿`,async()=>{
  let started,release;const entered=new Promise(resolve=>{started=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
  const f=await fixture({stream:async function*(options){started(options.signal);await blocked;yield {type:'text-delta',index:0,text:JSON.stringify(DRAFT)};yield {type:'finish',reason:{kind:'stop'}};}});
  try{
    await f.configure();const pending=f.tool.execute({action:'sample',comment:'假评论'});const rejection=assert.rejects(pending,/取消/);const signal=await entered;
    await assert.rejects(f.tool.execute({action:'sample',comment:'另一条假评论'}),/正在生成/);
    await f.tool.execute(action==='configure'?{action,settings:{...PERSONA,persona:'另一个通用测试风格，礼貌直接。'}}:{action});
    await rejection;assert.equal(signal.aborted,true);release();
    assert.equal(f.tables.get('receipts').size,0);assert.equal(f.tables.get('drafts').size,1);assert.equal([...f.tables.get('drafts').values()][0].status,'failed');assert.equal((await f.status()).todayGenerations,1);
  }finally{release();await f.close();}
});
test('v1 global默认迁移，旧去重仍在receipts，drafts不进入历史',async t=>{
  ownAccount(t);const now=Date.now();const key='42:99:old';const old={at:now,bvid:'BV1234567890',commentId:'old',status:'sent',reply:'旧回复',replyId:'sent-id'};
  const initial={bvids:['BV1234567890'],rules:[],fallbackReply:'旧模板',pollSeconds:120,gapSeconds:60,dailyLimit:20};
  const comments=t.mock.method(BiliApi.prototype,'comments',async()=>({comments:[{id:'old',mid:'7',name:'合成评论者',message:'旧评论',replyCount:0}],end:true}));
  const f=await fixture({initial,receipts:[[key,old]]});try{
    assert.equal(f.spec.version,1);assert.equal(f.spec.compatibleVersions,undefined);assert.deepEqual(Object.keys(f.spec.tables).sort(),['drafts','receipts']);
    const status=await f.status();assert.deepEqual(status.settings,{...DEFAULT_SETTINGS,...initial});assert.equal(status.settings.replyMode,'persona');assert.equal(status.todayGenerations,0);
    await f.configure({...status.settings,persona:PERSONA.persona});await f.tool.execute({action:'sample',comment:'假评论'});
    const preview=await f.tool.execute({action:'preview'});assert.deepEqual(preview.candidates,[]);assert.equal(comments.mock.callCount(),1);assert.equal(f.calls.length,1,'旧receipt仍阻止重复生成');
    const after=await f.status();assert.deepEqual(after.history,[{key,...old}]);assert.equal(after.todayAttempts,1);assert.equal(after.todayGenerations,1);assert.deepEqual(f.tables.get('receipts').get(key),old);
  }finally{await f.close();}
});
for(const stage of ['prepare','stream','output'])test(`模型${stage}失败脱敏，不能回退预设`,async()=>{
  const secret='fixture-secret SESSDATA=hidden provider-debug';
  const f=await fixture(stage==='prepare'?{prepare:async()=>{throw new Error(secret);}}:stage==='stream'?{stream:async function*(){throw new Error(secret);}}:{stream:async function*(){yield {type:'text-delta',index:0,text:'无效JSON '+secret};yield {type:'finish',reason:{kind:'stop'}};}});
  try{
    await f.configure({...PERSONA,fallbackReply:'不能用这个预设',rules:[{keyword:'假',reply:'不能用关键词回复'}]});
    const result=await f.ui('sample',{comment:'假评论'});assert.equal(result.status,400);assert.match(result.error,stage==='output'?/输出无效/:/AI 生成失败/);assert.doesNotMatch(JSON.stringify(result),/fixture-secret|hidden|provider-debug|不能用/);
    assert.equal(f.calls.length,1);assert.equal((await f.status()).todayGenerations,1);assert.equal(f.tables.get('receipts').size,0);assert.equal([...f.tables.get('drafts').values()][0].status,'failed');assert.equal(f.cookieReads,0);
  }finally{await f.close();}
});
