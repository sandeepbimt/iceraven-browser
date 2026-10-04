(() => {
  const domain = location.hostname.toLowerCase();
  browser.storage.local.get("sandfoxCosmeticDomains").then(data => {
    const selectors = (data.sandfoxCosmeticDomains || {})[domain];
    if (!Array.isArray(selectors) || !selectors.length) return;
    const valid = selectors.filter(selector => {
      if (typeof selector !== "string" || !selector.length || selector.length > 2048) return false;
      try { document.querySelector(selector); return true; } catch (_) { return false; }
    });
    if (!valid.length) return;
    const style = document.createElement("style");
    style.id = "__sandfox_cosmetic_rules";
    style.textContent = valid.map(selector => selector + " { display:none !important; }").join("\n");
    (document.head || document.documentElement).appendChild(style);
  }).catch(() => {});
})();
