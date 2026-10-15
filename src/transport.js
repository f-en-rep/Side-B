/* Host transport, prompt-context shaping, and safe rendering helpers. */
const HostCore=(()=>{
  const parse = (value, fallback={}) => { if (typeof value !== 'string') return value ?? fallback; try { return JSON.parse(value); } catch { return fallback; } };
  const parseObject = (value, fallback={}) => { const parsed=parse(value,fallback); return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:fallback; };
  const parseArray = (value, fallback=[]) => { const parsed=parse(value,fallback); return Array.isArray(parsed)?parsed:fallback; };
  const truth = x => x === true || x === 'true';
  const esc = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uuid = () => globalThis.crypto?.randomUUID?.() || `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function character(row) {
    const d=parseObject(row?.data,parseObject(row)); const ext=parseObject(d.extensions);
    return {name:d.name||row?.name||'이름 없음',description:d.description||'',personality:d.personality||'',scenario:d.scenario||'',backstory:d.backstory||ext.backstory||'',appearance:d.appearance||ext.appearance||'',exampleDialogue:d.mes_example||d.exampleDialogue||''};
  }
  async function context({chat,cards=[],personas=[],messages=[],lore=[]}, s, counter) {
    const meta=parseObject(chat.metadata), warnings=[];
    let eligible=messages.filter(m=>!truth(parseObject(m.extra).hiddenFromAI)&&!truth(parseObject(m.extra).hiddenFromUser)&&m.role!=='system');
    let boundary=-1; eligible.forEach((m,i)=>{if(truth(parseObject(m.extra).isConversationStart))boundary=i;});
    if(boundary>=0) eligible=eligible.slice(boundary);
    // Series parts stay on the canon point their series started from.
    if(Number.isInteger(s.historyCutoff)&&s.historyCutoff>=0)eligible=eligible.filter(m=>!/^\d+$/.test(String(m.id))||Number(m.id)<=s.historyCutoff);
    const total=eligible.length;if(s.referenceMode==='summary'||s.historyExclude)eligible=[];
    if(s.scope!=='all'){const n=Math.max(0,Number(s.scope)||0);eligible=n?eligible.slice(-n):[];}
    const names=Object.fromEntries(cards.map(c=>[c.id,character(c).name]));
    const base={characters:cards.map(character),players:personas.map(character),summary:s.includeSummary?(meta.summary||''):'',providedSummary:s.manualSummary||'',world:lore,notes:s.notes||''};
    const baseText=JSON.stringify(base),baseTokens=await counter.text(baseText);
    const mapped=eligible.map(m=>({id:m.id,speaker:m.role==='user'?'PC':(names[m.characterId]||m.role),text:String(m.content||'')}));
    const encode=n=>JSON.stringify({...base,dialogue:mapped.slice(n).map(({id,...rest})=>rest)});
    let lo=0,hi=mapped.length,best=mapped.length;
    while(lo<=hi){const mid=Math.floor((lo+hi)/2),count=await counter.text(encode(mid));if(count<=s.contextBudget){best=mid;hi=mid-1;}else lo=mid+1;}
    const selected=mapped.slice(best),used=await counter.text(encode(best))-baseTokens;
    if(best)warnings.push('참고 토큰 한도에 맞춰 오래된 대화를 제외했어요.');
    if(baseTokens>s.contextBudget)warnings.push('고정 참고 자료가 참고 한도를 넘어요. 대화는 제외했어요.');
    if(!selected.length&&!base.summary&&!base.providedSummary)warnings.push('참고할 대화·요약이 없어요. 제공된 설정만 사용해요.');if(s.referenceMode==='summary'&&!base.summary&&!base.providedSummary)throw new Error('요약 중심으로 생성하려면 직접 요약을 넣거나 저장된 채팅 요약을 포함해 주세요.');
    return {text:JSON.stringify({...base,dialogue:selected.map(({id,...rest})=>rest)}),stats:{messages:selected.length,available:total,tokens:baseTokens+used,first:selected[0]?.id,last:selected.at(-1)?.id,summary:!!base.summary,manualSummary:SideExtras.tokens(base.providedSummary),lore:lore.length},warnings};
  }

  async function stream(response,onText,signal,diagnostics={}) {
    if(!response.body)throw new Error('스트리밍 응답을 읽을 수 없어요.');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',text='',done=false;
    const consume=block=>{const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)return;
      let ev;try{ev=JSON.parse(data);}catch{throw new Error('서버 스트림 형식이 올바르지 않아요.');}
      const eventData=ev.data&&typeof ev.data==='object'?ev.data:{};
      const reason=eventData.finishReason??eventData.finish_reason??eventData.stop_reason??ev.finishReason??ev.finish_reason??ev.stop_reason;
      if(typeof reason==='string')diagnostics.finishReason=reason.slice(0,100);
      const usage=eventData.usage??ev.usage??(ev.type==='usage'?eventData:null);
      if(usage&&typeof usage==='object'){
       diagnostics.usage=diagnostics.usage||{};
       for(const key of ['input_tokens','output_tokens','total_tokens','prompt_tokens','completion_tokens','inputTokens','outputTokens','totalTokens','reasoning_tokens']){
        if(typeof usage[key]==='number'&&Number.isFinite(usage[key]))diagnostics.usage[key]=usage[key];
       }
       const reasoning=usage.completion_tokens_details?.reasoning_tokens;
       if(typeof reasoning==='number'&&Number.isFinite(reasoning))diagnostics.usage.reasoning_tokens=reasoning;
      }
      if(ev.type==='token'){text+=String(ev.data||'');onText(text);}
      if(ev.type==='result'){text=ev.data?.content??text;onText(text);}
      if(ev.type==='error')throw new Error(typeof ev.data==='string'?ev.data:'AI 생성 오류');
      if(ev.type==='aborted')throw new DOMException('중단됨','AbortError');
      if(ev.type==='done'){done=true;diagnostics.streamDone=true;}
    };
    try{while(true){if(signal?.aborted)throw new DOMException('중단됨','AbortError');const part=await reader.read();buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done}).replace(/\r/g,'');let pos;while((pos=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,pos));buffer=buffer.slice(pos+2);}if(part.done)break;}if(buffer.trim())consume(buffer);if(!done)throw new Error('연결이 끊겼어요. 받은 내용은 미완료 결과로 보관합니다.');diagnostics.receivedCharacters=text.length;if(['length','max_tokens','max_output_tokens'].includes(diagnostics.finishReason)){throw new Error('서버가 출력 한도 도달로 종료했다고 보고했어요. 받은 내용은 미완료로 보관해요.');}return text;}finally{diagnostics.receivedCharacters=text.length;diagnostics.streamDone=done;reader.releaseLock();}
  }

  function markdown(text) {
    const inline=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_(?!_)/g,'$1<em>$2</em>');
    const lines=text.split('\n'),out=[];let code=false,chunk=[];
    for(let i=0;i<lines.length;i++) {const l=lines[i];if(/^```/.test(l)){if(code){out.push('<pre><code>'+esc(chunk.join('\n'))+'</code></pre>');chunk=[];}code=!code;continue;}if(code){chunk.push(l);continue;}
      if(i+1<lines.length&&l.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])) {const cells=x=>x.trim().replace(/^\||\|$/g,'').split('|');out.push('<div class="table-wrap"><table><thead><tr>'+cells(l).map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>');i+=2;while(i<lines.length&&lines[i].includes('|')){out.push('<tr>'+cells(lines[i]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>');i++;}i--;out.push('</tbody></table></div>');continue;}
      const h=l.match(/^(#{1,6})\s+(.+)/);if(h)out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);else if(/^\s*(?:-{3,}|\*{3,})\s*$/.test(l))out.push('<hr>');else if(/^\s*[-*]\s/.test(l))out.push('<p class="bullet">• '+inline(l.replace(/^\s*[-*]\s/,''))+'</p>');else if(l.trim())out.push('<p>'+inline(l)+'</p>');
    }if(chunk.length)out.push('<pre>'+esc(chunk.join('\n'))+'</pre>');return out.join('\n');
  }

