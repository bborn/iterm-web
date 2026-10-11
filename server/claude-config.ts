import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

// Read only the selected process's config directory; no other environment values leave Python.
const processConfigScript=String.raw`
import ctypes, struct, json, sys
libc=ctypes.CDLL(None,use_errno=True)
mib=(ctypes.c_int*3)(1,49,int(sys.argv[1]))
size=ctypes.c_size_t(0)
if libc.sysctl(mib,3,None,ctypes.byref(size),None,0)!=0: raise OSError(ctypes.get_errno())
if size.value<4 or size.value>2*1024*1024: raise ValueError('Invalid process argument size')
buffer=ctypes.create_string_buffer(size.value)
if libc.sysctl(mib,3,buffer,ctypes.byref(size),None,0)!=0: raise OSError(ctypes.get_errno())
data=buffer.raw[:size.value]
argc=struct.unpack_from('i',data)[0]
if argc<0 or argc>65536: raise ValueError('Invalid argument count')
pos=data.index(b'\0',4)+1
while pos<len(data) and data[pos]==0: pos+=1
for _ in range(argc): pos=data.index(b'\0',pos)+1
value=next((v.split(b'=',1)[1].decode() for v in data[pos:].split(b'\0') if v.startswith(b'CLAUDE_CONFIG_DIR=')),None)
print(json.dumps({'configDir':value}))
`;
const resultSchema=z.object({configDir:z.string().max(4096).nullable()});
export function resolveClaudeConfigDir(configDir:string|null,home=homedir()) {
  const configured=configDir?.trim();
  if(!configured)return resolve(home,".claude");
  return resolve(home,configured.startsWith("~/")?configured.slice(2):configured);
}
export async function processClaudeConfigDir(pid:number,signal:AbortSignal) {
  if(!Number.isSafeInteger(pid)||pid<1)throw Error("Invalid Claude process");
  const {stdout}=await promisify(execFile)("/usr/bin/python3",["-I","-c",processConfigScript,String(pid)],{signal,timeout:2000,maxBuffer:32768,cwd:"/"});
  return resolveClaudeConfigDir(resultSchema.parse(JSON.parse(stdout)).configDir);
}
