import {request} from 'node:https';

// Explicit IPv4/HTTP1 transport for the official host. Preserve TLS verification,
// reject HTTP errors and never substitute another host or inferred data.
export function officialText(url,headers){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.hostname!=='www.boatrace.jp')throw new Error('official-host-mismatch');
 return new Promise((resolve,reject)=>{
  let completed=false,size=0,phase='dns';
  const finish=(error,value)=>{if(completed)return;completed=true;clearTimeout(timer);error?reject(error):resolve(value)};
  const req=request(parsed,{family:4,headers},res=>{
   phase='body';
   if(res.statusCode!==200){res.resume();finish(new Error(`official-http:${res.statusCode}`));return}
   const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)req.destroy(new Error('official-body-limit'));else chunks.push(chunk)});
   res.on('end',()=>finish(null,Buffer.concat(chunks).toString('utf8')));
   res.on('error',error=>finish(error));
  });
  req.on('socket',socket=>{socket.on('lookup',()=>{phase='connect'});socket.on('connect',()=>{phase='tls'});socket.on('secureConnect',()=>{phase='headers'})});
  const timer=setTimeout(()=>req.destroy(new Error(`timeout:${phase}`)),15000);
  req.on('error',error=>finish(new Error(`official-http:${error.code||error.message}`)));
  req.end();
 });
}
