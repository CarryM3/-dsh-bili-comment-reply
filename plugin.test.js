import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {apply,Config} from './index.js';
import {DEFAULT_SETTINGS} from './engine.js';

async function fixture() {
  let value=structuredClone(DEFAULT_SETTINGS),closed=false,route,tool,service;
  const disposers=[],rows=new Map();
  const ctx={
    credentials:{resolve:async()=>undefined,describe:async()=>({configured:false}),unset:async()=>{}},
    storageDomain:{open:async spec=>{assert.equal(spec.name,'bili_comment_reply');assert.match(spec.name,/^[a-z][a-z0-9_]*$/);return {global:{get:()=>value,set:async v=>{value=spec.global.schema.parse(v);}},table:()=>({get:k=>rows.get(k),entries:()=>rows.entries(),put:async(k,v)=>rows.set(k,v)}),close:async()=>{closed=true;}};}},
    connection:{fetch:{register:r=>{route=r;return async()=>{};}}},
    tools:{register:t=>{tool=t;return ()=>{};}},
    provide:(name,s)=>{assert.equal(name,'biliCommentReply');service=s;},
    effect:fn=>{const dispose=fn();disposers.push(dispose);return dispose;},
  };
  await apply(ctx);
  return {get route(){return route;},get tool(){return tool;},get service(){return service;},get closed(){return closed;},async close(){for(const d of disposers.reverse())await (await d)();}};
}
function request(action,input,headers={}) {
  return new Request('http://localhost/api/bili-comment-reply',{method:'POST',headers:{'Content-Type':'application/json','x-dsh-bili-ui':'1',...headers},body:JSON.stringify({action,input})});
}
test('插件可加载；Host入口与工具共用业务方法，默认未授权/不发送',async()=>{
  const f=await fixture();
  try {
    assert.deepEqual(Config.parse({}),{});
    assert.equal(f.route.path,'/api/bili-comment-reply');
    const response=await f.route.fetch(request('status'));
    assert.equal(response.status,200);
    const ui=(await response.json()).value,tool=await f.tool.execute({action:'status'});
    assert.deepEqual(ui,tool);assert.equal(tool.enabled,false);assert.equal(tool.credentialConfigured,false);
    assert.equal(f.tool.name,'bili_creator_comments');
    assert.ok(!f.tool.parameters.properties.action.enum.includes('enable'));
    await assert.rejects(f.tool.execute({action:'enable'}),/仅限用户界面/);
    await assert.rejects(f.tool.execute({action:'loginStart'}),/仅限用户界面/);
  } finally {await f.close();}
  assert.equal(f.closed,true);
});
test('配置通过UI/工具均持久化相同状态，错误不伪装成功',async()=>{
  const f=await fixture();
  try {
    const settings={...DEFAULT_SETTINGS,bvids:['BV1234567890'],fallbackReply:'谢谢 {user}'};
    const ui=(await (await f.route.fetch(request('configure',settings))).json()).value;
    const tool=await f.tool.execute({action:'configure',settings});
    assert.deepEqual(ui.settings,tool.settings);assert.equal(tool.enabled,false);
    await f.tool.execute({action:'pause'});
    assert.equal((await f.tool.execute({action:'status'})).message,'已暂停');
    const bad=await f.route.fetch(request('configure',{...settings,dailyLimit:0}));
    assert.equal(bad.status,400);assert.match((await bad.json()).error,/每日尝试上限/);
    assert.equal((await f.tool.execute({action:'status'})).message,'配置已更新，请重新开启','非法配置同样必须进入引擎暂停路径');
    await assert.rejects(f.tool.execute({action:'preview'}),/先扫码/);
    const preview=await f.route.fetch(request('preview'));assert.equal(preview.status,400);
    assert.match((await preview.json()).error,/先扫码/);
  } finally {await f.close();}
});
test('接口拒绝缺少UI标识、超长内容、非法JSON与未知操作',async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.route.fetch(request('status',null,{'x-dsh-bili-ui':'0'}))).status,400);
    assert.equal((await f.route.fetch(request('no-such-action'))).status,400);
    assert.equal((await f.route.fetch(request('configure','x'.repeat(66000)))).status,413);
    const invalid=new Request('http://localhost/api/bili-comment-reply',{method:'POST',headers:{'Content-Type':'application/json','x-dsh-bili-ui':'1'},body:'{'});
    assert.equal((await f.route.fetch(invalid)).status,400);
  } finally {await f.close();}
});
test('Client模块注册原生设置插槽并可首次渲染；资源支持卸载',async()=>{
  let module,component,registration;
  const dictionaries=new Map(),effects=[];
  const h=(type,props,...children)=>({type,props,children});
  const React={createElement:h,useState:v=>[v,()=>{}],useEffect:()=>{},useSyncExternalStore:()=>{},useRef:v=>({current:v})};
  const context={window:{__ModuleLoader__:{load:v=>{module=v;}}},fetch:async()=>{throw new Error('不应发生网络请求');},console,setTimeout,clearTimeout};
  vm.runInNewContext(await readFile(new URL('./client.js',import.meta.url),'utf8'),context);
  assert.equal(module.id,'@local/dsh-bili-comment-reply');
  const client=module.factory(name=>{assert.equal(name,'react');return React;});
  const snapshot={active:'zh-CN',revision:1};
  client.apply({locale:{register:(ns,lang,dict)=>dictionaries.set(lang,dict),bind:()=>key=>dictionaries.get('zh-CN')[key]||key,subscribe:()=>()=>{},getSnapshot:()=>snapshot},slots:{inject:(key,cb)=>{assert.equal(key,'settings.section');effects.push(cb());},register:(r,c)=>{registration=r;component=c;return ()=>{};}}});
  assert.equal(registration.id,'bili-comment-reply');assert.equal(registration.label(),'B站评论助手');
  assert.deepEqual(dictionaries.get('en'),dictionaries.get('zh-CN'),'英文DSH界面下也必须显示中文');
  for(const [key,value] of Object.entries(dictionaries.get('zh-CN'))) assert.match(value,/[\u4e00-\u9fff]/,`界面文案${key}应含中文`);
  const tree=component();assert.equal(tree.type,'section');assert.equal(tree.props['aria-label'],'B站评论助手');
  effects.forEach(fn=>fn());
});
