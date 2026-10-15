// Direct-selection keyword scan. Full activation rules remain the host's job in native mode.
function marinaraLoreActive(entry,text){
 const truth=v=>v===true||v==='true';
 const list=v=>{if(Array.isArray(v))return v.map(String);try{const parsed=JSON.parse(v);if(Array.isArray(parsed))return parsed.map(String);}catch{}return typeof v==='string'?v.split(',').map(x=>x.trim()).filter(Boolean):[];};
 if(truth(entry.constant))return true;
 const sensitive=truth(entry.caseSensitive),haystack=sensitive?String(text):String(text).toLocaleLowerCase();
 const hit=value=>{
  const key=value.trim();if(!key)return false;
  const needle=sensitive?key:key.toLocaleLowerCase();
  if(truth(entry.useRegex)){
   // Refuse oversized / nested repetition patterns on the UI thread; treat them literally.
   if(key.length>1000||/\([^)]*[*+{][^)]*\)[*+{]/.test(key))return haystack.includes(needle);
   try{return new RegExp(key,sensitive?'':'i').test(String(text));}catch{return haystack.includes(needle);}
  }
  if(!truth(entry.matchWholeWords))return haystack.includes(needle);
  const word=c=>!!c&&/[\p{L}\p{N}_]/u.test(c);
  for(let i=haystack.indexOf(needle);i>=0;i=haystack.indexOf(needle,i+1)){
   if(!word(Array.from(haystack.slice(0,i)).at(-1))&&!word(Array.from(haystack.slice(i+needle.length))[0]))return true;
  }
  return false;
 };
 if(!list(entry.keys??entry.key).some(hit))return false;
 const secondary=list(entry.secondaryKeys??entry.secondary_keys??entry.keysecondary);
 if(!truth(entry.selective)||!secondary.length)return true;
 const matches=secondary.map(hit);
 switch(entry.selectiveLogic){case 'and':case 'or':return matches.some(Boolean);case 'and_all':return matches.every(Boolean);case 'not':return !matches.some(Boolean);case 'not_all':return !matches.every(Boolean);default:return true;}
}
