import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import * as cheerio from 'cheerio';
import {normalizeExhibitionST,exhibitionStatus,validOriginalMetric} from '../app/exhibition.js';
import {sourceFresh,raceIntervals,validRaceIdentity} from '../app/lib/live-policy.js';
import {loadSource,streamSources} from '../app/lib/live-store.js';
const helper=fs.readFileSync('app/exhibition.js','utf8').replaceAll('export function','function');
const code=fs.readFileSync('app/api/boatrace/route.js','utf8').replace(/^import .*;$/gm,'').replaceAll('export const','const').replaceAll('export async function','async function');
const ctx=vm.createContext({cheerio,console,Response,URL,Intl,Date,fetch,AbortSignal});vm.runInContext(helper+'\n'+code,ctx);
for(const raw of ['.12','0.12','F.01','F01','L.01','L01'])assert.ok(normalizeExhibitionST(raw));
assert.equal(normalizeExhibitionST('F01').value,null);assert.equal(normalizeExhibitionST('12'),null);assert.equal(normalizeExhibitionST(''),null);
const rows=Array.from({length:6},(_,i)=>({lane:i+1,time:'6.82',st:'.12'}));assert.equal(exhibitionStatus(rows).ready,true);assert.equal(exhibitionStatus(rows.slice(1)).ready,false);assert.equal(exhibitionStatus([...rows,rows[0]]).ready,false);
assert.equal(validOriginalMetric('18.65','lap','半周'),true);assert.equal(validOriginalMetric('18.65','lap','1周'),false);
// A previous-run ST is not the current exhibition ST.
ctx.html='<table><thead><tr><th>枠</th><th>展示<br>タイム</th></tr></thead><tbody><tr><td>1</td><td>6.82</td></tr><tr><td>ST</td><td>.01</td></tr></tbody></table>';
const before=vm.runInContext('parseBefore(html)',ctx);assert.equal(before.completeTimes,1);assert.equal(before.completeST,0);
// BOATCAST partial optional measurements retain good rows without inventing a sixth.
ctx.txt='data=\n1\t2\n一　周\tまわり足\n'+Array.from({length:6},(_,i)=>`${i+1}\t選手\t37.00\t${i===4?'':'5.70'}`).join('\n');
const original=vm.runInContext("parseBoatcastOriginal(txt,'13')",ctx);assert.equal(original.available,true);assert.equal(original.counts.lap,6);assert.equal(original.counts.turn,5);assert.equal(original.validation,'rejected-partial');assert.equal(original.rows[4].turn,undefined);
const now=Date.now(),fresh={status:'published',fetchedAt:new Date(now).toISOString()};assert.equal(sourceFresh(fresh,'before',now),true);assert.equal(sourceFresh(fresh,'before',now+60001),false);assert.equal(sourceFresh({...fresh,status:'fetch-error'},'before',now),false);
assert.equal(validRaceIdentity({hd:'20260929',jcd:'02',rno:12},'20260930','02',12),false);
assert.equal(raceIntervals(now+10*60000,false,now).before,15000);assert.equal(raceIntervals(now+10*60000,true,now).before,45000);assert.equal(raceIntervals(now-1,true,now).before,0);
const key='verify-'+Date.now();let calls=0;
const loader=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {status:'published',data:{value:1}}};
const [a,b]=await Promise.all([loadSource(key,loader,60000),loadSource(key,loader,60000)]);assert.equal(calls,1);assert.equal(a.fetchedAt,b.fetchedAt);
let emptyCalls=0;await loadSource(key+'empty',async()=>{emptyCalls++;return {status:'waiting',data:{rows:[]}}},60000);await loadSource(key+'empty',async()=>{emptyCalls++;return {status:'published',data:{rows}}},60000);assert.equal(emptyCalls,2);
const failed=await loadSource(key,async()=>{throw Error('timeout')},0);assert.equal(failed.status,'fetch-error');assert.equal(failed.fetchedAt,a.fetchedAt);
const id={hd:key,jcd:'02',rno:12};const stream=await streamSources(id,['card','original'],{card:async()=>({status:'published',data:{race:1}}),original:async()=>{await new Promise(r=>setTimeout(r,80));return {status:'published',data:{lap:1}}}},{card:0,original:0});
const frames=(await new Response(stream).text()).trim().split('\n').map(JSON.parse).filter(x=>x.family);assert.equal(frames[0].family,'card');assert.equal(frames.at(-1).family,'original');
console.log('PASS: ST, lane binding, partial optional metrics, freshness, deadline polling, shared inflight, empty-response refresh, last-good safety, nonblocking stream');
