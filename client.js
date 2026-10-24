window.__ModuleLoader__.load({
  id:'@local/dsh-bili-comment-reply',
  factory(require) {
    const React=require('react'),h=React.createElement;
    return {inject:['slots','locale'],apply(ctx) {
      const zh={
        title:'B站评论助手',intro:'根据评论内容和本机角色设定，由DSH默认模型生成自然回复；无需关键词规则或固定答案。',
        login:'扫码登录',logout:'退出登录',check:'检查账号',refresh:'刷新状态',save:'保存稿件及角色设定',
        preview:'预览真实评论AI回复（不发送）',enable:'确认开启所选稿件自动回复',pause:'立即暂停',
        videos:'选择需要自动回复的投稿',load:'重新加载本人投稿',more:'加载更多投稿',selectAll:'全选已加载稿件',clear:'取消全部选择',
        videoHint:'扫码后自动加载已发布投稿。新增投稿和后续加载的稿件不会自动勾选；全选只针对当前已加载列表。',
        loading:'正在加载本人投稿…',notLoaded:'登录后将自动加载投稿，也可点击重新加载。',noVideos:'当前账号没有可加载的已发布投稿。',
        loaded:'已加载',selected:'已选择',total:'投稿总数',unit:'个',savedSelection:'已保存的回复范围',
        selectedList:'查看所选稿件清单',unknownVideo:'尚未在已加载列表中出现的已保存稿件',cover:'稿件封面',noCover:'暂无封面',
        selectionLimit:'最多选择或加载1000个稿件，请分批管理。',needSave:'稿件或角色设定已变更，请先保存，再预览或确认开启。',
        loadingError:'投稿加载失败；不会自动选择或开启回复。',accountChanged:'账号已变化，请重新加载本人投稿并选择回复范围。',
        selectionPaused:'所选稿件已变更，自动回复已暂停；保存后需重新确认开启。',
        personaTitle:'AI角色回复',personaName:'角色名称',persona:'角色性格与口吻（仅保存在本机）',
        personaHint:'只需确定一次角色性格、说话方式和边界，不需要填写任何评论规则或预设答案。模型会根据每条评论生成回复。',
        model:'DSH默认模型',noModel:'请先配置DSH默认模型',aiToday:'今日模型生成次数',aiLimit:'每日模型生成上限（含预览）',maxChars:'单条AI回复最长字数',
        privacy:'仅提交稿件标题、评论正文和角色设定给当前默认模型，不提交B站Cookie、用户名、账号编号、私信或聊天历史。预览与试聊也消耗模型额度；模型变化后需重新确认开启。',
        sample:'试聊人设（不发评论）',sampleInput:'模拟评论',sampleHint:'可先用一条模拟评论看看角色口吻；试聊不需要选择稿件，也不会在B站发言。',
        sampleResult:'角色试聊结果',sampleSkipped:'角色判断这条评论不适合自动回复，已跳过。',aiDraft:'AI生成草稿',
        noPersona:'尚未导入角色设定，不能开启自动回复。',
        poll:'轮询间隔（秒）',gap:'发送间隔（秒）',limit:'每日尝试上限（北京时间）',
        confirm:'我确认提交标题、评论和角色设定给当前DSH默认模型并消耗额度，允许用AI生成结果回复已保存范围内的新评论；理解内容和平台风控风险。',
        confirmHint:'关闭设置再进入保留有效勾选；取消勾选立即暂停。仅勾选不会开启，首次仍须点击下方按钮。',
        off:'已暂停',on:'自动回复中',unknown:'尚未登录',configured:'已保存凭证（加载投稿或检查账号时验证）',
        today:'今日发送尝试',history:'发送记录',empty:'暂无记录',candidates:'预览结果',
        scope:'AI每轮最多生成3次、预览3条，不适合回复的评论可跳过。预览包含历史评论，自动回复仅处理开启后的新评论，不补发历史。',
        waiting:'请用手机B站 → 我的 → 扫一扫',scanned:'已扫码，请在手机上确认',expired:'二维码已过期，请重新生成',ok:'登录成功',
        saved:'设置已保存，自动回复保持暂停；加载投稿和全选均不会自动开启。',
        note:'每轮最多检查10个所选稿件并轮转，最多发送1条；AI草稿缓存复用。生成失败会暂停，不会退回固定模板。发送超时不重试，重启后默认暂停。',
        qr:'B站登录二维码',account:'登录账号',state:'运行状态',sent:'已发送',uncertain:'结果不确定（不重试）',cancelled:'已取消',
      };
      ctx.locale.register('bili-comment-reply','zh-CN',zh);
      ctx.locale.register('bili-comment-reply','en',{...zh});
      const t=ctx.locale.bind('bili-comment-reply');
      async function api(action,input) {
        let response;
        try {response=await fetch('/api/bili-comment-reply',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-dsh-bili-ui':'1'},body:JSON.stringify({action,input})});}
        catch {throw new Error('无法连接DSH服务，请检查连接后重试');}
        let body;try {body=await response.json();}catch {throw new Error(`服务响应格式错误（状态码 ${response.status}）`);}
        if(!response.ok||body.error)throw new Error(body.error||`服务请求失败（状态码 ${response.status}）`);
        return body.value;
      }
      // 仅在本次页面会话保留确认，不写入浏览器持久存储或自动开启后台发送。
      let rememberedConfirmation=null,rememberedAccount=null,rememberedWasEnabled=false;
      const confirmationKey=s=>JSON.stringify([s.confirmationEpoch||s.version,s.settings,s.model,s.credentialConfigured]);
      function Panel() {
        const [state,setState]=React.useState(null),[form,setForm]=React.useState(null),[busy,setBusy]=React.useState(false);
        const [error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[qr,setQr]=React.useState(null);
        const [account,setAccount]=React.useState(null),[confirm,setConfirmValue]=React.useState(false),[preview,setPreview]=React.useState(null);
        const [sampleComment,setSampleComment]=React.useState('这个角色好可爱，期待更多内容！'),[sampleReply,setSampleReply]=React.useState(null);
        const [catalog,setCatalog]=React.useState({items:[],page:0,total:null,end:false});
        const [catalogBusy,setCatalogBusy]=React.useState(false),[catalogError,setCatalogError]=React.useState('');
        React.useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot());
        const alive=React.useRef(true),catalogRequest=React.useRef(0),catalogMid=React.useRef(null);
        function setConfirm(value) {rememberedConfirmation=value&&state?confirmationKey(state):null;setConfirmValue(value);}
        function acceptStatus(s,reset=false) {
          const key=confirmationKey(s);
          if(reset||(!s.enabled&&rememberedWasEnabled)||!s.credentialConfigured||rememberedConfirmation!==key)rememberedConfirmation=null;
          rememberedWasEnabled=!!s.enabled;
          const checked=!!s.enabled||rememberedConfirmation===key;
          if(s.enabled)rememberedConfirmation=key;
          setState(s);setConfirmValue(checked);
        }
        async function toggleConfirmation(checked) {
          setConfirm(checked);
          if(!checked)await run('pause');
        }
        async function loadSubmissions(page=1) {
          const request=++catalogRequest.current;
          setCatalogBusy(true);setCatalogError('');
          try {
            const value=await api('submissions',{page});
            if(!alive.current||request!==catalogRequest.current)return;
            const changed=(catalogMid.current??rememberedAccount)!==null&&(catalogMid.current??rememberedAccount)!==value.account.mid;
            rememberedAccount=value.account.mid;
            if(changed) {
              setForm(s=>s?{...s,bvids:[]}:s);setConfirm(false);setPreview(null);
              setCatalog({items:[],page:0,total:null,end:false});
              await api('pause');
              const stopped=await api('status');if(!alive.current||request!==catalogRequest.current)return;acceptStatus(stopped,true);
              if(page!==1)throw new Error(t('accountChanged'));
            }
            catalogMid.current=value.account.mid;setAccount(value.account);
            setCatalog(previous=>{
              const items=[...new Map([...(page===1?[]:previous.items),...value.items].map(v=>[v.bvid,v])).values()];
              return {items:items.slice(0,1000),page:value.page,total:value.total,end:value.end};
            });
          }catch(e){if(alive.current&&request===catalogRequest.current)setCatalogError(e.message);}
          finally {if(alive.current&&request===catalogRequest.current)setCatalogBusy(false);}
        }
        React.useEffect(()=>{
          alive.current=true;
          api('status').then(s=>{
            if(!alive.current)return;
            acceptStatus(s);setForm(s.settings);
            if(s.credentialConfigured)loadSubmissions(1);
          }).catch(e=>{if(alive.current)setError(e.message);});
          return()=>{alive.current=false;catalogRequest.current++;};
        },[]);
        React.useEffect(()=>{
          if(!qr||!['waiting','scanned'].includes(qr.status))return;
          const timer=setTimeout(async()=>{
            try {
              const value=await api('loginPoll');if(!alive.current)return;
              if(value.account) {
                setAccount(value.account);setQr(null);setConfirm(false);setNotice(t('ok'));
                const s=await api('status');if(!alive.current)return;acceptStatus(s,true);await loadSubmissions(1);
              }else setQr(q=>q?{...q,status:value.status}:q);
            }catch(e){if(alive.current){setError(e.message);setQr(null);}}
          },3000);
          return()=>clearTimeout(timer);
        },[qr]);
        const change=(key,value)=>{setForm(s=>({...s,[key]:value}));setConfirm(false);setPreview(null);setSampleReply(null);};
        async function updateSelection(ids) {
          const next=[...new Set(ids)];
          if(next.length>1000){setError(t('selectionLimit'));return;}
          setConfirm(false);setPreview(null);setError('');
          if(state?.enabled) {
            setBusy(true);
            try {await api('pause');if(!alive.current)return;acceptStatus({...state,enabled:false,message:t('selectionPaused')},true);}
            catch(e){if(alive.current)setError(e.message);return;}
            finally {if(alive.current)setBusy(false);}
          }
          change('bvids',next);
        }
        async function run(action,input) {
          setBusy(true);setError('');setNotice('');
          if(['loginStart','logout','account'].includes(action))setConfirm(false);
          try {
            const value=await api(action,input);if(!alive.current)return;
            if(action==='loginStart'){catalogRequest.current++;setCatalogBusy(false);setQr(value);}
            else if(action==='account')setAccount(value);
            else if(action==='logout') {
              catalogRequest.current++;catalogMid.current=null;rememberedAccount=null;setCatalogBusy(false);setAccount(null);setQr(null);
              setCatalog({items:[],page:0,total:null,end:false});setCatalogError('');change('bvids',[]);
            }else if(action==='preview')setPreview(value);
            else if(action==='sample')setSampleReply(value);
            else if(action==='configure'){setForm(value.settings);setNotice(t('saved'));setConfirm(false);setPreview(null);setSampleReply(null);}
            const s=await api('status');if(alive.current)acceptStatus(s,['pause','configure','logout','loginStart'].includes(action));
          }catch(e){if(alive.current){setError(e.message);if(action==='enable')setConfirm(false);if(action==='pause'){try{const s=await api('status');if(alive.current)acceptStatus(s,true);}catch{setConfirm(!!state?.enabled);}}}}
          finally {if(alive.current)setBusy(false);}
        }
        const button=(key,action,disabled=false)=>h('button',{type:'button',disabled,onClick:action},t(key));
        const field=(key,node,hint)=>h('label',{className:'bcr-field'},h('span',null,t(key)),node,hint&&h('small',null,t(hint)));
        const dirty=!!form&&JSON.stringify(form)!==JSON.stringify(state?.settings);
        const blocked=busy||catalogBusy;
        const selected=new Set(form?.bvids||[]),savedIds=state?.settings?.bvids||[];
        const titleOf=id=>catalog.items.find(v=>v.bvid===id)?.title||`${id}（${t('unknownVideo')}）`;
        return h('section',{className:'bcr-panel','aria-label':t('title')},
          h('style',null,`.bcr-panel{color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;max-width:840px;padding:8px 0 28px}.bcr-panel h2{font-size:20px;margin:0 0 8px}.bcr-panel h3{font-size:15px;margin:0 0 12px}.bcr-panel p,.bcr-panel small{color:var(--dsw-alias-label-secondary);line-height:1.65}.bcr-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px;margin:16px 0}.bcr-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0}.bcr-panel button{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;cursor:pointer}.bcr-panel button:hover{background:var(--dsw-alias-interactive-bg-hover)}.bcr-panel button:disabled{opacity:.5;cursor:not-allowed}.bcr-panel input:not([type=checkbox]),.bcr-panel textarea{box-sizing:border-box;width:100%;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 10px}.bcr-panel textarea{resize:vertical;min-height:78px}.bcr-panel button:focus-visible,.bcr-panel input:focus-visible,.bcr-panel textarea:focus-visible,.bcr-panel summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.bcr-field{display:flex;flex-direction:column;gap:7px;margin:14px 0}.bcr-field>span{font-weight:500}.bcr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.bcr-rule{display:grid;grid-template-columns:minmax(100px,1fr) minmax(140px,2fr) auto;gap:8px;margin:10px 0;align-items:start}.bcr-state{padding:4px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}.bcr-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}.bcr-notice{color:var(--dsw-alias-state-success-primary)}.bcr-item{border-top:1px solid var(--dsw-alias-border-l1);padding:12px 0;overflow-wrap:anywhere}.bcr-item p{white-space:pre-wrap;margin:5px 0}.bcr-qr{width:240px;height:240px;max-width:100%}.bcr-consent{display:flex;align-items:flex-start;gap:8px;line-height:1.6}.bcr-panel input[type=checkbox]{accent-color:var(--dsw-alias-brand-primary);margin-top:5px}.bcr-video-list{max-height:420px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}.bcr-video{display:flex;gap:12px;align-items:center;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}.bcr-video:last-child{border-bottom:0}.bcr-video:has(input:checked){background:var(--dsw-alias-bg-layer-2)}.bcr-cover{width:112px;aspect-ratio:16/10;flex-shrink:0;overflow:hidden;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.bcr-cover img{width:100%;height:100%;object-fit:cover}.bcr-video-info{min-width:0;overflow-wrap:anywhere}.bcr-video-info strong{display:block;line-height:1.5}.bcr-panel details{margin:12px 0;overflow-wrap:anywhere}.bcr-panel summary{cursor:pointer}.bcr-selected-list{max-height:220px;overflow:auto;line-height:1.8;padding-left:22px}@media(max-width:540px){.bcr-rule{grid-template-columns:1fr}.bcr-card{padding:12px}.bcr-cover{width:80px}.bcr-video{gap:8px;padding:10px}}`),
          h('h2',null,t('title')),h('p',null,t('intro')),
          error&&h('div',{role:'alert',className:'bcr-error'},error),notice&&h('div',{role:'status',className:'bcr-notice'},notice),
          h('div',{className:'bcr-card'},h('h3',null,t('account')),
            h('p',null,account?`${account.name} · 用户编号 ${account.mid}`:t(state?.credentialConfigured?'configured':'unknown')),
            h('div',{className:'bcr-row'},button('login',()=>run('loginStart'),blocked),button('check',()=>run('account'),blocked),button('logout',()=>run('logout'),busy||!state?.credentialConfigured)),
            qr&&h('div',null,h('img',{className:'bcr-qr',src:qr.image,alt:t('qr')}),h('p',{role:'status'},t(qr.status)))),
          state&&h('div',{className:'bcr-card'},h('h3',null,t('state')),
            h('div',{className:'bcr-row'},h('span',{className:'bcr-state'},t(state.enabled?'on':'off')),h('span',null,`${t('today')}: ${state.todayAttempts} / ${state.settings.dailyLimit}`),button('refresh',()=>run('status'),blocked),button('pause',()=>run('pause'),false)),state.message&&h('p',null,state.message)),
          form&&h('div',{className:'bcr-card'},h('h3',null,t('videos')),h('p',null,t('videoHint')),
            h('div',{className:'bcr-row'},button('load',()=>loadSubmissions(1),blocked||!state?.credentialConfigured),button('selectAll',()=>updateSelection([...selected,...catalog.items.map(v=>v.bvid)]),blocked||!catalog.items.length),button('clear',()=>updateSelection([]),blocked||!selected.size)),
            h('p',{'aria-live':'polite'},`${t('loaded')} ${catalog.items.length} ${t('unit')} / ${t('total')} ${catalog.total??'—'} ${t('unit')}；${t('selected')} ${selected.size} ${t('unit')}`),
            catalogBusy&&h('p',{role:'status'},t('loading')),
            catalogError&&h('div',{role:'alert',className:'bcr-error'},`${t('loadingError')} ${catalogError}`),
            !catalog.items.length&&!catalogBusy&&!catalogError&&h('p',null,t(catalog.page?'noVideos':'notLoaded')),
            !!catalog.items.length&&h('div',{className:'bcr-video-list','aria-label':t('videos')},...catalog.items.map(video=>h('label',{className:'bcr-video',key:video.bvid},
              h('input',{type:'checkbox','aria-label':`选择稿件：${video.title}`,checked:selected.has(video.bvid),disabled:blocked,onChange:e=>updateSelection(e.target.checked?[...selected,video.bvid]:[...selected].filter(v=>v!==video.bvid))}),
              h('span',{className:'bcr-cover'},video.cover?h('img',{src:video.cover,alt:`${video.title} · ${t('cover')}`,loading:'lazy',referrerPolicy:'no-referrer',onError:e=>{e.currentTarget.hidden=true;}}):t('noCover')),
              h('span',{className:'bcr-video-info'},h('strong',null,video.title),h('small',null,video.bvid))))),
            catalog.page>0&&!catalog.end&&h('div',{className:'bcr-row'},button('more',()=>loadSubmissions(catalog.page+1),blocked||catalog.items.length>=1000)),
            catalog.items.length>=1000&&!catalog.end&&h('p',null,t('selectionLimit')),
            !!selected.size&&h('details',null,h('summary',null,`${t('selectedList')}（${selected.size}）`),h('ul',{className:'bcr-selected-list'},...[...selected].map(id=>h('li',{key:id},titleOf(id)))))),
          form&&h('div',{className:'bcr-card'},h('h3',null,t('personaTitle')),
            field('personaName',h('input',{'aria-label':t('personaName'),value:form.personaName||'',maxLength:80,onChange:e=>change('personaName',e.target.value)})),
            field('persona',h('textarea',{'aria-label':t('persona'),value:form.persona||'',maxLength:6000,rows:6,onChange:e=>change('persona',e.target.value)}),'personaHint'),
            !form.persona?.trim()&&h('p',null,t('noPersona')),
            h('p',null,`${t('model')}：${state?.model?.provider&&state?.model?.model?`${state.model.provider} / ${state.model.model}`:t('noModel')}`),
            h('p',null,`${t('aiToday')}：${state?.todayGenerations??0} / ${state?.settings?.aiDailyLimit??40}`),
            h('p',null,t('privacy')),
            h('div',{className:'bcr-grid'},...['pollSeconds','gapSeconds','dailyLimit','maxReplyChars','aiDailyLimit'].map((key,i)=>field(['poll','gap','limit','maxChars','aiLimit'][i],h('input',{type:'number','aria-label':t(['poll','gap','limit','maxChars','aiLimit'][i]),min:[60,30,1,20,1][i],max:[3600,3600,100,300,200][i],value:form[key],onChange:e=>change(key,Number(e.target.value))})))),
            h('div',{className:'bcr-row'},button('save',()=>run('configure',{...form,replyMode:'persona'}),blocked),button('preview',()=>run('preview'),blocked||dirty||!savedIds.length||!state?.settings?.persona?.trim())),
            dirty&&h('p',{role:'status'},t('needSave')),
            field('sampleInput',h('textarea',{'aria-label':t('sampleInput'),value:sampleComment,maxLength:2000,onChange:e=>{setSampleComment(e.target.value);setSampleReply(null);}}),'sampleHint'),
            h('div',{className:'bcr-row'},button('sample',()=>run('sample',{comment:sampleComment}),blocked||dirty||state?.enabled||!state?.settings?.persona?.trim()||!sampleComment.trim())),
            h('p',null,`${t('savedSelection')}：${savedIds.length} ${t('unit')}；${t('personaName')}：${state?.settings?.personaName||'—'}`),
            h('label',{className:'bcr-consent'},h('input',{type:'checkbox',checked:!!state?.enabled||confirm,disabled:busy||(!state?.enabled&&(dirty||!savedIds.length||catalogBusy||!state?.settings?.persona?.trim())),onChange:e=>toggleConfirmation(e.target.checked)}),t('confirm')),h('small',null,t('confirmHint')),
            h('div',{className:'bcr-row'},button('enable',()=>run('enable',{confirmSelection:true,confirmAI:true,bvids:savedIds,settings:state.settings,model:state.model}),blocked||state?.enabled||!confirm||!state?.credentialConfigured||dirty||!savedIds.length||!state?.settings?.persona?.trim())),h('p',null,t('note'))),
          sampleReply&&h('div',{className:'bcr-card'},h('h3',null,t('sampleResult')),h('p',null,sampleReply.action==='skip'?t('sampleSkipped'):sampleReply.reply)),
          preview&&h('div',{className:'bcr-card'},h('h3',null,t('candidates')),h('p',null,t('scope')),preview.candidates?.length?preview.candidates.map(c=>h('div',{className:'bcr-item',key:c.key},h('strong',null,`${c.user} · ${c.bvid}`),h('p',null,c.comment),h('p',null,`→ ${c.reply}`))):h('p',null,preview.skipped||t('empty'))),
          h('div',{className:'bcr-card'},h('h3',null,t('history')),state?.history?.length?state.history.map(r=>h('div',{className:'bcr-item',key:r.key},h('strong',null,`${r.bvid} · ${t(r.status)}`),h('small',null,` · ${new Date(r.at).toLocaleString('zh-CN',{hour12:false})}`),h('p',null,r.reply))):h('p',null,t('empty'))));
      }
      ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bili-comment-reply',order:31,label:()=>t('title')},Panel));
    }};
  },
});
