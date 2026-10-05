let state={globalMode:"OFF",globalTheme:"dark",sites:{},customThemes:[]};
let nativePort=null;
function normalize(c){c=c&&typeof c==="object"?c:{};return{
 globalMode:["OFF","NATIVE","SMART"].includes(c.globalMode)?c.globalMode:"OFF",
 globalTheme:typeof c.globalTheme==="string"?c.globalTheme:"dark",
 sites:c.sites&&typeof c.sites==="object"?c.sites:{},
 customThemes:Array.isArray(c.customThemes)?c.customThemes:[]
}}
async function load(){try{const x=await browser.storage.local.get("sandfoxConfig");state=normalize(x.sandfoxConfig)}catch(_){}}
async function save(){await browser.storage.local.set({sandfoxConfig:state})}
async function broadcast(){let tabs=[];try{tabs=await browser.tabs.query({})}catch(_){return}
 await Promise.allSettled(tabs.filter(t=>Number.isInteger(t.id)).map(t=>browser.tabs.sendMessage(t.id,{type:"sandfox-config",config:state})))}
async function apply(c){state=normalize(c);await save();await broadcast()}
async function requestConfig(){try{
 const response=await browser.runtime.sendNativeMessage("browser",{type:"sandfox-get-config"});
 if(response?.type==="sandfox-config") await apply(response.config);
}catch(_){} }
function connect(){try{
 nativePort=browser.runtime.connectNative("browser");
 nativePort.onMessage.addListener(m=>{if(m?.type==="sandfox-config")apply(m.config)});
 nativePort.onDisconnect.addListener(()=>{nativePort=null;setTimeout(connect,1000)})
}catch(_){nativePort=null;setTimeout(connect,2000)}}
browser.runtime.onMessage.addListener(m=>m?.type==="sandfox-get-config"?Promise.resolve({config:state}):undefined);
load().then(async()=>{await requestConfig();connect()});