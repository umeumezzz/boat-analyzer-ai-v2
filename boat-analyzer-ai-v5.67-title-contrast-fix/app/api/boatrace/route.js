import * as cheerio from 'cheerio';
export const dynamic='force-dynamic';
// v5.54 FAST4: run scraping close to BOAT RACE's Japanese origin.
// Vercel Tokyo reduces origin round-trips substantially versus a distant default region.
export const preferredRegion='hnd1';
const base='https://www.boatrace.jp/owpc/pc/race/';
const clean=s=>(s||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
async function grab(path,ttl=20){
 const r=await fetch(base+path,{next:{revalidate:ttl},headers:{'User-Agent':'Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36','Accept-Language':'ja-JP,ja;q=0.9'}});
 if(!r.ok)throw new Error(String(r.status));return r.text()
}
function parseRace(html){
 const $=cheerio.load(html),racers=[];
 $('tbody tr').each((_,tr)=>{
  const cells=$(tr).find('th,td').map((_,td)=>clean($(td).text())).get().filter(Boolean),joined=cells.join(' | '),g=joined.match(/\b(A1|A2|B1|B2)\b/);
  if(!g)return;
  const reg=(joined.match(/\b\d{4}\b/)||[])[0]||'';
  let name='';
  for(const c of cells){if(c.includes(g[1])){name=clean(c.replace(reg,'').replace(g[1],'').replace(/\d{2,3}歳.*/,''));break}}
  if(name&&!racers.some(r=>r.reg===reg||r.name===name))racers.push({reg,name:name.slice(0,18),grade:g[1],stats:cells.filter(x=>x!==name&&x!==g[1]&&x!==reg).slice(0,10)})
 });
 return {racers:racers.slice(0,6)}
}
const ascii=s=>clean(s).replace(/[０-９]/g,ch=>String(ch.charCodeAt(0)-0xFEE0)).replace(/[．。]/g,'.');
const stOK=s=>/^(?:F|L)?\.?\d{2}$/.test(ascii(s));
const courseOK=s=>/^[1-6]$/.test(ascii(s));
const finishOK=s=>/^(?:[1-6]|F|L|K|S|転|落|妨|失)(?:着)?$/.test(ascii(s));
function parseSeries(html,racers){
 const $=cheerio.load(html),rows=[];
 // IMPORTANT: official racelist uses nested tables inside racer rows.
 // `find('td')` also picked up those nested cells and destroyed column alignment.
 // v4.4 reads only DIRECT cells of each result row, then groups course/ST/finish rows.
 const directCells=tr=>$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get();
 const allTr=$('tr').toArray();
 const hasReg=(tr,reg)=>reg&&new RegExp(`(^|\\D)${reg}(\\D|$)`).test(clean($(tr).text()));
 const extractTriples=(rowArrays)=>{
  let best=[];
  for(let si=0;si<rowArrays.length;si++){
   const sr=rowArrays[si];
   if(sr.filter(stOK).length<1)continue;
   for(let ci=Math.max(0,si-2);ci<si;ci++)for(let fi=si+1;fi<=Math.min(rowArrays.length-1,si+2);fi++){
    let cr=rowArrays[ci],fr=rowArrays[fi];
    const n=Math.min(cr.length,sr.length,fr.length); if(!n)continue;
    const a=cr.slice(-n),b=sr.slice(-n),c=fr.slice(-n),got=[];
    for(let j=0;j<n;j++){
     const course=ascii(a[j]),st=ascii(b[j]),finish=ascii(c[j]).replace('着','');
     if(courseOK(course)&&stOK(st)&&finishOK(finish))got.push({course,st,finish,raw:`${course} ${st} ${finish}`});
    }
    if(got.length>best.length)best=got;
   }
  }
  return best;
 };
 for(const racer of racers){
  let runs=[];
  const idx=allTr.findIndex(tr=>hasReg(tr,racer.reg));
  if(idx>=0){
   // Strategy A: direct sibling rows. This matches the official 4-row result block.
   const block=[];
   for(let i=idx;i<Math.min(allTr.length,idx+8);i++){
    if(i>idx && racers.some(x=>x.reg!==racer.reg&&hasReg(allTr[i],x.reg)))break;
    const cells=directCells(allTr[i]); if(cells.length)block.push(cells);
   }
   runs=extractTriples(block);

   // Strategy B: some official layouts wrap the four result rows in a nested table/tbody.
   if(!runs.length){
    const anchor=$(allTr[idx]);
    const candidates=[anchor.closest('tbody'),...anchor.find('tbody').toArray().map(x=>$(x)),...anchor.find('table').toArray().map(x=>$(x))];
    for(const box of candidates){
     if(!box||!box.length)continue;
     const arr=box.find('tr').toArray().map(directCells).filter(x=>x.length);
     const got=extractTriples(arr); if(got.length>runs.length)runs=got;
    }
   }

   // Strategy C: parse nested cells by row but never mix parent and descendant td values.
   if(!runs.length){
    const nested=$(allTr[idx]).find('table tr').toArray().map(directCells).filter(x=>x.length);
    runs=extractTriples(nested);
   }

   // v5.14 fallback: BOAT RACE sometimes renders 今節成績 as a compact/nested text block.
   // Read only the current racer's row/block and recognize course -> ST -> finish triplets.
   // This avoids depending on a particular nested-table column layout.
   if(!runs.length){
    const anchor=$(allTr[idx]);
    const scopes=[anchor,anchor.closest('tbody')];
    for(const scope of scopes){
     if(!scope||!scope.length)continue;
     const raw=ascii(scope.text()).replace(/([1-6])着/g,'$1');
     const tokens=raw.split(/\s+/).map(ascii).filter(Boolean);
     const got=[];
     for(let k=0;k<tokens.length-2;k++){
      const course=tokens[k],st=tokens[k+1],finish=tokens[k+2].replace('着','');
      if(courseOK(course)&&stOK(st)&&finishOK(finish))got.push({course,st,finish,raw:`${course} ${st} ${finish}`});
     }
     if(got.length>runs.length)runs=got;
    }
   }
  }
  rows.push({reg:racer.reg,name:racer.name,runs:runs.slice(0,14),values:runs.slice(0,14).map(x=>x.raw)});
 }
 return {rows,count:rows.filter(x=>x.runs.length).length,parser:'v5.14-flex-series'};
}
function parseOmuraSeries(html,racers){
 const $=cheerio.load(html), runsBy=Array.from({length:6},()=>[]), avgST=Array(6).fill('');
 const clean=s=>ascii(String(s||'')).replace(/\s+/g,' ').trim();
 const parseCell=txt=>{
  const t=clean(txt).replace(/([1-6])着/g,'$1'), out=[];
  // 公式: 着順 進入(.ST) 例「４ 2(.20)」「F 3(.01)」
  const re=/(?:^|\s)([1-6FLS転落妨失K])\s*([1-6])\s*\(((?:F|L)?\.?\d{2})\)/g;
  let m; while((m=re.exec(t)))out.push({finish:m[1],course:m[2],st:m[3],raw:`${m[2]} ${m[3]} ${m[1]}`});
  return out;
 };
 // 大村の出走表は画面上「6号艇→1号艇」の6列 + 右端ラベル。
 // 行ラベル(初日/2日目/.../今節平均ST)を基準にし、6データ列を reverse して1→6へ正規化。
 $('table').each((_,table)=>{
  const tt=clean($(table).text()); if(!/今節成績/.test(tt)||!/進入/.test(tt)||!/平均ST/.test(tt))return;
  $(table).find('tr').each((__,tr)=>{
   const cells=$(tr).children('th,td').map((___,td)=>clean($(td).text())).get(); if(cells.length<7)return;
   const label=cells[cells.length-1].replace(/\s/g,'');
   const six=cells.slice(0,6);
   if(/^(?:初日|[2-9]日目|最終日)/.test(label)||/今節成績/.test(label)){
    const laneOrder=[...six].reverse();
    laneOrder.forEach((c,i)=>runsBy[i].push(...parseCell(c)));
   }
   if(/今節平均ST/.test(label)){
    [...six].reverse().forEach((c,i)=>{const m=c.match(/\.?\d{2}/);if(m)avgST[i]=m[0].startsWith('.')?m[0]:'0.'+m[0]});
   }
  });
 });
 // responsive markup fallback: 「今節成績」周辺のtrで、6つの走データセルを見つけたら同じく逆順。
 if(!runsBy.every(x=>x.length)){
  $('tr').each((_,tr)=>{
   const cells=$(tr).children('th,td').map((__,td)=>clean($(td).text())).get();
   const data=cells.filter(c=>parseCell(c).length);
   if(data.length===6){[...data].reverse().forEach((c,i)=>{if(!runsBy[i].length)runsBy[i].push(...parseCell(c))})}
  });
 }
 const rows=(racers||[]).slice(0,6).map((r,i)=>({reg:r.reg,name:r.name,runs:runsBy[i].slice(0,14),values:runsBy[i].slice(0,14).map(x=>x.raw),avgST:avgST[i]||''}));
 return {rows,count:rows.filter(x=>x.runs.length).length,avgSTCount:avgST.filter(Boolean).length,parser:'omura-series-v6-six-column-reverse',source:'BOATRACE大村公式'};
}

function parseBefore(html){const $=cheerio.load(html),body=clean($('body').text()),byLane=new Map();
 const put=(lane,st,time)=>{lane=Number(lane);if(!(lane>=1&&lane<=6))return;const old=byLane.get(lane)||{lane};st=ascii(st||'');time=ascii(time||'');if(stOK(st)&&!old.st)old.st=st;if(/^6\.\d{2}$/.test(time)&&!old.time)old.time=time;byLane.set(lane,old)};
 const vals=el=>$(el).find('th,td,span,div').map((_,x)=>ascii($(x).text())).get().filter(Boolean);
 // Official start-exhibition blocks. Some layouts place ST and exhibition time in sibling/descendant nodes.
 $('.table1_boatImage1').each((_,el)=>{const a=vals(el),lane=Number(ascii($(el).find('.table1_boatImage1Number').first().text()))||a.map(Number).find(x=>x>=1&&x<=6),st=ascii($(el).find('.table1_boatImage1Time').first().text())||a.find(stOK),time=a.find(x=>/^6\.\d{2}$/.test(x));if(lane)put(lane,st,time)});
 // Scope parsing to tables/blocks explicitly containing 展示タイム; pair each data row with its lane.
 $('table,section,div').filter((_,el)=>/展示タイム/.test(ascii($(el).text()))).each((_,box)=>{$(box).find('tr').each((_,tr)=>{const c=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get().filter(Boolean);if(!c.length)return;const lane=c.map(Number).find(x=>x>=1&&x<=6),time=c.find(x=>/^6\.\d{2}$/.test(x)),st=c.find(stOK);if(lane&&(time||st))put(lane,st,time)})});
 // Official compact exhibition rows.
 $('.is-fs12').each((_,el)=>{const c=$(el).children('td').map((_,td)=>ascii($(td).text())).get().filter(Boolean),lane=c.map(Number).find(x=>x>=1&&x<=6),time=c.find(x=>/^6\.\d{2}$/.test(x)),st=c.find(stOK);if(lane&&(time||st))put(lane,st,time)});
 // If all six exhibition times are present as a contiguous official text block, map in lane order.
 if([...byLane.values()].filter(x=>x.time).length<6){const txt=ascii($('body').text()),pos=txt.indexOf('展示タイム');if(pos>=0){const chunk=txt.slice(pos,pos+1800),ts=[...chunk.matchAll(/(?:^|\s)(6\.\d{2})(?=\s|$)/g)].map(m=>m[1]);const uniq=ts.slice(0,6);if(uniq.length===6)uniq.forEach((t,i)=>put(i+1,'',t))}}
 const rows=[1,2,3,4,5,6].map(lane=>byLane.get(lane)||{lane}),weather={};for(const k of ['気温','水温','風速','波高']){const m=body.match(new RegExp(k+'\\s*([0-9.]+\\s*(?:℃|m|cm)?)'));if(m)weather[k]=m[1]}const wind=(body.match(/風向\s*([^\s]{1,8})/)||[])[1];if(wind)weather['風向']=wind;return {available:rows.some(r=>r.st||r.time),rows,weather,completeTimes:rows.filter(r=>r.time).length,completeST:rows.filter(r=>r.st).length}}


// v5.6 original exhibition adapters. Venue-specific official pages are primary for
// lap/turn/straight and can also repair missing common exhibition times.
const ORIGINAL_SUPPORTED={
  '01':{name:'桐生',parser:'kiryu'},
  '02':{name:'戸田',parser:'boatcast'},
  '03':{name:'江戸川',parser:'boatcast'},
  '04':{name:'平和島',parser:'boatcast'},
  '05':{name:'多摩川',parser:'boatcast'},
  '06':{name:'浜名湖',parser:'hamanako'},
  '07':{name:'蒲郡',parser:'boatcast'},
  '08':{name:'常滑',parser:'boatcast'},
  '09':{name:'津',parser:'boatcast'},
  '10':{name:'三国',parser:'mikuni'},
  '11':{name:'びわこ',parser:'boatcast'},
  '12':{name:'住之江',parser:'suminoe'},
  '13':{name:'尼崎',parser:'boatcast'},
  '14':{name:'鳴門',parser:'boatcast'},
  '15':{name:'丸亀',parser:'marugame'},
  '16':{name:'児島',parser:'boatcast'},
  '17':{name:'宮島',parser:'boatcast'},
  '18':{name:'徳山',parser:'boatcast'},
  '19':{name:'下関',parser:'boatcast'},
  '20':{name:'若松',parser:'boatcast'},
  '21':{name:'芦屋',parser:'boatcast'},
  '22':{name:'福岡',parser:'boatcast'},
  '23':{name:'唐津',parser:'karatsu'},
  '24':{name:'大村',parser:'omura'},
};

async function grabUrl(url,ttl=15){const r=await fetch(url,{next:{revalidate:ttl},headers:{'User-Agent':'Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36','Accept-Language':'ja-JP,ja;q=0.9'}});if(!r.ok)throw new Error(`original:${r.status}`);return r.text()}
function parseOriginalExhibition(html){
 const $=cheerio.load(html), rows=[];
 $('tr').each((_,tr)=>{
  const c=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get().filter(Boolean);
  if(c.length<5)return;
  const lane=Number(c[0]); if(!(lane>=1&&lane<=6))return;
  // Official venue pages use: lane/name/ST/exhibition/lap/turn/straight ...
  const nums=c.map(x=>ascii(x));
  const st=nums.find(stOK)||'';
  const ex=nums.find(x=>/^6\.\d{2}$/.test(x))||'';
  const lap=nums.find(x=>/^(?:3[5-9]|4[0-2])\.\d{2}$/.test(x))||'';
  const afterEx=ex?nums.slice(nums.indexOf(ex)+1):nums;
  const small=afterEx.filter(x=>/^[4-8]\.\d{2}$/.test(x));
  const turn=small[0]||'', straight=small[1]||'';
  if(st||ex||lap||turn||straight)rows.push({lane,st,time:ex,lap,turn,straight});
 });
 const by=new Map(); for(const r of rows){if(!by.has(r.lane))by.set(r.lane,r)}
 return {available:by.size>0,rows:[1,2,3,4,5,6].map(l=>by.get(l)||{lane:l}),completeTimes:[...by.values()].filter(x=>x.time).length,source:'各場公式オリジナル展示'};
}


function cleanRacerName(s){return ascii(s||'').replace(/[\s　]+/g,'').replace(/[・.]/g,'')}
function parseKiryuTimedata(html,racers=[]){
 const $=cheerio.load(html), byName=new Map(), norm=s=>ascii(s||'').replace(/\s+/g,' ').trim(); let current='';
 const put=(name,key,val)=>{if(!name||!val||val==='-.--'||val==='-')return;const k=cleanRacerName(name);byName.set(k,{...(byName.get(k)||{}),[key]:val})};
 $('tr').each((_,tr)=>{const c=$(tr).children('th,td').map((_,td)=>norm($(td).text())).get().filter(Boolean);if(!c.length)return;
   const joined=c.join(' ');let metric=null;if(joined.includes('まわり足'))metric='turn';else if(joined.includes('半周ラップ'))metric='lap';else if(joined.includes('展示タイム'))metric='time';else if(joined.includes('直線タイム'))metric='straight';if(!metric)return;
   const labelIdx=c.findIndex(x=>/まわり足|半周ラップ|展示タイム|直線タイム/.test(x));if(labelIdx>0)current=c[labelIdx-1];
   const vals=c.slice(labelIdx+1).filter(x=>/^\d{1,2}\.\d{2}$/.test(x));if(vals.length)put(current,metric,vals[vals.length-1]);
 });
 const rows=(racers||[]).map((r,i)=>({lane:i+1,...(byName.get(cleanRacerName(r.name))||{})}));
 return {available:rows.some(r=>r.time||r.lap||r.turn||r.straight),rows,completeTimes:rows.filter(r=>r.time).length,originalComplete:rows.filter(r=>r.time&&r.lap&&r.turn&&r.straight).length,source:'BOAT RACE桐生公式・選手タイムデータ',lapLabel:'半周',provider:'kiryu-official'};
}
function parseVenueOriginalTable(html,{source,provider,straight=true}={}){
 const $=cheerio.load(html),by=new Map(),clean=s=>ascii(s||'').replace(/\s+/g,'').replace('展示タイム','展示');
 $('table').each((_,table)=>{
  let header=null;
  $(table).find('tr').each((_,tr)=>{
   const cells=$(tr).children('th,td').map((_,td)=>ascii($(td).text()).trim()).get(), n=cells.map(clean);
   if(!header && n.some(x=>x==='展示') && n.some(x=>x.includes('一周')) && n.some(x=>/(?:まわり足|回り足)/.test(x))){
    const idx=re=>n.findIndex(x=>re.test(x));
    header={lane:idx(/^(?:枠|艇)$/),time:idx(/^展示$/),lap:idx(/一周/),turn:idx(/(?:まわり足|回り足)/),straight:idx(/^直線$/)};return;
   }
   if(!header)return;
   let lane=header.lane>=0?Number(clean(cells[header.lane])):Number(clean(cells[0])); if(!(lane>=1&&lane<=6))return;
   const val=i=>i>=0?clean(cells[i]||''):'';
   const time=val(header.time),lap=val(header.lap),turn=val(header.turn),st=straight?val(header.straight):'';
   const ok=(v,min,max)=>{const x=Number(v);return Number.isFinite(x)&&x>=min&&x<max?v:''};
   const row={lane,time:ok(time,6,9),lap:ok(lap,30,45),turn:ok(turn,4,15),straight:straight?ok(st,4,9):''};
   if(row.time||row.lap||row.turn||row.straight)by.set(lane,row);
  });
 });
 // Fallback for multi-row/colspan headers used by venue sites. Scope to a single racer row,
 // discard the lane cell first, then classify only plausible timing ranges.
 if(by.size<6){
  $('tr').each((_,tr)=>{const c=$(tr).children('th,td').map((_,td)=>ascii($(td).text()).replace(/\s+/g,' ').trim()).get().filter(Boolean);const lane=Number(c[0]);if(!(lane>=1&&lane<=6)||by.has(lane))return;
   const vals=c.slice(1).flatMap(x=>x.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number).filter(Number.isFinite);
   const timeN=vals.find(n=>n>=6&&n<9),lapN=vals.find(n=>n>=30&&n<45);let turnN,straightN;
   if(lapN!=null){const i=vals.indexOf(lapN),tail=vals.slice(i+1);turnN=tail.find(n=>n>=4&&n<15);if(straight&&turnN!=null){const j=tail.indexOf(turnN);straightN=tail.slice(j+1).find(n=>n>=4&&n<9)}}
   const row={lane,time:timeN!=null?timeN.toFixed(2):'',lap:lapN!=null?lapN.toFixed(2):'',turn:turnN!=null?turnN.toFixed(2):'',straight:straightN!=null?straightN.toFixed(2):''};if(row.time||row.lap||row.turn||row.straight)by.set(lane,row);
  });
 }
 const rows=[1,2,3,4,5,6].map(l=>by.get(l)||{lane:l});
 return {available:rows.some(r=>r.time||r.lap||r.turn||r.straight),rows,completeTimes:rows.filter(r=>r.time).length,originalComplete:rows.filter(r=>r.time&&r.lap&&r.turn&&(!straight||r.straight)).length,source,lapLabel:'1周',provider};
}
function strictVenueRows(html,{source,provider,straight=false}={}){
 const $=cheerio.load(html),by=new Map();
 const dec=s=>String(s||'').match(/-?\d+\.\d{1,2}/g)||[];
 const n2=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
 $('tr').each((_,tr)=>{
  const cells=$(tr).children('th,td').map((_,td)=>ascii($(td).text()).replace(/\s+/g,' ').trim()).get().filter(Boolean);
  if(!cells.length)return;
  const lane=Number(cells[0]); if(!(lane>=1&&lane<=6)||by.has(lane))return;
  // Racer rows contain weight/tilt before the timing block. We therefore identify the timing
  // block by venue-specific physical ranges AND order, never by absolute column indexes or
  // the first numeric token. This survives rowspan/colspan HTML without turning lane/weight
  // values into exhibition measurements.
  const vals=cells.flatMap(dec).map(n2).filter(x=>x!=null);
  let found=null;
  for(let i=0;i<vals.length;i++){
   const ex=vals[i]; if(!(ex>=6.3&&ex<8.5))continue;
   for(let j=i+1;j<Math.min(vals.length,i+4);j++){
    const lap=vals[j]; if(!(lap>=34&&lap<43))continue;
    for(let k=j+1;k<Math.min(vals.length,j+3);k++){
     const turn=vals[k];
     const turnOK=straight?(turn>=4.5&&turn<7.0):(turn>=10&&turn<13.5);
     if(!turnOK)continue;
     if(straight){
      const st=vals[k+1]; if(!(st>=5.5&&st<8.5))continue;
      found={time:ex.toFixed(2),lap:lap.toFixed(2),turn:turn.toFixed(2),straight:st.toFixed(2)};
     }else found={time:ex.toFixed(2),lap:lap.toFixed(2),turn:turn.toFixed(2),straight:''};
     break;
    }
    if(found)break;
   }
   if(found)break;
  }
  if(found)by.set(lane,{lane,...found});
 });
 const rows=[1,2,3,4,5,6].map(l=>by.get(l)||{lane:l});
 const required=r=>r.time&&r.lap&&r.turn&&(!straight||r.straight);
 const complete=rows.filter(required).length;
 // Never advertise "original reflected" or feed AI ranking from a partially/mis-parsed table.
 // Six complete racer rows are required; otherwise the caller falls back to common official data.
 return {available:complete===6,rows:complete===6?rows:[1,2,3,4,5,6].map(l=>({lane:l})),completeTimes:complete===6?6:0,originalComplete:complete,source,lapLabel:'1周',provider,validation:complete===6?'strict-6of6':'rejected-partial'};
}
function parseSuminoeOriginal(html){
 return strictVenueRows(html,{source:'BOAT RACE住之江公式・オリジナル展示',provider:'suminoe-official-strict-v2',straight:false});
}
function parseMarugameOriginal(html){
 return strictVenueRows(html,{source:'BOAT RACEまるがめ公式・オリジナル展示',provider:'marugame-official-strict-v2',straight:true});
}
function parseTokuyamaOriginal(html){
  // 徳山公式の計測ページは各艇ブロック内に
  // 「展示 → 一周 → まわり足」が並ぶ。登録番号を艇ブロック境界として扱い、
  // ページ全体を横断する正規表現で艇を取り違えないようにする。
  const $=cheerio.load(html);
  const text=ascii($('body').text()).replace(/\s+/g,' ').trim();
  const marks=[...text.matchAll(/(?:^|\s)(\d{4})(?=\s)/g)];
  const rows=[];

  for(let i=0;i<marks.length&&rows.length<6;i++){
    const from=marks[i].index;
    const to=i+1<marks.length?marks[i+1].index:text.length;
    const block=text.slice(from,to);
    const tm=block.match(/展示[：:]\s*(\d+(?:\.\d+)?)/);
    const lm=block.match(/一周[：:]\s*(\d+(?:\.\d+)?)/);
    const rm=block.match(/まわり足[：:]\s*(\d+(?:\.\d+)?)/);
    if(!tm||!lm||!rm)continue;
    const time=Number(tm[1]),lap=Number(lm[1]),turn=Number(rm[1]);
    if(!(time>=6&&time<9)||!(lap>=30&&lap<45)||!(turn>=9&&turn<15))continue;
    rows.push({lane:rows.length+1,time:time.toFixed(2),lap:lap.toFixed(2),turn:turn.toFixed(2),straight:''});
  }

  const complete=rows.length===6;
  return {
    available:complete,
    rows:complete?rows:[1,2,3,4,5,6].map(lane=>({lane})),
    completeTimes:complete?6:0,
    originalComplete:complete?6:0,
    source:'BOAT RACE徳山公式・オリジナル展示',
    lapLabel:'1周',
    provider:'tokuyama-official-v3',
    validation:complete?'strict-block-6of6':'rejected-partial'
  };
}

function parseTokonameOriginal(html){
  // 常滑公式の「オリジナル展示データ」表を列名で厳密に取得する。
  // 選手情報側の数値（勝率・年齢等）を誤って拾わないよう、
  // 展示タイム / 一周 / まわり足 / 直線のヘッダー位置を基準にする。
  const parsed=parseVenueOriginalTable(html,{
    source:'BOAT RACEとこなめ公式・オリジナル展示',
    provider:'tokoname-official-v3',
    straight:true
  });

  const rows=[1,2,3,4,5,6].map(lane=>{
    const r=(parsed.rows||[]).find(x=>Number(x.lane)===lane)||{lane};
    return {
      lane,
      time:r.time||'',
      lap:r.lap||'',
      turn:r.turn||'',
      straight:r.straight||''
    };
  });

  const complete=rows.filter(r=>
    /^6\.\d{2}$/.test(r.time||'') &&
    /^(?:3[0-9]|4[0-4])\.\d{2}$/.test(r.lap||'') &&
    /^[4-8]\.\d{2}$/.test(r.turn||'') &&
    /^[5-8]\.\d{2}$/.test(r.straight||'')
  ).length;

  return {
    available:complete===6,
    rows:complete===6 ? rows : [1,2,3,4,5,6].map(lane=>({lane})),
    completeTimes:complete===6?6:0,
    originalComplete:complete,
    source:'BOAT RACEとこなめ公式・オリジナル展示',
    lapLabel:'1周',
    provider:'tokoname-official-v3',
    validation:complete===6?'strict-header-6of6':'rejected-partial'
  };
}

function strictOfficialFourMetricVenue(html,{source,provider}={}){
  // 公式表の列名を第一優先で読む。rowspan/colspan の場合だけ既存の厳格な
  // 物理レンジ検証へフォールバックし、6艇完備しない限りAIには渡さない。
  const parsed=parseVenueOriginalTable(html,{source,provider,straight:true});
  const rows=[1,2,3,4,5,6].map(lane=>{
    const r=(parsed.rows||[]).find(x=>Number(x.lane)===lane)||{lane};
    return {lane,time:r.time||'',lap:r.lap||'',turn:r.turn||'',straight:r.straight||''};
  });
  const valid=r=>
    /^6\.\d{2}$/.test(r.time||'') &&
    /^(?:3[0-9]|4[0-4])\.\d{2}$/.test(r.lap||'') &&
    /^[4-8]\.\d{2}$/.test(r.turn||'') &&
    /^[5-8]\.\d{2}$/.test(r.straight||'');
  const complete=rows.filter(valid).length;
  return {
    available:complete===6,
    rows:complete===6?rows:[1,2,3,4,5,6].map(lane=>({lane})),
    completeTimes:complete===6?6:0,
    originalComplete:complete,
    source,lapLabel:'1周',provider,
    validation:complete===6?'strict-header-6of6':'rejected-partial'
  };
}

function parseBiwakoOriginal(html){
  return strictOfficialFourMetricVenue(html,{
    source:'BOAT RACEびわこ公式・オリジナル展示',
    provider:'biwako-official-v2'
  });
}

function parseKojimaOriginal(html){
  return strictOfficialFourMetricVenue(html,{
    source:'BOAT RACE児島公式・オリジナル展示',
    provider:'kojima-official-v2'
  });
}
function parseOmuraOriginal(html){
 const $=cheerio.load(html),by=new Map();
 const clean=s=>ascii(s||'').replace(/\s+/g,'').replace('展示タイム','展示');
 const put=(lane,obj)=>{lane=Number(lane);if(lane<1||lane>6)return;by.set(lane,{...(by.get(lane)||{lane}),...Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==''&&v!=null))})};
 $('table').each((_,table)=>{
  let header=null;
  $(table).find('tr').each((_,tr)=>{
   const cells=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get();
   const n=cells.map(clean);
   if(!header && n.some(x=>x==='ST') && n.some(x=>x==='展示') && n.some(x=>x.includes('一周')) && n.some(x=>x.includes('まわり足')) && n.some(x=>x==='直線')){
    const idx=label=>n.findIndex(x=>x===label||x.includes(label));
    header={lane:idx('枠'),st:idx('ST'),time:idx('展示'),lap:idx('一周'),turn:idx('まわり足'),straight:idx('直線'),tilt:idx('チルト')}; return;
   }
   if(!header)return;
   const lane=Number(clean(cells[header.lane>=0?header.lane:0])); if(!(lane>=1&&lane<=6))return;
   const val=i=>i>=0?clean(cells[i]||''):'';
   const st=val(header.st),time=val(header.time),lap=val(header.lap),turn=val(header.turn),straight=val(header.straight),tilt=val(header.tilt);
   put(lane,{st:stOK(st)?st:'',time:/^[0-9]+\.\d{2}$/.test(time)?time:'',lap:/^[0-9]+\.\d{2}$/.test(lap)?lap:'',turn:/^[0-9]+\.\d{2}$/.test(turn)?turn:'',straight:/^[0-9]+\.\d{2}$/.test(straight)?straight:'',tilt});
  });
 });
 const rows=[1,2,3,4,5,6].map(l=>by.get(l)||{lane:l});
 return {available:rows.some(r=>r.st||r.time||r.lap||r.turn||r.straight),rows,completeTimes:rows.filter(r=>r.time).length,source:'BOATRACE大村公式'};
}

