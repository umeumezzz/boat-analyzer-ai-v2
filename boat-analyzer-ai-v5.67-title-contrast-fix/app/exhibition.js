// Keep parsing and readiness identical in the API and the client.
const compact=value=>String(value??'').trim().replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[．。]/g,'.').toUpperCase();

export function normalizeExhibitionST(value){
 const raw=compact(value);
 const regular=raw.match(/^(?:0)?\.(\d{2})$/);
 if(regular){const n=Number(`0.${regular[1]}`);return {kind:'normal',label:`.${regular[1]}`,value:n}}
 const foul=raw.match(/^([FL])(?:0?\.)?(\d{2})$/);
 if(foul)return {kind:foul[1],label:`${foul[1]}.${foul[2]}`,value:null};
 return null;
}

export function validExhibitionTime(value){
 const raw=compact(value);
 return /^\d\.\d{2}$/.test(raw)&&Number(raw)>=6&&Number(raw)<9;
}

export function exhibitionStatus(rows){
 const byLane=new Map();
 for(const row of Array.isArray(rows)?rows:[]){
  const lane=Number(row?.lane);
  if(!Number.isInteger(lane)||lane<1||lane>6||byLane.has(lane))return {ready:false,timeCount:0,stCount:0,invalid:true};
  byLane.set(lane,row);
 }
 const timeCount=[1,2,3,4,5,6].filter(l=>validExhibitionTime(byLane.get(l)?.time)).length;
 const stCount=[1,2,3,4,5,6].filter(l=>normalizeExhibitionST(byLane.get(l)?.st)).length;
 const invalid=[...byLane.values()].some(r=>(String(r.time??'').trim()&&!validExhibitionTime(r.time))||(String(r.st??'').trim()&&!normalizeExhibitionST(r.st)));
 return {ready:byLane.size===6&&timeCount===6&&stCount===6&&!invalid,timeCount,stCount,invalid};
}

export function validOriginalMetric(value,field,lapLabel='1周'){
 if(field==='time')return validExhibitionTime(value);
 const v=compact(value);if(!/^\d{1,2}\.\d{1,2}$/.test(v))return false;
 const ranges={lap:lapLabel==='半周'?[12,30]:[30,45],turn:[4,15],straight:[4,9]},range=ranges[field];
 return !!range&&Number(v)>=range[0]&&Number(v)<range[1];
}
