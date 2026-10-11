import test from "node:test";
import assert from "node:assert/strict";
import { collectGroups, groupColor } from "../server/metadata";

test("preserves iTerm Display P3 components and accepts 8/16 bit colors",()=>{
  assert.equal(groupColor("p3#ffff80000000"),"color(display-p3 1.00000 0.50001 0.00000)");
  assert.equal(groupColor("p3#ff8000"),"color(display-p3 1.00000 0.50196 0.00000)");
  assert.equal(groupColor("#ffff80000000"),"#ff8000");
  assert.equal(groupColor("#87abcd"),"#87abcd");
  assert.equal(groupColor("url(https://example.com)"),"#808080");
});
test("maps group membership across split panes and minimized sessions",()=>{
  const groups=collectGroups({windows:[{tabs:[{groupId:"group",groupName:"work",groupColor:"#ff9900",collapsed:true,root:{links:[{session:{id:"a"}},{node:{links:[{session:{id:"b"}}]}}]},minimized:[{id:"c"}]},{root:{links:[{session:{id:"ungrouped"}}]}}]}]});
  assert.deepEqual([...groups.keys()],["a","b","c"]);
  assert.deepEqual(groups.get("b"),{id:"group",name:"work",color:"#ff9900",collapsed:true});
});

test("older iTerm saved layout maps groups by session UUID without loading contents",async()=>{
  const {mkdtemp,rm}=await import("node:fs/promises");
  const {tmpdir}=await import("node:os");
  const {join}=await import("node:path");
  const {execFileSync}=await import("node:child_process");
  const {readSavedGroups}=await import("../server/saved-layout");
  const dir=await mkdtemp(join(tmpdir(),"iterm-layout-test-"));
  try {
    const path=join(dir,"layout.sqlite");
    execFileSync("/usr/bin/python3",["-c",`
import sqlite3,plistlib,sys
c=sqlite3.connect(sys.argv[1])
c.execute('CREATE TABLE Node (key TEXT,identifier TEXT,parent INTEGER,data BLOB)')
metadata={'Tab Group ID':'group','Tab Group Name':'project','Tab Group Collapsed':True,'Tab Group Color':{'Red Component':1,'Green Component':0.5,'Blue Component':0,'Color Space':'P3'}}
blob=plistlib.dumps({'$objects':['$null',metadata],'$top':{'root':plistlib.UID(1)}},fmt=plistlib.FMT_BINARY)
for row in [(1,'__array','Tabs',0,None),(2,'','tab-guid',1,blob),(3,'Root','',2,None),(4,'','session-uuid',3,None),(5,'Session','',4,b'invalid plist: do not read terminal content')]:
 c.execute('INSERT INTO Node(rowid,key,identifier,parent,data) VALUES(?,?,?,?,?)',row)
c.commit()
`,path]);
    const groups=await readSavedGroups(AbortSignal.timeout(5000),path);
    assert.deepEqual(groups.get("session-uuid"),{id:"group",name:"project",color:"color(display-p3 1.00000 0.50000 0.00000)",collapsed:true});
    assert.equal(groups.has("unrelated-session"),false);
  } finally {await rm(dir,{recursive:true,force:true});}
});
