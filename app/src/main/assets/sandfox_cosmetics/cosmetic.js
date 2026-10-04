function injectStyle(selectors) {
  if (!Array.isArray(selectors) || !selectors.length) return;
  const style=document.createElement("style");
  style.dataset.sandfoxAdblock="1";
  style.textContent=selectors.map(s=>s+"{display:none !important;}").join("\n");
  (document.head||document.documentElement).appendChild(style);
}
let classes=new Set(), ids=new Set(), exceptions=[], genericHidden=false;
async function dynamic() {
  if (genericHidden) return;
  for (const element of document.querySelectorAll("[class],[id]")) {
    for (const name of element.classList||[]) classes.add(name);
    if (element.id) ids.add(element.id);
  }
  const result=await browser.runtime.sendMessage({type:"dynamic",url:location.href,classes:[...classes],ids:[...ids],exceptions}).catch(()=>null);
  if (result?.type==="dynamic") injectStyle(result.selectors);
}
async function initial() {
  const result=await browser.runtime.sendMessage({type:"cosmetic",url:location.href}).catch(()=>null);
  if (!result||result.type!=="cosmetic") return;
  injectStyle(result.hideSelectors);
  genericHidden=Boolean(result.generichide);
  exceptions=result.exceptions||[];
  if (result.injectedScript) {
    const script=document.createElement("script");
    script.textContent=result.injectedScript;
    (document.documentElement||document.head).appendChild(script);
    script.remove();
  }
  dynamic();
}
const observer=new MutationObserver(()=>{clearTimeout(observer.timer);observer.timer=setTimeout(dynamic,150);});
if (document.documentElement) observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class","id"]});
initial();