import { z } from 'zod';
import QRCode from 'qrcode';
import { BiliApi } from './bili-api.js';
import { DEFAULT_SETTINGS, ReplyEngine } from './engine.js';

export const inject = ['credentials','storageDomain','connection','tools'];
export const Config = z.object({});
const COOKIE_REF='DSH_BILI_COMMENT_REPLY_COOKIE';
const PATH='/api/bili-comment-reply';
const SETTINGS_SCHEMA=z.object({
  bvids:z.array(z.string()),rules:z.array(z.object({keyword:z.string(),reply:z.string()})),fallbackReply:z.string(),
  pollSeconds:z.number(),gapSeconds:z.number(),dailyLimit:z.number(),
});
const RECEIPT_SCHEMA=z.object({at:z.number(),bvid:z.string(),commentId:z.string(),status:z.enum(['uncertain','sent','cancelled']),reply:z.string(),replyId:z.string().optional()});

export async function apply(ctx) {
  const domain=await ctx.storageDomain.open({name:'bili_comment_reply',version:1,
    global:{schema:SETTINGS_SCHEMA,initial:structuredClone(DEFAULT_SETTINGS)},tables:{receipts:{valueSchema:RECEIPT_SCHEMA}}});
  const table=domain.table('receipts');
  const engine=new ReplyEngine({api:new BiliApi(),getCookie:async()=> (await ctx.credentials.resolve(COOKIE_REF))?.value,
    store:{settings:()=>domain.global.get(),saveSettings:v=>domain.global.set(v),receipt:k=>table.get(k),
      entries:()=>[...table.entries()],put:(k,v)=>table.put(k,v)}});
  let qr=null, qrBusy=false, closing=false, timer;
  const pending=new Set();
  function track(promise) {
    pending.add(promise);
    promise.then(()=>pending.delete(promise),()=>pending.delete(promise));
    return promise;
  }
  const userActions=new Set(['loginStart','loginPoll','enable']);
  const sharedActions=new Set(['status','account','submissions','configure','preview','pause','logout']);
  const service={
    execute(action,input={},caller='tool') {return track(this.handle(action,input,caller));},
    async handle(action,input={},caller='tool') {
      if(closing) throw new Error('插件正在停止');
      if(!sharedActions.has(action) && !(caller==='ui' && userActions.has(action))) throw new Error('不支持的操作，开启自动发送及扫码授权仅限用户界面');
      switch(action) {
        case 'status': return {version:'1.1.0',...engine.status(),credentialConfigured:(await ctx.credentials.describe(COOKIE_REF)).configured};
        case 'account': {const {account}=await engine.identity();return account;}
        case 'submissions': {
          const page=input?.page ?? 1;
          if(!Number.isInteger(page) || page<1 || page>500) throw new Error('投稿页码范围为1至500');
          const {cookie,account}=await engine.identity();
          const result=await engine.api.submissions(cookie,page);
          return {...result,items:result.items.filter(item=>!item.ownerMid||item.ownerMid===account.mid),account};
        }
        case 'configure': return engine.configure(input);
        case 'preview': return engine.run(false);
        case 'pause': return engine.pause();
        case 'enable': {
          // 确认绑定当前已保存的精确稿件集合；加载或全选不能替代此独立动作。
          if(input?.confirmSelection!==true || !Array.isArray(input.bvids)
            || JSON.stringify(input.settings)!==JSON.stringify(engine.settings)
            || JSON.stringify([...new Set(input.bvids)].sort())!==JSON.stringify([...engine.settings.bvids].sort())) {
            throw new Error('请确认当前已保存的所选稿件与回复规则后，再开启自动回复');
          }
          return engine.enable();
        }
        case 'logout': {
          engine.pause('已退出B站登录');qr=null;
          if(engine.busy || qrBusy) throw new Error('已暂停，请等待当前请求结束后再次退出');
          await ctx.credentials.unset(COOKIE_REF);return {loggedOut:true};
        }
        case 'loginStart': {
          engine.pause('扫码授权中');
          if(engine.busy || qrBusy) throw new Error('已有请求执行中，请稍后再试');
          qrBusy=true;
          try {
            const result=await engine.api.startQR();
            qr={key:result.key,expires:Date.now()+180000};
            return {status:result.status,expires:qr.expires,image:await QRCode.toDataURL(result.url,{width:240,margin:2})};
          } finally {qrBusy=false;}
        }
        case 'loginPoll': {
          if(!qr || qr.expires<Date.now()) {qr=null;return {status:'expired'};}
          if(qrBusy) return {status:'waiting'};
          qrBusy=true;
          try {
            const result=await engine.api.pollQR(qr.key);
            if(result.status==='ok') {
              if(!result.cookies) throw new Error('扫码响应未提供有效登录凭证');
              const account=await engine.api.whoami(result.cookies);
              await ctx.credentials.set(COOKIE_REF,result.cookies);qr=null;
              return {status:'ok',account};
            }
            if(result.status==='expired') qr=null;
            return {status:result.status};
          } finally {qrBusy=false;}
        }
      }
    },
  };
  ctx.effect(()=>async()=>{
    closing=true;clearTimeout(timer);engine.dispose();qr=null;
    await Promise.allSettled([...pending]);
    await domain.close();
  });
  ctx.provide('biliCommentReply',service);
  // Connection 原生 Fetch 入口继承 DSH 的认证、Host 与 Origin 校验。
  ctx.effect(()=>ctx.connection.fetch.register({path:PATH,methods:['POST'],requestBody:'buffered',
    async fetch(request) {
      const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
      try {
        if(request.headers.get('x-dsh-bili-ui')!=='1' || !request.headers.get('content-type')?.startsWith('application/json')) return new Response(JSON.stringify({error:'请求格式错误'}),{status:400,headers});
        const text=await request.text();
        if(text.length>65536) return new Response(JSON.stringify({error:'请求过大'}),{status:413,headers});
        const body=JSON.parse(text);
        if(typeof body.action!=='string') throw new Error('缺少操作名称');
        return new Response(JSON.stringify({value:await service.execute(body.action,body.input,'ui')}),{headers});
      } catch(error) {
        return new Response(JSON.stringify({error:error instanceof SyntaxError?'JSON格式错误':error instanceof Error?error.message:'执行失败'}),{status:400,headers});
      }
    }}));
  ctx.effect(()=>ctx.tools.register({name:'bili_creator_comments',
    description:'管理B站本人稿件评论助手：查看状态或账号、分页加载本人投稿、配置回复规则、预览、暂停或退出。不会开启发送；扫码和发送确认仅限设置界面。',
    parameters:{type:'object',properties:{action:{type:'string',enum:[...sharedActions]},page:{type:'integer',description:'submissions使用的页码，默认1，范围1至500；每页20条。'},settings:{type:'object',description:'configure时提供完整设置；修改后自动暂停。',properties:{bvids:{type:'array',items:{type:'string'},description:'所选本人稿件BV号，最多1000个；新加载的稿件不会自动加入。'},rules:{type:'array',items:{type:'object',properties:{keyword:{type:'string'},reply:{type:'string'}},required:['keyword','reply'],additionalProperties:false}},fallbackReply:{type:'string',description:'未命中关键词时的回复，留空跳过。支持{user}、{title}。'},pollSeconds:{type:'integer',description:'轮询秒数，60至3600'},gapSeconds:{type:'integer',description:'发送最小间隔秒数，30至3600'},dailyLimit:{type:'integer',description:'北京时间每日最多尝试1至100条'}},additionalProperties:false}},required:['action'],additionalProperties:false},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args) {return service.execute(args.action,args.action==='submissions'?{page:args.page}:args.settings);}
  }));
  const tick=async()=>{
    if(closing) return;
    try {if(engine.enabled) await track(engine.run(true));} catch { /* 错误已记录在面板，发送保持暂停。 */ }
    if(!closing) timer=setTimeout(tick,engine.settings.pollSeconds*1000);
  };
  timer=setTimeout(tick,5000);
}
