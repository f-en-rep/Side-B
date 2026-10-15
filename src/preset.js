const SidePreset=(()=>{
 function nativePromptParts(options,chat){
  // Skipping presets without promptParts would drop persona/cards in native preview.
  // Explicit promptParts invokes Marinara's persona, character and context assembly.
  const hasPersona=!!(chat?.personaId||chat?.personaCharacterId);
  return {
   includePersona:hasPersona,
   includeCharacters:true,
   includeHistory:options.referenceMode!=='summary',
   includeChatSummary:options.includeSummary===true,
   includeLorebook:true,
   includeTrackers:true
  };
 }
 function hasNativePersona(preview){
  return Array.isArray(preview?.prompt?.messages)&&preview.prompt.messages.some(m=>m?.role==='system'&&typeof m.content==='string'&&/(?:<persona(?:\s[^>]*)?>|^##\s*persona\b|^Name:\s*\S)/im.test(m.content));
 }
 function compose(preview,taskMessages,maxTokens,inputMaxTokens=Infinity){
 const source=preview?.prompt?.messages;if(!Array.isArray(source))throw new Error('마리나라가 조립된 프리셋 메시지를 반환하지 않았어요.');
 const sourceMessages=source.map(m=>{if(!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')throw new Error('지원하지 않는 프리셋 메시지 형식이에요.');const out={role:m.role,content:m.content};for(const k of ['images','files','providerMetadata'])if(m[k]!==undefined)out[k]=m[k];return out;});
 // Preserve the host preset unchanged; append the complete Side-B prompt as one USER input.
 const finalMessages=taskMessages.every(m=>m.role!=='system')?taskMessages.map(m=>({...m})):[{role:'user',content:taskMessages.map(m=>m.content).filter(Boolean).join('\n\n')}];
 const maxInput=Number.isFinite(Number(inputMaxTokens))?Math.max(1,Math.floor(Number(inputMaxTokens))):Infinity,keep=sourceMessages.map(()=>true),costs=sourceMessages.map(m=>SideExtras.tokens(m.content)+8),removable=sourceMessages.map((m,i)=>m.role==='system'?null:i).filter(i=>i!==null);let kept=sourceMessages.length,total=3+finalMessages.reduce((n,m)=>n+SideExtras.tokens(m.content)+8,0)+costs.reduce((a,b)=>a+b,0),trimmedHistory=0,cursor=0;
 while((kept>200-finalMessages.length||total>maxInput)&&cursor<removable.length){const i=removable[cursor++];if(!keep[i])continue;keep[i]=false;kept--;total-=costs[i];trimmedHistory++;}
 if(kept>200-finalMessages.length)throw new Error('프리셋의 고정 시스템 지침 메시지만으로 서버 메시지 수 한도를 넘었어요. 프리셋 구성을 줄여 주세요.');
 if(total>maxInput)throw new Error(`과거 대화를 모두 제외해도 프리셋 고정 지침과 이번 요청이 전체 입력 한도 ${Math.floor(maxInput).toLocaleString()} 추정 토큰을 넘어요. 입력 한도를 높이거나 고정 지침을 줄여 주세요.`);
 const messages=sourceMessages.filter((_,i)=>keep[i]);messages.push(...finalMessages);if(messages.some(m=>m.content.length>490000))throw new Error('프리셋 또는 요청이 단일 메시지 전송 한도를 넘었어요.');
 const input=preview.parameters||{},parameters={},ranges={temperature:[0,5],topP:[0,1],topK:[0,10000],minP:[0,1],frequencyPenalty:[-2,2],presencePenalty:[-2,2],maxContext:[1,10000000]};
 for(const [k,[lo,hi]] of Object.entries(ranges)){const v=input[k];if(typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi&&(!['topK','maxContext'].includes(k)||Number.isInteger(v)))parameters[k]=v;}
 for(const [k,allowed] of Object.entries({reasoningEffort:[null,'low','medium','high','xhigh','maximum'],verbosity:[null,'low','medium','high'],serviceTier:[null,'flex','priority']}))if(allowed.includes(input[k]))parameters[k]=input[k];
 if(input.customParameters&&typeof input.customParameters==='object'&&!Array.isArray(input.customParameters))parameters.customParameters=structuredClone(input.customParameters);if(input.enabledParameters&&typeof input.enabledParameters==='object')parameters.enabledParameters=Object.fromEntries(Object.entries(input.enabledParameters).filter(([,v])=>typeof v==='boolean'));if(input.suppressModelParameters)parameters.enabledParameters={...parameters.enabledParameters,...Object.fromEntries(['temperature','topP','topK','minP','frequencyPenalty','presencePenalty','reasoningEffort','verbosity'].map(k=>[k,false]))};if(input.reasoningEffort==='none')parameters.reasoningEffort=null;parameters.maxTokens=maxTokens;if(parameters.enabledParameters)parameters.enabledParameters.maxTokens=true;return {messages,parameters,trimmedHistory,inputTokens:SideExtras.inputTokens(messages)};
 }return {compose,nativePromptParts,hasNativePersona};
})();
if(typeof module!=='undefined')module.exports=SidePreset;

/* Selective mode imports only the prompt branch appropriate to the linked Marinara chat. */
const SideSelectedPreset=(()=>{
 const parse=(v,f={})=>{if(typeof v!=='string')return v??f;try{return JSON.parse(v);}catch{return f;}};
 const enabled=x=>x!==false&&x!=='false';
 function compile(full,ctx,chat={},mode){
  const preset=full.preset;if(!preset)throw new Error('프리셋 전체 정보를 읽지 못했어요.');
  const chatMode=mode||chat.mode||'roleplay',ref=JSON.parse(ctx.text),chars=ref.characters||[],people=ref.players||[],variables=parse(preset.variableValues),meta=parse(chat.metadata),choices=chat.promptPresetId===preset.id?parse(meta.presetChoices):parse(preset.defaultChoices);
  for(const block of full.choiceBlocks||[]){if(block.randomPick)throw new Error('이 프리셋의 무작위 선택 블록은 직접 선택 모드에서 지원하지 않아요. 본편 참고 모드를 사용해 주세요.');const options=parse(block.options,[]),chosen=choices[block.id]??choices[block.variableName],ids=Array.isArray(chosen)?chosen:[chosen];variables[block.variableName]=options.filter(o=>ids.includes(o.id)).map(o=>o.value).join(block.separator||', ')||options[0]?.value||'';}
  const known={char:chars.map(c=>c.name).join(', '),user:people.map(c=>c.name).join(', ')||ref.player?.name||'PC',description:chars.map(c=>c.description).join('\n'),personality:chars.map(c=>c.personality).join('\n'),scenario:chars.map(c=>c.scenario).join('\n'),persona:people.map(c=>c.description).join('\n'),mes_example:chars.map(c=>c.exampleDialogue).join('\n'),...variables};
  function resolve(text){let result=String(text||'').replace(/{{\s*(?:getvar::)?([\w]+)\s*}}/g,(whole,key)=>Object.hasOwn(known,key)?known[key]:whole);if(/{{[\s\S]*?}}/.test(result))throw new Error('직접 선택 모드에서 처리할 수 없는 프리셋 매크로가 있어요: '+result.match(/{{[\s\S]*?}}/)[0]+'. 지침을 조정하거나 본편 참고 모드를 선택해 주세요.');return result;}
  const messages=[];
  if(chatMode==='conversation'){
   const custom=typeof meta.customSystemPrompt==='string'?meta.customSystemPrompt.trim():'';
   const content=custom||String(preset.conversationPrompt||'').trim();
   if(content)messages.push({role:'system',content:resolve(content)});
  }else if(chatMode==='game'){
   const explicit=typeof meta.gameSystemPrompt==='string'?meta.gameSystemPrompt.trim():'';
   const custom=typeof meta.customGmPrompt==='string'?meta.customGmPrompt.trim():'';
   const setup=parse(meta.gameSetupConfig),templateId=(typeof meta.gameGmPromptTemplateId==='string'&&meta.gameGmPromptTemplateId.trim())||(typeof setup?.gameGmPromptTemplateId==='string'&&setup.gameGmPromptTemplateId.trim())||'';
   const templates=parse(meta.gameGmPromptTemplates,[]),customTemplate=Array.isArray(templates)?templates.find(x=>x&&x.id===templateId):null;
   const templateText=typeof customTemplate?.promptTemplate==='string'?customTemplate.promptTemplate.trim():'';
   if(templateId&&!explicit&&!templateText&&chat.promptPresetId===preset.id)throw new Error('이 게임 방은 마리나라의 별도 GM 템플릿을 사용하고 있어 직접 선택 모드에서 정확히 재현할 수 없어요. 참고 캐릭터 및 로어북을 “본편에 연결된 카드 및 로어북 사용”으로 바꾸면 현재 게임 프롬프트를 그대로 사용할 수 있어요.');
   const base=explicit||templateText||String(preset.gamePrompt||'').trim();
   const content=[base,custom].filter(Boolean).join('\n\n');
   if(content)messages.push({role:'system',content:resolve(content)});
  }else{
   const groups=full.groups||[],groupMap=new Map(groups.map(g=>[g.id,g]));
   function groupEnabled(id,seen=new Set()){if(!id)return true;if(seen.has(id))throw new Error('프리셋 그룹이 순환해요.');seen.add(id);const g=groupMap.get(id);return !g||(enabled(g.enabled)&&groupEnabled(g.parentGroupId,seen));}
   const order=parse(preset.sectionOrder,[]),sections=[...(full.sections||[])].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?1e6:ai)-(bi<0?1e6:bi);});
   for(const section of sections){if(!enabled(section.enabled)||!groupEnabled(section.groupId))continue;if(section.isMarker===true||section.isMarker==='true')continue;const content=resolve(section.content);if(content.trim())messages.push({role:['system','user','assistant'].includes(section.role)?section.role:'system',content});}
  }
  if(!messages.length)messages.push({role:'system',content:'Use the selected reference supplied with the final writing task.'});
  return {prompt:{messages},parameters:parse(preset.parameters),mode:chatMode};
 }
 return {compile};
})();
if(typeof module!=='undefined')module.exports=SideSelectedPreset;

