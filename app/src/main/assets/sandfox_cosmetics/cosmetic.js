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

function genericSelectorKey(selector) {
  const match = String(selector || "").match(/^(?:[a-z][a-z0-9_-]*)?([.#])([a-zA-Z0-9_-]+)/);
  return match ? match[1] + match[2] : "";
}

function pageGenericKeys() {
  const keys = new Set();
  const root = document.documentElement;
  if (!root) return keys;
  for (const element of root.querySelectorAll("[class],[id]")) {
    for (const name of element.classList || []) keys.add("." + name);
    if (element.id) keys.add("#" + element.id);
  }
  if (root.id) keys.add("#" + root.id);
  for (const name of root.classList || []) keys.add("." + name);
  return keys;
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

  // Brave's native cosmetic cache avoids injecting every generic selector into
  // every page. Mirror that keying strategy here until Gecko exposes the native
  // CosmeticFilterCache API to the Android embedding layer: only generic rules
  // whose leading class/id is actually present on this document are injected.
  const genericKeys = pageGenericKeys();
  const genericApplied = new Set();
  for (const item of rules["*"] || []) {
    if (matchingExceptions.has(item.s)) continue;
    const key = genericSelectorKey(item.s);
    if (key ? genericKeys.has(key) : /(?:ad|ads|advert|sponsor|promot|cookie|consent|newsletter|notification|social|popup|modal|overlay|banner|paywall)/i.test(item.s)) {
      const dedupe = item.s + "\u0000" + item.st;
      if (!genericApplied.has(dedupe)) {
        genericApplied.add(dedupe);
        add(item);
      }
    }
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

  // CSS rules automatically cover future matching nodes. The observer only discovers
  // newly introduced class/id keys so generic rules stay selective on SPAs and
  // lazy-loaded pages without rescanning the whole DOM.
  const observedKeys = new Set(genericKeys);
  const observer = new MutationObserver(mutations => {
    const pendingKeys = new Set();
    let inspected = 0;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        for (const element of [node, ...node.querySelectorAll("[class],[id]")]) {
          for (const name of element.classList || []) pendingKeys.add("." + name);
          if (element.id) pendingKeys.add("#" + element.id);
          if (++inspected >= 250) break;
        }
        if (inspected >= 250) break;
      }
      if (inspected >= 250) break;
    }
    const additions = [];
    for (const key of pendingKeys) {
      if (observedKeys.has(key)) continue;
      observedKeys.add(key);
      for (const item of rules["*"] || []) {
        if (matchingExceptions.has(item.s)) continue;
        if (genericSelectorKey(item.s) !== key) continue;
        const rule = item.s + "{" + item.st + "}";
        if (!style.textContent.includes(rule)) additions.push(rule);
      }
    }
    if (additions.length) style.textContent += (style.textContent ? "\n" : "") + additions.join("\n");
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

applyCosmetics();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[CONFIG_KEY] || changes.sandfoxCosmeticLists)) {
    applyCosmetics();
  }
});