function parseKaratsuOriginal(html){
 const $=cheerio.load(html),body=ascii($('body').text()),by=new Map();
 const put=(lane,obj)=>{lane=Number(lane);if(lane<1||lane>6)return;by.set(lane,{...(by.get(lane)||{lane}),...Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==''&&v!=null))})};
 const norm=s=>ascii(s||'').replace(/\s+/g,'').replace('展示タイム','展示');
 // Karatsu's 展示情報 table is authoritative. Read columns by their headers,
 // never by numeric guessing: 枠 / 体重 / チルト / 展示 / 一周 / まわり足 / 直線.
 $('table').each((_,table)=>{
   let header=null;
   $(table).find('tr').each((_,tr)=>{
     const cells=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get();
     const n=cells.map(norm);
     if(!header && n.some(x=>x==='展示') && n.some(x=>x.includes('一周'))){
       const idx=label=>n.findIndex(x=>x===label||x.includes(label));
       header={lane:idx('枠'),time:idx('展示'),lap:idx('一周'),turn:idx('まわり足'),straight:idx('直線')};
       return;
     }
     if(!header)return;
     const lane=Number(cells[header.lane>=0?header.lane:0]);
     if(!(lane>=1&&lane<=6))return;
     const val=i=>i>=0?norm(cells[i]||''):'';
     const time=val(header.time),lap=val(header.lap),turn=val(header.turn),straight=val(header.straight);
     put(lane,{
       time:/^[0-9]+\.\d{2}$/.test(time)?time:'',
       lap:/^[0-9]+\.\d{2}$/.test(lap)?lap:'',
       turn:/^[0-9]+\.\d{2}$/.test(turn)?turn:'',
       straight:/^[0-9]+\.\d{2}$/.test(straight)?straight:''
     });
   });
 });
 // Start exhibition is a separate block. Only ST is taken from it.
 $('table').each((_,table)=>{
   const txt=norm($(table).text()); if(!txt.includes('スタート展示'))return;
   $(table).find('tr').each((_,tr)=>{const c=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get().filter(Boolean);const lane=c.map(Number).find(x=>x>=1&&x<=6);const st=c.find(stOK)||'';if(lane&&st)put(lane,{st})});
 });
 // Compatibility fallback for Karatsu layouts where the exhibition table has no semantic table header.
 // Use the known row shape and fixed positions, not "first 6.xx" heuristics.
 if([...by.values()].filter(x=>x.time).length<6){
   $('tr').each((_,tr)=>{const c=$(tr).children('th,td').map((_,td)=>norm($(td).text())).get().filter(Boolean);const lane=Number(c[0]);if(!(lane>=1&&lane<=6))return;
     // Typical row: 枠,体重,チルト,展示,一周,まわり足,直線 (name cells may precede; detect 4 consecutive time-like cells).
     for(let i=1;i<=c.length-4;i++){
       const q=c.slice(i,i+4); if(q.every(x=>/^[0-9]+\.\d{2}$/.test(x)) && Number(q[1])>20){put(lane,{time:q[0],lap:q[1],turn:q[2],straight:q[3]});break;}
     }
     const st=c.find(stOK)||'';if(st)put(lane,{st});
   });
 }
 const rows=[1,2,3,4,5,6].map(l=>by.get(l)||{lane:l});
 const day=(body.match(/(初日|最終日|[２-９2-9]\s*日目)/)||[])[1]?.replace(/\s/g,'')||'';
 const comments=[]; $('tr').each((_,tr)=>{const c=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get().filter(Boolean);const lane=Number(c[0]);if(lane>=1&&lane<=6&&c.length>=2&&c.some(x=>x.length>12))comments[lane-1]=c.find(x=>x.length>12)||''});
 return {available:rows.some(r=>r.st||r.time||r.lap||r.turn||r.straight),rows,completeTimes:rows.filter(r=>r.time).length,source:'BOATRACEからつ公式',meetingLabel:day||null,comments};
}
function parseHamanakoOriginal(html){
 const $=cheerio.load(html),by=new Map(),body=ascii($('body').text());
 const norm=s=>ascii(s||'').replace(/％/g,'%').replace(/\s+/g,'').replace('展示タイム','展示');
 const put=(lane,obj)=>{lane=Number(lane);if(lane<1||lane>6)return;by.set(lane,{...(by.get(lane)||{lane}),...Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==''&&v!=null))})};
 const numeric=v=>/^[-+]?\d+(?:\.\d+)?$/.test(norm(v));
 const validOriginal=(time,lap,turn,straight)=>{
  const a=[time,lap,turn,straight].map(Number);
  return a.every(Number.isFinite)&&a[0]>=5&&a[0]<9&&a[1]>=30&&a[1]<46&&a[2]>=4&&a[2]<10&&a[3]>=6&&a[3]<11;
 };
 // 浜名湖公式「オリジナル展示データ」をテーブル単位で限定。
 // 枠/登番/選手/体重/調整/モーター/チルト/展示/一周/まわり足/直線…のように
 // 前方の数値列が増えても、展示→一周→まわり足→直線の相対順を崩さず取得する。
 $('table').each((_,table)=>{
  const tableText=norm($(table).text());
  if(!tableText.includes('展示')||!tableText.includes('一周')||!(tableText.includes('まわり足')||tableText.includes('回り足'))||!tableText.includes('直線'))return;
  let header=null;
  $(table).find('tr').each((_,tr)=>{
   const cells=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get();
   if(!cells.length)return;
   const n=cells.map(norm);
   if(!header && n.some(x=>x==='展示') && n.some(x=>x.includes('一周')) && n.some(x=>x.includes('直線'))){
    const idx=(...labels)=>n.findIndex(x=>labels.some(label=>x===label||x.includes(label)));
    header={lane:idx('枠'),time:idx('展示'),lap:idx('一周'),turn:idx('まわり足','回り足'),straight:idx('直線'),tilt:idx('チルト')};
    return;
   }
   const laneIndex=n.findIndex(x=>/^[1-6]$/.test(x));
   const lane=laneIndex>=0?Number(n[laneIndex]):0;if(!(lane>=1&&lane<=6))return;
   let found=null;
   if(header && [header.time,header.lap,header.turn,header.straight].every(i=>i>=0)){
    const q=[header.time,header.lap,header.turn,header.straight].map(i=>norm(cells[i]||''));
    if(validOriginal(...q))found=q;
   }
   // ヘッダーが多段・colspanでも、公式オリジナル展示ブロック内だけで4連続値を検出。
   if(!found){
    for(let i=Math.max(0,laneIndex+1);i<=n.length-4;i++){
     const q=n.slice(i,i+4);
     if(q.every(numeric)&&validOriginal(...q)){found=q;break;}
    }
   }
   if(found){
    let tilt='';
    if(header?.tilt>=0)tilt=norm(cells[header.tilt]||'');
    else{
     const ti=n.find(x=>/^(?:-0\.5|0|\+?0\.5|\+?1\.0|\+?1\.5|\+?2\.0|\+?2\.5|\+?3\.0)$/.test(x));
     tilt=ti||'';
    }
    put(lane,{time:found[0],lap:found[1],turn:found[2],straight:found[3],tilt});
   }
  });
 });
 // レスポンシブDOMがtableを使わない場合の公式ブロック限定フォールバック。
 // 「オリジナル展示」見出し近傍の行要素だけを対象にするため、他の統計値は拾わない。
 if([...by.values()].filter(x=>x.lap&&x.turn&&x.straight).length<6){
  $('section,article,div,ul').filter((_,el)=>{const t=norm($(el).text());return t.includes('オリジナル展示')&&t.includes('一周')&&t.includes('直線')}).each((_,box)=>{
   $(box).find('tr,li,.row,[class*=row],[class*=boat]').each((_,row)=>{
    const cells=$(row).find('th,td,span,div').map((_,x)=>ascii($(x).text())).get().filter(Boolean),n=cells.map(norm);
    const laneIndex=n.findIndex(x=>/^[1-6]$/.test(x)),lane=laneIndex>=0?Number(n[laneIndex]):0;if(!(lane>=1&&lane<=6))return;
    for(let i=Math.max(0,laneIndex+1);i<=n.length-4;i++){
     const q=n.slice(i,i+4);if(q.every(numeric)&&validOriginal(...q)){put(lane,{time:q[0],lap:q[1],turn:q[2],straight:q[3]});break;}
    }
   });
  });
 }
 // PC版のレスポンシブ表示でセル構造が崩れても、公式「オリジナル展示データ」本文だけを
 // 枠→登録番号の並びで6行に切り、展示/一周/まわり足/直線の4連値を復元する。
 // 他ブロックの数値は参照しないので、別統計を展示値として誤採用しない。
 if([...by.values()].filter(x=>x.lap&&x.turn&&x.straight).length<6){
  const raw=ascii($('body').text()).replace(/％/g,'%').replace(/　/g,' ');
  const si=raw.indexOf('オリジナル展示データ'),ei=si>=0?raw.indexOf('スタート展示',si):-1;
  const sec=si>=0?raw.slice(si,ei>si?ei:undefined):'';
  const tokens=sec.split(/\s+/).map(x=>x.trim()).filter(Boolean);
  let cursor=0;
  for(let lane=1;lane<=6;lane++){
   let start=-1;
   for(let i=cursor;i<tokens.length;i++){
    if(tokens[i]!==String(lane))continue;
    const near=tokens.slice(i+1,i+5);
    if(near.some(x=>/^\d{4}$/.test(x))){start=i;break;}
   }
   if(start<0)continue;
   let end=tokens.length;
   for(let i=start+1;i<tokens.length;i++){
    if(tokens[i]===String(lane+1)&&tokens.slice(i+1,i+5).some(x=>/^\d{4}$/.test(x))){end=i;break;}
   }
   const row=tokens.slice(start,end).map(norm);
   for(let i=0;i<=row.length-4;i++){
    const q=row.slice(i,i+4);
    if(q.every(numeric)&&validOriginal(...q)){put(lane,{time:q[0],lap:q[1],turn:q[2],straight:q[3]});break;}
   }
   cursor=end;
  }
 }
 // スタート展示は別ブロック。共通BOAT RACE公式beforeinfoでもSTを補完するため、ここでは確実な行だけ採用。
 $('table,section,article,div').filter((_,el)=>/スタート展示/.test(ascii($(el).text()))).each((_,table)=>{
  $(table).find('tr,li').each((_,tr)=>{const c=$(tr).find('th,td,span').map((_,td)=>ascii($(td).text())).get().filter(Boolean);const lane=c.map(x=>Number(norm(x))).find(x=>x>=1&&x<=6),st=c.map(norm).find(stOK)||'';if(lane&&st)put(lane,{st})});
 });
 const rows=[1,2,3,4,5,6].map(l=>by.get(l)||{lane:l});
 const originalComplete=rows.filter(r=>r.time&&r.lap&&r.turn&&r.straight).length;
 return {available:rows.some(r=>r.st||r.time||r.lap||r.turn||r.straight),rows,completeTimes:rows.filter(r=>r.time).length,originalComplete,source:'BOAT RACE浜名湖公式・オリジナル展示',hasOriginalLabels:/一周/.test(body)&&/(?:まわり足|回り足)/.test(body)&&/直線/.test(body)};
}
function parseBoatcastOriginal(text,jcd){
 const lines=String(text||'').replace(/\r/g,'').split('\n');
 if(!lines.length||!lines[0].trim().startsWith('data='))return {available:false,rows:[],source:'BOATCAST公式・オリジナル展示',provider:'boatcast'};
 const meta=(lines[1]||'').split('\t'), status=clean(meta[0]||''), count=Number(clean(meta[1]||''))||0;
 if(status!=='1')return {available:false,rows:[],status,measureCount:count,source:'BOATCAST公式・オリジナル展示',provider:'boatcast'};
 const labels=(lines[2]||'').split('\t').slice(0,count||3).map(x=>clean(x).replace(/　/g,'').replace(/\s/g,''));
 const by=new Map();
 for(const raw of lines.slice(3)){
  if(!raw.trim())continue;
  const p=raw.split('\t'), lane=Number(clean(p[0]||'')); if(!(lane>=1&&lane<=6))continue;
  const vals=p.slice(2,2+labels.length).map(x=>clean(x));
  const row={lane};
  labels.forEach((lab,i)=>{
  const v=vals[i]||'';
  if(!/^\d+(?:\.\d+)?$/.test(v))return;

  if(
    lab.includes('展示タイム') ||
    lab==='展示'
  ){
    row.time=v;
  }else if(
    lab.includes('一周') ||
    lab.includes('半周ラップ')
  ){
    row.lap=v;
  }else if(
    lab.includes('まわり足') ||
    lab.includes('回り足')
  ){
    row.turn=v;
  }else if(
    lab.includes('直線')
  ){
    row.straight=v;
  }
});
  by.set(lane,row);
 }
 const rows=[1,2,3,4,5,6].map(l=>by.get(l)||{lane:l});
 const venue=String(jcd).padStart(2,'0')==='06'?'浜名湖':String(jcd).padStart(2,'0');
 return {available:rows.filter(r=>r.lap||r.turn||r.straight).length===6,rows,status,measureCount:count,measureLabels:labels,source:`BOATCAST公式・${venue}オリジナル展示`,provider:'boatcast'};
}
async function getBoatcastOriginal(jcd,hd,rno){
 const jo=String(jcd).padStart(2,'0'),rr=String(rno).padStart(2,'0');
 const url=`https://race.boatcast.jp/txt/${jo}/bc_oriten_${hd}_${jo}_${rr}.txt`;
 try{const txt=await grabUrl(url,10);return {...parseBoatcastOriginal(txt,jo),urlPattern:'race.boatcast.jp/txt/{場}/bc_oriten_{日付}_{場}_{R}.txt'};}
 catch(e){return {available:false,rows:[],source:'BOATCAST公式・オリジナル展示',provider:'boatcast',error:String(e?.message||e)}}
}
async function getOriginal(jcd,hd,rno,racers=[]){
 const a=ORIGINAL_SUPPORTED[jcd];if(!a)return {supported:false,available:false,rows:[],source:null};
 try{
  if(jcd==='01'){
   const boatcast=await getBoatcastOriginal(jcd,hd,rno);
   if(boatcast.available)return {supported:true,venue:a.name,...boatcast,lapLabel:'1周',requestedDate:hd};
   const html=await grabUrl('https://www.kiryu-kyotei.com/modules/raceinfo/?page=index_timedata',15);
   return {supported:true,venue:a.name,...parseKiryuTimedata(html,racers),requestedDate:hd};
  }
  if(jcd==='10'){
  const boatcast=await getBoatcastOriginal(jcd,hd,rno);
  return {
    supported:true,
    venue:a.name,
    ...boatcast,
    requestedDate:hd
  };
}
if(jcd==='08'){
  const url=`https://www.boatrace-tokoname.jp/sp/raceguide/kyogi19/${Number(rno)}/`;
  const html=await grabUrl(url,15);

  return {
    supported:true,
    venue:a.name,
    ...parseTokonameOriginal(html),
    requestedDate:hd
  };
}

if(jcd==='11'){
  const url=`https://www.boatrace-biwako.jp/sp/index.php?page=yosou-cyokuzen&race=${Number(rno)}`;
  const html=await grabUrl(url,15);

  return {
    supported:true,
    venue:a.name,
    ...parseBiwakoOriginal(html),
    requestedDate:hd
  };
}

if(jcd==='16'){
  const rr=String(rno).padStart(2,'0');
  const url=`https://www.kojimaboat.jp/asp/kyogi/16/sp/yoso05${rr}.htm`;
  const html=await grabUrl(url,15);

  return {
    supported:true,
    venue:a.name,
    ...parseKojimaOriginal(html),
    requestedDate:hd
  };
}

if(jcd==='18'){
  const url=`https://www.boatrace-tokuyama.jp/tenji-keisoku/m/?day=${hd}&race=${Number(rno)}`;
  const html=await grabUrl(url,15);

  return {
    supported:true,
    venue:a.name,
    ...parseTokuyamaOriginal(html),
    requestedDate:hd
  };
}
  const BOATCAST_VENUES=new Set([
  '02','03','04','05',
  '09',
  '13','14','17',
  '19','20','21','22'
]);

if(BOATCAST_VENUES.has(jcd)){
  const boatcast=await getBoatcastOriginal(jcd,hd,rno);

  return {
    supported:true,
    venue:a.name,
    ...boatcast,
    requestedDate:hd
  };
}
if(jcd==='12'){
   const url=`https://www.boatrace-suminoe.jp/asp/kyogi/12/pc/st02${String(rno).padStart(2,'0')}.htm`;
   const html=await grabUrl(url,15);
   return {supported:true,venue:a.name,...parseSuminoeOriginal(html),requestedDate:hd};
  }
  if(jcd==='15'){
   const url=`https://www.marugameboat.jp/asp/kyogi/15/pc/yoso05${String(rno).padStart(2,'0')}.htm`;
   const html=await grabUrl(url,15);
   return {supported:true,venue:a.name,...parseMarugameOriginal(html),requestedDate:hd};
  }
  // 浜名湖: PC版RACE LIVEの直前情報を優先し、同じ公式ドメインのSP/モジュール候補も並列照合。
  // 各候補は「展示・一周・まわり足・直線」が実際に存在する場合だけ採用するので、
  // URL構造変更時に別ページの数値を誤表示しない。
  if(jcd==='06'){
   // Fast path: the official BOATCAST feed is tiny and deterministic. It replaces the old
   // 9-page HTML fan-out that made Hamanako detail loading noticeably slow.
   const boatcast=await getBoatcastOriginal(jcd,hd,rno);
   if(boatcast.available)return {supported:true,venue:a.name,...boatcast,requestedDate:hd};
   // Safe fallback: keep only two official Hamanako pages. Never guess values from unrelated pages.
   const urls=[`https://www.boatrace-hamanako.jp/?kind=2&page=index_zenken`,`https://www.boatrace-hamanako.jp/sp/`];
   const settled=await Promise.allSettled(urls.map(u=>grabUrl(u,15)));
   const parsed=settled.filter(x=>x.status==='fulfilled').map(x=>parseHamanakoOriginal(x.value));
   const score=x=>(x.rows||[]).reduce((n,r)=>n+(r.lap?4:0)+(r.turn?4:0)+(r.straight?4:0)+(r.time?1:0),0);
   parsed.sort((x,y)=>score(y)-score(x));
   const best=parsed[0]||boatcast;
   return {supported:true,venue:a.name,...best,requestedDate:hd,boatcastFallback:boatcast};
  }
  // Karatsu can retain a different race/day on its live page. Always bind the requested hd,
  // and try both parameter orders; choose the parse with the richest original measurements.
  if(jcd==='23'){
   const urls=[
    `https://www.boatrace-karatsu.jp/sp/index.php?page=yosou-cyokuzen&day=${hd}&race=${rno}`,
    `https://www.boatrace-karatsu.jp/sp/index.php?page=yosou-cyokuzen&race=${rno}&day=${hd}`,
    `https://www.boatrace-karatsu.jp/sp/index.php?page=yosou-cyokuzen&race=${rno}`
   ];
   const settled=await Promise.allSettled(urls.map(u=>grabUrl(u,15)));
   const parsed=settled.filter(x=>x.status==='fulfilled').map(x=>parseKaratsuOriginal(x.value));
   const score=x=>(x.rows||[]).reduce((n,r)=>n+['st','time','lap','turn','straight'].filter(k=>r[k]).length,0);
   parsed.sort((x,y)=>score(y)-score(x));
   const best=parsed[0]||{available:false,rows:[],source:'BOATRACEからつ公式'};
   return {supported:true,venue:a.name,...best,requestedDate:hd};
  }
  const html=await grabUrl(a.url(hd,rno),15);const parsed=a.parser==='omura'?parseOmuraOriginal(html):a.parser==='hamanako'?parseHamanakoOriginal(html):parseOriginalExhibition(html);return {supported:true,venue:a.name,...parsed};
 }catch(e){return {supported:true,venue:a.name,available:false,rows:[],source:'各場公式オリジナル展示',error:String(e?.message||e)}}
}
function mergeBefore(common,original){
 if(!original?.available)return {...common,original};
 const om=new Map((original.rows||[]).map(x=>[x.lane,x]));
 const rows=[1,2,3,4,5,6].map(l=>{const a=(common?.rows||[]).find(x=>x.lane===l)||{lane:l},b=om.get(l)||{};return {...a,st:b.st||a.st,time:b.time||a.time,lap:b.lap||'',turn:b.turn||'',straight:b.straight||'',originalSource:original.source}});
 return {...common,available:rows.some(r=>r.st||r.time||r.lap||r.turn||r.straight),rows,original,completeTimes:rows.filter(r=>r.time).length,completeST:rows.filter(r=>r.st).length};
}

