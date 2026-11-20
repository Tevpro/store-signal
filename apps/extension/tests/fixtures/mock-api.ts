import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fixtures from '../../../../tests/fixtures/check-responses.json' with { type: 'json' };
/** Loopback-only permission probe; not a provider or safety-verdict simulator. */
export async function startSyntheticApi(): Promise<{endpoint:string;received:string[];close():Promise<void>}> {
  const received:string[]=[];
  const server=createServer(async(req,res)=>{
    if(req.method!=='POST' || req.url!=='/v1/checks'){res.writeHead(404).end();return;}
    try {
      let body='';
      for await(const chunk of req){body+=String(chunk);if(body.length>4096) throw new Error('large request');}
      const parsed:unknown=JSON.parse(body);
      if(typeof parsed!=='object' || parsed===null || !('origin' in parsed) || typeof parsed.origin!=='string' || Object.keys(parsed).length!==1) throw new Error('origin required');
      received.push(parsed.origin);
      res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify(fixtures.unsupported));
    } catch {res.writeHead(400).end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {endpoint:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`,received,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
