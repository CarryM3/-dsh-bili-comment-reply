import { z } from 'zod';
import QRCode from 'qrcode';
import { BiliApi } from './bili-api.js';
import { DEFAULT_SETTINGS, ReplyEngine } from './engine.js';
import { createPersonaGenerator } from './persona-generator.js';
import { createHash } from 'node:crypto';

export const inject = ['credentials','storageDomain','connection','tools','llm','agentDefaultModel'];
export const Config = z.object({});
const COOKIE_REF='DSH_BILI_COMMENT_REPLY_COOKIE';
const PATH='/api/bili-comment-reply';
const SETTINGS_SCHEMA=z.object({
  bvids:z.array(z.string()),rules:z.array(z.object({keyword:z.string(),reply:z.string()})),fallbackReply:z.string(),
  pollSeconds:z.number(),gapSeconds:z.number(),dailyLimit:z.number(),
  replyMode:z.enum(['persona','template']).default('persona'),personaName:z.string().default(''),persona:z.string().default(''),
  maxReplyChars:z.number().default(180),aiDailyLimit:z.number().default(40),
});
const DRAFT_SCHEMA=z.object({at:z.number(),day:z.string(),calls:z.number(),status:z.enum(['pending','done','failed']),provider:z.string(),model:z.string(),draft:z.object({action:z.enum(['reply','skip']),reply:z.string()}).optional()});
const RECEIPT_SCHEMA=z.object({at:z.number(),bvid:z.string(),commentId:z.string(),status:z.enum(['uncertain','sent','cancelled']),reply:z.string(),replyId:z.string().optional()});

