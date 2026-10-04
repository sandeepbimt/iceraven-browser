const nativeApp = "sandfox.elementPicker";
const registrations = new Map();

async function registerDomain(domain) {
  if (!domain || registrations.has(domain)) return;
  try {
    const registration = await browser.contentScripts.register({
      matches: ["*://*." + domain + "/*", "*://" + domain + "/*"],
      js: [{ file: "/cosmetic.js" }],
      runAt: "document_start"
    });
    registrations.set(domain, registration);
  } catch (_) {}
}

async function restoreRules() {
  const stored = await browser.storage.local.get("sandfoxCosmeticDomains");
  const rules = stored.sandfoxCosmeticDomains || {};
  for (const domain of Object.keys(rules)) await registerDomain(domain);
}

browser.runtime.onInstalled.addListener(restoreRules);
browser.runtime.onStartup.addListener(restoreRules);
restoreRules();

const port = browser.runtime.connectNative(nativeApp);
port.onMessage.addListener(async message => {
  if (!message || typeof message !== "object") return;
  if (message.type === "startPicker") {
    try { await browser.tabs.executeScript({file: "/picker.js", allFrames: false}); } catch (_) {}
  }
  if (message.type === "addCosmeticRule") {
    const domain = String(message.domain || "").toLowerCase();
    const selector = String(message.selector || "");
    if (!domain || !selector || selector.length > 2048) return;
    const stored = await browser.storage.local.get("sandfoxCosmeticDomains");
    const rules = stored.sandfoxCosmeticDomains || {};
    const list = Array.isArray(rules[domain]) ? rules[domain] : [];
    if (!list.includes(selector)) list.push(selector);
    rules[domain] = list.slice(-512);
    await browser.storage.local.set({sandfoxCosmeticDomains: rules});
    await registerDomain(domain);
  }
});
