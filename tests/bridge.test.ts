import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { SCRIPT, automationError } from "../server/bridge";
import { actionSchema, listSchema } from "../server/contract";

function fixture() {
  const writes:unknown[]=[];
  const calls:string[]=[];
  const s = (id:string) => ({
    id:()=>id, name:()=>`Session ${id}`, tty:()=>"/dev/ttys001", profileName:()=>"Default",
    variable:()=>"/tmp/project",isProcessing:()=>false,isAtShellPrompt:()=>true,
    contents:()=>"hello\nworld",write:(input:unknown)=>writes.push({id,input:JSON.parse(JSON.stringify(input))}),
    close:()=>calls.push(`close:${id}`),select:()=>calls.push(`select:${id}`),
    splitVerticallyWithDefaultProfile:()=>s("split-v"),splitHorizontallyWithDefaultProfile:()=>s("split-h"),
  });
  const a=s("a"),b=s("b"),c=s("c");
  const tab = (sessions:ReturnType<typeof s>[]) => ({close:()=>calls.push(`close-tab:${sessions.map(s=>s.id()).join(",")}`),title:()=>"Custom tab title",sessions:()=>sessions,select:()=>{},currentSession:()=>sessions[0]});
  const window = (id:number,tabs:ReturnType<typeof tab>[]) => ({id:()=>id,name:()=>`Window ${id}`,tabs:()=>tabs,currentSession:()=>tabs[0].currentSession(),select:()=>{},createTabWithDefaultProfile:()=>tab([s("new-tab")])});
  const windows=[window(1,[tab([a,b])]),window(2,[tab([c])])];
  const app={running:()=>true,windows:()=>windows,currentWindow:()=>windows[0],activate:()=>calls.push("activate"),createWindowWithDefaultProfile:()=>window(3,[tab([s("new-window")])])};
  const run = (input:unknown) => {
    const data=JSON.stringify(input);
    const context={ObjC:{import:()=>{},unwrap:(v:unknown)=>v},$:{NSFileHandle:{fileHandleWithStandardInput:{readDataToEndOfFile:data}},NSString:{alloc:{initWithDataEncoding:(d:unknown)=>d}},NSUTF8StringEncoding:4},Application:()=>app};
    return JSON.parse(runInNewContext(`${SCRIPT}\nrun()`,context));
  };
  return {run,writes,calls,a,b,c,app,windows};
}

test("list includes every window and split pane without reading screen contents",()=>{
  const f=fixture();f.a.contents=()=>{throw Error("must not read screen");};
  const result=listSchema.parse(f.run({method:"list"}));
  assert.deepEqual(result.sessions.map(s=>[s.id,s.windowId,s.paneIndex]),[["a",1,1],["b",1,2],["c",2,1]]);
  assert.equal(result.sessions[0].selected,true);
});
test("listing does not launch iTerm when it is stopped",()=>{const f=fixture();f.app.running=()=>false;assert.deepEqual(f.run({method:"list"}),{running:false,sessions:[],truncated:false});});
test("actions select by UUID after tab order changes",()=>{const f=fixture();f.windows.reverse();f.run({method:"action",action:{kind:"send",sessionId:"a",text:"hello",enter:false}});assert.deepEqual(f.writes,[{id:"a",input:{text:"hello",newline:false}}]);});
test("quoted input and code-shaped text remain literal",()=>{
  const f=fixture();const text='\"; throw Error("oops"); //\n$(touch /tmp/not-executed) `no` \\ café';
  f.run({method:"action",action:{kind:"send",sessionId:"b",text,enter:true}});
  assert.deepEqual(f.writes,[{id:"b",input:{text,newline:true}}]);
});
test("special keys do not append an unwanted newline",()=>{
  const f=fixture();f.run({method:"action",action:{kind:"key",sessionId:"b",key:"ctrl-c"}});
  f.run({method:"action",action:{kind:"key",sessionId:"b",key:"up"}});
  assert.deepEqual(f.writes,[{id:"b",input:{text:"\x03",newline:false}},{id:"b",input:{text:"\x1b[A",newline:false}}]);
});
test("missing session fails without writing to another session",()=>{const f=fixture();assert.throws(()=>f.run({method:"action",action:{kind:"send",sessionId:"missing",text:"no",enter:true}}),/no longer exists/);assert.equal(f.writes.length,0);});
test("preview is bounded and marks truncation",()=>{const f=fixture();f.a.contents=()=>"x".repeat(65000);const result=f.run({method:"preview",sessionId:"a"});assert.equal(result.text.length,64000);assert.equal(result.truncated,true);});
test("new tabs and splits return the created session ID",()=>{const f=fixture();for(const [kind,direction,expected] of [["new-tab",undefined,"new-tab"],["split","vertical","split-v"],["split","horizontal","split-h"]])assert.equal(f.run({method:"action",action:{kind,sessionId:"b",direction}}).sessionId,expected);});
test("close affects only the requested session",()=>{const f=fixture();f.run({method:"action",action:{kind:"close",sessionId:"b",confirmed:true}});assert.deepEqual(f.calls,["close:b"]);});
test("schemas reject unsafe or malformed actions",()=>{
  for(const input of [{kind:"close",sessionId:"a"},{kind:"close",sessionId:"a",confirmed:false},{kind:"send",sessionId:"a",text:"x".repeat(16001),enter:true},{kind:"send",sessionId:"a",text:"a\0b",enter:true},{kind:"key",sessionId:"a",key:"anything"},{kind:"focus",sessionId:"a",command:"oops"}])assert.equal(actionSchema.safeParse(input).success,false);
});
test("permission failures and timeouts provide recovery instructions",()=>{
  assert.match(automationError({stderr:"Not authorized (-1743)"}).message,/Automation/);
  assert.match(automationError({stderr:"AppleEvent timed out (-1712)"}).message,/prompt/);
  assert.match(automationError({killed:true}).message,/prompt/);
});


test("list reports the Mac tab title separately from the session name",()=>{
  const f=fixture();const result=listSchema.parse(f.run({method:"list"}));
  assert.equal(result.sessions[0].tabName,"Custom tab title");
  assert.equal(result.sessions[0].name,"Session a");
});
test("rename updates the tab title shown on the Mac",()=>{
  const f=fixture();f.run({method:"action",action:{kind:"rename",sessionId:"a",name:"Project tab"}});
  assert.equal(f.windows[0].tabs()[0].title,"Project tab");
});

test("closing a tab targets the selected session's entire tab after reorder",()=>{
  const f=fixture();f.windows.reverse();
  f.run({method:"action",action:{kind:"close-tab",sessionId:"b",confirmed:true}});
  assert.deepEqual(f.calls,["close-tab:a,b"]);
  assert.equal(actionSchema.safeParse({kind:"close-tab",sessionId:"b"}).success,false);
});
