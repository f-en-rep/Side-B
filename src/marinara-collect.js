async function collect(options,target,signal,{approvedFacetPlan=false}={}){if(!target&&!options.manualSummary?.trim()&&!options.characterIds.length&&!options.personaIds.length)throw new Error('채팅을 고르거나 직접 요약을 넣어 주세요.');const chat=target?await get('/chats/'+encodeURIComponent(target),signal):{metadata:{},name:'직접 요약',characterIds:[]};const cid=options.connectionId||chat.connectionId||connections.find(c=>H.truth(c.isDefault))?.id;if(!cid)throw new Error('마리나라의 AI 연결을 설정하거나 연결을 직접 선택해 주세요.');const counter=appHost.tokenCounter(cid);if(approvedFacetPlan)return {cid,chat,counter};if(options.referenceSource==='native'&&options.mode!=='facet'){
 if(options.historyExclude)throw new Error('본편 대화를 제외하려면 참고 자료 방식을 직접 선택으로 바꿔 주세요. 본편 연결 모드는 마리나라의 전체 프롬프트를 사용해요.');
 if(!target)throw new Error('기존 프리셋을 사용하려면 참고 채팅을 선택해 주세요.');
 if(options.presetId&&options.presetId!=='__chat')await get('/prompts/'+encodeURIComponent(options.presetId),signal);
 const payload={chatId:target,connectionId:cid,returnPrompt:true,streaming:false,wrapLastMessage:true,injectLorebook:true,injectTrackers:true,injectChatSummary:options.includeSummary};
 if(options.presetId&&options.presetId!=='__chat')payload.presetId=options.presetId;
 if(!options.presetId){payload.skipPreset=true;payload.promptParts=SidePreset.nativePromptParts(options,chat);}
 const response=await api('/generate/dryRun',payload,signal);const preview=await response.json();
 if(!Array.isArray(preview?.prompt?.messages))throw new Error('서버가 프리셋 미리보기를 지원하지 않거나 잘못된 응답을 반환했어요.');
 if(!options.presetId&&(chat.personaId||chat.personaCharacterId)&&!SidePreset.hasNativePersona(preview))throw new Error('마리나라가 연결된 페르소나를 프롬프트에 포함하지 못했어요. promptParts를 지원하는 버전인지 확인하거나 참고 자료를 직접 선택해 주세요.');
 const connection=connections.find(c=>c.id===cid),meta=H.parseObject(chat.metadata);
 const candidates=options.presetId?[options.presetId!=='__chat'?options.presetId:'',chat.mode==='roleplay'?connection?.promptPresetId:'',chat.promptPresetId].filter(Boolean):[];
 const selectedPreset=candidates.map(id=>presets.find(p=>p.id===id)).find(Boolean);
 const parameterSources=[H.parseObject(selectedPreset?.parameters),H.parseObject(connection?.defaultParameters),H.parseObject(meta.chatParameters)];
 const switches=Object.assign({},...parameterSources.map(p=>H.parseObject(p.enabledParameters)),H.parseObject(preview.parameters?.enabledParameters));
 if(Object.keys(switches).length)preview.parameters={...preview.parameters,enabledParameters:switches};

 const text=JSON.stringify({providedSummary:options.manualSummary||''});
 const currentPromptLabel=chat.mode==='conversation'?'현재 채팅 프롬프트':chat.mode==='game'?'현재 게임 프롬프트':'현재 채팅 / 연결 프리셋';const name=!options.presetId?'이면 기본 지침 + 본편 참고':options.presetId==='__chat'?currentPromptLabel:presets.find(p=>p.id===options.presetId)?.name||options.presetId;
 return {cid,chat,counter,preset:preview,ctx:{text,stats:{preset:name,presetMessages:preview.prompt.messages.length,messages:0,tokens:SideExtras.inputTokens(preview.prompt.messages)+SideExtras.tokens(text),summary:options.includeSummary,manualSummary:SideExtras.tokens(options.manualSummary||''),lore:0},warnings:[]}};
}
 const ids=options.referenceSource==='native'?(Array.isArray(chat.characterIds)?chat.characterIds:H.parseArray(chat.characterIds)):options.characterIds;
 const pids=options.referenceSource==='native'?(chat.personaCharacterId?['character:'+chat.personaCharacterId]:chat.personaId?['persona:'+chat.personaId]:[]):options.personaIds;
 const [messages,cards,players,lore]=await Promise.all([
 target&&options.referenceMode!=='summary'?get('/chats/'+encodeURIComponent(target)+'/messages'+(''),signal):[],
 Promise.all(ids.map(id=>get('/characters/'+encodeURIComponent(id),signal))),
 Promise.all(pids.map(key=>{const i=key.indexOf(':');return get((key.slice(0,i)==='character'?'/characters/':'/characters/personas/')+encodeURIComponent(key.slice(i+1)),signal);})),
 Promise.all(options.loreIds.map(async lid=>{const entries=await get('/lorebooks/'+encodeURIComponent(lid)+'/entries',signal),overrides=H.parseObject(H.parseObject(chat.metadata).entryStateOverrides);return {name:lorebooks.find(l=>l.id===lid)?.name||lid,entries:entries.filter(e=>options.loreEntries[lid]?options.loreEntries[lid].includes(e.id):(overrides[e.id]?.enabled??H.truth(e.enabled))).filter(e=>typeof options.loreScan!=='string'||marinaraLoreActive(e,options.loreScan)).map(e=>({name:e.comment||e.name||'',content:e.content}))};}))]);
 const filtered=appHost.limitHistory(messages,options);const ctx=await H.context({chat,cards,personas:players,messages:filtered,lore}, {...options,historyCutoff:undefined},counter);
 let preset=null;if(options.presetId&&options.mode!=='facet'){const mode=chat.mode||'roleplay';let pid=options.presetId,sourceChat=chat;if(pid==='__chat'){const meta=H.parseObject(chat.metadata);if(mode==='conversation'&&typeof meta.customSystemPrompt==='string'&&meta.customSystemPrompt.trim()){preset={prompt:{messages:[{role:'system',content:meta.customSystemPrompt.trim()}]},parameters:{},mode};}else{const listed=new Set(presets.map(p=>p.id)),fallback=presets.find(p=>H.truth(p.isDefault))?.id||'',connectionPreset=connections.find(c=>c.id===cid)?.promptPresetId||'',candidateIds=(mode==='roleplay'?[connectionPreset,chat.promptPresetId,fallback]:[chat.promptPresetId,fallback]).filter(Boolean),resolved=presets.length?candidateIds.find(id=>listed.has(id)):candidateIds[0];pid=resolved||'';if(!pid&&mode==='game'&&((typeof meta.gameSystemPrompt==='string'&&meta.gameSystemPrompt.trim())||(typeof meta.customGmPrompt==='string'&&meta.customGmPrompt.trim()))){preset={prompt:{messages:[{role:'system',content:[meta.gameSystemPrompt,meta.customGmPrompt].filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()).join('\n\n')}]},parameters:{},mode};}}}if(!preset){if(!pid)throw new Error('적용할 프리셋을 찾지 못했어요. 프리셋을 직접 선택해 주세요.');const full=await get('/prompts/'+encodeURIComponent(pid)+'/full',signal);if(options.presetId!=='__chat')sourceChat={...chat,metadata:{},promptPresetId:pid};preset=SideSelectedPreset.compile(full,ctx,sourceChat,mode);}}
 return {cid,chat,ctx,preset,counter};}
