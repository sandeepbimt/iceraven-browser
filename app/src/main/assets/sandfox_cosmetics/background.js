const NATIVE_APP = "sandfox.cosmetics";
let state = { enabled:true, ready:false, suspendNetworkUntilReady:true, globalLists:[], customFilters:"", siteListOverrides:{}, siteEnabledOverrides:{}, siteReadyHosts:[] };
let syncPromise = null;
let nativePort = null;
function connectNative() {
  try {
    nativePort = browser.runtime.connectNative(NATIVE_APP);
    nativePort.onMessage.addListener(message => {
      if (message?.type === "refresh" || message?.type === "configChanged") {
        syncState().then(() => {
          if (state.enabled && (state.forceRefresh || !state.ready)) buildEngine("");
        });
      }
    });
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      setTimeout(connectNative, 1000);
    });
  } catch (_) {
    nativePort = null;
  }
}
const native = message => browser.runtime.sendNativeMessage(NATIVE_APP, message).catch(() => null);

async function syncState() {
  if (!syncPromise) {
    syncPromise = native({type:"getConfig"}).then(config => {
      if (config?.type === "config") state = {...state, ...config};
      return state;
    }).finally(() => { syncPromise = null; });
  }
  return syncPromise;
}
const hostOf = value => { try { return new URL(value).hostname.toLowerCase().replace(/^www\./,""); } catch (_) { return ""; } };

async function buildEngine(host) {
  const target = hostOf("https://" + host);
  const response = await native({type:"build",host:target});
  if (!response || response.type !== "buildAccepted") return false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await syncState();
    if (!target && state.ready) return true;
    if (target && Array.isArray(state.siteReadyHosts) && state.siteReadyHosts.includes(target)) return true;
    await new Promise(r => setTimeout(r,100));
  }
  return false;
}
async function ensureReady() {
  await syncState();
  if (!state.enabled || state.ready) return true;
  return buildEngine("");
}
async function ensureSite(host) {
  if (!host) return true;
  if (state.siteEnabledOverrides?.[host] === false) return false;
  if (!Array.isArray(state.siteListOverrides?.[host])) return true;
  if (state.siteReadyHosts?.includes(host)) return true;
  return buildEngine(host);
}
const typeMap = {main_frame:"document",sub_frame:"subdocument",script:"script",stylesheet:"stylesheet",image:"image",object:"other",object_subrequest:"other",xmlhttprequest:"xmlhttprequest",media:"media",font:"font",websocket:"websocket",ping:"other",beacon:"other",csp_report:"other",imageset:"image",web_manifest:"other"};

browser.webRequest.onBeforeRequest.addListener(async details => {
  if (!state.enabled) return {};
  const site = hostOf(details.documentUrl || details.originUrl || details.initiator || details.url);
  if (state.siteEnabledOverrides?.[site] === false) return {};
  if (state.suspendNetworkUntilReady && !await ensureReady()) return {};
  if (!await ensureSite(site)) return {};
  const result = await native({type:"check",url:details.url,source:details.documentUrl || details.originUrl || details.initiator || details.url,requestType:typeMap[details.type]||"other",method:details.method||"GET"});
  if (!result || result.type !== "check") return {};
  if (result.rewritten_url) return {redirectUrl:result.rewritten_url};
  if (result.blocked) return {cancel:true};
  return {};
},{urls:["<all_urls>"]},["blocking"]);

browser.runtime.onMessage.addListener(async message => {
  if (message?.type === "cosmetic") {
    await syncState();
    let host = hostOf(message.url);
    if (!state.enabled || state.siteEnabledOverrides?.[host] === false) return {type:"cosmetic",hideSelectors:[],exceptions:[],injectedScript:"",generichide:false};
    if (state.suspendNetworkUntilReady && !await ensureReady()) return {type:"cosmetic",hideSelectors:[],exceptions:[],injectedScript:"",generichide:false};
    await ensureSite(host);
    return native({type:"cosmetic",url:message.url});
  }
  if (message?.type === "dynamic") return native({type:"dynamic",url:message.url||"",classes:message.classes||[],ids:message.ids||[],exceptions:message.exceptions||[]});
  return undefined;
});
browser.runtime.onInstalled.addListener(() => syncState());
browser.runtime.onStartup.addListener(() => { connectNative(); syncState(); });
(async()=>{ connectNative(); await syncState(); if (state.enabled && (state.forceRefresh || !state.ready)) await buildEngine(""); })();