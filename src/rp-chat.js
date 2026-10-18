let rpDraft=null;
function withTimeout(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=appHost.setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>appHost.clearTimeout(timer));}
/** fromStart: parts 1..current of the line being read go in as one message each, in order. */
async function openResultChat(fromStart=false){
 if(busy||!current)return;
 const record=current,parts=fromStart?partsUpTo(record):[record];
 rpDraft={recordId:record.id,partIds:parts.map(r=>r.id),name:((parts.length>1&&record.seriesTitle)||record.title||'새 이야기').slice(0,160),characterIds:[...(record.rpSource?.characterIds||record.characterIds||record.settings?.characterIds||[])],persona:'',connectionId:record.rpSource?.connectionId||record.settings?.connectionId||'',presetId:record.rpSource?.promptPresetId||'',loading:true,working:false,error:'',link:record.rpChatLink||null};
 if(rpDraft.link){for(const k of ['characterIds','persona','connectionId','presetId','partIds'])if(rpDraft.link[k]!==undefined)rpDraft[k]=structuredClone(rpDraft.link[k]);rpDraft.loading=false;openFeature('newchat');return;}const draft=rpDraft;openFeature('newchat');
 try{
  const source=record.rpSource|| (record.chatId?await withTimeout(get('/chats/'+encodeURIComponent(record.chatId)),5000,'원본 채팅 불러오기 지연'):{});
  if(rpDraft!==draft||featurePanel!=='newchat')return;
  if(!draft.characterIds.length)draft.characterIds=[...(source.characterIds||[])];
  const selected=record.settings?.referenceSource==='native'?[]:record.settings?.personaIds||[];
  draft.persona=selected.length===1?selected[0]:source.personaCharacterId?'character:'+source.personaCharacterId:source.personaId?'persona:'+source.personaId:'';
  draft.connectionId=draft.connectionId||source.connectionId||connections.find(c=>H.truth(c.isDefault))?.id||'';
  draft.presetId=draft.presetId||source.promptPresetId||'';
 }catch(e){draft.error=e.message+' · 아래에서 직접 골라 주세요.';}
 finally{draft.loading=false;if(rpDraft===draft&&featurePanel==='newchat')paintFeature();}
}
function resultChatPanel(){
 const d=rpDraft;if(!d)return '';
 const record=records.find(r=>r.id===d.recordId)||current,ready=d.link?.messageId,many=d.partIds.length>1,what=many?`1편부터 ${d.partIds.length}편까지 아티클을 메시지로 하나씩`:'아티클을 첫 메시지로';
 if(ready)return featureShell('새 RP방',`<p class="rp-success">${E(d.link.name)}에 ${what} 저장했어요.</p><p class="hint">새 방 열기를 누르면 화면을 새로고침해서 해당 방으로 이동해요.</p>`,`<button id="feature-close-bottom">닫기</button><button id="rp-open" class="primary">새 방 열기</button>`);
 const frozen=d.working||d.loading||!!d.link;
 const options=[['','선택 안 함'],...personas.map(p=>['persona:'+p.id,p.name||H.character(p).name]),...characters.map(c=>['character:'+c.id,'캐릭터로 참여 · '+H.character(c).name])];
 const pick=(id,items,value)=>`<select id="${id}" ${frozen?'disabled':''}>${items.map(([v,n])=>opt(v,n,value)).join('')}</select>`;
 return featureShell('결과로 새 RP방 만들기',`<p class="hint">${E(record?.title||'')}의 ${what} 넣어요.</p>${field('방 이름',`<input id="rp-name" maxlength="160" value="${E(d.name)}" ${frozen?'disabled':''}>`)}<div class="field"><span>등장 캐릭터</span><div class="chips">${characters.map(c=>`<label class="check"><input type="checkbox" data-rp-character="${E(c.id)}" ${d.characterIds.includes(c.id)?'checked':''} ${frozen?'disabled':''}>${E(H.character(c).name)}</label>`).join('')||'<p class="hint">등록된 캐릭터가 없어요.</p>'}</div></div>${field('플레이할 페르소나',pick('rp-persona',options,d.persona))}${field('AI 연결',pick('rp-connection',[['','기본 연결'],...connections.map(c=>[c.id,c.name])],d.connectionId))}${field('RP 프리셋',pick('rp-preset',[['','기본 설정'],...presets.map(p=>[p.id,p.name])],d.presetId))}<p class="rp-error" role="status">${E(d.error)}</p>${d.link?'<p class="hint">이미 만든 방에 첫 메시지 저장을 다시 시도해요.</p>':''}`,`<button id="feature-close-bottom" ${d.working?'disabled':''}>닫기</button><button id="rp-create" class="primary" ${d.loading||d.working?'disabled':''}>${d.loading?'불러오는 중…':d.working?'저장 중…':d.link?'저장 다시 시도':'새 RP방 만들기'}</button>`);
}
async function createResultChat(){
 const d=rpDraft,record=records.find(r=>r.id===d?.recordId)|| (current?.id===d?.recordId?current:null);
 if(!d||d.loading||d.working||busy||!record)return;
 if(!d.link){
  d.name=($('rp-name')?.value||'').trim().slice(0,160);d.characterIds=[...root.querySelectorAll('[data-rp-character]:checked')].map(el=>el.dataset.rpCharacter);d.persona=$('rp-persona')?.value||'';d.connectionId=$('rp-connection')?.value||'';d.presetId=$('rp-preset')?.value||'';
  if(!d.name||!d.characterIds.length){d.error='방 이름과 등장 캐릭터를 선택해 주세요.';paintFeature();return;}
  if(partRecords(d).some(r=>!r?.content?.trim())){d.error='새 방에 넣을 아티클이 없어요.';paintFeature();return;}
 }
 d.working=true;d.error='';busy=true;paintFeature();
 const persistLink=async()=>{const latest=records.find(r=>r.id===record.id)||record;const next={...latest,rpChatLink:structuredClone(d.link)};await save(next);if(current?.id===next.id)current=next;};
 try{
  if(!d.link){d.link={name:d.name+' · '+H.uuid().slice(-8),chatId:null,messageId:null,partIds:[...d.partIds],characterIds:[...d.characterIds],persona:d.persona,connectionId:d.connectionId,presetId:d.presetId};await persistLink();}
  if(!d.link.chatId){
   // Recover an acknowledged-late create before issuing another POST.
   const existing=(await get('/chats')).find(c=>c.name===d.link.name);
   const body={name:d.link.name,mode:'roleplay',characterIds:d.characterIds,personaId:d.persona.startsWith('persona:')?d.persona.slice(8):null,personaCharacterId:d.persona.startsWith('character:')?d.persona.slice(10):null,connectionId:d.connectionId||null,promptPresetId:d.presetId||null};
   const chat=existing||await (await api('/chats',body)).json();
   if(!chat?.id)throw Error('새 방 저장을 확인하지 못했어요.');d.link.chatId=chat.id;await persistLink();
  }
  // One assistant message per part, in order; parts already saved by an earlier attempt are skipped.
  const saved=await get('/chats/'+encodeURIComponent(d.link.chatId)+'/messages');let message=null;
  for(const part of partRecords(d)){
   message=saved.find(m=>H.parseObject(m.extra).sideBRecordId===part.id)||await (await api('/chats/'+encodeURIComponent(d.link.chatId)+'/messages',{role:'assistant',characterId:d.characterIds.length===1?d.characterIds[0]:null,content:part.content,extra:{sideBRecordId:part.id}})).json();
   if(!message?.id)throw Error('메시지 저장을 확인하지 못했어요.');
  }
  d.link.messageId=message.id;await persistLink();
  say(d.partIds.length>1?`새 RP방에 1편부터 ${d.partIds.length}편까지 아티클을 저장했어요.`:'새 RP방에 아티클을 저장했어요.');
 }catch(e){d.error=e.message+' · 다시 시도하면 저장된 방부터 확인해요.';}
 finally{d.working=false;busy=false;if(alive&&rpDraft===d&&featurePanel==='newchat')paintFeature();}
}
function partRecords(d){return (d.partIds?.length?d.partIds:[d.recordId]).map(id=>records.find(r=>r.id===id));}
/** Appends one part, or parts 1..current, to the chat open in Marinara as character messages. */
async function appendResultToChat(fromStart=false){
 if(busy||!current)return;const record=current,parts=fromStart?partsUpTo(record):[record],open=appHost.currentChatId();
 if(!open||record.chatId!==open)throw Error('이 아티클을 만든 채팅을 마리나라에서 열어 둔 상태에서 추가할 수 있어요.');
 if(parts.some(r=>!r?.content?.trim()))throw Error('채팅에 넣을 아티클이 없어요.');
 if(!await askConfirm('현재 채팅에 추가',`${parts.length>1?`1편부터 ${parts.length}편까지 `:''}아티클 ${parts.length}개를 캐릭터 메시지로 지금 채팅 맨 끝에 붙여요. 일반 메시지라 이후 대화에서 AI가 기억해요.`))return;
 busy=true;render();
 try{
  const chat=await get('/chats/'+encodeURIComponent(open)),members=H.parseArray(chat?.characterIds),speaker=members.find(id=>H.parseArray(record.characterIds).includes(id))||(members.length===1?members[0]:null);
  // Parts already appended by an earlier attempt are not sent twice.
  const saved=new Set((await get('/chats/'+encodeURIComponent(open)+'/messages')).map(m=>H.parseObject(m.extra).sideBRecordId).filter(Boolean));let n=0;
  for(const part of parts){if(saved.has(part.id))continue;const message=await (await api('/chats/'+encodeURIComponent(open)+'/messages',{role:'assistant',characterId:speaker,content:part.content,extra:{sideBRecordId:part.id}})).json();if(!message?.id)throw Error('메시지 저장을 확인하지 못했어요.');n++;}
  say(n?`채팅에 메시지 ${n}개를 추가했어요.`:'이미 채팅에 들어 있는 아티클이에요.');
  // Marinara does not refresh an open chat for messages added through the API.
  if(n&&await askConfirm('채팅 새로고침',`추가한 메시지는 새로고침하면 채팅에 보여요. 지금 새로고침할까요?`)){flushSettings();await saveQueue;window.location.reload();}
 }finally{busy=false;if(alive)render();}
}
async function openCreatedChat(){if(!rpDraft?.link?.messageId)return;flushSettings();await saveQueue;localStorage.setItem('marinara-active-chat-id',rpDraft.link.chatId);window.location.reload();}

