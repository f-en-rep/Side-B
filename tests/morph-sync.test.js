import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {parseHTML} from '../test-runtime/linkedom.mjs';

const read=n=>fs.readFileSync(new URL('../src/'+n,import.meta.url),'utf8');

test('morph patches in place: nodes, scroll containers and code-managed content survive',()=>{
 const {document}=parseHTML('<html><body><div id="ui"></div></body></html>');
 const morph=new Function('document',read('morph.js')+';return SideMorph;')(document);
 const ui=document.getElementById('ui');
 morph.patch(ui,'<div class="scrim"></div><section class="sheet" data-key="sheet-a"><div class="body" data-ui-scroll="a"><p>one</p></div></section><div id="result" data-own></div>');
 const scrim=ui.querySelector('.scrim'),sheet=ui.querySelector('.sheet'),result=ui.querySelector('#result');
 result.className='prose';result.innerHTML='<iframe></iframe>';
 const kept=document.createElement('div');kept.dataset.keep='';ui.append(kept);
 morph.patch(ui,'<div class="scrim"></div><section class="sheet" data-key="sheet-a"><div class="body" data-ui-scroll="a"><p>two</p></div></section><div id="result" data-own></div>');
 assert.equal(ui.querySelector('.scrim'),scrim);assert.equal(ui.querySelector('.sheet'),sheet);
 assert.equal(sheet.textContent,'two');
 assert.equal(ui.querySelector('#result'),result);assert.equal(result.className,'prose');assert(result.querySelector('iframe'));
 assert(kept.parentNode===ui,'data-keep nodes stay');
 morph.patch(ui,'<div class="scrim"></div><section class="sheet" data-key="sheet-b"><p>other</p></section>');
 assert.equal(ui.querySelector('.scrim'),scrim,'the scrim is reused when only the sheet changes');
 assert.notEqual(ui.querySelector('.sheet'),sheet,'a different sheet is a new element');
 assert.equal(ui.querySelector('#result'),null);
});

test('morph keeps form state in step with the template',()=>{
 const {document}=parseHTML('<html><body><div id="ui"></div></body></html>');
 const morph=new Function('document',read('morph.js')+';return SideMorph;')(document);
 const ui=document.getElementById('ui');
 morph.patch(ui,'<input type="checkbox" class="c"><details><summary>s</summary></details>');
 ui.querySelector('details').setAttribute('open','');
 morph.patch(ui,'<input type="checkbox" class="c" checked><details><summary>s</summary></details>');
 assert.equal(ui.querySelector('.c').checked,true);
 assert(ui.querySelector('details').hasAttribute('open'),'a user-opened details stays open');
});

test('archive sync: merge, tombstones, skip unchanged writes and fit the 1MB budget',{skip:!globalThis.CompressionStream},async()=>{
 const sync=new Function(read('archive-sync.js')+';return SideSync;')();
 const rec=(id,at,extra={})=>({id,createdAt:at,title:id,content:'본문 '+id,...extra});
 let server={sideB:{mode:'story'}},writes=0;
 const io={get:async()=>structuredClone(server),patch:async v=>{writes++;server={...server,...structuredClone(v)};}};
 // phone uploads
 let r=await sync.sync({rows:[rec('a',1),rec('b',2)],tombstones:{},settings:server.sideB,...io});
 assert.equal(r.kept,2);assert.equal(writes,1);assert.equal(server.sideBArchive.box.enc,'gzip');
 // PC pulls them, has its own, and a newer copy of b wins
 r=await sync.sync({rows:[rec('c',3),rec('b',2,{updatedAt:9,favorite:true})],tombstones:{},settings:server.sideB,...io});
 assert.deepEqual(r.incoming.map(x=>x.id).sort(),['a']);assert.equal(r.total,3);
 const stored=await sync.unpack(server.sideBArchive.box);assert.equal(stored.find(x=>x.id==='b').favorite,true);
 // nothing changed: no write
 const before=writes;await sync.sync({rows:stored,tombstones:{},settings:server.sideB,...io});assert.equal(writes,before);
 // a deletion on one device removes the record on the other
 await sync.sync({rows:stored.filter(x=>x.id!=='a'),tombstones:{a:Date.now()},settings:server.sideB,...io});
 r=await sync.sync({rows:stored,tombstones:{},settings:server.sideB,...io});
 assert.deepEqual(r.removed,['a']);
 // over budget: favorites and the newest go first, the rest stay local
 const noise=()=>crypto.randomBytes(9000).toString('base64');
 const many=Array.from({length:120},(_,i)=>rec('n'+i,100+i,{content:noise(),favorite:i===0}));
 r=await sync.sync({rows:many,tombstones:{},settings:server.sideB,...io});
 assert(r.kept<r.total&&r.kept>0,`kept ${r.kept} of ${r.total}`);
 const ids=new Set((await sync.unpack(server.sideBArchive.box)).map(x=>x.id));
 assert(ids.has('n0'),'favorite kept');assert(ids.has('n119'),'newest kept');assert(!ids.has('n1'),'oldest left out');
 assert(Buffer.byteLength(JSON.stringify(server))<=1000000);
});
