import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML,DOMParser} from '../test-runtime/linkedom.mjs';

test('Marinara integration: upgrade, every screen, generation, series boundaries, presets, chat creation and cleanup',async()=>{
 const {window,document}=parseHTML('<html><head></head><body><input id="main-chat"></body></html>');
 window.innerWidth=1200;window.innerHeight=800;window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:20,top:140,width:64,height:64});
 const cache=new Map([['marinara-active-chat-id','chat1']]);const storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)};
 Object.assign(globalThis,{window,document,DOMParser,localStorage:storage,sessionStorage:storage});
 const rows=new Map([['legacy',{id:'legacy',title:'이전 기록',content:'SAVED_LEGACY',mode:'story',chatId:'chat1',createdAt:1,status:'complete',favorite:true,settings:{}}]]);
 const db={close(){},transaction(){let count=0;const tx={};function req(fn){count++;const r={};setTimeout(()=>{r.result=fn();r.onsuccess?.();count--;setTimeout(()=>{if(!count)tx.oncomplete?.();},0);},0);return r;}tx.objectStore=()=>({getAll:()=>req(()=>[...rows.values()]),put:v=>req(()=>rows.set(v.id,structuredClone(v))),delete:id=>req(()=>rows.delete(id))});return tx;}};
 globalThis.indexedDB={open(name){assert.equal(name,'side-b-archive-v1');const r={};setTimeout(()=>{r.result=db;r.onsuccess?.();},0);return r;}};
 const chars=[{id:'a',name:'A',data:JSON.stringify({name:'A',description:'CARD_A'})},{id:'b',name:'B',data:{name:'B',description:'CHARACTER_PERSONA'}}];
 const chat={id:'chat1',name:'Test RP',mode:'roleplay',connectionId:'conn',characterIds:['a'],personaId:'u',metadata:{summary:'CHAT_SUMMARY'}};
 const messages=[{id:'uuid-one',role:'assistant',content:'CANON_OLD'},{id:'uuid-two',role:'user',content:'CANON_START'}];
 const sent=[],calls=[],created=[],cleanups=[],timers=new Set();let holdHistory=null;let saved,answer='STORY_OUTPUT\n\n<recap>SUMMARY</recap>';
 const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
 const runtime={onCleanup:f=>cleanups.push(f),storage:{get:async()=>({sideB:{mode:'story',request:'LEGACY_DRAFT',characterIds:['a'],personaIds:['persona:u'],scope:'all',instructionPresets:[{id:'custom',name:'Saved',mode:'story',prompt:'KEEP_PROMPT'}],launcherX:.25,launcherY:.5}}),patch:async v=>{saved=v;}},setTimeout:(f,ms)=>{const id=setTimeout(f,ms);timers.add(id);return id;},clearTimeout:clearTimeout,
 fetch:async(url,args={})=>{const path=url.replace('/api','');const body=args.body?JSON.parse(args.body):undefined;calls.push({path,body});if(path==='/chats/chat1/messages'&&holdHistory)await holdHistory;if(args.signal?.aborted)throw new DOMException('Stopped','AbortError');if(path==='/generate/raw'){sent.push(body);return new Response('data: '+JSON.stringify({type:'token',data:answer})+'\n\ndata: '+JSON.stringify({type:'done',data:''})+'\n\n',{headers:{'content-type':'text/event-stream'}});}
 if(path==='/generate/dryRun')return json({prompt:{messages:[{role:'system',content:'NATIVE_PRESET'},{role:'user',content:'NATIVE_HISTORY'}]},parameters:{temperature:.7}});
 if(path==='/chats'&&body){created.push(body);return json({id:'newchat',...body});}
 if(path==='/chats/newchat/messages')return json(body?{id:'first-message',...body}:[]);
 if(path==='/characters'&&body){created.push(body);return json({id:'new-char',...body});}
 if(path==='/characters/personas'&&body){created.push(body);return json({id:'new-persona',...body});}
 const routes={'/chats':[chat],'/chats/chat1':chat,'/chats/chat1/messages':messages,'/connections':[{id:'conn',name:'Test connection',isDefault:true,model:'test'}],'/lorebooks':[], '/prompts':[{id:'preset',name:'Existing preset'}],'/prompts/preset':{id:'preset'},'/characters':chars,'/characters/a':chars[0],'/characters/b':chars[1],'/characters/personas/list':[{id:'u',name:'U',description:'PERSONA_U'}],'/characters/personas/u':{id:'u',name:'U',description:'PERSONA_U'}};
 if(Object.hasOwn(routes,path))return json(routes[path]);throw Error('Unexpected route: '+path);
 }};
 const code=fs.readFileSync(new URL('../extension.js',import.meta.url),'utf8');const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const api=await new AsyncFunction('marinara',code+`;return {stop,translateCurrent,openSideB,generate,collect,close,render,refresh,appHost,openResultChat,createResultChat,get state(){return {s,chatId,current,records,notice,opened};},set(values){if(values.s)Object.assign(s,values.s);if(values.page!==undefined)page=values.page;if(values.settingsTab!==undefined)settingsTab=values.settingsTab;if(values.sheet!==undefined)sheet=values.sheet;if(values.current!==undefined)current=values.current;render();},root};`)(runtime);
 try{
  await api.openSideB();assert.equal(api.state.s.request,'LEGACY_DRAFT');assert.equal(api.state.records[0].content,'SAVED_LEGACY');assert.equal(api.state.s.instructionPresets[0].prompt,'KEEP_PROMPT');assert.equal(api.state.s.launcherX,.25);
  for(const page of ['archive','create','settings']){api.set({page});assert(api.root.querySelector('.window'));}
  for(const settingsTab of ['connections','generation','translation','reading','reasoning','data'])api.set({page:'settings',settingsTab});
  for(const sheet of ['references','preset','lore','conditions','history'])api.set({sheet});
  for(const mode of ['story','analysis','visual','speak','write','facet'])api.set({page:'create',sheet:'',s:{mode}});
  api.set({s:{mode:'story',request:'FIRST_REQUEST'}});await api.generate();assert(sent.length>0,api.state.notice);assert(api.state.current,api.state.notice);assert.equal(api.state.current.content,'STORY_OUTPUT');assert.equal(api.state.current.anchor.messageId,'uuid-two');assert.equal(api.state.current.recap,'SUMMARY');assert(sent.at(-1).messages.some(m=>m.content.includes('CARD_A')));
  messages.push({id:'uuid-three',role:'assistant',content:'FUTURE_CANON_MUST_NOT_LEAK'});answer='PART_TWO';await api.generate('continue');assert.equal(api.state.current.content,'PART_TWO',api.state.notice);assert(!JSON.stringify(sent.at(-1)).includes('FUTURE_CANON_MUST_NOT_LEAK'));assert(JSON.stringify(sent.at(-1)).includes('STORY_OUTPUT'));
  api.set({s:{personaIds:['character:b']}});const bundle=await api.collect({...api.state.s,mode:'facet'},'chat1');assert(bundle.ctx.text.includes('CHARACTER_PERSONA'));
  api.set({s:{referenceSource:'native',presetId:'preset',request:'NATIVE_REQUEST'}});answer='NATIVE_OUTPUT';await api.generate();assert.equal(api.state.current.content,'NATIVE_OUTPUT',api.state.notice);assert.equal(sent.at(-1).messages[0].content,'NATIVE_PRESET');assert.equal(sent.at(-1).parameters.temperature,.7);assert.deepEqual(api.state.s.personaIds,['persona:u']);assert.deepEqual(api.state.current.characterIds,['a']);
  answer='invalid translation JSON';await api.translateCurrent();assert.equal(api.state.current.content,'NATIVE_OUTPUT');assert(api.state.current.translationRecovery);const beforeRecovery=sent.length;
  const chunk=api.state.current.translationRecovery.chunks[0];api.state.current.translationRecovery.edits[0]=JSON.stringify({items:chunk.map(x=>({id:x.id,text:'번역 완료'}))});await api.translateCurrent(true);assert.equal(sent.length,beforeRecovery);assert.equal(api.state.current.translationView.content,'번역 완료');
  api.set({s:{referenceSource:'selected',presetId:'',request:'CONCURRENT',mode:'story'}});answer='SINGLE_OUTPUT';let release;holdHistory=new Promise(r=>release=r);const beforeParallel=sent.length;const one=api.generate();const two=api.generate();release();await Promise.all([one,two]);holdHistory=null;assert.equal(sent.length,beforeParallel+1,'only one generation may pass preparation');
  holdHistory=new Promise(r=>release=r);const beforeCancel=sent.length;const cancelled=api.generate();assert(api.root.querySelector('#stop-global'),'preparation must expose cancel');await api.stop();release();await cancelled;holdHistory=null;assert.equal(sent.length,beforeCancel,'cancelled preparation must never generate');
  await api.openResultChat();assert(api.root.querySelector('#rp-name'));await api.createResultChat();assert(created.some(c=>c.mode==='roleplay'));assert(api.state.current.rpChatLink.messageId);
  await api.appHost.createCharacterFromProfile({name:'AU',description:'PROFILE'});assert(created.some(c=>c.data?.description==='PROFILE'));
  await api.appHost.createPersonaFromProfile({name:'AU Persona',description:'PLAYER'});assert(created.some(c=>c.description==='PLAYER'));
  api.close();assert.equal(document.querySelector('#side-b-root').hidden,true);await api.openSideB();assert.equal(document.querySelector('#side-b-root').hidden,false);api.close();
 }finally{for(const f of [...cleanups].reverse())await f();for(const t of timers)clearTimeout(t);}
 assert.equal(document.getElementById('side-b-root'),null);assert.equal(document.getElementById('side-b-launcher-root'),null);assert(saved.sideB);assert(!saved.sideStory);
});