function parseMeetingMeta(html,hd){
 const $=cheerio.load(html), text=ascii($('body').text());
 // Match ONLY today's date in the official meeting-day navigation.
 // Example: 9月20日４日目 / 9月20日初日 / 9月20日最終日.
 const m=String(hd||'').match(/^\d{4}(\d{2})(\d{2})$/);
 if(!m)return {day:null,total:null,label:'開催中'};
 const month=Number(m[1]),dayOfMonth=Number(m[2]);
 const re=new RegExp(`${month}\\s*月\\s*${dayOfMonth}\\s*日\\s*(初日|最終日|[２-９2-9]\\s*日目)`);
 const hit=text.match(re);
 if(!hit)return {day:null,total:null,label:'開催中'};
 let label=hit[1].replace(/\s/g,'');
 if(label==='初日')return {day:1,total:null,label:'初日'};
 if(label==='最終日')return {day:null,total:null,label:'最終日'};
 const n=Number(ascii(label).match(/[2-9]/)?.[0]||0);
 return {day:n||null,total:null,label:n?`${n}日目`:'開催中'};
}
function parseSchedule(html){
 const $=cheerio.load(html), text=clean($('body').text());
 const out=[];
 // Prefer DOM blocks that contain both an R label and a clock time.
 $('a,li,td,div').each((_,el)=>{const t=clean($(el).text());const m=t.match(/(?:^|\s)(1[0-2]|[1-9])R[^0-9]{0,30}([01]?\d|2[0-3]):([0-5]\d)/);if(m){const r=Number(m[1]),tm=`${String(Number(m[2])).padStart(2,'0')}:${m[3]}`;if(!out[r-1])out[r-1]=tm}});
 // Fallback: raceindex text often exposes 1R..12R followed by deadline time.
 if(out.filter(Boolean).length<12){for(let r=1;r<=12;r++){const re=new RegExp(`(?:^|\\s)${r}R[\\s\\S]{0,120}?([01]?\\d|2[0-3]):([0-5]\\d)`);const m=text.match(re);if(m&&!out[r-1])out[r-1]=`${String(Number(m[1])).padStart(2,'0')}:${m[2]}`}}
 return out.length>=12&&out.slice(0,12).every(Boolean)?out.slice(0,12):[];
}

