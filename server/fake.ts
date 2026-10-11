import type { Action, ChatMessage, ClaudeSend, InputOptions, Preview, Session, SessionList } from "./contract";
import { liveClaudePrompt, claudeWorking } from "./claude-view";

// A stand-in for iTerm2 so the UI can be developed and demoed on any machine
// (`iterm-web start --demo`). Nothing here touches a real terminal.
const HOME="/Users/sam";
const session=(id:string,o:Partial<Session>):Session=>({id,name:"zsh",tabName:"",windowId:1,windowName:"Window 1",group:null,tabIndex:1,paneIndex:1,tty:`/dev/ttys00${id.length}`,profile:"Default",cwd:HOME,processing:false,atPrompt:true,selected:false,claude:false,...o});
const shop={id:"g1",name:"storefront",color:"#e8833a",collapsed:false};
const site={id:"g2",name:"blog",color:"color(display-p3 0.30000 0.55000 0.95000)",collapsed:false};

interface FakeTab { session:Session; screen:string; chat?:ChatMessage[] }
const tabs:FakeTab[]=[
  {session:session("claude-blog",{tabName:"✳ Dark mode for the blog",claude:true,group:site,cwd:`${HOME}/code/blog`,processing:true,atPrompt:false}),screen:"",chat:[
    {id:"1",role:"user",text:"Add a dark mode to the blog that follows the system setting."},
    {id:"2",role:"assistant",text:"Sure. I'll start with how colors are defined today.\n\nThe theme hard-codes hex values in `layout.css`, so the first step is moving them to CSS variables."},
    {id:"t1",role:"tool",name:"Read",text:JSON.stringify({file_path:`${HOME}/code/blog/src/styles/layout.css`},null,2),status:"completed",result:"body {\n  background: #ffffff;\n  …\n}"},
    {id:"t2",role:"tool",name:"Edit",text:JSON.stringify({file_path:`${HOME}/code/blog/src/styles/layout.css`},null,2),status:"completed",result:"Updated 14 colors"},
    {id:"t3",role:"tool",name:"Bash",text:JSON.stringify({command:"npm test",description:"Run the test suite"},null,2),status:"completed",result:"✔ 42 tests passed"},
    {id:"3",role:"assistant",text:"Done. Here's what changed:\n\n1. **Colors are variables** in `:root`\n2. A `prefers-color-scheme: dark` block swaps them\n3. Code blocks get their own dark palette\n\n```css\n@media (prefers-color-scheme: dark) {\n  :root { --bg: #111318; --text: #e8e8ea; }\n}\n```\n\nWant me to add a manual toggle too?"},
  ]},
  {session:session("claude-shop",{tabName:"✳ Fix cart rounding",claude:true,group:shop,windowId:1,tabIndex:2,cwd:`${HOME}/code/storefront`,processing:true,atPrompt:false}),
    screen:"⏺ Bash(bin/rails db:migrate)\n\n╭──────────────────────────────────────────────╮\n│ Bash command                                 │\n│                                              │\n│   bin/rails db:migrate                       │\n│   Run pending migrations                     │\n│                                              │\n│ Do you want to proceed?                      │\n│ ❯ 1. Yes                                     │\n│   2. Yes, and don't ask again for bin/rails  │\n│      commands in ~/code/storefront           │\n│   3. No, and tell Claude what to do differently (esc) │\n╰──────────────────────────────────────────────╯",
    chat:[{id:"1",role:"user",text:"The cart total is off by a cent sometimes. Can you find out why?"},{id:"2",role:"assistant",text:"Found it: prices are rounded before tax is applied. I've fixed the calculation and added a migration to correct stored totals."},{id:"t1",role:"tool",name:"Bash",text:JSON.stringify({command:"bin/rails db:migrate"},null,2),status:"pending"}]},
  {session:session("shell",{tabName:"~/code/storefront",group:shop,tabIndex:3,cwd:`${HOME}/code/storefront`}),screen:"➜  storefront git:(main) git status\nOn branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean\n➜  storefront git:(main) "},
  {session:session("server",{tabName:"rails s",tabIndex:4,cwd:`${HOME}/code/storefront`,processing:true,atPrompt:false}),screen:"=> Booting Puma\n=> Rails 8.0.2 application starting in development\n* Listening on http://127.0.0.1:3000\nUse Ctrl-C to stop\nStarted GET \"/cart\" for 127.0.0.1\nCompleted 200 OK in 41ms"},
  {session:session("logs",{tabName:"rails s",tabIndex:4,paneIndex:2,name:"tail -f log/development.log",cwd:`${HOME}/code/storefront`}),screen:"tail: following log/development.log"},
  {session:session("w2",{tabName:"htop",windowId:2,windowName:"Window 2",tabIndex:1}),screen:"  PID USER      PRI  NI  VIRT   RES\n  412 sam        24   0  410G  1.2G"},
];
let working=new Set(["claude-blog"]);

const find=(id:string)=>{const tab=tabs.find(t=>t.session.id===id);if(!tab)throw Error("Session no longer exists. Refresh the session list.");return tab;};
const screenFor=(tab:FakeTab)=>tab.screen+(working.has(tab.session.id)?"\n\n✻ Thinking… (12s · ↑ 1.2k tokens · esc to interrupt)":"\n\n> ");

export const fake={
  hostName:()=>"Sam's MacBook",
  async list():Promise<SessionList> { return {running:true,sessions:tabs.map(t=>t.session),truncated:false}; },
  async preview(id:string):Promise<Preview> {
    const tab=find(id);const text=screenFor(tab);
    if(!tab.chat)return {text,truncated:false,claude:null};
    return {text,truncated:false,claude:{source:"transcript",identity:id,messages:tab.chat,prompt:liveClaudePrompt(text),working:claudeWorking(text)}};
  },
  async inputOptions():Promise<InputOptions> {
    return {truncated:false,skills:[
      {command:"review",label:"review",description:"Review the current diff for bugs",hint:"[pr-number]",source:"Personal"},
      {command:"compact",label:"compact",description:"Compact the conversation",hint:"",source:"Personal"},
      {command:"init",label:"init",description:"Create a CLAUDE.md for this project",hint:"",source:"Built in"},
      {command:"ship",label:"ship",description:"Commit, push and open a PR",hint:"",source:"Project"},
    ]};
  },
  async action(action:Action) {
    if(action.kind==="new-window")return {sessionId:null};
    const tab=find(action.sessionId);
    if(action.kind==="key" && /^[1-9]$/.test(action.key) && tab.screen.includes("Do you want to proceed")){
      tab.screen="⏺ Bash(bin/rails db:migrate)\n  ⎿  == 20261001 FixCartRounding: migrated (0.0123s)";
      const pending=tab.chat?.find(m=>m.status==="pending");if(pending){pending.status="completed";pending.result="== 20261001 FixCartRounding: migrated";}
    }
    if(action.kind==="key" && (action.key==="escape" || action.key==="ctrl-c"))working.delete(tab.session.id);
    if(action.kind==="send")tab.screen+=action.text+(action.enter?"\n":"");
    return {sessionId:tab.session.id};
  },
  async sendClaude(id:string,input:ClaudeSend) {
    const tab=find(id);
    tab.chat?.push({id:String(Date.now()),role:"user",text:[input.text,...input.files.map(f=>`Attached file: ${HOME}/.iterm-web/attachments/${f.name}`)].join("\n")});
    working.add(id);
    setTimeout(()=>{working.delete(id);tab.chat?.push({id:String(Date.now()+1),role:"assistant",text:"On it."});},2500);
    return {sessionId:id};
  },
};
