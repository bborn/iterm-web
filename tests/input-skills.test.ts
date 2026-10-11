import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { inputSkills, skillMetadata } from "../server/input-skills";

test("skill metadata respects invocability and never executes skill content",()=>{
  assert.equal(skillMetadata('---\nuser-invocable: false\n---\nHidden','hidden','Personal'),null);
  assert.equal(skillMetadata('---\nname: renamed\ndescription: "Review changes"\n---\n!`touch /tmp/never`','plugin:folder','plugin',true)?.command,'plugin:renamed');
  assert.equal(skillMetadata('---\nname: renamed\n---\nBody','folder','Personal')?.command,'folder');
});
test("discovers applicable skills and enabled plugins with project boundaries",async()=>{
  const root=await mkdtemp(join(tmpdir(),'iterm-skills-'));
  const home=join(root,'home'),project=join(root,'project'),plugin=join(root,'plugin');
  async function file(path:string,text:string){await mkdir(dirname(path),{recursive:true});await writeFile(path,text);}
  try {
    await mkdir(join(project,'.git'),{recursive:true});
    await file(join(home,'.claude/skills/review/SKILL.md'),'---\ndescription: Personal review\n---\nReview');
    await file(join(project,'.claude/skills/review/SKILL.md'),'Project review');
    await file(join(project,'.claude/skills/test/SKILL.md'),'Run tests');
    await file(join(root,'.claude/skills/outside/SKILL.md'),'Outside repo');
    await file(join(home,'.claude/skills/private/SKILL.md'),'---\nuser-invocable: false\n---\nHidden');
    await file(join(plugin,'skills/design/SKILL.md'),'Design');
    await file(join(home,'.claude/plugins/installed_plugins.json'),JSON.stringify({plugins:{'demo@market':[{scope:'user',projectPath:null,installPath:plugin}]}}));
    await file(join(home,'.claude/settings.json'),JSON.stringify({enabledPlugins:{'demo@market':true}}));
    const result=await inputSkills(project,new AbortController().signal,home);
    assert.deepEqual(result.skills.map(s=>s.command),['demo:design','review','test']);
    assert.equal(result.skills.find(s=>s.command==='review')?.description,'Personal review');
    await file(join(project,'.claude/settings.local.json'),JSON.stringify({enabledPlugins:{'demo@market':false}}));
    assert.deepEqual((await inputSkills(project,new AbortController().signal,home)).skills.map(s=>s.command),['review','test']);
  } finally {await rm(root,{recursive:true,force:true});}
});
