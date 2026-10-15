import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const active=new Function(fs.readFileSync(new URL('../src/marinara-lore.js',import.meta.url),'utf8')+';return marinaraLoreActive')();
test('Marinara JSON keys, flags, secondary logic and unicode word boundaries',()=>{
 const e={keys:'["Alpha"]',secondaryKeys:'["beta","gamma"]',selective:'true',selectiveLogic:'and_all'};
 assert.equal(active(e,'alpha beta'),false);assert.equal(active(e,'alpha beta gamma'),true);
 for(const [logic,expected] of [['and',true],['or',true],['not',false],['not_all',true]])assert.equal(active({...e,selectiveLogic:logic},'alpha beta'),expected);
 assert.equal(active({...e,caseSensitive:'true'},'alpha beta gamma'),false);
 assert.equal(active({keys:['서울'],matchWholeWords:'true'},'서울역'),false);
 assert.equal(active({keys:['서울'],matchWholeWords:'true'},'나는 서울 방문'),true);
 assert.equal(active({keys:[],constant:'false'},'anything'),false);
 assert.equal(active({keys:[],constant:'true'},''),true);
 assert.equal(active({keys:['A[0-9]+'],useRegex:'true'},'a123'),true);
 assert.equal(active({keys:['[invalid'],useRegex:true},'[invalid'),true);
});
