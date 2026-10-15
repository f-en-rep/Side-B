import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from '../test-runtime/linkedom.mjs';

const read=n=>fs.readFileSync(new URL('../src/'+n,import.meta.url),'utf8');
const series=new Function(read('series.js')+';return SideSeries;')();
const C=new Function(read('replacement.js')+read('facet.js')+read('core.js')+';return SideCore;')();
test('mixed-mode siblings stay in one series; missing parents and cyclic imports remain navigable',()=>{
 const rows=[{id:'a',seriesId:'s',createdAt:1},{id:'b',seriesId:'s',parentId:'a',createdAt:2},{id:'c',seriesId:'s',parentId:'b',mode:'story',createdAt:3},{id:'d',seriesId:'s',parentId:'b',mode:'visual',createdAt:4}];
 assert.equal(series.groups(rows).length,1);assert.deepEqual(series.ordered(rows).map(x=>[x.record.id,x.depth]),[['a',0],['b',1],['c',2],['d',2]]);
 assert.equal(series.groups(rows.slice(2)).length,1);assert.equal(series.ordered(rows.slice(2)).length,2);
 assert.equal(series.ordered([{id:'a',parentId:'b'},{id:'b',parentId:'a'}]).length,2);
 assert.equal(series.groups([{id:'a'},{id:'b',parentId:'a'}]).length,2);
 const backup=C.backup({kind:'side-b-backup',version:2,records:[{...rows[2],seriesTitle:'제목',action:'continue',title:'C',content:'text',mode:'story'}]});assert.equal(backup[0].seriesId,'s');assert.equal(backup[0].parentId,'b');assert.equal(backup[0].action,'continue');
 const prompt=C.contextualPrompt(C.settings({mode:'visual'}),'다음 장면',{content:'PRIOR',request:'ORIGINAL'},'continue');assert(prompt.includes('PRIOR'));assert(!prompt.includes('ORIGINAL'),'earlier requests stay out');assert(prompt.includes('<resume_point>\nPRIOR'));assert(prompt.includes('Create the next page'));assert(prompt.trim().endsWith('</SIDESTORY>'));assert(prompt.indexOf('<user_request>')>prompt.indexOf('<previous_part'));
});
test('PNG choice hides or expands inner thoughts during capture and restores them on errors',async()=>{
 const {document}=parseHTML('<div id="result"><details class="speak-inner"><summary>속마음</summary><div>SECRET</div></details></div><button id="save-image"></button>');
 const result=document.getElementById('result'),inner=result.querySelector('details');inner.open=false;
 let source=read('enhancements.js');source=source.slice(source.indexOf('async function saveImage()'));
 const make=(include,fail)=>new Function('$','SideHTML',`let savingImage=false,current={mode:'speak',title:'test'},raw=false,editing=false,pngIncludeInner=${include};const C={},displayRecord=()=>({}),flushReading=async()=>{},download=()=>{},say=()=>{};${source};return saveImage;`)(id=>document.getElementById(id),{png:async()=>{assert.equal(inner.open,include);if(!include)assert.equal(inner.style.display,'none');if(fail)throw Error('capture failed');return new Blob();}});
 await make(false,false)();assert.equal(inner.open,false);assert.equal(inner.getAttribute('style'),null);
 await assert.rejects(make(true,true)(),/capture failed/);assert.equal(inner.open,false);assert.equal(inner.getAttribute('style'),null);assert.equal(document.getElementById('save-image').disabled,false);
});
