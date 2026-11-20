import assert from 'node:assert/strict';
import { test } from 'node:test';

test('denied optional API host permission never reads tab or makes a request', async () => {
  let tabReads=0;
  let requests=0;
  let click:(()=>void)|undefined;
  const mode={value:'self',addEventListener:()=>{}};
  const endpoint={value:'http://localhost:8787/v1/'};
  const button={disabled:false,addEventListener:(_event:string,handler:()=>void)=>{click=handler;}};
  const result={textContent:'',innerHTML:''};
  const elements:Record<string,unknown>={'#mode':mode,'#endpoint':endpoint,'#check':button,'#result':result};
  Object.assign(globalThis,{
    document:{querySelector:(selector:string)=>elements[selector]},
    chrome:{storage:{local:{get:async()=>({mode:'self',selfEndpoint:endpoint.value}),set:async()=>{}}},permissions:{request:async()=>false},tabs:{query:async()=>{tabReads++;return [{url:'https://example.com'}];}}},
    fetch:async()=>{requests++;throw new Error('unexpected network');},
  });
  await import('../src/popup.js');
  assert.ok(click);
  click();
  for(let i=0;i<10 && button.disabled;i++) await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(tabReads,0);
  assert.equal(requests,0);
  assert.match(result.innerHTML,/API access not granted/);
});