function combos(){const a=[];for(let f=1;f<=6;f++)for(let s=1;s<=6;s++)if(s!==f)for(let t=1;t<=6;t++)if(t!==f&&t!==s)a.push(`${f}-${s}-${t}`);return a}
function parseOdds(html){const $=cheerio.load(html);let matrix=[];
 // Official odds table uses td.oddsPoint: 20 rows x 6 first-place columns.
 $('table').each((_,table)=>{const rows=[];$(table).find('tbody tr').each((_,tr)=>{const cells=$(tr).find('td.oddsPoint').map((_,td)=>clean($(td).text())).get();if(cells.length===6)rows.push(cells)});if(rows.length>=20&&matrix.length<20)matrix=rows.slice(0,20)});
 if(matrix.length===20){const flat=[];for(let col=0;col<6;col++)for(let row=0;row<20;row++)flat.push(matrix[row][col]);const keys=combos();return keys.map((combo,i)=>({combo,odds:flat[i]})).filter(x=>/^\d+(?:\.\d+)?$/.test(x.odds)).slice(0,120)}
 // fallback for markup changes
 // Never guess combination order if the 20x6 official matrix cannot be reconstructed.
 // Returning no odds is safer than displaying a valid number beside the wrong trifecta.
 return []}
function parseKaratsuCourse(html,racers=[]){
 const $=cheerio.load(html),rows=[];
 // Karatsu official table: each racer is a 6-row block (courses 1..6).
 // The first row contains frame + racer name + course; following rows start with course only.
 // Select the row matching the racer's current frame/course and read fixed columns.
 const trs=[];
 $('table tr').each((_,tr)=>{const c=$(tr).children('th,td').map((_,td)=>ascii($(td).text())).get().filter(Boolean);if(c.length>=8)trs.push(c)});
 let blocks=[];
 for(let i=0;i<trs.length;i++){
  const c=trs[i];
  if(/^[1-6]$/.test(c[0]) && c.length>=10 && !/^[1-6]$/.test(c[1])){
   const frame=Number(c[0]), name=clean(c[1]).replace(/\s/g,''), block=[c];
   for(let j=i+1;j<trs.length && block.length<6;j++){
    const n=trs[j]; if(/^[1-6]$/.test(n[0]) && n.length>=10 && !/^[1-6]$/.test(n[1]))break;
    if(/^[1-6]$/.test(n[0]))block.push(n);
   }
   blocks.push({frame,name,block});
  }
 }
 for(let lane=1;lane<=6;lane++){
  const racer=racers[lane-1], key=clean(racer?.name||'').replace(/\s/g,'');
  let g=blocks.find(x=>x.frame===lane && (!key || x.name.includes(key) || key.includes(x.name))) || blocks.find(x=>x.frame===lane);
  if(!g)continue;
  let c=g.block.find((r,idx)=>Number(idx===0?r[2]:r[0])===lane) || g.block[lane-1];
  if(!c)continue;
  const off=(c===g.block[0]?2:0), course=Number(c[off]), entry=Number(String(c[off+1]).replace('%','')), avg=Number(c[off+2]), w1=Number(String(c[off+3]).replace('%','')), w2=Number(String(c[off+4]).replace('%','')), w3=Number(String(c[off+5]).replace('%',''));
  rows.push({lane,course:Number.isFinite(course)?course:lane,entryRate:Number.isFinite(entry)?entry:null,avgST:Number.isFinite(avg)?avg:null,win1:Number.isFinite(w1)?w1:null,win2:Number.isFinite(w2)?w2:null,win3:Number.isFinite(w3)?w3:null});
 }
 const body=ascii($('body').text()),pm=body.match(/集計期間[:：]?\s*([0-9]{4}年\s*[0-9]{1,2}月)\s*[～〜~-]\s*([0-9]{4}年\s*[0-9]{1,2}月)/);
 return {available:rows.length===6,rows,period:pm?`${pm[1]}〜${pm[2]}`:'直近1年',source:'BOATRACEからつ公式'};
}


