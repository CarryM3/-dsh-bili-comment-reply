window.__ModuleLoader__.load({
  id:'@local/dsh-bili-comment-reply',
  factory(require) {
    const React=require('react'),h=React.createElement;
    return {inject:['slots','locale'],apply(ctx) {
      const zh={
        title:'B站评论助手',intro:'加载本人投稿，勾选需要回复的稿件。加载与选择不会开启自动回复。',
        login:'扫码登录',logout:'退出登录',check:'检查账号',refresh:'刷新状态',save:'保存所选稿件及规则',
        preview:'预览回复（不发送）',enable:'确认开启所选稿件自动回复',pause:'立即暂停',
        videos:'选择需要自动回复的投稿',load:'重新加载本人投稿',more:'加载更多投稿',selectAll:'全选已加载稿件',clear:'取消全部选择',
        videoHint:'扫码后自动加载已发布投稿。新增投稿和后续加载的稿件不会自动勾选；全选只针对当前已加载列表。',
        loading:'正在加载本人投稿…',notLoaded:'登录后将自动加载投稿，也可点击重新加载。',noVideos:'当前账号没有可加载的已发布投稿。',
        loaded:'已加载',selected:'已选择',total:'投稿总数',unit:'个',savedSelection:'已保存的回复范围',
        selectedList:'查看所选稿件清单',unknownVideo:'尚未在已加载列表中出现的已保存稿件',cover:'稿件封面',noCover:'暂无封面',
        selectionLimit:'最多选择或加载1000个稿件，请分批管理。',needSave:'选择或规则已变更，请先保存，再预览或确认开启。',
        loadingError:'投稿加载失败；不会自动选择或开启回复。',accountChanged:'账号已变化，请重新加载本人投稿并选择回复范围。',
        selectionPaused:'所选稿件已变更，自动回复已暂停；保存后需重新确认开启。',
        rules:'关键词规则',rulesHint:'按顺序命中第一条；关键词不区分大小写。无匹配且默认回复为空时跳过。',
        keyword:'关键词',reply:'回复内容',add:'添加规则',remove:'移除',fallback:'默认回复',
        template:'支持 {user} 和 {title}。开启后仅处理新发布的一级评论，不处理楼中楼。',
        poll:'轮询间隔（秒）',gap:'发送间隔（秒）',limit:'每日尝试上限（北京时间）',
        confirm:'我确认仅向下方已保存范围内的所选稿件发送以上规则的回复，了解自动评论可能触发平台限制。',
        off:'已暂停',on:'自动回复中',unknown:'尚未登录',configured:'已保存凭证（加载投稿或检查账号时验证）',
        today:'今日发送尝试',history:'发送记录',empty:'暂无记录',candidates:'预览结果',
        scope:'每稿最多扫描最近3页；超长回复线程保守跳过。预览包含历史评论，自动回复不会补发历史。',
        waiting:'请用手机B站 → 我的 → 扫一扫',scanned:'已扫码，请在手机上确认',expired:'二维码已过期，请重新生成',ok:'登录成功',
        saved:'设置已保存，自动回复保持暂停；加载投稿和全选均不会自动开启。',
        note:'每轮最多检查10个所选稿件并轮转，最多发送1条。跳过自己的评论及已有本人回复的线程，发送超时不重试。重启后默认暂停。',
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
      function Panel() {
        const [state,setState]=React.useState(null),[form,setForm]=React.useState(null),[busy,setBusy]=React.useState(false);
        const [error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[qr,setQr]=React.useState(null);
        const [account,setAccount]=React.useState(null),[confirm,setConfirm]=React.useState(false),[preview,setPreview]=React.useState(null);
        const [catalog,setCatalog]=React.useState({items:[],page:0,total:null,end:false});
        const [catalogBusy,setCatalogBusy]=React.useState(false),[catalogError,setCatalogError]=React.useState('');
        React.useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot());
        const alive=React.useRef(true),catalogRequest=React.useRef(0),catalogMid=React.useRef(null);
        async function loadSubmissions(page=1) {
          const request=++catalogRequest.current;
          setCatalogBusy(true);setCatalogError('');
          try {
            const value=await api('submissions',{page});
            if(!alive.current||request!==catalogRequest.current)return;
            const changed=catalogMid.current!==null&&catalogMid.current!==value.account.mid;
            if(changed) {
              setForm(s=>s?{...s,bvids:[]}:s);setConfirm(false);setPreview(null);
              setCatalog({items:[],page:0,total:null,end:false});
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
            setState(s);setForm(s.settings);
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
                const s=await api('status');if(!alive.current)return;setState(s);await loadSubmissions(1);
              }else setQr(q=>q?{...q,status:value.status}:q);
            }catch(e){if(alive.current){setError(e.message);setQr(null);}}
          },3000);
          return()=>clearTimeout(timer);
        },[qr]);
        const change=(key,value)=>{setForm(s=>({...s,[key]:value}));setConfirm(false);setPreview(null);};
        async function updateSelection(ids) {
          const next=[...new Set(ids)];
          if(next.length>1000){setError(t('selectionLimit'));return;}
          setConfirm(false);setPreview(null);setError('');
          if(state?.enabled) {
            setBusy(true);
            try {await api('pause');if(!alive.current)return;setState(s=>({...s,enabled:false,message:t('selectionPaused')}));}
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
              catalogRequest.current++;catalogMid.current=null;setCatalogBusy(false);setAccount(null);setQr(null);
              setCatalog({items:[],page:0,total:null,end:false});setCatalogError('');change('bvids',[]);
            }else if(action==='preview')setPreview(value);
            else if(action==='configure'){setForm(value.settings);setNotice(t('saved'));setConfirm(false);setPreview(null);}
            const s=await api('status');if(alive.current)setState(s);
          }catch(e){if(alive.current)setError(e.message);}
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
          form&&h('div',{className:'bcr-card'},h('h3',null,t('rules')),h('small',null,t('rulesHint')),
            ...form.rules.map((rule,i)=>h('div',{className:'bcr-rule',key:i},h('input',{'aria-label':`${t('keyword')} ${i+1}`,placeholder:t('keyword'),value:rule.keyword,onChange:e=>change('rules',form.rules.map((v,j)=>j===i?{...v,keyword:e.target.value}:v))}),h('textarea',{'aria-label':`${t('reply')} ${i+1}`,placeholder:t('reply'),value:rule.reply,onChange:e=>change('rules',form.rules.map((v,j)=>j===i?{...v,reply:e.target.value}:v))}),button('remove',()=>change('rules',form.rules.filter((_,j)=>j!==i)),blocked))),
            button('add',()=>change('rules',[...form.rules,{keyword:'',reply:''}]),form.rules.length>=30||blocked),
            field('fallback',h('textarea',{'aria-label':t('fallback'),value:form.fallbackReply,maxLength:500,onChange:e=>change('fallbackReply',e.target.value)}),'template'),
            h('div',{className:'bcr-grid'},...['pollSeconds','gapSeconds','dailyLimit'].map((key,i)=>field(['poll','gap','limit'][i],h('input',{type:'number','aria-label':t(['poll','gap','limit'][i]),min:[60,30,1][i],max:[3600,3600,100][i],value:form[key],onChange:e=>change(key,Number(e.target.value))})))),
            h('div',{className:'bcr-row'},button('save',()=>run('configure',form),blocked),button('preview',()=>run('preview'),blocked||dirty||!savedIds.length)),
            dirty&&h('p',{role:'status'},t('needSave')),
            h('p',null,`${t('savedSelection')}：${savedIds.length} ${t('unit')}`),
            h('label',{className:'bcr-consent'},h('input',{type:'checkbox',checked:confirm,disabled:dirty||!savedIds.length||blocked,onChange:e=>setConfirm(e.target.checked)}),t('confirm')),
            h('div',{className:'bcr-row'},button('enable',()=>run('enable',{confirmSelection:true,bvids:savedIds,settings:state.settings}),blocked||!confirm||!state?.credentialConfigured||dirty||!savedIds.length)),h('p',null,t('note'))),
          preview&&h('div',{className:'bcr-card'},h('h3',null,t('candidates')),h('p',null,t('scope')),preview.candidates?.length?preview.candidates.map(c=>h('div',{className:'bcr-item',key:c.key},h('strong',null,`${c.user} · ${c.bvid}`),h('p',null,c.comment),h('p',null,`→ ${c.reply}`))):h('p',null,preview.skipped||t('empty'))),
          h('div',{className:'bcr-card'},h('h3',null,t('history')),state?.history?.length?state.history.map(r=>h('div',{className:'bcr-item',key:r.key},h('strong',null,`${r.bvid} · ${t(r.status)}`),h('small',null,` · ${new Date(r.at).toLocaleString('zh-CN',{hour12:false})}`),h('p',null,r.reply))):h('p',null,t('empty'))));
      }
      ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bili-comment-reply',order:31,label:()=>t('title')},Panel));
    }};
  },
});