function httpError(status,path,body,raw) {
    const payload=parse(raw,null);
    const heading=typeof payload?.error==='string'?payload.error:typeof payload?.message==='string'?payload.message:'서버 요청 거절';
    const details=payload?.details??payload?.issues??payload?.validation;
    const describe=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
    let reason=Array.isArray(details)?details.map(d=>typeof d==='object'&&d!==null?`${Array.isArray(d.path)?d.path.join('.'):(d.path||d.instancePath||'(요청 전체)')}: ${d.message||describe(d)}`:describe(d)).join('\n'):details?describe(details):'';
    if(!reason) reason=payload?JSON.stringify(payload,null,2):raw.replace(/<[^>]*>/g,' ').trim();
    const summary=body?{fields:Object.keys(body),connectionIdType:typeof body.connectionId,messageCount:Array.isArray(body.messages)?body.messages.length:undefined,messages:Array.isArray(body.messages)?body.messages.map(m=>({role:m.role,contentType:typeof m.content,estimatedTokens:typeof m.content==='string'?SideExtras.tokens(m.content):null})):undefined,parameters:body.parameters,streaming:body.streaming,runIdType:typeof body.runId}:null;
    return `요청 실패 (${status}): ${heading}\n요청: ${body===undefined?'GET':'POST'} /api${path}\n서버 상세:\n${(reason||'서버가 상세 사유를 제공하지 않았어요.').slice(0,20000)}${summary?'\n전송 형식 (본문 제외):\n'+JSON.stringify(summary,null,2):''}`;
  }

return {stream,httpError,parse,parseObject,parseArray,truth,esc,uuid,character,context,markdown};
})();
if(typeof module!=="undefined")module.exports=HostCore;