function parseHamanakoVenueCourse(html){
 const $=cheerio.load(html),clean2=s=>ascii(String(s||'')).replace(/％/g,'%').replace(/\s+/g,' ').trim(),rows=[];
 // 公式「最近3ヶ月のコース別入着率＆決まり手」。同一行の6入着率と6決まり手を固定対応。
 $('table').each((_,table)=>{
  const txt=clean2($(table).text());if(!txt.includes('1着')||!txt.includes('6着')||!txt.includes('コース'))return;
  $(table).find('tr').each((_,tr)=>{
   const cells=$(tr).children('th,td').map((__,td)=>clean2($(td).text())).get().filter(Boolean);
   const ci=cells.findIndex(x=>/^[1-6]\s*コース$/.test(x));if(ci<0)return;
   const course=Number(cells[ci].match(/[1-6]/)?.[0]);if(!course||rows.some(r=>r.course===course))return;
   const nums=[];for(const cell of cells.slice(ci+1)){for(const m of cell.matchAll(/([0-9]{1,3}(?:\.[0-9]+)?)/g))nums.push(Number(m[1]));}
   if(nums.length<6)return;const p=nums.slice(0,6),methods=nums.length>=12?nums.slice(6,12):[];
   rows.push({lane:course,course,win1:p[0],win2:p[1],win3:p[2],win4:p[3],win5:p[4],win6:p[5],threeRate:+(p[0]+p[1]+p[2]).toFixed(1),avgST:null,avgSTRank:null,finishRates:p,methods:methods.length===6?{escape:methods[0],makuri:methods[1],sashi:methods[2],makurisashi:methods[3],nuki:methods[4],megumare:methods[5]}:null});
  });
 });
 // PC/SPどちらでもテーブルが分割される場合に備え、入着率部分の本文から6コースを復元。
 if(rows.length!==6){
  rows.length=0;const body=clean2($('body').text()),start=body.indexOf('最近3ヶ月のコース別入着率'),end=start>=0?body.indexOf('最近3ヶ月の枠番別コース取得率',start):-1,sec=start>=0?body.slice(start,end>start?end:undefined):'';
  for(let c=1;c<=6;c++){
   const re=new RegExp(`${c}\\s*コース\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)`),m=sec.match(re);if(!m)continue;
   const p=m.slice(1,7).map(Number);if(p.every(Number.isFinite))rows.push({lane:c,course:c,win1:p[0],win2:p[1],win3:p[2],win4:p[3],win5:p[4],win6:p[5],threeRate:+(p[0]+p[1]+p[2]).toFixed(1),avgST:null,avgSTRank:null,finishRates:p,methods:null});
  }
 }
 rows.sort((a,b)=>a.course-b.course);
 const body=clean2($('body').text()),pm=body.match(/集計期間[:：]?\s*([0-9]{4}\/\d{2}\/\d{2})\s*[～〜~-]\s*([0-9]{4}\/\d{2}\/\d{2})/);
 return {available:rows.length===6,rows,period:pm?`${pm[1]}〜${pm[2]}`:'浜名湖公式・最近3ヶ月',source:'BOAT RACE浜名湖公式・水面特性/進入コース別情報',parser:'hamanako-venue-course-v1',count:rows.length};
}

