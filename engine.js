export const DEFAULT_SETTINGS = Object.freeze({
  bvids: [], rules: [], fallbackReply: '', replyMode:'persona', personaName:'', persona:'',
  maxReplyChars:180, aiDailyLimit:40, pollSeconds:120, gapSeconds:60, dailyLimit:20,
});
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置必须是对象');
  const allowed = Object.keys(DEFAULT_SETTINGS);
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error('包含不支持的设置字段');
  const s = {...DEFAULT_SETTINGS, ...input};
  if (!Array.isArray(s.bvids) || s.bvids.length > 1000 || s.bvids.some(v => typeof v !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(v))) throw new Error('请选择最多1000个有效BV号');
  s.bvids = [...new Set(s.bvids)];
  if (!Array.isArray(s.rules) || s.rules.length > 30) throw new Error('关键词规则最多30条');
  const validReply = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
  s.rules = s.rules.map(r => {
    if (!r || typeof r.keyword !== 'string' || !r.keyword.trim() || r.keyword.length > 80 || !validReply(r.reply)) throw new Error('每条规则需要关键词及1至500字回复');
    return {keyword:r.keyword.trim(), reply:r.reply.trim()};
  });
  if (typeof s.fallbackReply !== 'string' || (s.fallbackReply !== '' && !validReply(s.fallbackReply))) throw new Error('默认回复最长500字');
  s.fallbackReply = s.fallbackReply.trim();
  if(!['persona','template'].includes(s.replyMode))throw new Error('回复方式无效');
  if(typeof s.personaName!=='string'||s.personaName.length>80)throw new Error('角色名称最长80字');
  if(typeof s.persona!=='string'||s.persona.length>6000)throw new Error('角色设定最长6000字');
  s.personaName=s.personaName.trim();s.persona=s.persona.trim();
  for (const [key,min,max] of [['pollSeconds',60,3600],['gapSeconds',30,3600],['dailyLimit',1,100],['maxReplyChars',20,300],['aiDailyLimit',1,200]]) {
    const label={pollSeconds:'轮询间隔',gapSeconds:'发送间隔',dailyLimit:'每日尝试上限',maxReplyChars:'AI回复长度',aiDailyLimit:'每日模型生成上限'}[key];
    if (!Number.isInteger(s[key]) || s[key]<min || s[key]>max) throw new Error(`${label}范围为${min}至${max}`);
  }
  return s;
}
export function dayKey(ms) { return new Date(ms + 8*3600000).toISOString().slice(0,10); }
export function selectReply(s, comment, video) {
  const template = s.rules.find(r => comment.message.toLowerCase().includes(r.keyword.toLowerCase()))?.reply || s.fallbackReply;
  // 单遍替换，不解释用户评论、用户名中的模板或指令。
  return template.replace(/\{(user|title)\}/g, (_,k) => k === 'user' ? comment.name : video.title).slice(0,500);
}
export class ReplyEngine {
  constructor({api,getCookie,store,now=Date.now,generateReply,prepareAI}) {
    Object.assign(this,{api,getCookie,store,now,generateReply,prepareAI});
    this.generationController=null;this.approvedModel=null;
    this.enabled=false; this.busy=false; this.disposed=false; this.since=0; this.message=''; this.lastRun=null; this.epoch=0; this.configuring=false; this.scanOffset=0;
    this.settings=validateSettings(store.settings());
  }
  status() {
    const rows=this.store.entries();
    return {enabled:this.enabled,busy:this.busy,since:this.since,settings:this.settings,message:this.message,lastRun:this.lastRun,
      todayAttempts:rows.filter(([,r])=>dayKey(r.at)===dayKey(this.now())).length,
      history:rows.slice().sort((a,b)=>b[1].at-a[1].at).slice(0,30).map(([key,r])=>({key,...r}))};
  }
  pause(reason='已暂停') { this.epoch++; this.enabled=false; this.generationController?.abort();this.message=reason; return this.status(); }
  async configure(input) {
    this.pause('配置已更新，请重新开启');
    if(this.busy || this.configuring) throw new Error('任务执行中，请等待结束后修改设置');
    const settings=validateSettings(input);
    this.configuring=true;
    try {
      await this.store.saveSettings(settings); this.settings=settings;
      return this.status();
    } finally {this.configuring=false;}
  }
  async identity() {
    const cookie=await this.getCookie();
    if(!cookie) throw new Error('请先扫码登录B站');
    return {cookie,account:await this.api.whoami(cookie)};
  }
  assertPersona() {
    if(!this.settings.persona)throw new Error('请先导入角色设定，无需配置关键词或固定回复');
    if(typeof this.generateReply!=='function'||typeof this.prepareAI!=='function')throw new Error('DSH模型服务不可用，请检查模型设置');
  }
  async enable({model}={}) {
    if(this.busy || this.configuring || this.disposed) throw new Error('任务正在执行或插件已停止');
    if(!this.settings.bvids.length)throw new Error('请先选择需要回复的稿件');
    if(this.settings.replyMode==='persona')this.assertPersona();
    else if(!this.settings.rules.length&&!this.settings.fallbackReply)throw new Error('请先设置稿件及回复规则');
    this.pause('正在校验账号及稿件所有权');
    const epoch=this.epoch;
    try {
      const {cookie,account}=await this.identity();
      for(const bvid of this.settings.bvids) {
        if(this.disposed || epoch!==this.epoch) throw new Error('开启操作已取消');
        await this.ownedVideo(bvid,cookie,account);
      }
      if(this.settings.replyMode==='persona')this.approvedModel=await this.prepareAI(model);
      if(this.disposed || epoch!==this.epoch) throw new Error('开启操作已取消');
    } catch(error) {
      if(epoch===this.epoch) this.pause(error instanceof Error?error.message:'开启失败');
      throw error;
    }
    this.since=Math.ceil(this.now()/1000); this.enabled=true; this.message='自动回复已开启，仅处理开启后发布的一级评论';
    return this.status();
  }
  async ownedVideo(bvid,cookie,account) {
    const video=await this.api.video(bvid,cookie);
    if(String(video.ownerMid)!==String(account.mid)) throw new Error(`稿件${bvid}不属于当前登录账号，已阻止操作`);
    return video;
  }
  async hasCreatorReply(video,comment,cookie,account) {
    if(!comment.replyCount) return false;
    // 完整确认后才允许发送；超出扫描上限则保守跳过。
    for(let page=1;page<=10;page++) {
      const result=await this.api.thread(video.aid,comment.id,cookie,page);
      if(result.comments.some(r=>String(r.mid)===String(account.mid))) return true;
      if(result.end) return false;
    }
    return true;
  }
  sendLimit(settings) {
    const rows=this.store.entries();
    if(rows.filter(([,r])=>dayKey(r.at)===dayKey(this.now())).length>=settings.dailyLimit)return '已达今日发送尝试上限';
    const last=rows.reduce((value,[,r])=>Math.max(value,r.at),0);
    if(this.now()-last<settings.gapSeconds*1000)return '等待发送间隔';
    return '';
  }
  async run(send=false) {
    if(this.busy)return {skipped:'任务正在执行'};
    if(this.disposed||(send&&!this.enabled))return {skipped:'自动回复未开启'};
    this.busy=true;
    const epoch=this.epoch,controller=new AbortController();this.generationController=controller;
    try {
      const settings=structuredClone(this.settings),candidates=[];
      const persona=settings.replyMode==='persona';let aiCalls=0;
      if(persona)this.assertPersona();
      if(send){const limited=this.sendLimit(settings);if(limited)return {limited};}
      const {cookie,account}=await this.identity();
      const rotated=settings.bvids.slice(this.scanOffset).concat(settings.bvids.slice(0,this.scanOffset));
      const ordered=send?rotated.slice(0,10):persona?settings.bvids.slice(0,10):settings.bvids;
      for(const bvid of ordered) {
        if(send && (!this.enabled || this.disposed)) return {paused:true};
        if(send) this.scanOffset=(settings.bvids.indexOf(bvid)+1)%settings.bvids.length;
        const video=await this.ownedVideo(bvid,cookie,account);
        // 每轮读取各稿件最近3页一级评论；不是全量历史爬取。
        for(let page=1;page<=3;page++) {
          const result=await this.api.comments(video.aid,cookie,page);
          for(const comment of result.comments) {
            if(String(comment.mid)===String(account.mid) || (send && comment.ctime < this.since)) continue;
            const key=`${account.mid}:${video.aid}:${comment.id}`;
            if(this.store.receipt(key)) continue;
            if(await this.hasCreatorReply(video,comment,cookie,account))continue;
            if(this.disposed||epoch!==this.epoch)return {paused:true};
            let message,draft;
            if(persona) {
              if(aiCalls>=3)return {candidates,aiCalls,truncated:true};
              draft=await this.generateReply({settings,comment,video,account,signal:controller.signal,expectedModel:send?this.approvedModel:undefined});
              if(this.disposed||epoch!==this.epoch)return {paused:true};
              if(!draft||!['reply','skip'].includes(draft.action))throw new Error('AI返回了无效的回复动作，已暂停');
              if(draft.called)aiCalls++;
              if(draft.action==='skip') {
                if(aiCalls>=3)return {candidates,aiCalls,truncated:true,scope:'本轮最多生成3次；不适合回复的评论由模型跳过'};
                continue;
              }
              message=draft.reply;
              if(typeof message!=='string'||!message.trim()||[...message].length>settings.maxReplyChars)throw new Error('AI回复格式或长度无效，已暂停');
            }else message=selectReply(settings,comment,video);
            if(!message)continue;
            candidates.push({key,bvid,title:video.title,commentId:comment.id,user:comment.name,comment:comment.message.slice(0,500),reply:message,...(persona?{source:'ai',model:`${draft.provider}/${draft.model}`,cached:draft.cached}: {})});
            if(send) {
              if(!this.enabled || this.disposed) return {paused:true};
              const limited=this.sendLimit(settings);if(limited)return {limited};
              // 发送前再次验证所有权并检查一级子评论页，避免错误目标。
              await this.ownedVideo(bvid,cookie,account);
              const root=await this.api.thread(video.aid,comment.id,cookie,1);
              if(root.comments.some(r=>String(r.mid)===String(account.mid))) continue;
              if(!this.enabled || this.disposed) return {paused:true};
              const receipt={at:this.now(),bvid,commentId:comment.id,status:'uncertain',reply:message};
              // 先持久化占位；超时、断电或远端成功但本地失败均禁止自动重试。
              await this.store.put(key,receipt);
              if(!this.enabled || this.disposed) {
                await this.store.put(key,{...receipt,status:'cancelled'}); return {paused:true};
              }
              const sent=await this.api.reply(video.aid,comment.id,message,cookie);
              await this.store.put(key,{...receipt,status:'sent',replyId:sent.id});
              this.message='已发送1条回复'; return {sent:1,candidates};
            }
            if(candidates.length>=(persona?3:30)||aiCalls>=3)return {candidates,aiCalls,truncated:true};
          }
          if(result.end) break;
        }
      }
      return {candidates,aiCalls,scope:persona?'AI每轮最多生成3次、预览3条；只发送标题、评论和角色设定到DSH默认模型，预览不发评论':'每稿最近3页一级评论，预览不发送；自动模式仅处理开启后的新评论'};
    } catch(error) {
      if(epoch===this.epoch)this.pause(error instanceof Error?error.message:'执行失败，已暂停');
      throw error;
    } finally {this.busy=false;this.lastRun=this.now();if(this.generationController===controller)this.generationController=null;}
  }
  dispose() {this.disposed=true;this.pause('插件已卸载');}
}
