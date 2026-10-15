import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const C=new Function(read('replacement.js')+read('facet.js')+read('core.js')+';return SideCore;')();
const H=new Function('SideExtras',read('transport.js')+';return HostCore;')({tokens:t=>String(t||'').length});

const part=(id,props)=>({id,mode:'story',chatId:'c',createdAt:1,...props});

test('continuation turn: earlier parts with their own requests, full previous part, resume point, request last',()=>{
 const records=[
  part('p1',{action:'new',request:'두 사람이 싸운 이야기',instruction:'두 사람이 싸운 이야기',content:'싸움이 시작됐다.\n\n문이 쾅 닫혔다.',recap:'둘은 크게 싸웠다.'}),
  part('p2',{action:'continue',parentId:'p1',request:'두 사람이 싸운 이야기',instruction:'화해까지',content:'초안'}),
  part('p2b',{action:'revise',parentId:'p2',request:'두 사람이 싸운 이야기',instruction:'더 천천히',content:'며칠이 지났다.\n\n그가 먼저 문을 두드렸다.'})
 ];
 const chain=C.seriesChain(records,records[2]);
 assert.deepEqual(chain.map(r=>r.id),['p1','p2b']);
 const s=C.settings({mode:'story'});
 const text=C.contextualPrompt(s,'그 다음날 아침',chain,'continue');
 assert(text.startsWith('<SIDESTORY>'));assert(text.trim().endsWith('</SIDESTORY>'));
 assert(text.includes('<part n="1">\n싸움이 시작됐다.'));assert(!text.includes('두 사람이 싸운 이야기'));
 assert(text.includes('<previous_part n="2">'));
 assert(text.includes('<resume_point>\n며칠이 지났다.\n\n그가 먼저 문을 두드렸다.\n</resume_point>'));
 assert(text.includes('Part 3 of an ongoing side story'));
 assert(!text.includes('초안'),'superseded draft never reaches the prompt');
 assert(!/standalone episode/i.test(text));
 const order=['<preset_scope>\n','<mode name="story">\n','<timeline>\n','<story_so_far>\n','<previous_part n','<resume_point>\n','<user_request>\n','<task>\n','<output>\n'].map(tag=>text.indexOf(tag));
 assert(order.every((v,i)=>v>=0&&(i===0||v>order[i-1])),'blocks keep their order with the request near the end');
 assert(text.includes('This counts the new part only.'));
});

test('long series falls back to recaps for earlier parts; revise sends the draft with earlier context',()=>{
 const big='가'.repeat(13000);
 const chain=[part('a',{action:'new',instruction:'A',content:big,recap:'RECAP_A'}),part('b',{action:'continue',parentId:'a',instruction:'B',content:'B 본문'}),part('c',{action:'continue',parentId:'b',instruction:'C',content:'C 본문'})];
 const s=C.settings({mode:'story'});
 const cont=C.contextualPrompt(s,'D',chain,'continue');
 assert(cont.includes('RECAP_A'));assert(!cont.includes(big));
 const rev=C.contextualPrompt(s,'고쳐줘',chain,'revise');
 assert(rev.includes('<draft_to_revise>\nC 본문'));assert(rev.includes('<previous_part n="2">'));
 assert(!rev.includes('<resume_point>'));assert(!rev.includes('<timeline>'),'a revision keeps the original timing');
 assert(rev.includes('Revise <draft_to_revise>'));
});

test('new pieces carry the selected timeline only in creative modes; regenerate asks for a fresh attempt',()=>{
 for(const [timeline,text] of Object.entries(C.TIMELINES)){
  assert(C.contextualPrompt(C.settings({mode:'story',timeline}),'X').includes(text));
 }
 assert(!C.contextualPrompt(C.settings({mode:'analysis',timeline:'past'}),'X').includes('<timeline>'));
 assert(C.contextualPrompt(C.settings({mode:'story'}),'X',null,'regenerate').includes('fresh attempt'));
 assert.equal(C.settings({timeline:'bogus'}).timeline,'auto');
});

