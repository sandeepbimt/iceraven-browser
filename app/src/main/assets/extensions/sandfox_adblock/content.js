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


let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(async () => {
    scheduled = false;
    const classes = [];
    const ids = [];
    const seenClasses = new Set();
    const seenIds = new Set();

    for (const node of document.querySelectorAll("[class],[id]")) {
      for (const value of (node.getAttribute("class") || "").split(/\s+/)) {
        if (value && !seenClasses.has(value)) {
          seenClasses.add(value);
          classes.push(value);
        }
      }
      const id = node.getAttribute("id");
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        ids.push(id);
      }
      if (classes.length >= 250 || ids.length >= 250) break;
    }

    if (!classes.length && !ids.length) return;
    try {
      const result = await browser.runtime.sendMessage({
        type: "dynamic-cosmetic",
        classes,
        ids
      });
      apply(result || []);
    } catch (_) {}
  });
});

if (document.documentElement) {
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
