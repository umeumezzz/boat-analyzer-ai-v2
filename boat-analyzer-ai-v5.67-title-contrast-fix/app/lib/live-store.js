import {getCache} from '@vercel/functions';
// Hobby cache storage is shared by a team: namespace includes this app and schema.
const shared=getCache({namespace:'boat-analyzer-nexus-live-v2'});
const memory=new Map(),inflight=new Map();
const iso=()=>new Date().toISOString();
function remember(key,value){memory.delete(key);memory.set(key,value);if(memory.size>600)memory.delete(memory.keys().next().value)}
export async function peekSource(key){
 const local=memory.get(key);
 if(local&&Date.now()-Date.parse(local.storedAt)<3000)return local;
 try{const remote=await shared.get(key);if(remote){remember(key,remote);return remote}}catch{}
 return local||null;
}
export function sourceAge(value){const t=Date.parse(value?.fetchedAt||'');return Number.isFinite(t)?Math.max(0,Date.now()-t):Infinity}
export async function loadSource(key,loader,ttl){
 if(inflight.has(key))return inflight.get(key);
 const task=(async()=>{
  const old=await peekSource(key);
  // Empty/invalid responses are never reused as a positive cache hit.
  if(old&&old.status==='published'&&sourceAge(old)<ttl)return {...old,cache:'hit'};
  const start=Date.now();
  try{
   const loaded=await loader();
   const value={...loaded,fetchedAt:iso(),detectedAt:old?.status==='published'?old.detectedAt:loaded.status==='published'?iso():null,storedAt:iso(),durationMs:Date.now()-start,cache:'miss'};
   remember(key,value);
   // Persist diagnostic/partial data for snapshots, but only published entries are reused.
   await shared.set(key,value,{ttl:21600}).catch(()=>{});
   return value;
  }catch(e){
   const value={status:'fetch-error',data:old?.data||null,fetchedAt:old?.fetchedAt||null,detectedAt:old?.detectedAt||null,storedAt:iso(),durationMs:Date.now()-start,error:String(e?.message||e),cache:old?'last-good':'miss'};
   remember(key,value);await shared.set(key,value,{ttl:21600}).catch(()=>{});return value;
  }
 })().finally(()=>inflight.delete(key));
 inflight.set(key,task);return task;
}
export async function streamSources(identity,families,loaders,ttls,peekOnly=false){
 const encoder=new TextEncoder(),key=f=>`${identity.hd}:${identity.jcd}:${identity.rno}:${f}`;
 if(peekOnly){const entries=await Promise.all(families.map(async f=>[f,await peekSource(key(f))]));return {identity,sources:Object.fromEntries(entries),serverAt:iso()}}
 let disconnected=false;
 return new ReadableStream({
  async start(controller){
   const send=event=>{if(!disconnected){try{controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'))}catch{disconnected=true}}};
   send({identity,serverAt:iso()});
   await Promise.allSettled(families.map(async family=>{
    const previous=await peekSource(key(family));if(previous)send({identity,family,...previous,phase:'cached'});
    const value=await loadSource(key(family),loaders[family],ttls[family]);
    send({identity,family,...value,phase:'confirmed',apiDetected:value.detectedAt});
   }));
   if(!disconnected)controller.close();
  },cancel(){disconnected=true}
 });
}