test('preset scope is editable, removable, and never sent on a separate connection',()=>{
 assert(C.contextualPrompt(C.settings({mode:'story'}),'X').includes(C.PRESET_SCOPE));
 assert(C.contextualPrompt(C.settings({mode:'story',presetScope:'MY SCOPE'}),'X').includes('<preset_scope>\nMY SCOPE\n</preset_scope>'));
 assert(!C.contextualPrompt(C.settings({mode:'story',presetScope:'  '}),'X').includes('<preset_scope>'));
 const rows=C.messages(C.settings({mode:'story'}),{text:'{"dialogue":[]}'},'X');
 assert(!rows[1].content.includes('<preset_scope>'));assert(rows[1].content.includes('<SIDESTORY>'));
});

test('recap is split off generated text; message count accepts free numbers',()=>{
 assert.deepEqual(C.splitRecap('본문\n\n<recap>요약입니다.</recap>'),{content:'본문',recap:'요약입니다.'});
 assert.deepEqual(C.splitRecap('본문만'),{content:'본문만',recap:''});
 assert.equal(C.splitRecap('본문\n<recap>잘림').content,'본문');
 for(const [input,expected] of [['','all'],['all','all'],['0','0'],['25','25'],['abc','all'],[' 7 ','7'],['20','20']])assert.equal(C.settings({scope:input}).scope,expected);
});

test('structure report carries roles, sizes and tag names but no prompt text',()=>{
 const X=new Function(read('extras.js')+';return SideExtras;')();
 const report=X.structureReport({connectionMeta:{api:'openai',source:'claude',model:'m',squash:true,prefillChars:12,promptReadyEvent:true},
  finalPrompt:[{role:'system',content:'<rules>SECRET_TEXT</rules>'},{role:'user',content:'<SIDESTORY>\nSECRET_REQUEST'},{role:'assistant',content:'SECRET_PREFILL'}],
  responseShape:{chars:10,tags:['thinking'],recap:false,startsWithTag:'thinking'}});
 assert(!/SECRET/.test(report));assert(report.includes('#2 user'));assert(report.includes('★SIDESTORY'));assert(report.includes('태그: rules'));
 assert(report.includes('SIDESTORY 뒤에 메시지 1개'));assert(report.includes('source=claude'));
});

test('reasoning blocks: built-ins stay (switchable), custom names add, removal handles prefill and truncation',()=>{
 const blocks=C.settings({}).reasoningBlocks;
 assert.deepEqual(blocks.map(b=>[b.name,b.enabled,b.builtin]),[['thinking',true,true],['think',true,true]]);
 const cleaned=C.cleanReasoningBlocks([{name:'think',enabled:false},{name:'<cot>'},{name:'bad name'},{name:'COT'}]);
 assert.deepEqual(cleaned.map(b=>[b.name,b.enabled,b.builtin]),[['thinking',true,true],['think',false,true],['cot',true,false]],'built-ins cannot be removed; duplicates and invalid names drop');
 assert.equal(C.stripReasoning('<thinking>계획</thinking>\n\n본문',blocks),'본문');
 assert.equal(C.stripReasoning('프리필로 시작된 추론\n</thinking>\n본문',blocks),'본문');
 assert.equal(C.stripReasoning('본문\n<think>잘린 추론',blocks),'본문');
 assert.equal(C.stripReasoning('<Thinking mode="x">a</Thinking>본문<think>b</think>끝',blocks),'본문끝');
 assert.equal(C.stripReasoning('<thinking>only</thinking>',blocks),'<thinking>only</thinking>','never empties a result');
 assert.equal(C.stripReasoning('<thinking>a</thinking>본문',cleaned.map(b=>({...b,enabled:false}))),'<thinking>a</thinking>본문');
 assert.equal(C.stripReasoning('<cot>x</cot>본문',cleaned),'본문');
});

