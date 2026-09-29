export const LIVE_CACHE_VERSION=2;
export const SOURCE_MAX_AGE={card:180000,series:180000,before:60000,original:90000,odds:90000,result:120000};
export function sourceFresh(meta,family,now=Date.now()){
 const t=Date.parse(meta?.fetchedAt||'');
 return Number.isFinite(t)&&t<=now+5000&&now-t<=(SOURCE_MAX_AGE[family]||60000)&&!meta?.error&&!['fetch-error','parse-error'].includes(meta?.status);
}
export function raceIntervals(deadline,exReady,now=Date.now()){
 if(!Number.isFinite(deadline))return {card:60000,series:60000,before:30000,original:60000,odds:60000,result:0};
 const left=deadline-now;
 if(left<=0)return {card:0,series:0,before:0,original:0,odds:0,result:30000};
 return {card:120000,series:60000,before:exReady?45000:left<=15*60000?15000:left<=30*60000?20000:120000,original:left<=30*60000?45000:180000,odds:left<=15*60000?30000:60000,result:0};
}
export function validRaceIdentity(identity,hd,jcd,rno){return identity?.hd===hd&&identity?.jcd===jcd&&Number(identity?.rno)===Number(rno)}
