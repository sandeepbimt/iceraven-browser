(()=>{"use strict";
let config={globalMode:"OFF",globalTheme:"dark",sites:{},customThemes:[]},enabled=false,observer=null,timer=0;
const sheets=new WeakSet(),inline=new WeakSet();
const T={
dark:{bg:"#181818",surface:"#202020",elevated:"#292929",text:"#F2F2F2",border:"#3A3A3A"},
grey:{bg:"#242424",surface:"#2D2D2D",elevated:"#363636",text:"#F4F4F4",border:"#474747"},
deep:{bg:"#101010",surface:"#181818",elevated:"#222222",text:"#F4F4F4",border:"#303030"},
amoled:{bg:"#000000",surface:"#080808",elevated:"#101010",text:"#F5F5F5",border:"#242424"},
oled:{bg:"#000000",surface:"#080808",elevated:"#101010",text:"#F5F5F5",border:"#242424"},
blue:{bg:"#101820",surface:"#18232D",elevated:"#223340",text:"#F1F5F8",border:"#354652"},
warm:{bg:"#211D1A",surface:"#29231F",elevated:"#342B25",text:"#F5F0EA",border:"#4A4038"}};
const theme=()=>T[config.globalTheme]||T.dark;
function color(v){if(!v||/url\(|var\(|gradient\(|currentColor|transparent/i.test(v))return null;
 const c=color.ctx||(color.ctx=document.createElement("canvas").getContext("2d",{willReadFrequently:true}));if(!c)return null;c.fillStyle="#000";c.fillStyle=v;
 const m=c.fillStyle.match(/^rgba?\(([^)]+)\)$/i);if(!m)return null;const p=m[1].replace(/\//g," ").split(/[ ,]+/).filter(Boolean).map(Number);if(p.length<3||p.some(Number.isNaN))return null;return{r:p[0],g:p[1],b:p[2],a:p[3]??1}}
function lum(c){const f=x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)}
function hsl(c){let r=c.r/255,g=c.g/255,b=c.b/255,M=Math.max(r,g,b),m=Math.min(r,g,b),d=M-m,h=0;if(d){h=M===r?((g-b)/d)%6:M===g?(b-r)/d+2:(r-g)/d+4;h*=60;if(h<0)h+=360}const l=(M+m)/2,s=d?d/(1-Math.abs(2*l-1)):0;return{h,s,l}}
function tx(v,role){const c=color(v);if(!c||c.a===0)return v;const y=lum(c),h=hsl(c),t=theme();
 if(role==="background"){if(y<.16||(h.s>.72&&y<.55))return v;return y>.82?t.bg:y>.55?t.surface:t.elevated}
 if(role==="foreground"){return y<.45?t.text:v}
 if(role==="border")return y>.55?t.border:v;
 if(role==="shadow")return y>.35?"#000000":v;
 return v}
function replace(v,role){if(!v||!/(#(?:[0-9a-f]{3,8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|gray|grey)\b)/i.test(v))return v;
 return v.replace(/#(?:[0-9a-f]{3,8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|gray|grey)\b/gi,x=>tx(x,role))}
function role(n){n=n.toLowerCase();if(n==="color"||n.includes("text-decoration")||n.includes("caret"))return"foreground";if(n.includes("background"))return"background";if(n.includes("border")||n==="outline"||n.includes("column-rule"))return"border";if(n.includes("shadow"))return"shadow";if(n==="fill"||n==="stroke"||n==="stop-color")return"foreground";if(n.startsWith("--")){const x=n.slice(2);if(/background|surface|panel|card|canvas|layer|popover/.test(x))return"background";if(/text|foreground|font|label/.test(x))return"foreground"}return null}
function transform(style){const names=[];for(let i=0;i<style.length;i++)names.push(style.item(i));for(const n of names){const r=role(n);if(!r)continue;const p=style.getPropertyPriority(n),v=style.getPropertyValue(n);if(n==="color-scheme"){style.setProperty(n,"dark",p);continue}const x=replace(v,r);if(x!==v)style.setProperty(n,x,p)}}
function walk(rules){for(const r of rules){try{if(r.type===CSSRule.STYLE_RULE)transform(r.style);else if(r.cssRules)walk(r.cssRules)}catch(_){}}}
function sheet(s){if(!s||sheets.has(s))return;try{walk(s.cssRules);sheets.add(s)}catch(_){}}
function inline(root){if(!root?.querySelectorAll)return;for(const n of root.querySelectorAll("[style]"))if(!inline.has(n)){try{transform(n.style);inline.add(n)}catch(_){}}}
function pre(){document.documentElement?.setAttribute("data-sandfox-dark","1");const s=document.createElement("style");s.id="sandfox-dark-prepaint";const t=theme();s.textContent=":root{color-scheme:dark!important;background:"+t.bg+"!important}html,body{background:"+t.bg+"!important;color-scheme:dark!important}";(document.head||document.documentElement||document).appendChild(s)}
function clean(){document.getElementById("sandfox-dark-prepaint")?.remove();document.documentElement?.removeAttribute("data-sandfox-dark")}
function scan(){if(!enabled)return;const start=performance.now();for(const s of Array.from(document.styleSheets)){sheet(s);if(performance.now()-start>12){clearTimeout(timer);timer=setTimeout(scan,0);return}}inline(document)}
function schedule(){clearTimeout(timer);timer=setTimeout(scan,0)}
function siteMode(){const s=config.sites?.[location.hostname.toLowerCase()];return["OFF","NATIVE","SMART"].includes(s)?s:config.globalMode}
function observe(){if(observer||!document.documentElement)return;observer=new MutationObserver(ms=>{if(ms.some(m=>m.type==="attributes"||[...m.addedNodes].some(n=>n.nodeType===1&&(n.localName==="style"||n.localName==="link"||n.querySelector?.("style,link")))))schedule()});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["style"]})}
function stop(){enabled=false;observer?.disconnect();observer=null;clean()}
function apply(c){config=c||config;const m=siteMode();stop();if(m==="OFF")return;if(m==="NATIVE"){document.documentElement?.style.setProperty("color-scheme","dark","important");return}enabled=true;pre();schedule();observe()}
browser.runtime.onMessage.addListener(m=>{if(m?.type==="sandfox-config")apply(m.config)});
browser.runtime.sendMessage({type:"sandfox-get-config"}).then(r=>apply(r?.config)).catch(()=>apply(config));
})();