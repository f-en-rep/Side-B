let rpDraft=null;
async function openResultChat(){
 if(busy||!current)return;
 const record=current;
 rpDraft={recordId:record.id,name:(record.title||'새 이야기').slice(0,160),characterIds:[...(record.rpSource?.characterIds||record.characterIds||record.settings?.characterIds||[])],persona:'',connectionId:record.rpSource?.connectionId||record.settings?.connectionId||'',presetId:record.rpSource?.promptPresetId||'',loading:true,working:false,error:'',link:record.rpChatLink||null};
 if(rpDraft.link){for(const k of ['characterIds','persona','connectionId','presetId'])if(rpDraft.link[k]!==undefined)rpDraft[k]=structuredClone(rpDraft.link[k]);rpDraft.loading=false;openFeature('newchat');return;}const draft=rpDraft;openFeature('newchat');
 try{
  const source=record.rpSource|| (record.chatId?await bounded(get('/chats/'+encodeURIComponent(record.chatId)),5000,'원본 채팅 불러오기 지연'):{});
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
 const record=records.find(r=>r.id===d.recordId)||current,ready=d.link?.messageId;
 if(ready)return featureShell('새 RP방',`<p class="rp-success">${E(d.link.name)}에 원문을 첫 메시지로 저장했어요.</p><p class="hint">새 방 열기를 누르면 화면을 새로고침해서 해당 방으로 이동해요.</p>`,`<button id="feature-close-bottom">닫기</button><button id="rp-open" class="primary">새 방 열기</button>`);
 const frozen=d.working||d.loading||!!d.link;
 const options=[['','선택 안 함'],...personas.map(p=>['persona:'+p.id,p.name||H.character(p).name]),...characters.map(c=>['character:'+c.id,'캐릭터로 참여 · '+H.character(c).name])];
 const pick=(id,items,value)=>`<select id="${id}" ${frozen?'disabled':''}>${items.map(([v,n])=>opt(v,n,value)).join('')}</select>`;
 return featureShell('결과로 새 RP방 만들기',`<p class="hint">${E(record?.title||'')}의 원문을 첫 메시지로 넣어요.</p>${field('방 이름',`<input id="rp-name" maxlength="160" value="${E(d.name)}" ${frozen?'disabled':''}>`)}<div class="field"><span>등장 캐릭터</span><div class="chips">${characters.map(c=>`<label class="check"><input type="checkbox" data-rp-character="${E(c.id)}" ${d.characterIds.includes(c.id)?'checked':''} ${frozen?'disabled':''}>${E(H.character(c).name)}</label>`).join('')||'<p class="hint">등록된 캐릭터가 없어요.</p>'}</div></div>${field('플레이할 페르소나',pick('rp-persona',options,d.persona))}${field('AI 연결',pick('rp-connection',[['','기본 연결'],...connections.map(c=>[c.id,c.name])],d.connectionId))}${field('RP 프리셋',pick('rp-preset',[['','기본 설정'],...presets.map(p=>[p.id,p.name])],d.presetId))}<p class="rp-error" role="status">${E(d.error)}</p>${d.link?'<p class="hint">이미 만든 방에 첫 메시지 저장을 다시 시도해요.</p>':''}`,`<button id="feature-close-bottom" ${d.working?'disabled':''}>닫기</button><button id="rp-create" class="primary" ${d.loading||d.working?'disabled':''}>${d.loading?'불러오는 중…':d.working?'저장 중…':d.link?'저장 다시 시도':'새 RP방 만들기'}</button>`);
}
async function createResultChat(){
 const d=rpDraft,record=records.find(r=>r.id===d?.recordId)|| (current?.id===d?.recordId?current:null);
 if(!d||d.loading||d.working||busy||!record)return;
 if(!d.link){
  d.name=($('rp-name')?.value||'').trim().slice(0,160);d.characterIds=[...root.querySelectorAll('[data-rp-character]:checked')].map(el=>el.dataset.rpCharacter);d.persona=$('rp-persona')?.value||'';d.connectionId=$('rp-connection')?.value||'';d.presetId=$('rp-preset')?.value||'';
  if(!d.name||!d.characterIds.length){d.error='방 이름과 등장 캐릭터를 선택해 주세요.';paintFeature();return;}
  if(!record.content?.trim()){d.error='새 방에 넣을 원문이 없어요.';paintFeature();return;}
 }
 d.working=true;d.error='';busy=true;paintFeature();
 const persistLink=async()=>{const latest=records.find(r=>r.id===record.id)||record;const next={...latest,rpChatLink:structuredClone(d.link)};await save(next);if(current?.id===next.id)current=next;};
 try{
  if(!d.link){d.link={name:d.name+' · '+H.uuid().slice(-8),chatId:null,messageId:null,characterIds:[...d.characterIds],persona:d.persona,connectionId:d.connectionId,presetId:d.presetId};await persistLink();}
  if(!d.link.chatId){
   // Recover an acknowledged-late create before issuing another POST.
   const existing=(await get('/chats')).find(c=>c.name===d.link.name);
   const body={name:d.link.name,mode:'roleplay',characterIds:d.characterIds,personaId:d.persona.startsWith('persona:')?d.persona.slice(8):null,personaCharacterId:d.persona.startsWith('character:')?d.persona.slice(10):null,connectionId:d.connectionId||null,promptPresetId:d.presetId||null};
   const chat=existing||await (await api('/chats',body)).json();
   if(!chat?.id)throw Error('새 방 저장을 확인하지 못했어요.');d.link.chatId=chat.id;await persistLink();
  }
  const messages=await get('/chats/'+encodeURIComponent(d.link.chatId)+'/messages');
  let message=messages.find(m=>H.parseObject(m.extra).sideBRecordId===record.id);
  if(!message)message=await (await api('/chats/'+encodeURIComponent(d.link.chatId)+'/messages',{role:'assistant',characterId:d.characterIds.length===1?d.characterIds[0]:null,content:record.content,extra:{sideBRecordId:record.id}})).json();
  if(!message?.id)throw Error('첫 메시지 저장을 확인하지 못했어요.');d.link.messageId=message.id;await persistLink();
  say('새 RP방에 원문을 저장했어요.');
 }catch(e){d.error=e.message+' · 다시 시도하면 저장된 방부터 확인해요.';}
 finally{d.working=false;busy=false;if(alive&&rpDraft===d&&featurePanel==='newchat')paintFeature();}
}
async function openCreatedChat(){if(!rpDraft?.link?.messageId)return;flushSettings();await saveQueue;localStorage.setItem('marinara-active-chat-id',rpDraft.link.chatId);window.location.reload();}

