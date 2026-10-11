import { open, readdir, access, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { InputSkill } from "./contract";

async function readSmall(path:string,max=65536) {
  const file=await open(path,"r");
  try {const info=await file.stat();if(!info.isFile()||info.size>max)throw Error("File too large");return await file.readFile("utf8");}finally{await file.close();}
}
const frontSchema=z.object({name:z.string().optional(),description:z.string().optional(),"argument-hint":z.string().optional(),"user-invocable":z.union([z.boolean(),z.string(),z.number()]).optional()});
export function skillMetadata(text:string,command:string,source:string,plugin=false):InputSkill|null {
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  let front:z.infer<typeof frontSchema>={};
  try {if(match)front=frontSchema.parse(parse(match[1],{maxAliasCount:0}) ?? {});}catch{return null;}
  if(/^(false|no|off|0)$/i.test(String(front["user-invocable"])))return null;
  if(plugin && front.name)command=command.slice(0,command.indexOf(":")+1)+front.name;
  if(!/^[a-zA-Z0-9_:.\/-]{1,180}$/.test(command))return null;
  const body=match?text.slice(match[0].length):text;
  return {command,label:(front.name||command).slice(0,180),description:(front.description||body.split("\n").find(l=>l.trim())||"").replace(/^#+\s*/,"").slice(0,300),hint:(front["argument-hint"]||"").slice(0,150),source};
}
const pluginIndexSchema=z.object({plugins:z.record(z.string(),z.array(z.object({scope:z.string(),projectPath:z.string().nullable().optional(),installPath:z.string()})))});
const settingsSchema=z.object({enabledPlugins:z.record(z.string(),z.boolean()).optional()});
export async function inputSkills(cwd:string,signal:AbortSignal,home=homedir()):Promise<{skills:InputSkill[];truncated:boolean}> {
  const found=new Map<string,InputSkill>();let visited=0;let truncated=false;
  async function add(path:string,command:string,source:string,plugin=false){
    signal.throwIfAborted();
    if(++visited>1600){truncated=true;return;}
    // A repo could link a "skill" to a private file; only follow links in your own ~/.claude.
    if(source==="Project" && (await lstat(path).catch(()=>null))?.isSymbolicLink())return;
    try {const skill=skillMetadata(await readSmall(path),command,source,plugin);if(skill && !found.has(skill.command))found.set(skill.command,skill);}catch{}
  }
  // In repos, don't follow links out of .claude (only your own ~/.claude may link elsewhere).
  const linked=async(path:string)=>(await lstat(path).catch(()=>null))?.isSymbolicLink() ?? false;
  async function folder(root:string,source:string,prefix="") {
    if(source==="Project" && await linked(root))return;
    let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{return;}
    for(const entry of entries.slice(0,1000))if((entry.isDirectory()||(entry.isSymbolicLink() && source!=="Project")) && entry.name.toLowerCase()!=="synced")await add(join(root,entry.name,"SKILL.md"),prefix+entry.name,source,!!prefix);
  }
  async function commands(root:string,source:string,prefix="",depth=0){
    signal.throwIfAborted();
    if(source==="Project" && await linked(root))return;
    if(depth>4 || ++visited>1600)return;
    let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{return;}
    for(const entry of entries.slice(0,500)){
      if(entry.isDirectory())await commands(join(root,entry.name),source,prefix+entry.name+":",depth+1);
      else if(entry.name.endsWith(".md"))await add(join(root,entry.name),prefix+basename(entry.name,".md"),source);
    }
  }
  const ancestors:string[]=[];
  for(let dir=resolve(cwd);ancestors.length<32;dir=dirname(dir)){
    ancestors.push(dir);
    try{await access(join(dir,".git"));break;}catch{}
    if(dirname(dir)===dir)break;
  }
  await folder(join(home,".claude/skills"),"Personal");
  for(const dir of ancestors)await folder(join(dir,".claude/skills"),"Project");
  await commands(join(home,".claude/commands"),"Personal");
  for(const dir of ancestors)await commands(join(dir,".claude/commands"),"Project");
  let enabled:Record<string,boolean>={};
  for(const path of [join(home,".claude/settings.json"),...[...ancestors].reverse().flatMap(dir=>[join(dir,".claude/settings.json"),join(dir,".claude/settings.local.json")])]){
    try{enabled={...enabled,...settingsSchema.parse(JSON.parse(await readSmall(path))).enabledPlugins};}catch{}
  }
  try{
    const installed=pluginIndexSchema.parse(JSON.parse(await readSmall(join(home,".claude/plugins/installed_plugins.json"),1024*1024)));
    for(const [key,entries] of Object.entries(installed.plugins)){
      if(!enabled[key])continue;
      const eligible=entries.filter(e=>e.scope==="user" || e.scope==="managed" || (!!e.projectPath && ancestors.includes(resolve(e.projectPath))));
      const entry=eligible.find(e=>e.scope==="local")||eligible.find(e=>e.scope==="project")||eligible[0];if(!entry)continue;
      const name=key.split("@")[0];
      await folder(join(entry.installPath,"skills"),name,name+":");
      await commands(join(entry.installPath,"commands"),name,name+":");
    }
  }catch{}
  const skills=[...found.values()].sort((a,b)=>a.command.localeCompare(b.command));
  return {skills:skills.slice(0,1000),truncated:truncated||skills.length>1000};
}
