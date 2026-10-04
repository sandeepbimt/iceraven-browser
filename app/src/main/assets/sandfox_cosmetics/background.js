const LIST_URLS = {
  "ublock-filters": "https://ublockorigin.github.io/uAssets/filters/filters.min.txt",
  "ublock-privacy": "https://ublockorigin.github.io/uAssets/filters/privacy.min.txt",
  "ublock-unbreak": "https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt",
  "easylist": "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt",
  "easyprivacy": "https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt",
  "adguard-generic": "https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt",
  "adguard-mobile": "https://filters.adtidy.org/extension/ublock/filters/11.txt",
  "fanboy-cookiemonster": "https://ublockorigin.github.io/uAssets/thirdparties/easylist-cookies.txt",
  "adguard-cookies": "https://filters.adtidy.org/extension/ublock/filters/18.txt",
  "ublock-cookies-adguard": "https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt",
  "fanboy-social": "https://ublockorigin.github.io/uAssets/thirdparties/easylist-social.txt",
  "adguard-social": "https://filters.adtidy.org/extension/ublock/filters/4.txt",
  "fanboy-thirdparty_social": "https://secure.fanboy.co.nz/fanboy-antifacebook.txt",
  "fanboy-ai-suggestions": "https://ublockorigin.github.io/uAssets/thirdparties/easylist-ai.txt",
  "ublock-annoyances": "https://ublockorigin.github.io/uAssets/filters/annoyances.txt",
  "adguard-annoyances": "https://filters.adtidy.org/extension/ublock/filters/14.txt",
  "easylist-chat": "https://ublockorigin.github.io/uAssets/thirdparties/easylist-chat.txt",
  "easylist-newsletters": "https://ublockorigin.github.io/uAssets/thirdparties/easylist-newsletters.txt",
  "easylist-notifications": "https://ublockorigin.github.io/uAssets/thirdparties/easylist-notifications.txt",
  "easylist-annoyances": "https://ublockorigin.github.io/uAssets/thirdparties/easylist-annoyances.txt"
};

const CACHE_KEY = "sandfoxCosmeticLists";
const CONFIG_KEY = "sandfoxCosmeticConfig";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_RULES_PER_LIST = 9000;
const MAX_GENERIC_PER_LIST = 500;
const MAX_TOTAL_RULES = 30000;
const MAX_GENERIC_TOTAL = 800;
const GENERIC_HINTS = [
  "cookie", "consent", "gdpr", "privacy", "notice", "newsletter",
  "subscribe", "social", "popup", "modal", "overlay", "banner",
  "advert", "notification", "paywall", "dialog", "app"
];

let config = {
  enabled: true,
  globalLists: [],
  customFilters: "",
  siteListOverrides: {},
  siteEnabledOverrides: {}
};

function safeHost(host) {
  return typeof host === "string" && host.length > 0 && host.length <= 253
    ? host.toLowerCase().replace(/^www\./, "")
    : "";
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function parseSelector(raw) {
  let selector = raw.trim();
  if (!selector || selector.length > 2048) return null;
  if (selector.startsWith("+js(") || selector.startsWith("^")) return null;
  if (/:has-text\(|:matches-(?:attr|css|css-before|css-after|media|path|prop)\(/i.test(selector)) return null;
  if (/:upward\(|:watch-attr\(|:xpath\(|:min-text-length\(/i.test(selector)) return null;
  if (/:remove-attr\(|:remove-class\(/i.test(selector)) return null;

  if (/:remove\(\)\s*$/i.test(selector)) {
    return { selector: selector.replace(/:remove\(\)\s*$/i, ""), style: "display:none !important;" };
  }

  const styleMatch = selector.match(/:style\(([^()]*)\)\s*$/i);
  if (styleMatch) {
    const base = selector.slice(0, styleMatch.index).trim();
    const style = styleMatch[1].trim();
    if (!base || !style || /[{}]/.test(style)) return null;
    return { selector: base, style: style.endsWith(";") ? style : style + ";" };
  }

  if (selector.includes(":matches-") || selector.includes(":xpath(")) return null;
  return { selector, style: "display:none !important;" };
}

function genericAllowed(selector) {
  const lower = selector.toLowerCase();
  return GENERIC_HINTS.some(token => lower.includes(token));
}

function addRule(map, domain, selector, style) {
  const current = map[domain] || [];
  if (current.length >= MAX_RULES_PER_LIST) return;
  const existing = current.find(item => item.s === selector);
  if (existing) {
    if (style && existing.st !== style) existing.st = style;
    return;
  }
  current.push({ s: selector, st: style });
  map[domain] = current;
}

function parseList(text) {
  const rules = {};
  const exceptions = {};

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[Adblock")) continue;

    let operator = line.indexOf("#@#");
    const isException = operator >= 0;
    if (operator < 0) operator = line.indexOf("##");
    if (operator < 0) continue;

    const domainPart = line.slice(0, operator).trim();
    const selector = parseSelector(line.slice(operator + (isException ? 3 : 2)));
    if (!selector) continue;

    const domains = domainPart ? domainPart.split(",").map(d => d.trim().toLowerCase()) : ["*"];
    const positives = domains.filter(d => d && !d.startsWith("~") && d !== "*");
    const negatives = domains.filter(d => d.startsWith("~")).map(d => d.slice(1)).filter(Boolean);

    if (!domainPart || domainPart === "*") {
      if (isException) addRule(exceptions, "*", selector.selector, selector.style);
      else if (genericAllowed(selector.selector)) addRule(rules, "*", selector.selector, selector.style);
      continue;
    }

    if (!positives.length) continue;
    for (const domain of positives) {
      if (domain.includes("*") || domain.includes("/") || domain.length > 253) continue;
      // Negated domains are intentionally ignored when they are mixed with positives;
      // this avoids false-positive hiding on sites for which a list explicitly excludes a rule.
      if (negatives.length) continue;
      if (isException) addRule(exceptions, domain, selector.selector, selector.style);
      else addRule(rules, domain, selector.selector, selector.style);
    }
  }

  return { rules, exceptions };
}

async function syncConfig() {
  try {
    const nativeConfig = await browser.runtime.sendNativeMessage(
      "sandfox.cosmetics",
      { type: "getConfig" }
    );
    if (nativeConfig && typeof nativeConfig === "object") {
      config = nativeConfig;
      await browser.storage.local.set({ [CONFIG_KEY]: config });
      await refreshSelected(Boolean(config.forceRefresh));
    }
  } catch (_) {}
}

browser.runtime.onMessage.addListener(message => {
  if (!message || message.type !== "getConfig") return undefined;
  return syncConfig().then(() => config);
});

browser.runtime.onInstalled.addListener(() => syncConfig());

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[CONFIG_KEY]) {
    config = changes[CONFIG_KEY].newValue || config;
    applyCosmetics();
  }
});

applyCosmetics();
