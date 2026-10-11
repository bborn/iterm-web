import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { ItermApi, Request, Response, tabSessions } from "../server/iterm-api";
import { LiveSessions } from "../server/live";

// A stand-in for iTerm's API socket that answers a few requests.
async function fakeIterm(screenLines:{text:string;continuation?:number}[]) {
  const dir=await mkdtemp(join(tmpdir(),"iterm-api-"));
  const path=join(dir,"socket");
  const http=createServer();
  const wss=new WebSocketServer({server:http});
  const sent:string[]=[];const headers:Record<string,unknown>[]=[];
  let subscriber:((session:string)=>void)|undefined;
  wss.on("connection",(ws,req)=>{
    headers.push(req.headers);
    subscriber=session=>ws.send(Response.encode(Response.fromObject({notification:{screenUpdate:{session}}})).finish());
    ws.on("message",data=>{
      const m=Request.toObject(Request.decode(data as Buffer),{longs:Number}) as Record<string,any>;
      const reply=(body:object)=>ws.send(Response.encode(Response.fromObject({id:m.id,...body})).finish());
      if(m.listSessions)reply({listSessions:{windows:[{windowId:"w1",selectedTabId:"t1",tabs:[{tabId:"t1",activeSessionId:"a",tabGroupId:"g",tabGroupName:"work",tabGroupColor:"#ff8000",root:{links:[{session:{uniqueIdentifier:"a"}},{node:{links:[{session:{uniqueIdentifier:"b"}}]}}]}}]}]}});
      else if(m.variable)reply({variable:m.variable.sessionId==="gone"?{status:1}:{values:m.variable.get.map((n:string)=>JSON.stringify(n==="jobName"?"claude":n==="tty"?"/dev/ttys001":`${n} of ${m.variable.sessionId || m.variable.tabId}`))}});
      else if(m.getBuffer)reply({getBuffer:{contents:screenLines}});
      else if(m.sendText){sent.push(m.sendText.text);reply({sendText:{}});}
      else if(m.notification)reply({notificationResponse:{}});
    });
  });
  await new Promise<void>(r=>http.listen(path,r));
  return {path,sent,headers,push:(s:string)=>subscriber?.(s),close:async()=>{wss.close();http.close();await rm(dir,{recursive:true,force:true});}};
}

test("talks to iTerm's API: list, variables, screen, typing, notifications",async()=>{
  const iterm=await fakeIterm([{text:"❯ 1. Yes   "},{text:"a long line that",continuation:2},{text:" wrapped"},{text:""},{text:""}]);
  const api=new ItermApi(iterm.path,async()=>({cookie:"c",key:"k"}));
  try {
    const windows=await api.listSessions();
    assert.deepEqual(tabSessions(windows[0].tabs![0]).map(s=>s.uniqueIdentifier),["a","b"]);
    assert.equal(windows[0].tabs![0].tabGroupName,"work");
    assert.deepEqual(await api.variables({sessionId:"a"},["jobName","path"]),{jobName:"claude",path:"path of a"});
    await assert.rejects(api.variables({sessionId:"gone"},["path"]),/no longer exists/);
    assert.equal(await api.screen("a"),"❯ 1. Yes\na long line that wrapped\n");
    await api.sendText("a","\x1b[200~hi\x1b[201~\r");
    assert.deepEqual(iterm.sent,["\x1b[200~hi\x1b[201~\r"]);
    assert.equal(iterm.headers[0]["x-iterm2-cookie"],"c");
    let updates=0;
    const off=api.onScreenUpdate("a",()=>updates++);
    await new Promise(r=>setTimeout(r,50));
    iterm.push("a");iterm.push("b");
    await new Promise(r=>setTimeout(r,50));
    assert.equal(updates,1);
    off();
  } finally {api.close();await iterm.close();}
});

test("pushed change events trigger reads, rate-limited by minGap",async()=>{
  let reads=0,text=0;let fire=()=>{};
  const live=new LiveSessions(async()=>{reads++;return {text:String(text),truncated:false,claude:null};},{active:60000,idle:60000,minGap:100,onChange:(_,changed)=>{fire=changed;return ()=>{fire=()=>{};};}});
  const got:string[]=[];
  const off=live.subscribe("s",{send:m=>got.push(JSON.parse(m).preview.text)});
  await new Promise(r=>setTimeout(r,30));
  assert.equal(reads,1);
  text=1;for(let i=0;i<20;i++)fire();          // a burst of screen updates
  await new Promise(r=>setTimeout(r,250));
  assert.ok(reads>=2 && reads<=3,`reads=${reads}`);
  assert.deepEqual(got,["0","1"]);
  off();
});
