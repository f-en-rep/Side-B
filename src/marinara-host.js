/** Marinara adapter: no SillyTavern globals or relative host imports. */
function createMarinaraHost(runtime){

 const currentChatId=()=>{try{return localStorage.getItem('marinara-active-chat-id')||'';}catch{return '';}};
 async function response(path,body,signal){
  if(signal?.aborted)throw new DOMException('중단됨','AbortError');
  const r=await runtime.fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','x-marinara-csrf':'1'},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});
  if(!r.ok)throw new Error(HostCore.httpError(r.status,path,body,await r.text()));return r;
 }
 async function request(path,body,signal){const r=await response(path,body,signal);if(!(r.headers.get('content-type')||'').includes('json'))throw Error('마리나라가 JSON 대신 다른 페이지를 반환했어요. 로그인 상태를 확인해 주세요.');return r.json();}
 const tokenCounter=()=>({text:async value=>SideExtras.tokens(value),messages:async rows=>SideExtras.inputTokens(rows),info:()=>({source:'estimate',label:'마리나라 · 글자 수 추정'})});
 async function messages(id,signal){return id?request('/chats/'+encodeURIComponent(id)+'/messages',undefined,signal):[];}
 async function currentAnchor(id,signal){const rows=await messages(id,signal);const row=rows.at(-1);return row?{index:rows.length-1,messageId:String(row.id),sendDate:String(row.createdAt||''),name:String(row.role||'')}:null;}
 async function resolveAnchor(anchor,id,signal){const rows=await messages(id,signal);return anchor?.messageId?rows.findIndex(m=>String(m.id)===anchor.messageId):-1;}
 function limitHistory(rows,options){return Number.isInteger(options.historyCutoff)&&options.historyCutoff>=0?rows.slice(0,options.historyCutoff+1):rows;}
 async function generate(payload,signal,onText=()=>{},diagnostics={}){
  const body={connectionId:payload.connectionId,messages:payload.messages,parameters:payload.parameters,streaming:true,runId:payload.runId};
  const running={runId:body.runId,connectionId:body.connectionId};
  const abort=()=>{request('/generate/raw/abort',running).catch(()=>{});};
  if(signal?.aborted)throw new DOMException('중단됨','AbortError');
  signal?.addEventListener('abort',abort,{once:true});
  try{payload.onPromptReady?.({messages:body.messages,meta:{connectionId:body.connectionId}});const r=await response('/generate/raw',body,signal);
   if((r.headers.get('content-type')||'').includes('json')){const value=await r.json();const text=value.content??value.text??value.data?.content;if(typeof text!=='string')throw Error('AI 응답에 본문이 없어요.');onText(text);return text;}
   return await HostCore.stream(r,onText,signal,diagnostics);
  }finally{signal?.removeEventListener('abort',abort);}
 }
 return {request,response,generate,tokenCounter,currentChatId,currentAnchor,resolveAnchor,limitHistory,currentPersona:()=>'',
  storage:runtime.storage,setTimeout:(...a)=>runtime.setTimeout(...a),clearTimeout:id=>runtime.clearTimeout(id),onCleanup:fn=>runtime.onCleanup(fn),
  async createCharacterFromProfile({name,description}){return request('/characters',{data:{name,description,personality:'',scenario:'',first_mes:'',mes_example:''}});},
  async createPersonaFromProfile({name,description}){return request('/characters/personas',{name,description});}
 };
}
