window.__ModuleLoader__.load({
  id:'@local/dsh-bili-comment-reply',
  factory(require) {
    const React=require('react'), h=React.createElement;
    return {inject:['slots','locale'],apply(ctx) {
      const zh={title:'B站评论助手',intro:'扫码授权，只回复你自己的稿件。规则在本机匹配，不调用外部模型。',login:'扫码登录',logout:'退出登录',check:'检查账号',refresh:'刷新状态',save:'保存设置',preview:'预览回复（不发送）',enable:'开启自动回复',pause:'立即暂停',bvids:'监听稿件 BV号',bvidHint:'每行一个，最多10个。预览和开启时校验本人所有权；不自动添加其他稿件。',rules:'关键词规则',rulesHint:'按顺序命中第一条；关键词不区分大小写。无匹配且默认回复为空时跳过。',keyword:'关键词',reply:'回复内容',add:'添加规则',remove:'移除',fallback:'默认回复',template:'支持 {user} 和 {title}。开启后仅处理新发布的一级评论，不处理楼中楼。',poll:'轮询间隔（秒）',gap:'发送间隔（秒）',limit:'每日尝试上限（北京时间）',confirm:'我确认以当前B站账号发送以上规则的回复，了解自动评论可能触发平台限制。',off:'已暂停',on:'自动回复中',unknown:'尚未登录',configured:'已保存凭证（点击检查账号验证）',today:'今日发送尝试',history:'发送记录',empty:'暂无记录',candidates:'预览结果',scope:'每稿最多扫描最近3页；超长回复线程保守跳过。预览包含历史评论，开启自动回复不会补发历史。',waiting:'请用手机B站 → 我的 → 扫一扫',scanned:'已扫码，请在手机上确认',expired:'二维码已过期，请重新生成',ok:'登录成功',request:'处理中…',saved:'设置已保存，自动回复保持暂停',note:'安全机制：每轮最多发送1条；跳过自己的评论及已有本人回复的线程；发送超时不会重试。DSH退出或插件重载后默认暂停。',result:'操作结果',qr:'B站登录二维码',account:'登录账号',state:'运行状态',sent:'已发送',uncertain:'结果不确定（不重试）',cancelled:'已取消'};
      // 即使DSH使用英文或其他语言，此插件仍按用户要求显示中文。
      const en={...zh};
      ctx.locale.register('bili-comment-reply','zh-CN',zh);
      ctx.locale.register('bili-comment-reply','en',en);
      const t=ctx.locale.bind('bili-comment-reply');
      async function api(action,input) {
        let response;
        try {response=await fetch('/api/bili-comment-reply',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-dsh-bili-ui':'1'},body:JSON.stringify({action,input})});}
        catch {throw new Error('无法连接DSH服务，请检查连接后重试');}
        let body;try {body=await response.json();} catch {throw new Error(`服务响应格式错误（状态码 ${response.status}）`);}
        if(!response.ok || body.error) throw new Error(body.error || `服务请求失败（状态码 ${response.status}）`);
        return body.value;
      }
      function Panel() {
        const [state,setState]=React.useState(null),[form,setForm]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[qr,setQr]=React.useState(null),[account,setAccount]=React.useState(null),[confirm,setConfirm]=React.useState(false),[preview,setPreview]=React.useState(null);
        React.useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot());
        const alive=React.useRef(true);
        React.useEffect(()=>{alive.current=true;api('status').then(s=>{if(alive.current){setState(s);setForm(s.settings);}}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;};},[]);
        React.useEffect(()=>{
          if(!qr || !['waiting','scanned'].includes(qr.status))return;
          const timer=setTimeout(async()=>{
            try {const v=await api('loginPoll');if(!alive.current)return;if(v.account){setAccount(v.account);setQr(null);setNotice(t('ok'));const s=await api('status');if(alive.current)setState(s);}else setQr(q=>q?{...q,status:v.status}:q);}
            catch(e){if(alive.current){setError(e.message);setQr(null);}}
          },3000);
          return()=>clearTimeout(timer);
        },[qr]);
        const change=(key,value)=>{setForm(s=>({...s,[key]:value}));setConfirm(false);};
        const run=async(action,input)=>{
          setBusy(true);setError('');setNotice('');
          if(['loginStart','logout','account'].includes(action))setConfirm(false);
          try {
            const value=await api(action,input);
            if(!alive.current)return;
            if(action==='loginStart')setQr(value);
            else if(action==='account')setAccount(value);
            else if(action==='logout'){setAccount(null);setQr(null);}
            else if(action==='preview')setPreview(value);
            else if(action==='configure'){setForm(value.settings);setNotice(t('saved'));setConfirm(false);setPreview(null);}
            const s=await api('status');if(alive.current)setState(s);
          }catch(e){if(alive.current)setError(e.message);}
          finally {if(alive.current)setBusy(false);}
        };
        const button=(key,action,disabled=false)=>h('button',{type:'button',disabled,onClick:action},t(key));
        const field=(key,node,hint)=>h('label',{className:'bcr-field'},h('span',null,t(key)),node,hint&&h('small',null,t(hint)));
        return h('section',{className:'bcr-panel','aria-label':t('title')},
          h('style',null,`.bcr-panel{color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;max-width:840px;padding:8px 0 28px}.bcr-panel h2{font-size:20px;margin:0 0 8px}.bcr-panel h3{font-size:15px;margin:0 0 12px}.bcr-panel p,.bcr-panel small{color:var(--dsw-alias-label-secondary);line-height:1.65}.bcr-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px;margin:16px 0}.bcr-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0}.bcr-panel button{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;cursor:pointer}.bcr-panel button:hover{background:var(--dsw-alias-interactive-bg-hover)}.bcr-panel button:disabled{opacity:.5;cursor:not-allowed}.bcr-panel input:not([type=checkbox]),.bcr-panel textarea{box-sizing:border-box;width:100%;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 10px}.bcr-panel textarea{resize:vertical;min-height:78px}.bcr-panel button:focus-visible,.bcr-panel input:focus-visible,.bcr-panel textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.bcr-field{display:flex;flex-direction:column;gap:7px;margin:14px 0}.bcr-field>span{font-weight:500}.bcr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.bcr-rule{display:grid;grid-template-columns:minmax(100px,1fr) minmax(140px,2fr) auto;gap:8px;margin:10px 0;align-items:start}.bcr-state{padding:4px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}.bcr-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}.bcr-notice{color:var(--dsw-alias-state-success-primary)}.bcr-item{border-top:1px solid var(--dsw-alias-border-l1);padding:12px 0;overflow-wrap:anywhere}.bcr-item p{white-space:pre-wrap;margin:5px 0}.bcr-qr{width:240px;height:240px;max-width:100%}.bcr-consent{display:flex;align-items:flex-start;gap:8px;line-height:1.6}.bcr-panel input[type=checkbox]{accent-color:var(--dsw-alias-brand-primary);margin-top:5px}@media(max-width:540px){.bcr-rule{grid-template-columns:1fr}.bcr-card{padding:12px}}`),
          h('h2',null,t('title')),h('p',null,t('intro')),
          error&&h('div',{role:'alert',className:'bcr-error'},error),notice&&h('div',{role:'status',className:'bcr-notice'},notice),
          h('div',{className:'bcr-card'},h('h3',null,t('account')),h('p',null,account?`${account.name} · 用户编号 ${account.mid}`:t(state?.credentialConfigured?'configured':'unknown')),
            h('div',{className:'bcr-row'},button('login',()=>run('loginStart'),busy),button('check',()=>run('account'),busy),button('logout',()=>run('logout'),busy||!state?.credentialConfigured)),
            qr&&h('div',null,h('img',{className:'bcr-qr',src:qr.image,alt:t('qr')}),h('p',{role:'status'},t(qr.status)))),
          state&&h('div',{className:'bcr-card'},h('h3',null,t('state')),h('div',{className:'bcr-row'},h('span',{className:'bcr-state'},t(state.enabled?'on':'off')),h('span',null,`${t('today')}: ${state.todayAttempts} / ${state.settings.dailyLimit}`),button('refresh',()=>run('status'),busy),button('pause',()=>run('pause'),false)),state.message&&h('p',null,state.message)),
          form&&h('div',{className:'bcr-card'},
            field('bvids',h('textarea',{'aria-label':t('bvids'),value:form.bvids.join('\n'),onChange:e=>change('bvids',e.target.value.split(/\s+/).filter(Boolean))}),'bvidHint'),
            h('h3',null,t('rules')),h('small',null,t('rulesHint')),
            ...form.rules.map((r,i)=>h('div',{className:'bcr-rule',key:i},h('input',{'aria-label':`${t('keyword')} ${i+1}`,placeholder:t('keyword'),value:r.keyword,onChange:e=>change('rules',form.rules.map((v,j)=>j===i?{...v,keyword:e.target.value}:v))}),h('textarea',{'aria-label':`${t('reply')} ${i+1}`,placeholder:t('reply'),value:r.reply,onChange:e=>change('rules',form.rules.map((v,j)=>j===i?{...v,reply:e.target.value}:v))}),button('remove',()=>change('rules',form.rules.filter((_,j)=>j!==i)),busy))),
            button('add',()=>change('rules',[...form.rules,{keyword:'',reply:''}]),form.rules.length>=30||busy),
            field('fallback',h('textarea',{'aria-label':t('fallback'),value:form.fallbackReply,maxLength:500,onChange:e=>change('fallbackReply',e.target.value)}),'template'),
            h('div',{className:'bcr-grid'},...['pollSeconds','gapSeconds','dailyLimit'].map((key,i)=>field(['poll','gap','limit'][i],h('input',{type:'number','aria-label':t(['poll','gap','limit'][i]),min:[60,30,1][i],max:[3600,3600,100][i],value:form[key],onChange:e=>change(key,Number(e.target.value))})))),
            h('div',{className:'bcr-row'},button('save',()=>run('configure',form),busy),button('preview',()=>run('preview'),busy||JSON.stringify(form)!==JSON.stringify(state?.settings))),
            h('label',{className:'bcr-consent'},h('input',{type:'checkbox',checked:confirm,onChange:e=>setConfirm(e.target.checked)}),t('confirm')),
            h('div',{className:'bcr-row'},button('enable',()=>run('enable'),busy||!confirm||!state?.credentialConfigured||JSON.stringify(form)!==JSON.stringify(state?.settings))),h('p',null,t('note'))),
          preview&&h('div',{className:'bcr-card'},h('h3',null,t('candidates')),h('p',null,t('scope')),preview.candidates?.length?preview.candidates.map(c=>h('div',{className:'bcr-item',key:c.key},h('strong',null,`${c.user} · ${c.bvid}`),h('p',null,c.comment),h('p',null,`→ ${c.reply}`))):h('p',null,preview.skipped||t('empty'))),
          h('div',{className:'bcr-card'},h('h3',null,t('history')),state?.history?.length?state.history.map(r=>h('div',{className:'bcr-item',key:r.key},h('strong',null,`${r.bvid} · ${t(r.status)}`),h('small',null,` · ${new Date(r.at).toLocaleString('zh-CN',{hour12:false})}`),h('p',null,r.reply))):h('p',null,t('empty'))));
      }
      ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bili-comment-reply',order:31,label:()=>t('title')},Panel));
    }};
  },
});
