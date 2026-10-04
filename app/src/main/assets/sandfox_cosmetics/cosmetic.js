const CONFIG_KEY = "sandfoxCosmeticConfig";
const STYLE_ID = "sandfox-cosmetic-filters";

function safeHost(host) {
  return typeof host === "string" && host.length > 0 && host.length <= 253
    ? host.toLowerCase().replace(/^www\./, "")
    : "";
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

async function applyCosmetics() {
  const host = safeHost(location.hostname);
  if (!host) return;

  let config = (await browser.storage.local.get(CONFIG_KEY))[CONFIG_KEY] || {};
  try {
    const fresh = await browser.runtime.sendMessage({ type: "getConfig" });
    if (fresh && typeof fresh === "object") config = fresh;
  } catch (_) {}
  const enabled = config.siteEnabledOverrides &&
    typeof config.siteEnabledOverrides[host] === "boolean"
      ? config.siteEnabledOverrides[host]
      : config.enabled !== false;

  let style = document.getElementById(STYLE_ID);
  if (!enabled) {
    if (style) style.textContent = "";
    return;
  }

  const cache = (await browser.storage.local.get("sandfoxCosmeticLists")).sandfoxCosmeticLists || {};
  const selected = config.siteListOverrides && Array.isArray(config.siteListOverrides[host])
    ? config.siteListOverrides[host]
    : (Array.isArray(config.globalLists) ? config.globalLists : []);

  const rules = {};
  const exceptions = {};
  for (const id of selected) {
    const item = cache[id];
    if (!item) continue;
    for (const [domain, selectors] of Object.entries(item.rules || {})) {
      rules[domain] = (rules[domain] || []).concat(selectors);
    }
    for (const [domain, selectors] of Object.entries(item.exceptions || {})) {
      exceptions[domain] = (exceptions[domain] || []).concat(selectors);
    }
  }

  const seen = new Set();
  const output = [];

  function add(item) {
    const key = item.s + "\u0000" + item.st;
    if (seen.has(key) || output.length >= 1200) return;
    seen.add(key);
    output.push(item);
  }

  const matchingExceptions = new Set((exceptions["*"] || []).map(item => item.s));
  for (const [domain, selectors] of Object.entries(exceptions)) {
    if (domain === "*" || !domainMatches(host, domain)) continue;
    for (const item of selectors) matchingExceptions.add(item.s);
  }

  for (const item of rules["*"] || []) {
    if (!matchingExceptions.has(item.s)) add(item);
  }

  for (const [domain, selectors] of Object.entries(rules)) {
    if (domain === "*" || !domainMatches(host, domain)) continue;
    for (const item of selectors) {
      if (!matchingExceptions.has(item.s)) add(item);
    }
  }

  const customExceptions = new Set();
  const customRules = [];
  for (const raw of String(config.customFilters || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[Adblock")) continue;
    let op = line.indexOf("#@#");
    const exception = op >= 0;
    if (op < 0) op = line.indexOf("##");
    if (op < 0) continue;
    const domains = line.slice(0, op).trim();
    const selector = line.slice(op + (exception ? 3 : 2)).trim();
    if (!selector || (domains && domains !== "*" &&
        !domains.split(",").some(d =>
          domainMatches(host, d.trim().toLowerCase().replace(/^www\./, ""))))) continue;
    if (exception) {
      customExceptions.add(selector);
    } else if (!selector.startsWith("+js(") &&
        !/:has-text\(|:matches-|:upward\(|:xpath\(/i.test(selector)) {
      customRules.push({s: selector, st: "display:none !important;"});
    }
  }
  for (const item of customRules) {
    if (!customExceptions.has(item.s)) add(item);
  }

  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute("data-sandfox", "cosmetic");
    (document.head || document.documentElement).appendChild(style);
  }

  if (!output.length) {
    style.textContent = "";
    return;
  }

  style.textContent = output.map(item => item.s + "{" + item.st + "}").join("\n");
}

applyCosmetics();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[CONFIG_KEY] || changes.sandfoxCosmeticLists)) {
    applyCosmetics();
  }
});
