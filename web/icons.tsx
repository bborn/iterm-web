// Inline icons so they render the same on every device (no font glyph fallbacks).
const props={width:22,height:22,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2.2,strokeLinecap:"round" as const,strokeLinejoin:"round" as const,"aria-hidden":true};
export const PlusIcon=()=><svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
export const SendIcon=()=><svg {...props} strokeWidth={2.6}><path d="M12 19V5M6 11l6-6 6 6"/></svg>;
export const BackIcon=()=><svg {...props} width={26} height={26}><path d="M15 5l-7 7 7 7"/></svg>;
export const MoreIcon=()=><svg {...props}><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></svg>;
