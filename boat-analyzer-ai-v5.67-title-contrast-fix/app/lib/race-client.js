import {LIVE_CACHE_VERSION,sourceFresh,validRaceIdentity} from './live-policy.js';
const memory=new Map(),listeners=new Map(),jobs=new Map(),controllers=new Set();
export const raceKey=id=>`${id.hd}-${id.jcd}-${id.rno}`;
export function readRace(id){
 const key=raceKey(id);let entry=memory.get(key);
 if(!entry){try{entry=JSON.parse(sessionStorage.getItem('nexus:live:'+key)||'null')}catch{}}
 if(!entry||entry.version!==LIVE_CACHE_VERSION||!validRaceIdentity(entry.identity,id.hd,id.jcd,id.rno)||!Number.isFinite(entry.cachedAt)||entry.cachedAt>Date.now()+5000||Date.now()-entry.cachedAt>21600000)return null;
 memory.set(key,entry);return entry;
}
function accept(id,event){
 if(!validRaceIdentity(event.identity,id.hd,id.jcd,id.rno)||!event.family)return;
 const key=raceKey(id),old=readRace(id)||{identity:id,version:LIVE_CACHE_VERSION,sources:{}};
 const previous=old.sources[event.family];
 if(previous&&Date.parse(previous.storedAt)>Date.parse(event.storedAt))return;
 const entry={...old,cachedAt:Date.now(),sources:{...old.sources,[event.family]:{...event,uiUpdated:new Date().toISOString()}}};
 memory.delete(key);memory.set(key,entry);if(memory.size>80)memory.delete(memory.keys().next().value);
 try{sessionStorage.setItem('nexus:live:'+key,JSON.stringify(entry))}catch{}
 for(const callback of listeners.get(key)||[])callback(entry);
}
export function subscribeRace(id,callback){const key=raceKey(id),set=listeners.get(key)||new Set();set.add(callback);listeners.set(key,set);return()=>{set.delete(callback);if(!set.size)listeners.delete(key)}}
export function pauseRaceRequests(){for(const c of controllers)c.abort();controllers.clear()}
export async function refreshRace(id,families){
 const key=raceKey(id),existing=families.map(f=>jobs.get(key+':'+f)).filter(Boolean),missing=families.filter(f=>!jobs.has(key+':'+f));
 if(!missing.length)return Promise.allSettled(existing);
 const controller=new AbortController();controllers.add(controller);
 const timeout=setTimeout(()=>controller.abort(),25000);
 const task=(async()=>{
  try{
   const query=new URLSearchParams({...id,rno:String(id.rno),kind:'live',families:missing.join(',')});
   const res=await fetch('/api/boatrace?'+query,{cache:'no-store',signal:controller.signal});if(!res.ok)throw new Error('HTTP '+res.status);
   const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.trim())accept(id,JSON.parse(line))}if(done)break}
  }catch(e){if(e.name!=='AbortError'){for(const family of missing){const old=readRace(id)?.sources?.[family];accept(id,{...old,identity:id,family,status:'fetch-error',error:String(e.message),storedAt:new Date().toISOString()})}}}
  finally{clearTimeout(timeout);controllers.delete(controller);for(const f of missing)jobs.delete(key+':'+f)}
 })();
 for(const f of missing)jobs.set(key+':'+f,task);
 return Promise.allSettled([...existing,task]);
}
export function raceView(entry,now=Date.now()){
 if(!entry)return {core:null,odds:[],oddsAt:null,result:null};
 const s=entry.sources,card=s.card?.data,b=s.before?.data,original=sourceFresh(s.original,'original',now)?s.original?.data:null;
 const rows=(b?.rows||[]).map(row=>{const extra=original?.rows?.find(x=>Number(x.lane)===Number(row.lane))||{};return {...row,time:row.time||extra.time,lap:extra.lap||'',turn:extra.turn||'',straight:extra.straight||''}});
 const core={identity:entry.identity,race:card?.race,series:s.series?.data||card?.series,before:{...b,rows,original},beforeAt:s.before?.fetchedAt,baseAt:s.card?.fetchedAt,seriesAt:s.series?.fetchedAt||s.card?.fetchedAt,updatedAt:s.before?.fetchedAt||s.card?.fetchedAt,sources:s};
 return {core,odds:s.odds?.data||[],oddsAt:s.odds?.fetchedAt,result:s.result?.data?.available?s.result.data:null};
}
