import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TabGroup } from "./metadata";

// Older iTerm builds omit groups from ListSessions. Read only layout metadata
// from its restoration database; never load session contents or modify the DB.
const SCRIPT = String.raw`
import sqlite3, plistlib, json, os, sys
path = sys.argv[1] if len(sys.argv)>1 else os.path.expanduser('~/Library/Application Support/iTerm2/SavedState/restorable-state.sqlite')
c = sqlite3.connect('file:' + path + '?mode=ro', uri=True, timeout=1)
def unpack(blob):
    archive = plistlib.loads(blob)
    objects = archive['$objects']
    def value(x, depth=0):
        if depth > 32: raise ValueError('Layout nesting too deep')
        if isinstance(x, plistlib.UID): return value(objects[x.data], depth+1)
        if isinstance(x, dict) and 'NS.keys' in x:
            return {value(k,depth+1):value(v,depth+1) for k,v in zip(x['NS.keys'],x['NS.objects'])}
        return x
    return value(archive['$top']['root'])
result=[]
for rowid,blob in c.execute("SELECT n.rowid,n.data FROM Node n JOIN Node p ON n.parent=p.rowid WHERE p.key='__array' AND p.identifier='Tabs' AND length(n.data)<65536"):
    tab=unpack(blob)
    if not tab.get('Tab Group ID'): continue
    color=tab.get('Tab Group Color',{})
    rgb=[max(0,min(1,float(color.get(k,0.5)))) for k in ['Red Component','Green Component','Blue Component']]
    css=('color(display-p3 %.5f %.5f %.5f)' % tuple(rgb)) if color.get('Color Space')=='P3' else '#'+''.join('%02x'%round(n*255) for n in rgb)
    group=dict(id=tab['Tab Group ID'],name=tab.get('Tab Group Name',''),color=css,collapsed=bool(tab.get('Tab Group Collapsed',False)))
    descendants=c.execute("WITH RECURSIVE children AS (SELECT rowid,identifier,0 depth FROM Node WHERE rowid=? UNION ALL SELECT n.rowid,n.identifier,ch.depth+1 FROM Node n JOIN children ch ON n.parent=ch.rowid WHERE n.key!='Session' AND ch.depth<32) SELECT identifier FROM children WHERE identifier!=''",(rowid,))
    result.extend([identifier,group] for (identifier,) in descendants)
print(json.dumps(result))
`;
export async function readSavedGroups(signal:AbortSignal, databasePath?:string):Promise<Map<string,TabGroup>> {
  const {stdout}=await promisify(execFile)("/usr/bin/python3",["-I","-c",SCRIPT,...(databasePath?[databasePath]:[])],{signal,timeout:5000,maxBuffer:512*1024,cwd:"/"});
  return new Map(JSON.parse(stdout));
}
