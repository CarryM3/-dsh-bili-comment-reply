import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {DEFAULT_SETTINGS} from './engine.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const video=(bvid,title)=>({aid:'99',bvid,title,cover:'https://i0.hdslb.com/bfs/archive/fixture.jpg'});
const first=[video('BV1234567890','我的第一条投稿'),video('BV1234567891','我的第二条投稿')];
const last=video('BV1234567892','后续加载的投稿');
async function mounted({enabled=false,saved=[],credentialConfigured=true,failure=false,pauseFailure=false,persona='通用测试角色，亲切自然、回答简洁。'}={}) {
  let module,Panel,renderer;
  const calls=[],settings=structuredClone({...DEFAULT_SETTINGS,bvids:saved,personaName:'通用测试角色',persona});
  const state={version:'1.2.2',confirmationEpoch:'fixture-runtime',enabled,busy:false,settings,todayAttempts:0,todayGenerations:0,model:{provider:'fixture-provider',model:'fixture-model'},history:[],credentialConfigured};
  const source=await readFile(new URL('./client.js',import.meta.url),'utf8');
  const context={window:{__ModuleLoader__:{load:v=>{module=v;}}},setTimeout,clearTimeout,console,
    fetch:async(_url,request)=>{
      const body=JSON.parse(request.body);calls.push(body);let value;
      switch(body.action) {
        case 'status':value=state;break;
        case 'submissions':
          if(failure)return {ok:false,status:400,json:async()=>({error:'B站登录已失效，请重新扫码'})};
          value={items:body.input.page===1?first:[last],page:body.input.page,total:3,end:body.input.page===2,account:{mid:state.accountMid||'42',name:'作者'}};break;
        case 'configure':state.settings=structuredClone(body.input);state.enabled=false;value=state;break;
        case 'pause':if(pauseFailure)return {ok:false,status:400,json:async()=>({error:'暂停失败，请重试'})};state.enabled=false;value=state;break;
        case 'sample':state.todayGenerations++;value={action:'reply',reply:'谢谢喜欢，会继续认真做内容。',source:'ai',provider:'fixture-provider',model:'fixture-model',cached:false,called:true};break;
        case 'enable':assert.equal(body.input.confirmSelection,true);assert.equal(body.input.confirmAI,true);assert.deepEqual(body.input.model,state.model);assert.deepEqual(body.input.bvids,state.settings.bvids);assert.deepEqual(body.input.settings,state.settings);state.enabled=true;value=state;break;
        default:throw new Error(`测试不允许的操作${body.action}`);
      }
      return {ok:true,status:200,json:async()=>({value:structuredClone(value)})};
    },
  };
  vm.runInNewContext(source,context);
  const dictionaries=new Map(),snapshot={active:'zh-CN',revision:1};
  module.factory(name=>{assert.equal(name,'react');return React;}).apply({
    locale:{register:(ns,lang,dict)=>dictionaries.set(lang,dict),bind:()=>key=>dictionaries.get('zh-CN')[key]||key,subscribe:()=>()=>{},getSnapshot:()=>snapshot},
    slots:{inject:(_key,callback)=>callback(),register:(_registration,component)=>{Panel=component;return ()=>{};}},
  });
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Panel));});
  const root=()=>renderer.root;
  const button=label=>root().findAllByType('button').find(v=>v.children.join('')===label);
  const choice=title=>root().findByProps({'aria-label':`选择稿件：${title}`});
  const consent=()=>root().findAllByType('input').find(v=>v.props.type==='checkbox'&&!v.props['aria-label']);
  return {calls,state,root,button,choice,consent,async reopen(){await act(async()=>renderer.unmount());await act(async()=>{renderer=TestRenderer.create(React.createElement(Panel));});},async click(label){const b=button(label);assert.ok(b,`按钮${label}应存在`);assert.equal(b.props.disabled,false);await act(async()=>{await b.props.onClick();});},async choose(title,checked){await act(async()=>{await choice(title).props.onChange({target:{checked}});});},async close(){await act(async()=>renderer.unmount());}};
}
test('扫码凭证存在时自动加载标题和封面，初次加载不勾选、不保存、不开启',async()=>{
  const f=await mounted();
  try {
    assert.deepEqual(f.calls.map(v=>v.action),['status','submissions']);
    assert.equal(f.choice(first[0].title).props.checked,false);
    assert.equal(f.root().findAllByType('img').length,2);
    assert.equal(f.root().findAllByType('textarea').some(v=>['监听稿件 BV号','默认回复'].includes(v.props['aria-label'])),false);
    assert.equal(f.button('添加规则'),undefined);
    assert.ok(f.root().findByProps({'aria-label':'角色性格与口吻（仅保存在本机）'}));
    assert.equal(f.state.enabled,false);assert.deepEqual(f.state.settings.bvids,[]);
    assert.equal(f.button('确认开启所选稿件自动回复').props.disabled,true);
  }finally {await f.close();}
});
test('全选只选择已加载稿件；分页新增不继承全选，必须保存并单独确认才开启',async()=>{
  const f=await mounted();
  try {
    await f.click('全选已加载稿件');
    assert.equal(f.choice(first[0].title).props.checked,true);
    assert.equal(f.choice(first[1].title).props.checked,true);
    assert.deepEqual(f.state.settings.bvids,[]);
    assert.ok(!f.calls.some(v=>['configure','enable'].includes(v.action)));
    await f.click('加载更多投稿');
    assert.equal(f.choice(last.title).props.checked,false);
    await f.click('保存稿件及角色设定');
    assert.deepEqual(f.state.settings.bvids,first.map(v=>v.bvid));assert.equal(f.state.enabled,false);
    assert.equal(f.button('确认开启所选稿件自动回复').props.disabled,true);
    await act(async()=>f.consent().props.onChange({target:{checked:true}}));
    await f.click('确认开启所选稿件自动回复');
    assert.equal(f.state.enabled,true);
    assert.equal(f.calls.filter(v=>v.action==='enable').length,1);
    assert.deepEqual(f.calls.find(v=>v.action==='enable').input.bvids,first.map(v=>v.bvid));
  }finally {await f.close();}
});
test('取消或改变选择会清除开启确认，运行中改变选择先暂停',async()=>{
  const f=await mounted({enabled:true,saved:first.map(v=>v.bvid)});
  try {
    await act(async()=>f.consent().props.onChange({target:{checked:true}}));
    await f.choose(first[0].title,false);
    assert.equal(f.state.enabled,false);
    assert.equal(f.calls.filter(v=>v.action==='pause').length,1);
    assert.equal(f.consent().props.checked,false);
    assert.equal(f.button('确认开启所选稿件自动回复').props.disabled,true);
    assert.deepEqual(f.state.settings.bvids,first.map(v=>v.bvid),'未保存前不扩大或重写实际范围');
    await f.click('取消全部选择');
    assert.equal(f.choice(first[1].title).props.checked,false);
    assert.equal(f.calls.filter(v=>v.action==='enable').length,0);
  }finally {await f.close();}
});
test('不需要关键词或固定答案，角色试聊只调用模型而不保存或开启',async()=>{
  const f=await mounted({credentialConfigured:false});
  try {
    assert.equal(f.state.settings.rules.length,0);assert.equal(f.state.settings.fallbackReply,'');
    await f.click('试聊人设（不发评论）');
    assert.equal(f.calls.filter(v=>v.action==='sample').length,1);
    assert.ok(!f.calls.some(v=>['configure','enable'].includes(v.action)));
    assert.equal(f.state.enabled,false);assert.equal(f.state.todayGenerations,1);
  }finally {await f.close();}
});
test('角色设定未配置时不能试聊或开启，默认模型变化清除已勾选确认',async()=>{
  const empty=await mounted({persona:'',saved:first.map(v=>v.bvid)});
  try {assert.equal(empty.button('试聊人设（不发评论）').props.disabled,true);assert.equal(empty.consent().props.disabled,true);}
  finally {await empty.close();}
  const f=await mounted({saved:first.map(v=>v.bvid)});
  try {
    await act(async()=>f.consent().props.onChange({target:{checked:true}}));
    f.state.model={provider:'fixture-provider',model:'other-model'};
    await f.click('刷新状态');
    assert.equal(f.consent().props.checked,false);
    assert.equal(f.button('确认开启所选稿件自动回复').props.disabled,true);
  }finally {await f.close();}
});
test('仅勾选后关闭重进保留确认，但不隐式开启',async()=>{
  const f=await mounted({saved:first.map(v=>v.bvid)});try{
    await act(async()=>f.consent().props.onChange({target:{checked:true}}));await f.reopen();
    assert.equal(f.consent().props.checked,true);assert.equal(f.state.enabled,false);assert.ok(!f.calls.some(v=>v.action==='enable'));
    await act(async()=>f.consent().props.onChange({target:{checked:false}}));await f.reopen();assert.equal(f.consent().props.checked,false);
  }finally{await f.close();}
});
test('已开启重进显示勾选，取消勾选立即暂停且重进不再勾选',async()=>{
  const f=await mounted({enabled:true,saved:first.map(v=>v.bvid)});try{
    assert.equal(f.consent().props.checked,true);assert.equal(f.button('确认开启所选稿件自动回复').props.disabled,true);
    await f.reopen();assert.equal(f.consent().props.checked,true);
    await act(async()=>{await f.consent().props.onChange({target:{checked:false}});});
    assert.equal(f.state.enabled,false);assert.equal(f.calls.filter(v=>v.action==='pause').length,1);
    await f.reopen();assert.equal(f.consent().props.checked,false);assert.ok(!f.calls.some(v=>v.action==='enable'));
  }finally{await f.close();}
});
for(const field of ['settings','model','confirmationEpoch','accountMid'])test(`关闭期间${field}变化使旧勾选失效`,async()=>{
  const f=await mounted({saved:first.map(v=>v.bvid)});try{
    await act(async()=>f.consent().props.onChange({target:{checked:true}}));
    if(field==='settings')f.state.settings={...f.state.settings,persona:'另一份通用角色'};
    if(field==='model')f.state.model={...f.state.model,model:'changed'};
    if(field==='confirmationEpoch')f.state.confirmationEpoch='new-runtime';
    if(field==='accountMid')f.state.accountMid='84';
    await f.reopen();assert.equal(f.consent().props.checked,false);assert.ok(!f.calls.some(v=>v.action==='enable'));
  }finally{await f.close();}
});
test('运行中改选暂停后恢复原稿件并重新确认，重进仍保留新确认',async()=>{
  const f=await mounted({enabled:true,saved:[first[0].bvid]});try{
    await f.choose(first[1].title,true);await f.choose(first[1].title,false);
    await act(async()=>f.consent().props.onChange({target:{checked:true}}));
    await f.reopen();assert.equal(f.consent().props.checked,true);assert.equal(f.state.enabled,false);
    assert.ok(!f.calls.some(v=>v.action==='enable'));
  }finally{await f.close();}
});
test('后台已暂停时重进不恢复旧的运行勾选',async()=>{
  const f=await mounted({enabled:true,saved:first.map(v=>v.bvid)});try{
    f.state.enabled=false;await f.reopen();assert.equal(f.consent().props.checked,false);
  }finally{await f.close();}
});
test('即使本页状态过期，取消勾选也向后台请求暂停',async()=>{
  const f=await mounted({saved:first.map(v=>v.bvid)});try{
    await act(async()=>f.consent().props.onChange({target:{checked:true}}));
    f.state.enabled=true;
    await act(async()=>{await f.consent().props.onChange({target:{checked:false}});});
    assert.equal(f.state.enabled,false);assert.equal(f.calls.filter(v=>v.action==='pause').length,1);assert.equal(f.consent().props.checked,false);
  }finally{await f.close();}
});
test('取消暂停请求失败明确报错，并保持实际运行勾选',async()=>{
  const f=await mounted({enabled:true,saved:first.map(v=>v.bvid),pauseFailure:true});try{
    await act(async()=>{await f.consent().props.onChange({target:{checked:false}});});
    assert.equal(f.state.enabled,true);assert.equal(f.consent().props.checked,true);assert.ok(f.root().findAllByProps({role:'alert'}).length);
  }finally{await f.close();}
});
test('投稿加载失败明确提示且不静默开启，没有凭证时不请求投稿',async()=>{
  const failed=await mounted({failure:true});
  try {assert.ok(failed.root().findAllByProps({role:'alert'}).length);assert.equal(failed.state.enabled,false);assert.ok(!failed.calls.some(v=>v.action==='enable'));}
  finally {await failed.close();}
  const loggedOut=await mounted({credentialConfigured:false});
  try {assert.deepEqual(loggedOut.calls.map(v=>v.action),['status']);assert.equal(loggedOut.button('重新加载本人投稿').props.disabled,true);}
  finally {await loggedOut.close();}
});
