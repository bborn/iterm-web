import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveClaudeConfigDir } from "../server/claude-config";
import { readClaudeTranscript, type Process } from "../server/claude-session";

test("resolves the selected Claude configuration directory with the standard default",()=>{
  assert.equal(resolveClaudeConfigDir(null,"/home/user"),"/home/user/.claude");
  assert.equal(resolveClaudeConfigDir("/custom/Claude Work","/home/user"),"/custom/Claude Work");
  assert.equal(resolveClaudeConfigDir("~/.claude-ik","/home/user"),"/home/user/.claude-ik");
  assert.equal(resolveClaudeConfigDir(".claude-ik","/home/user"),"/home/user/.claude-ik");
});

test("loads exact session JSONL from a custom config root and rejects stale process identity",async()=>{
  const root=await mkdtemp(join(tmpdir(),"claude-custom-"));
  try {
    const process:Process={pid:42,tty:"ttys001",foreground:42,group:42,started:"Mon Sep 14 17:34:43 2026",command:"claude"};
    const sessionId="30cb5470-c05f-4af5-8fbb-1538817aebb2";
    const registry={pid:42,sessionId,cwd:"/work/project",procStart:process.started};
    await mkdir(join(root,"sessions"));
    await mkdir(join(root,"projects","-work-project"),{recursive:true});
    await writeFile(join(root,"sessions","42.json"),JSON.stringify(registry));
    await writeFile(join(root,"projects","-work-project",`${sessionId}.jsonl`),[
      {sessionId,uuid:"user",parentUuid:null,type:"user",message:{content:"Explain this"}},
      {sessionId,uuid:"reply",parentUuid:"user",type:"assistant",message:{content:[{type:"text",text:"## Answer\n**Structured** content."}]}},
    ].map(row=>JSON.stringify(row)).join("\n"));
    const view=await readClaudeTranscript(process,root,new AbortController().signal);
    assert.equal(view?.source,"transcript");
    assert.equal(view?.identity,sessionId);
    assert.deepEqual(view?.messages.map(m=>m.role),["user","assistant"]);
    assert.equal(view?.messages[1].text,"## Answer\n**Structured** content.");
    await writeFile(join(root,"sessions","42.json"),JSON.stringify({...registry,procStart:"older process"}));
    assert.equal(await readClaudeTranscript(process,root,new AbortController().signal),null);
    await writeFile(join(root,"sessions","42.json"),JSON.stringify({...registry,pid:43}));
    assert.equal(await readClaudeTranscript(process,root,new AbortController().signal),null);
  } finally {await rm(root,{recursive:true,force:true});}
});
