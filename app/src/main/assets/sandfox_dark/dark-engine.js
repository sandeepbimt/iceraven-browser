/* Sandfox Dark Engine v1: UltimaDark-inspired, color-preserving Gecko content layer. */
(() => {
  "use strict";
  const KEY = "sandfoxDarkSettings";
  const MARK = "data-sandfox-dark";
  const DEFAULTS = Object.freeze({
    enabled: true, threshold: .20, peak: .23, floor: .08,
    fgFloor: .78, fgCeiling: .96, oled: false, excludedSites: []
  });
  let cfg = { ...DEFAULTS }, excluded = false, queued = false, busy = false;
  const doneSheets = new WeakSet(), doneStyles = new WeakSet(), doneNodes = new WeakSet();
  const COLORS = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch?\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|\b(?:black|white|red|green|blue|yellow|orange|purple|gray|grey|transparent)\b)/gi;

  const hostExcluded = () => {
    const h = location.hostname.toLowerCase();
    return !h || cfg.excludedSites.some(x => { const s = String(x).trim().toLowerCase(); return s && (h === s || h.endsWith("." + s)); });
  };

  function guard() {
    if (!document.documentElement || document.documentElement.hasAttribute(MARK)) return;
    const s = document.createElement("style");
    s.setAttribute(MARK, "guard");
    s.textContent = ":root{color-scheme:dark!important}html,body{scrollbar-color:rgba(220,220,220,.45) rgba(20,20,20,.55)}::selection{background:rgba(130,170,255,.35)!important}";
    document.documentElement.appendChild(s);
  }

  function color(token, kind) {
    if (/^(transparent|currentcolor|inherit|initial|unset|revert|revert-layer)$/i.test(token.trim())) return token;
    if (kind === "bg") {
      const over = `clamp(0,(l - ${cfg.threshold} + .00001)*infinity,1)`;
      const floor = cfg.oled ? .02 : cfg.floor;
      const target = `calc(l*(1-${over})+min(${cfg.peak},max(${floor},calc(${cfg.peak}-(l-${cfg.threshold})*.18)))*${over})`;
      return `oklch(from ${token} ${target} c h / alpha)`;
    }
    const target = `clamp(${cfg.fgFloor},calc(${cfg.fgFloor}+l*.22),${cfg.fgCeiling})`;
    return `oklch(from ${token} ${target} c h / alpha)`;
  }

  function value(text, kind) { return text.replace(COLORS, token => color(token, kind)); }

  function propertyKind(p) {
    p = p.toLowerCase();
    if (p === "background" || p === "background-color" || p === "box-shadow" || p === "text-shadow") return "bg";
    if (p === "color" || p === "fill" || p === "stroke" || p === "caret-color" || p === "text-decoration-color" || p.startsWith("border") || p === "outline" || p === "outline-color") return "fg";
    return null;
  }

  function rewriteStyle(style) {
    for (let i = 0; i < style.length; i++) {
      const p = style[i], kind = propertyKind(p);
      if (!kind) continue;
      const before = style.getPropertyValue(p), after = value(before, kind);
      if (after !== before) style.setProperty(p, after, style.getPropertyPriority(p));
    }
  }

  function rewriteRule(rule) {
    try {
      if (rule.style) rewriteStyle(rule.style);
      if (rule.cssRules) [...rule.cssRules].forEach(rewriteRule);
    } catch (_) {}
  }

  function cloneSheet(text, tag) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      [...sheet.cssRules].forEach(rewriteRule);
      const out = [...sheet.cssRules].map(r => r.cssText).join("\n");
      if (!out) return null;
      const s = document.createElement("style");
      s.setAttribute(MARK, tag);
      s.textContent = out;
      return s;
    } catch (_) { return null; }
  }

  async function link(link) {
    if (!link.href || doneSheets.has(link)) return;
    doneSheets.add(link);
    try {
      const r = await fetch(link.href, { credentials: "include", cache: "force-cache" });
      if (!r.ok) return;
      const s = cloneSheet(await r.text(), "sheet");
      if (s) link.after(s);
    } catch (_) {}
  }

  function inlineStyle(s) {
    if (doneStyles.has(s)) return;
    doneStyles.add(s);
    const clone = cloneSheet(s.textContent || "", "inline");
    if (clone) s.after(clone);
  }

  function inlineNode(el) {
    if (doneNodes.has(el) || el.hasAttribute(MARK) || !el.getAttribute("style")) return;
    doneNodes.add(el);
    try { rewriteStyle(el.style); } catch (_) {}
  }

  async function process() {
    if (busy || excluded) return;
    busy = true;
    try {
      await Promise.all([...document.querySelectorAll("link[rel~='stylesheet'][href]")].map(link));
      document.querySelectorAll(`style:not([${MARK}])`).forEach(inlineStyle);
      document.querySelectorAll("body,main,article,header,nav,section,aside,footer,form,dialog,pre,code,button,input,textarea,select").forEach(el => {
        if (el.getClientRects().length) inlineNode(el);
      });
    } finally { busy = false; }
  }

  function queue() {
    if (queued || busy) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; process(); });
  }

  async function init() {
    try { const x = await browser.storage.local.get(KEY); cfg = { ...DEFAULTS, ...(x?.[KEY] || {}) }; } catch (_) {}
    if (!cfg.enabled || hostExcluded()) { excluded = true; return; }
    guard();
    queue();
    new MutationObserver(ms => {
      let relevant = false;
      for (const m of ms) {
        if (m.type === "attributes") { doneNodes.delete(m.target); relevant = true; }
        if (m.type === "childList") for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE && (n.matches?.("style,link[rel~='stylesheet']") || n.querySelector?.("style,link[rel~='stylesheet']"))) relevant = true;
        }
      }
      if (relevant) queue();
    }).observe(document.documentElement || document, { subtree:true, childList:true, attributes:true, attributeFilter:["style"] });
  }

  browser.storage.onChanged?.addListener((c,a) => { if (a === "local" && c[KEY]) location.reload(); });
  init();
})();