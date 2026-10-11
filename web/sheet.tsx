import { useEffect, type ReactNode } from "react";

export interface SheetAction { label:string; onSelect:()=>void; destructive?:boolean; disabled?:boolean }

// An iOS-style action sheet: a list of actions anchored to the bottom of the screen.
export function Sheet({open,title,message,actions,onClose,children}:{open:boolean;title?:string;message?:string;actions?:SheetAction[];onClose:()=>void;children?:ReactNode}) {
  useEffect(()=>{
    if(!open)return;
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    window.addEventListener("keydown",key);
    return ()=>window.removeEventListener("keydown",key);
  },[open,onClose]);
  if(!open)return null;
  return <div className="sheet-backdrop" onClick={onClose}>
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}>
      {(title || message) && <div className="sheet-head">{title && <p className="sheet-title">{title}</p>}{message && <p className="sheet-message">{message}</p>}</div>}
      {children}
      {actions?.map(a=><button key={a.label} type="button" className="sheet-action" data-destructive={a.destructive} disabled={a.disabled} onClick={()=>{onClose();a.onSelect();}}>{a.label}</button>)}
      <button type="button" className="sheet-action sheet-cancel" onClick={onClose}>Cancel</button>
    </div>
  </div>;
}