function parseOmuraVenueCourse(html){
 const $=cheerio.load(html), clean2=s=>ascii(String(s||'')).replace(/％/g,'%').replace(/\s+/g,' ').trim(), rows=[];
 // 大村公式「コース別入着情報」。同じ行の [コース,1着,2着,3着,4着,5着,6着] を固定対応。
 $('table tr').each((_,tr)=>{
  const cells=$(tr).children('th,td').map((__,td)=>clean2($(td).text())).get().filter(Boolean);
  const ci=cells.findIndex(x=>/^[1-6](?:コース)?$/.test(x)); if(ci<0)return;
  const course=Number(cells[ci].match(/[1-6]/)?.[0]); if(!course||rows.some(r=>r.course===course))return;
  const vals=[];
  for(const c of cells.slice(ci+1)){
   const m=c.match(/^([0-9]{1,3}(?:\.[0-9]+)?)\s*%?$/); if(m)vals.push(Number(m[1]));
  }
  if(vals.length>=6){const p=vals.slice(0,6);rows.push({lane:course,course,win1:p[0],win2:p[1],win3:p[2],win4:p[3],win5:p[4],win6:p[5],threeRate:+(p[0]+p[1]+p[2]).toFixed(1),avgST:null,avgSTRank:null});}
 });
 // Text fallback: official markup can flatten cells and omit percent symbols.
 if(rows.length!==6){
  rows.length=0; const text=clean2($('body').text());
  for(let c=1;c<=6;c++){
   const re=new RegExp(`(?:^|\\s)${c}(?:コース)?\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)(?:\\s|$)`),m=text.match(re); if(!m)continue;
   const p=m.slice(1,7).map(Number); if(p.every(Number.isFinite))rows.push({lane:c,course:c,win1:p[0],win2:p[1],win3:p[2],win4:p[3],win5:p[4],win6:p[5],threeRate:+(p[0]+p[1]+p[2]).toFixed(1),avgST:null,avgSTRank:null});
  }
 }
 rows.sort((a,b)=>a.course-b.course);
 const body=clean2($('body').text());
 const pm=body.match(/集計期間[:：]?\s*([0-9]{4}年\s*[0-9]{1,2}月\s*[0-9]{1,2}日)\s*[～〜~-]\s*([0-9]{4}年\s*[0-9]{1,2}月\s*[0-9]{1,2}日)/);
 return {available:rows.length===6,rows,period:pm?`${pm[1]}〜${pm[2]}`:'大村公式掲載期間',source:'BOAT RACE大村公式・コース別入着情報',parser:'omura-venue-course-v2-row-lock',count:rows.length};
}

