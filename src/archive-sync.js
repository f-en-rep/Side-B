/* Mirrors the IndexedDB archive into Marinara's extension storage, which lives on the server and is shared
   by every device (phone, PC). That storage holds 1MB in total together with the settings, so the archive is
   gzip-packed as one blob (records repeat the same prompts) and, when it still does not fit, favorites and the
   newest records go first; the rest stay on the device that has them. Deletions travel as tombstones. */
const SideSync=(()=>{
 const KEY='sideBArchive',LIMIT=1000000,RESERVE=60000,KEEP_TOMBSTONES=90*864e5;
 const bytes=v=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)??'').length;
 const stamp=r=>Number(r?.updatedAt||r?.createdAt)||0;
 const gzip=typeof CompressionStream==='function'&&typeof DecompressionStream==='function';
 function toBase64(u8){let out='';for(let i=0;i<u8.length;i+=0x8000)out+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(out);}
 function fromBase64(text){const raw=atob(text),u8=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u8[i]=raw.charCodeAt(i);return u8;}
 async function through(data,stream){return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());}
 async function pack(rows){const json=JSON.stringify(rows);return gzip?{enc:'gzip',data:toBase64(await through(json,new CompressionStream('gzip')))}:{enc:'json',data:json};}
 async function unpack(box){
  if(!box?.data)return [];
  if(box.enc==='gzip'&&!gzip)throw Error('이 브라우저는 다른 기기에서 올린 보관함을 풀 수 없어요. 브라우저를 업데이트해 주세요.');
  const rows=JSON.parse(box.enc==='gzip'?new TextDecoder().decode(await through(fromBase64(box.data),new DecompressionStream('gzip'))):box.data);
  return Array.isArray(rows)?rows.filter(r=>r&&typeof r.id==='string'):[];
 }
 const signature=rows=>rows.map(r=>r.id+':'+stamp(r)).sort().join('|');
 function prune(tombstones){const cut=Date.now()-KEEP_TOMBSTONES;return Object.fromEntries(Object.entries(tombstones||{}).filter(([id,at])=>typeof id==='string'&&Number(at)>cut));}
 /** Newest copy of each record wins; a tombstone newer than the record removes it. */
 function merge(local,remote,tombstones){
  const byId=new Map();
  for(const r of [...local,...remote]){if((tombstones[r.id]||0)>=stamp(r))continue;const old=byId.get(r.id);if(!old||stamp(r)>stamp(old))byId.set(r.id,r);}
  return [...byId.values()];
 }
 /** Packs as many records as fit the budget: favorites first, then the most recently changed. */
 async function fit(rows,budget){
  const order=[...rows].sort((a,b)=>(b.favorite?1:0)-(a.favorite?1:0)||stamp(b)-stamp(a));let n=order.length;
  for(let tries=0;tries<10;tries++){const box=await pack(order.slice(0,n)),size=bytes(box);if(size<=budget||!n)return {box,rows:order.slice(0,n)};n=Math.max(0,Math.min(n-1,Math.floor(n*budget/size*.97)));}
  return {box:await pack([]),rows:[]};
 }
 /**
  * One round: read the server copy, merge it with the local records, write back what changed.
  * Returns rows to store locally (incoming), ids to delete locally (removed) and what the server now holds.
  */
 async function sync({rows,tombstones,settings,get,patch}){
  const stored=await get()||{},remote=stored[KEY]&&typeof stored[KEY]==='object'?stored[KEY]:{};
  const deleted=prune({...remote.deleted,...tombstones}),remoteRows=await unpack(remote.box);
  const merged=merge(rows,remoteRows,deleted),local=new Map(rows.map(r=>[r.id,r]));
  const incoming=merged.filter(r=>local.get(r.id)!==r),removed=rows.filter(r=>!merged.includes(r)&&(deleted[r.id]||0)>=stamp(r)).map(r=>r.id);
  const others=bytes({...stored,[KEY]:undefined,sideB:settings});
  const {box,rows:kept}=await fit(merged,LIMIT-RESERVE-others-bytes(deleted));
  const changed=signature(kept)!==signature(remoteRows)||JSON.stringify(deleted)!==JSON.stringify(prune(remote.deleted));
  if(changed)await patch({[KEY]:{version:1,savedAt:Date.now(),deleted,box}});
  return {incoming,removed,total:merged.length,kept:kept.length,wrote:changed};
 }
 return {sync,merge,stamp,pack,unpack,KEY};
})();
