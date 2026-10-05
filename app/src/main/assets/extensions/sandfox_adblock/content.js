const STYLE_ID = "sandfox-adblock-v1-cosmetic";
const seen = new Set();

function apply(selectors) {
  if (!Array.isArray(selectors) || !selectors.length) return;
  const valid = [];
  for (const selector of selectors) {
    if (typeof selector !== "string" || selector.length > 2048 || seen.has(selector)) continue;
    try {
      document.querySelector(selector);
      seen.add(selector);
      valid.push(selector);
    } catch (_) {}
  }
  if (!valid.length) return;

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.documentElement || document.head || document).appendChild(style);
  }
  style.textContent += "\n" + valid.map(s => s + "{display:none!important;}").join("\n");
}

browser.runtime.sendMessage({ type: "cosmetic", url: location.href })
  .then(result => apply(result?.hide_selectors || []))
  .catch(() => {});