export async function apply(ctx) {
  // 只增量添加字段和表，保留原格式；同时兼容1.2.0全新安装可能写下的v2文件。
  const spec={name:'bili_comment_reply',version:1,
    global:{schema:SETTINGS_SCHEMA,initial:structuredClone(DEFAULT_SETTINGS)},tables:{receipts:{valueSchema:RECEIPT_SCHEMA},drafts:{valueSchema:DRAFT_SCHEMA}}};
  let domain;
  try {domain=await ctx.storageDomain.open(spec);}
  catch(error) {
    if(error?.code!=='version-mismatch')throw error;
    domain=await ctx.storageDomain.open({...spec,version:2});
  }
  const table=domain.table('receipts');
  const modelSnapshot=()=>{
    const value=ctx.agentDefaultModel.currentSelection();
    return {provider:value?.provider||'',model:value?.model||'',...(value?.reasoningEffort?{reasoningEffort:value.reasoningEffort}:{})};
  };
  const generator=createPersonaGenerator({llm:ctx.llm,getModel:modelSnapshot,table:domain.table('drafts')});
  const engine=new ReplyEngine({api:new BiliApi(),getCookie:async()=> (await ctx.credentials.resolve(COOKIE_REF))?.value,
    generateReply:input=>generator.generate(input),prepareAI:model=>generator.validateModel(model),
    store:{settings:()=>domain.global.get(),saveSettings:v=>domain.global.set(v),receipt:k=>table.get(k),
      entries:()=>[...table.entries()],put:(k,v)=>table.put(k,v)}});
  let qr=null,qrBusy=false,closing=false,timer,sampleController=null;
  const pending=new Set();
  function track(promise) {
    pending.add(promise);
    promise.then(()=>pending.delete(promise),()=>pending.delete(promise));
    return promise;
  }
  const userActions=new Set(['loginStart','loginPoll','enable']);
  const sharedActions=new Set(['status','account','submissions','configure','preview','sample','pause','logout']);
  const service={
    execute(action,input={},caller='tool') {return track(this.handle(action,input,caller));},
    async handle(action,input={},caller='tool') {
      if(closing) throw new Error('插件正在停止');
      if(!sharedActions.has(action) && !(caller==='ui' && userActions.has(action))) throw new Error('不支持的操作，开启自动发送及扫码授权仅限用户界面');
      switch(action) {
        case 'status': return {version:'1.2.1',...engine.status(),model:modelSnapshot(),...generator.stats(),credentialConfigured:(await ctx.credentials.describe(COOKIE_REF)).configured};
        case 'account': {const {account}=await engine.identity();return account;}
        case 'submissions': {
          const page=input?.page ?? 1;
          if(!Number.isInteger(page) || page<1 || page>500) throw new Error('投稿页码范围为1至500');
          const {cookie,account}=await engine.identity();
          const result=await engine.api.submissions(cookie,page);
          return {...result,items:result.items.filter(item=>!item.ownerMid||item.ownerMid===account.mid),account};
        }
        case 'configure': sampleController?.abort();return engine.configure(input);
        case 'preview': return engine.run(false);
        case 'sample': {
          if(engine.enabled||engine.busy)throw new Error('请先暂停自动回复并等待当前任务结束，再试聊角色');
          if(typeof input?.comment!=='string'||!input.comment.trim()||input.comment.length>2000)throw new Error('模拟评论需要1至2000字');
          engine.assertPersona();
          const id=createHash('sha256').update(input.comment).digest('hex');
          if(sampleController)throw new Error('角色试聊正在生成，请稍后重试');
          const controller=new AbortController();sampleController=controller;
          try {return await generator.generate({settings:engine.settings,comment:{id,message:input.comment},video:{aid:'sample',title:'角色回复风格预览'},account:{mid:'sample'},signal:controller.signal});}
          finally {if(sampleController===controller)sampleController=null;}
        }
        case 'pause': sampleController?.abort();return engine.pause();
        case 'enable': {
          if(sampleController)throw new Error('请等待角色试聊结束后，再确认开启自动回复');
          // 确认绑定当前已保存的精确稿件集合；加载或全选不能替代此独立动作。
          if(input?.confirmSelection!==true || !Array.isArray(input.bvids)
            || JSON.stringify(input.settings)!==JSON.stringify(engine.settings)
            || JSON.stringify([...new Set(input.bvids)].sort())!==JSON.stringify([...engine.settings.bvids].sort())) {
            throw new Error('请确认当前已保存的所选稿件与角色设定后，再开启自动回复');
          }
          if(engine.settings.replyMode==='persona'&&(input.confirmAI!==true||JSON.stringify(input.model)!==JSON.stringify(modelSnapshot())))throw new Error('请确认当前默认模型及模型调用额度后，再开启角色AI回复');
          return engine.enable({model:input.model});
        }
        case 'logout': {
          sampleController?.abort();engine.pause('已退出B站登录');qr=null;
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
    closing=true;clearTimeout(timer);sampleController?.abort();engine.dispose();qr=null;
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
    description:'管理B站角色AI评论助手：查看状态、加载本人投稿、配置本机人设、预览真实评论或试聊、暂停和退出。preview/sample会调用DSH默认模型并消耗额度；不会开启发送，发送确认仅限设置界面。',
    parameters:{type:'object',properties:{
      action:{type:'string',enum:[...sharedActions]},
      page:{type:'integer',description:'submissions页码，默认1，范围1至500；每页20条。'},
      comment:{type:'string',description:'sample使用的模拟评论，1至2000字；只生成草稿、不发评论。'},
      settings:{type:'object',description:'configure时提供完整设置；修改后自动暂停。本机人设不能提交到源码仓库。',properties:{
        bvids:{type:'array',items:{type:'string'},description:'所选本人稿件BV号，最多1000个。'},
        replyMode:{type:'string',enum:['persona'],description:'使用角色AI自动生成，不需要关键词规则。'},
        personaName:{type:'string',description:'本机角色名称，最长80字。'},
        persona:{type:'string',description:'角色性格、口吻及边界，最长6000字；只提交给用户选择的DSH模型，不上传到GitHub。'},
        maxReplyChars:{type:'integer',description:'单条AI回复最长20至300字，默认180。'},
        aiDailyLimit:{type:'integer',description:'北京时间每日模型生成尝试上限1至200，预览也计入，默认40。'},
        pollSeconds:{type:'integer',description:'轮询秒数，60至3600。'},gapSeconds:{type:'integer',description:'发送最小间隔秒数，30至3600。'},dailyLimit:{type:'integer',description:'北京时间每日发送尝试上限1至100。'},
      },additionalProperties:false},
    },required:['action'],additionalProperties:false},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args) {return service.execute(args.action,args.action==='submissions'?{page:args.page}:args.action==='sample'?{comment:args.comment}:args.settings);}
  }));
  const tick=async()=>{
    if(closing) return;
    try {if(engine.enabled) await track(engine.run(true));} catch { /* 错误已记录在面板，发送保持暂停。 */ }
    if(!closing) timer=setTimeout(tick,engine.settings.pollSeconds*1000);
  };
  timer=setTimeout(tick,5000);
}