function parseOmuraCourse(html){
 const $=cheerio.load(html), rows=[];
 const clean2=s=>ascii(String(s||'')).replace(/％/g,'%').replace(/\s+/g,' ').trim();
 const add=(lane,vals)=>{
  if(rows.some(x=>x.lane===lane)||vals.length<7)return;
  const v=vals.slice(-7).map(Number),[win1,win2,win3,other,threeRate,avgST,avgSTRank]=v;
  if(!v.every(Number.isFinite))return;
  rows.push({lane,course:lane,win1,win2,win3,other,threeRate,avgST,avgSTRank});
 };
 // Official PC page: heading and data table are separate. Start from the heading,
 // then read the first following table whose rows begin with frame 1..6.
 const head=$('*').filter((_,el)=>clean2($(el).clone().children().remove().end().text())==='全国コース別成績').first();
 const candidates=[];
 if(head.length){
  const root=head.closest('section,article,div');
  root.find('table').each((_,t)=>candidates.push(t));
  head.nextAll('table').each((_,t)=>candidates.push(t));
  head.parent().nextAll().find('table').each((_,t)=>candidates.push(t));
 }
 $('table').each((_,t)=>{const x=clean2($(t).text());if(/3連率|三連率/.test(x)&&/平均ST|平均ＳＴ/.test(x))candidates.push(t)});
 for(const table of [...new Set(candidates)]){
  $(table).find('tr').each((_,tr)=>{
   const cells=$(tr).children('th,td').map((__,td)=>clean2($(td).text())).get();
   const li=cells.findIndex(x=>/^[1-6]$/.test(x)); if(li<0)return;
   const lane=Number(cells[li]);
   // PC official row is: frame, racer, four rates, 3-rate, avgST, avgST-rank.
   // Strip frame and collect numeric cells; using the final seven avoids racer-name/layout cells.
   const vals=[];
   for(const c of cells.slice(li+1)) for(const m of (c.match(/\d+(?:\.\d+)?/g)||[])) vals.push(Number(m));
   add(lane,vals);
  });
  if(rows.length===6)break;
 }
 // Structure-independent fallback: isolate only the official course section and split by frame rows.
 if(rows.length!==6){
  rows.length=0;
  const body=clean2($('body').text()), st=body.indexOf('全国コース別成績'), en=st>=0?body.indexOf('枠番別過去10走データ',st):-1;
  const sec=st>=0?body.slice(st,en>st?en:undefined):'';
  for(let lane=1;lane<=6;lane++){
   const startRe=new RegExp(`(?:^|\\s)${lane}\\s+`), sm=startRe.exec(sec); if(!sm)continue;
   const from=sm.index+sm[0].length;
   let to=sec.length;
   if(lane<6){const nm=new RegExp(`\\s${lane+1}\\s+`).exec(sec.slice(from));if(nm)to=from+nm.index;}
   const chunk=sec.slice(from,to);
   const pct=[...chunk.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)].map(m=>Number(m[1]));
   const dec=[...chunk.matchAll(/(?:^|\s)(0?\.\d{1,2}|[0-6]\.\d{1,2})(?=\s|$)/g)].map(m=>Number(m[1]));
   // First four integer rates precede 3-rate; then avgST and avgST rank.
   const beforePct=(pct.length?chunk.slice(0,chunk.indexOf(String(pct[0])+'%')):chunk);
   const ints=(beforePct.match(/(?:^|\s)(\d{1,3})(?=\s|$)/g)||[]).map(x=>Number(x.trim())).filter(n=>n>=0&&n<=100);
   if(ints.length>=4&&pct.length&&dec.length>=2)add(lane,[...ints.slice(-4),pct[0],dec[0],dec[1]]);
  }
 }
 rows.sort((a,b)=>a.lane-b.lane);
 const body=clean2($('body').text());
 const pm=body.match(/上記の値は\s*(\d{4}年\s*\d{1,2}月\s*\d{1,2}日?)\s*[～〜~-]\s*(\d{4}年\s*\d{1,2}月\s*\d{1,2}日?)/);
 return {available:rows.length===6,rows,period:pm?`${pm[1]}〜${pm[2]}`:'公式集計期間',source:'BOATRACE大村公式・全国コース別成績',parser:'omura-course-v7-heading-table',count:rows.length};
}

function parseResult(html){
 const $=cheerio.load(html), body=ascii($('body').text());
 const finish=[];
 $('table tr').each((_,tr)=>{const c=$(tr).find('th,td').map((_,td)=>ascii($(td).text())).get().filter(Boolean);if(c.length>=2&&/^[1-6]$/.test(c[0])&&/^[1-6]$/.test(c[1]))finish.push({place:Number(c[0]),lane:Number(c[1])})});
 const tri=body.match(/3連単\s*([1-6])\s*[-－]\s*([1-6])\s*[-－]\s*([1-6])\s*[¥￥]?\s*([0-9,]+)\s*円?/);
 return {available:!!tri||finish.length>=3,finish:finish.slice(0,6),trifecta:tri?`${tri[1]}-${tri[2]}-${tri[3]}`:null,payout:tri?Number(tri[4].replace(/,/g,'')):null};
}
function parseRacerSearch(html){
 const $=cheerio.load(html),out=[];
 $('body').find('*').each((_,el)=>{
  const t=clean($(el).text());
  const m=t.match(/(?:^|\s)(\d{4})\s+([^\d]{2,20}?)\s+級別[:：]\s*(A1|A2|B1|B2)/);
  if(m&&!out.some(x=>x.reg===m[1]))out.push({reg:m[1],name:clean(m[2]),grade:m[3]});
 });
 if(!out.length){
  const body=clean($('body').text()),re=/(\d{4})\s+([一-龠々ヶぁ-んァ-ヶー\s]{2,20}?)\s+級別[:：]\s*(A1|A2|B1|B2)/g;let m;
  while((m=re.exec(body))&&out.length<30)if(!out.some(x=>x.reg===m[1]))out.push({reg:m[1],name:clean(m[2]),grade:m[3]});
 }
 return out.slice(0,30)
}
function parseRacerProfile(html){
 const $=cheerio.load(html),body=clean($('body').text());
 const name=(body.match(/^(.{2,30}?)（過去[３3]節成績/)||[])[1]||'';
 const reg=(body.match(/登録番号\s*(\d{4})/)||[])[1]||'';
 const grade=(body.match(/級別\s*(A1|A2|B1|B2)級?/)||[])[1]||'';
 const branch=(body.match(/支部\s*([^\s]{1,8})/)||[])[1]||'';
 const venueNames=['桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','びわこ','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村'];
 const fw=v=>String(v||'').replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
 const norm=v=>fw(clean(v)).replace(/[\s　]+/g,' ').trim();
 const isResult=t=>/^(?:[1-6]|\[[1-6]\]|F|L|S|転|妨|欠|失)$/.test(norm(t));
 const classifyGrade=(meta,title)=>{
   const m=norm(meta).toUpperCase();
   if(/PG1|PGI|PREMIER.?G1|PREMIUM.?G1/.test(m))return 'PG1';
   if(/(?:^|[^A-Z])SG(?:[^A-Z]|$)|GRADE[_-]?SG|ICON[_-]?SG|GRADE=SG/.test(m))return 'SG';
   if(/(?:^|[^A-Z])G1(?:[^0-9]|$)|GRADE[_-]?G1|ICON[_-]?G1|GRADE=G1/.test(m))return 'G1';
   if(/(?:^|[^A-Z])G2(?:[^0-9]|$)|GRADE[_-]?G2|ICON[_-]?G2|GRADE=G2/.test(m))return 'G2';
   if(/(?:^|[^A-Z])G3(?:[^0-9]|$)|GRADE[_-]?G3|ICON[_-]?G3|GRADE=G3/.test(m))return 'G3';
   if(/一般|IPPAN|GENERAL/.test(m))return '一般';
   if(/オーシャンカップ|グランドチャンピオン|ボートレースクラシック|ボートレースオールスター|ボートレースメモリアル|ボートレースダービー|チャレンジカップ|グランプリ/.test(title))return 'SG';
   if(/モーターボート大賞/.test(title))return 'G2';
   return '未取得';
 };
 // Restrict parsing to the DOM range between the official "過去3節成績" heading and "直近の優勝情報".
 // This prevents current/upcoming series or recent-win tables from being paired with back3 results.
 const all=$('body *').toArray();
 const hStart=all.findIndex(el=>/過去[３3]節成績/.test(norm($(el).clone().children().remove().end().text())));
 const hEnd=all.findIndex((el,i)=>i>hStart&&/直近の優勝情報/.test(norm($(el).clone().children().remove().end().text())));
 const candidates=[];
 $('tr').each((_,tr)=>{
   const idx=all.indexOf(tr); if(hStart>=0&&idx>=0&&(idx<hStart||(hEnd>=0&&idx>hEnd)))return;
   const $tr=$(tr), joined=norm($tr.text());
   const dates=[...joined.matchAll(/20\d{2}\/\d{2}\/\d{2}/g)].map(m=>m[0]);
   if(dates.length<2)return;
   const anchors=$tr.find('a').toArray().map(a=>({text:norm($(a).text()),href:$(a).attr('href')||'',meta:norm(`${$(a).attr('class')||''} ${$(a).attr('title')||''}`)}));
   const results=anchors.map(x=>x.text).filter(isResult);
   if(results.length<2)return;
   const imgMeta=$tr.find('img').map((_,im)=>norm(`${$(im).attr('alt')||''} ${$(im).attr('title')||''} ${$(im).attr('src')||''} ${$(im).attr('class')||''}`)).get().join(' ');
   let venue=venueNames.find(v=>imgMeta.includes(v))||venueNames.find(v=>joined.includes(v))||'';
   if(!venue){const hm=anchors.map(x=>x.href).join(' ').match(/[?&](?:jcd|jyo|place)=(\d{1,2})/i);if(hm){const n=Number(hm[1]);venue=venueNames[n-1]||''}}
   const titleAnchor=anchors.find(x=>x.text&&!isResult(x.text)&&!venueNames.includes(x.text)&&!/^20\d{2}\//.test(x.text));
   const title=titleAnchor?.text||'';
   const rowMeta=norm(`${imgMeta} ${anchors.map(x=>`${x.meta} ${x.href}`).join(' ')}`);
   candidates.push({period:`${dates[0]}〜${dates[1]}`,venue,grade:classifyGrade(rowMeta,title),title,results:results.join(' ')});
 });
 // If DOM range indexing differs on upstream HTML, use only rows whose dates occur after the exact heading
 // and before recent-win heading in serialized HTML. Still never mix independent fields across rows.
 let rows=candidates.slice(0,3);
 const ds=rows.map(x=>Date.parse(x.period.split('〜')[0].replaceAll('/','-')));
 const sane=rows.length===3&&rows.every(x=>x.venue&&x.period&&x.results)&&ds.every(Number.isFinite)&&ds[0]>ds[1]&&ds[1]>ds[2];
 return {reg,name:clean(name),grade,branch,recentSeries:sane?rows:[],back3Verified:sane,back3Source:'BOAT RACE公式 過去3節成績'};
}

function parseOfficialRacerCourse(html){
 const $=cheerio.load(html), body=ascii($('body').text()).replace(/\s+/g,' ').trim();
 const section=(a,b)=>{const i=body.indexOf(a);if(i<0)return '';const j=b?body.indexOf(b,i+a.length):-1;return body.slice(i+a.length,j>i?j:undefined)};
 const readSix=(txt,percent=false)=>{const out={};for(let n=1;n<=6;n++){const re=new RegExp(`(?:^|\\s)${n}\\s*[|｜]?\\s*([0-9]+(?:\\.[0-9]+)?)${percent?'%?':''}(?=\\s|$)`);const m=txt.match(re);if(m)out[n]=Number(m[1])}return out};
 const entry=readSix(section('コース別進入率','コース別3連対率'),true);
 const three=readSix(section('コース別3連対率','コース別平均スタートタイミング'),true);
 const st=readSix(section('コース別平均スタートタイミング','コース別スタート順'));
 const rank=readSix(section('コース別スタート順','集計期間内'));
 const rows=[1,2,3,4,5,6].map(course=>({course,entryRate:entry[course]??null,threeRate:three[course]??null,avgST:st[course]??null,avgSTRank:rank[course]??null}));
 return {period:'BOAT RACE公式 コース別成績',rows,available:rows.filter(r=>r.threeRate!=null||r.avgST!=null).length>=4,source:'BOAT RACE公式'}
}
function parseOfficialSeason(html){
 const $=cheerio.load(html),body=ascii($('body').text()).replace(/\s+/g,' ').trim();
 const period=(body.match(/集計期間[:：]?\s*(\d{4}\/\d{2}\/\d{2})\s*[-~〜]\s*(\d{4}\/\d{2}\/\d{2})/)||[]);
 const num=(label,suffix='')=>{const m=body.match(new RegExp(label+'\\s*([0-9]+(?:\\.[0-9]+)?)'+suffix));return m?Number(m[1]):null};
 return {period:period[1]?`${period[1]}〜${period[2]}`:'公式期別',winRate:num('勝率'),twoRate:num('2連対率','%?'),threeRate:num('3連対率','%?'),starts:num('出走回数'),avgST:num('平均スタートタイミング'),available:/集計期間/.test(body),source:'BOAT RACE公式'}
}

export async function GET(req){
 const q=new URL(req.url).searchParams,hd=q.get('hd'),jcd=q.get('jcd'),rno=q.get('rno'),kind=q.get('kind')||'core';
 if(kind==='racersearch'){
  const term=clean(q.get('q')||''); if(!term)return Response.json({ok:true,rows:[]});
  try{const isReg=/^\d{4}$/.test(term),url=isReg?`https://www.boatrace.jp/owpc/pc/data/racersearch/result?prevpgid=TDAT320&toban_left=${term}`:`https://www.boatrace.jp/owpc/pc/data/racersearch/result?prevpgid=TDAT320&name=${encodeURIComponent(term)}`;const html=await grabUrl(url,300);return Response.json({ok:true,rows:parseRacerSearch(html)})}catch{return Response.json({ok:false,rows:[]})}
 }
 if(kind==='racerprofile'){
  const reg=q.get('reg')||'';if(!/^\d{4}$/.test(reg))return Response.json({ok:false},{status:400});
  try{const html=await fetch(`https://www.boatrace.jp/owpc/pc/data/racersearch/back3?toban=${reg}&_=${Date.now()}`,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36','Accept-Language':'ja-JP,ja;q=0.9'}}).then(r=>{if(!r.ok)throw new Error(`back3:${r.status}`);return r.text()});return Response.json({ok:true,profile:parseRacerProfile(html)},{headers:{'Cache-Control':'no-store, max-age=0'}})}catch{return Response.json({ok:false})}
 }
 if(kind==='raceranalyticsbatch'){
  const regs=(q.get('regs')||'').split(',').map(x=>x.trim()).filter(x=>/^\d{4}$/.test(x)).slice(0,6);
  if(!regs.length)return Response.json({ok:true,items:{}});
  const pairs=await Promise.all(regs.map(async reg=>{
   try{const [cr,sr]=await Promise.allSettled([grabUrl(`https://www.boatrace.jp/owpc/pc/data/racersearch/course?toban=${reg}`,21600),grabUrl(`https://www.boatrace.jp/owpc/pc/data/racersearch/season?toban=${reg}`,21600)]);const course=cr.status==='fulfilled'?parseOfficialRacerCourse(cr.value):{available:false,rows:[]};const season=sr.status==='fulfilled'?parseOfficialSeason(sr.value):{available:false};return [reg,{ok:course.available||season.available,reg,course,season,updatedAt:new Date().toISOString()}]}catch{return [reg,{ok:false,reg}]}
  }));
  return Response.json({ok:true,items:Object.fromEntries(pairs)},{headers:{'Cache-Control':'public, s-maxage=21600, stale-while-revalidate=86400'}})
 }
 if(kind==='raceranalytics'){
  const reg=q.get('reg')||'';if(!/^\d{4}$/.test(reg))return Response.json({ok:false},{status:400});
  try{const [cr,sr]=await Promise.allSettled([grabUrl(`https://www.boatrace.jp/owpc/pc/data/racersearch/course?toban=${reg}`,21600),grabUrl(`https://www.boatrace.jp/owpc/pc/data/racersearch/season?toban=${reg}`,21600)]);const course=cr.status==='fulfilled'?parseOfficialRacerCourse(cr.value):{available:false,rows:[]};const season=sr.status==='fulfilled'?parseOfficialSeason(sr.value):{available:false};return Response.json({ok:course.available||season.available,reg,course,season,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=21600, stale-while-revalidate=86400'}})}catch{return Response.json({ok:false})}
 }
 if(!/^\d{8}$/.test(hd||'')||!/^\d{2}$/.test(jcd||'')||!/^(?:[1-9]|1[0-2])$/.test(rno||''))return Response.json({ok:false},{status:400});
 try{
  if(kind==='schedule'){
   const html=await grab(`raceindex?hd=${hd}&jcd=${jcd}`,60),times=parseSchedule(html);
   const meeting=parseMeetingMeta(html,hd);
   return Response.json({ok:times.length===12,times,meeting,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=60, stale-while-revalidate=300'}})
  }
  if(kind==='course'){
   if(jcd==='06'){
    const ch=await grabUrl(`https://www.boatrace-hamanako.jp/modules/datafile/?page=index_suimen`,900);
    const course=parseHamanakoVenueCourse(ch);
    return Response.json({ok:true,course,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=900, stale-while-revalidate=3600'}})
   }
   if(jcd==='23'){
    const rh=await grab(`racelist?hd=${hd}&jcd=${jcd}&rno=${rno}`,60);
    const racers=parseRace(rh).racers;
    const courseUrls=[
     `https://www.boatrace-karatsu.jp/modules/raceinfo/?page=index_racecourse&day=${hd}&race=${rno}`,
     `https://www.boatrace-karatsu.jp/modules/raceinfo/?page=index_racecourse&race=${rno}&day=${hd}`,
     `https://www.boatrace-karatsu.jp/modules/raceinfo/?page=index_racecourse&race=${rno}`
    ];
    const cs=await Promise.allSettled(courseUrls.map(u=>grabUrl(u,300)));
    const candidates=cs.filter(x=>x.status==='fulfilled').map(x=>parseKaratsuCourse(x.value,racers));
    candidates.sort((a,b)=>(b.rows?.length||0)-(a.rows?.length||0));
    const course=candidates[0]||{available:false,rows:[],period:'直近1年',source:'BOATRACEからつ公式'};
    return Response.json({ok:true,course,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=1800'}})
   }
   if(jcd==='24'){
    const ch=await grabUrl(`https://omurakyotei.jp/rank/course.php`,300);
    const course=parseOmuraVenueCourse(ch);
    return Response.json({ok:true,course,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=120, stale-while-revalidate=900'}})
   }
   return Response.json({ok:true,course:{available:false,rows:[],source:null}});
  }
  // v5.52 FAST2: split first paint from slower exhibition/original venue scraping.
  if(kind==='base'){
   const html=await grab(`racelist?hd=${hd}&jcd=${jcd}&rno=${rno}`,45),race=parseRace(html);
   return Response.json({ok:race.racers.length===6,source:'BOAT RACE公式',updatedAt:new Date().toISOString(),race},{headers:{'Cache-Control':'public, s-maxage=45, stale-while-revalidate=180'}})
  }
  if(kind==='before'){
   const [bb,oo]=await Promise.allSettled([grab(`beforeinfo?hd=${hd}&jcd=${jcd}&rno=${rno}`,20),getOriginal(jcd,hd,rno)]);
   const commonBefore=bb.status==='fulfilled'?parseBefore(bb.value):{available:false,rows:[],weather:{}},original=oo.status==='fulfilled'?oo.value:{supported:false,available:false,rows:[]},before=mergeBefore(commonBefore,original);
   return Response.json({ok:true,updatedAt:new Date().toISOString(),before},{headers:{'Cache-Control':'public, s-maxage=15, stale-while-revalidate=120'}})
  }
  if(kind==='result'){
   const html=await grab(`raceresult?hd=${hd}&jcd=${jcd}&rno=${rno}`,20),result=parseResult(html);
   return Response.json({ok:true,result,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=20, stale-while-revalidate=120'}})
  }
  if(kind==='odds'){
   const html=await grab(`odds3t?hd=${hd}&jcd=${jcd}&rno=${rno}`,15),odds=parseOdds(html);
   return Response.json({ok:true,updatedAt:new Date().toISOString(),odds,count:odds.length},{headers:{'Cache-Control':'public, s-maxage=15, stale-while-revalidate=120'}})
  }
  if(kind==='series'){
   const raceHtml=await grab(`racelist?hd=${hd}&jcd=${jcd}&rno=${rno}`,60);
   const racers=parseRace(raceHtml).racers;
   // Omura publishes current-series results explicitly as finish + entry course + ST.
   // Use the venue official page first so the three values stay paired correctly.
   if(jcd==='24'){
    try{
     const oh=await grabUrl(`https://omurakyotei.jp/yosou/sp/syussou/?day=${hd}&race=${String(rno).padStart(2,'0')}`,60);
     const os=parseOmuraSeries(oh,racers);
     if(os.count)return Response.json({ok:true,series:os,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=60, stale-while-revalidate=300'}});
    }catch(e){}
   }
   const series=parseSeries(raceHtml,racers);
   return Response.json({ok:true,series,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=60, stale-while-revalidate=300'}})
  }
  // First paint: start official/original exhibition scraping immediately instead of
  // waiting for racelist parsing first. Kiryu still needs racer names, so it keeps the
  // dependency; every other venue can overlap the network waits.
  const originalTask=jcd==='01'?null:getOriginal(jcd,hd,rno);
  const [rr,bb]=await Promise.allSettled([grab(`racelist?hd=${hd}&jcd=${jcd}&rno=${rno}`,45),grab(`beforeinfo?hd=${hd}&jcd=${jcd}&rno=${rno}`,20)]);
  if(rr.status!=='fulfilled')return Response.json({ok:false,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=15, stale-while-revalidate=120'}});
  const race=parseRace(rr.value);
  const oo=await Promise.allSettled([originalTask||getOriginal(jcd,hd,rno,race.racers)]);
  const commonBefore=bb.status==='fulfilled'?parseBefore(bb.value):{available:false,rows:[],weather:{}},original=oo[0]?.status==='fulfilled'?oo[0].value:{supported:false,available:false,rows:[]},before=mergeBefore(commonBefore,original);
  return Response.json({ok:race.racers.length===6,source:'BOAT RACE公式',updatedAt:new Date().toISOString(),race,before},{headers:{'Cache-Control':'public, s-maxage=15, stale-while-revalidate=120'}})
 }catch(e){return Response.json({ok:false,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, s-maxage=15, stale-while-revalidate=120'}})}
}
