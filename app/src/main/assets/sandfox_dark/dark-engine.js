/*
 * Sandfox Dark Engine v1.
 * Inspired by the color-preserving, preemptive strategy of UltimaDark, but implemented as
 * a smaller Gecko-native first-party engine. It rewrites author CSS at document_start rather
 * than using page-wide inversion, so images/video/canvas are not blindly inverted.
 */
(() => {
  "use strict";

  const KEY = "sandfoxDarkSettings";
  const MARK = "data-sandfox-dark";
  const DEFAULTS = {
    enabled: true,
    mode: "smart",
    threshold: 0.20,
    backgroundPeak: 0.23,
    backgroundFloor: 0.08,
    foregroundFloor: 0.78,
    foregroundCeiling: 0.96,
    preserveImages: true,
    oled: false,
    excludedSites: []
  };

  let settings = { ...DEFAULTS };
  let nativeDark = false;
  let excluded = false;
  let queued = false;
  let busy = false;
  const processedSheets = new WeakSet();
  const processedStyles = new WeakSet();
  const processedElements = new WeakSet();

  const COLOR = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch?\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|\b(?:black|white|red|green|blue|yellow|orange|purple|gray|grey|transparent)\b)/gi;

  function hostExcluded() {
    const h = location.hostname.toLowerCase();
    return !h || settings.excludedSites.some(site => {
      const s = String(site).trim().toLowerCase();
      return s && (h === s || h.endsWith("." + s));
    });
  }

  function earlyGuard() {
    if (!document.documentElement || document.documentElement.hasAttribute(MARK)) return;
    const style = document.createElement("style");
    style.setAttribute(MARK, "guard");
    style.textContent = `
      :root { color-scheme: dark !important; }
      html, body { scrollbar-color: rgba(220,220,220,.45) rgba(20,20,20,.55); }
      ::selection { background: rgba(130,170,255,.35) !important; }
    `;
    document.documentElement.appendChild(style);
  }

  // Piecewise UltimaDark-style lightness mapping, expressed in OKLCH so Gecko does the
  // color conversion. Colors below the threshold are preserved; bright surfaces are compressed
  // toward a controlled dark peak. Foreground is moved into a readable light band.
  function replacement(token, kind) {
    if (/^(transparent|currentcolor|inherit|initial|unset|revert|revert-layer)$/i.test(token.trim())) return token;
    if (kind === "background") {
      const over = `clamp(0, (l - ${settings.threshold} + 0.00001) * infinity, 1)`;
      const floor = settings.oled ? 0.02 : settings.backgroundFloor;
      const target = `calc(l * (1 - ${over}) + min(${settings.backgroundPeak}, max(${floor}, calc(${settings.backgroundPeak} - (l - ${settings.threshold}) * 0.18))) * ${over})`;
      return `oklch(from ${token} ${target} c h / alpha)`;
    }
    const target = `clamp(${settings.foregroundFloor}, calc(${settings.foregroundFloor} + (l * 0.22)), ${settings.foregroundCeiling})`;
    return `oklch(from ${token} ${target} c h / alpha)`;
  }

  function transformColors(value, kind) {
    if (!value || /url\(/i.test(value) && kind === "background-image") return value;
    return value.replace(COLOR, token => replacement(token, kind));
  }

  function kindForProperty(property) {
    const p = property.toLowerCase();
    if (p === "background" || p === "background-color" || p === "box-shadow" || p === "text-shadow") return "background";
    if (p === "color" || p === "fill" || p === "stroke" || p === "caret-color" || p === "text-decoration-color" || p.startsWith("border") || p === "outline" || p === "outline-color") return "foreground";
    return null;
  }

  function transformStyle(style) {
    for (let i = 0; i < style.length; i++) {
      const property = style[i];
      const kind = kindForProperty(property);
      if (!kind) continue;
      const before = style.getPropertyValue(property);
      const after = transformColors(before, kind);
      if (after !== before) style.setProperty(property, after, style.getPropertyPriority(property));
    }
  }

  function transformRule(rule) {
    try {
      if (rule.style) transformStyle(rule.style);
      if (rule.cssRules) for (const child of [...rule.cssRules]) transformRule(child);
    } catch (_) {
      // A single unsupported rule must never disable the page or the rest of dark mode.
    }
  }

  function makeStyle(text, marker) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      for (const rule of [...sheet.cssRules]) transformRule(rule);
      const output = [...sheet.cssRules].map((rule => rule.cssText)).join("\n");
      if (!output) return null;
      const style = document.createElement("style");
      style.setAttribute(MARK, marker);
      style.textContent = output;
      return style;
    } catch (_) {
      return null;
    }
  }

  async function processLink(link) {
    if (!link.href || processedSheets.has(link)) return;
    processedSheets.add(link);
    try {
      const response = await fetch(link.href, { credentials: "include", cache: "force-cache" });
      if (!response.ok) return;
      const style = makeStyle(await response.text(), "sheet");
      if (style) link.after(style);
    } catch (_) {
      // Keep the original stylesheet untouched if it cannot be read or parsed.
    }
  }

  function processInline(style) {
    if (processedStyles.has(style)) return;
    processedStyles.add(style);
    const clone = makeStyle(style.textContent || "", "inline");
    if (clone) style.after(clone);
  }

  function processInlineElement(element) {
    if (processedElements.has(element) || element.hasAttribute(MARK)) return;
    if (!element.getAttribute("style")) return;
    processedElements.add(element);
    try { transformStyle(element.style); } catch (_) {}
  }

  function detectNativeDark() {
    if (!document.documentElement) return false;
    const root = getComputedStyle(document.documentElement);
    const body = document.body ? getComputedStyle(document.body) : root;
    const rgb = value => {
      const m = value.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\w.]+), ]+\s*([\d.]+)/i);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const lum = c => c ? (0.2126*c[0] + 0.7152*c[1] + 0.0722*n[2]) / 255 : 255;
    return Math.min(lum(rgb(root.backgroundColor)), lum(rgb(body.backgroundColor))) < 55;
  }

  async function processPage() {
    if (busy || nativeDark || excluded) return;
    busy = true;
    try {
      const links = [...document.querySelectorAll("link[rel~='stylesheet'][href]")];
      const styles = [...document.querySelectorAll(`style:not([${MARK}])`)]tì(€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡±¥¹­Ì¹µ…À¡ÁÉ½•ÍÍ1¥¹¬¤¤ì(€€€€€ÍÑå±•Ì¹™½É… ¡ÁÉ½•ÍÍ%¹±¥¹”¤ì(€€€€€™½È€¡½¹ÍÐ•°½˜‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰½‘ä±µ…¥¸±…ÉÑ¥±”±¡•…‘•È±¹…Ø±Í•Ñ¥½¸±…Í¥‘”±™½½Ñ•È±™½É´±‘¥…±½œ±ÁÉ”±½‘”±‰ÕÑÑ½¸±¥¹ÁÕÐ±Ñ•áÑ…É•„±Í•±•Ðˆ¤¤ì(€€€€€€€¥˜€¡•°¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ ¤ÁÉ½•ÍÍ%¹±¥¹•±•µ•¹Ð¡•°¤ì(€€€€€ô(€€€ô™¥¹…±±äì(€€€€€‰ÕÍä€ô™…±Í”ì(€€€ô(€ô((€™Õ¹Ñ¥½¸ÅÕ•Õ” ¤ì(€€€¥˜€¡ÅÕ•Õ•ñð‰ÕÍä¤É•ÑÕÉ¸ì(€€€ÅÕ•Õ•€ôÑÉÕ”(€€€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”  ¤€ôøì(€€€€€ÅÕ•Õ•€ô™…±Í”ì(€€€€€ÁÉ½•ÍÍA…” ¤ì(€€€ô¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸¥¹¥Ð ¤ì(€€€ÑÉäì(€€€€€½¹ÍÐÍÑ½É•€ô…Ý…¥Ð‰É½ÝÍ•È¹ÍÑ½É…”¹±½…°¹•Ð¡-d¤ì(€€€€€Í•ÑÑ¥¹Ì€ôì€¸¸¹U1QL°€¸¸¸¡ÍÑ½É•ü¹m-etñðíô¤ôì(€€€ô…Ñ €¡|¤íô(€€€¥˜€ …Í•ÑÑ¥¹Ì¹•¹…‰±•¤É•ÑÕÉ¸ì(€€€•á±Õ‘•€ô¡½ÍÑá±Õ‘• ¤ì(€€€¥˜€¡•á±Õ‘•¤É•ÑÕÉ¸ì(€€€•…É±åÕ…É ¤ì(€€€¹…Ñ¥Ù•…É¬€ô‘•Ñ•Ñ9…Ñ¥Ù•…É¬ ¤ì(€€€¥˜€¡‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð¤‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð¹Í•ÑÑÑÉ¥‰ÕÑ”¡5I,°¹…Ñ¥Ù•…É¬€ü€‰¹…Ñ¥Ù”ˆ€è€‰Í…¹‘™½àˆ¤ì(€€€ÅÕ•Õ” ¤ì((€€€½¹ÍÐ½‰Í•ÉÙ•È€ô¹•Ü5ÕÑ…Ñ¥½¹=‰Í•ÉÙ•È¡µÕÑ…Ñ¥½¹Ì€ôøì(€€€€€±•ÐÉ•±•Ù…¹Ð€ô™…±Í”ì(€€€€€™½È€¡½¹ÍÐµÕÑ…Ñ¥½¸½˜µÕÑ…Ñ¥½¹Ì¤ì(€€€€€€€¥˜€¡µÕÑ…Ñ¥½¸¹ÑåÁ”€ôôô€‰…ÑÑÉ¥‰ÕÑ•Ìˆ€˜˜µÕÑ…Ñ¥½¸¹…ÑÑÉ¥‰ÕÑ•9…µ”€ôôô€‰ÍÑå±”ˆ¤ì(€€€€€€€€€É•±•Ù…¹Ð€ôÑÉÕ”ì(€€€€€€€€€ÁÉ½•ÍÍ•‘±•µ•¹ÑÌ¹‘•±•Ñ”¡µÕÑ…Ñ¥½¸¹Ñ…É•Ð¤ì(€€€€€€€ô(€€€€€€€¥˜€¡µÕÑ…Ñ¥½¸¹ÑåÁ”€ôôô€‰¡¥±‘1¥ÍÐˆ¤ì(€€€€€€€€€™½È€¡½¹ÍÐ¹½‘”½˜µÕÑ…Ñ¥½¸¹…‘‘•‘9½‘•Ì¤ì(€€€€€€€€€€€¥˜€¡¹½‘”¹¹½‘•QåÁ”€„ôô9½‘”¹159Q}9=¤½¹Ñ¥¹Õ”ì(€€€€€€€€€€€½¹ÍÐ•°€ô€¼¨¨ÑåÁ”í±•µ•¹Ñô€¨¼€¡¹½‘”¤ì(€€€€€€€€€€€¥˜€¡•°¹µ…Ñ¡•Ìü¸ ‰ÍÑå±”±±¥¹­mÉ•±øôÍÑå±•Í¡••Ðtˆ¤ñð•°¹ÅÕ•ÉåM•±•Ñ½Èü¸ ‰ÍÑå±”±±¥¹­mÉ•±øôÍÑå±•Í¡••Ðtˆ¤¤É•±•Ù…¹Ð€ôÑÉÕ”ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€ô(€€€€€¥˜€¡É•±•Ù…¹Ð¤ÅÕ•Õ” ¤ì(€€€ô¤ì(€€€½‰Í•ÉÙ•È¹½‰Í•ÉÙ”¡‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ðñð‘½Õµ•¹Ð°ì¡¥±‘1¥ÍÐèÑÉÕ”°ÍÕ‰ÑÉ•”èÑÉÕ”°…ÑÑÉ¥‰ÕÑ•ÌèÑÉÕ”°…ÑÑÉ¥‰ÕÑ•¥±Ñ•Èèl‰ÍÑå±”‰tô¤ì(€ô((€‰É½ÝÍ•È¹ÍÑ½É…”¹½¹¡…¹•ü¹…‘‘1¥ÍÑ•¹•È ¡¡…¹•Ì°…É•„¤€ôøì(€€€¥˜€¡…É•„€ôôô€‰±½…°ˆ€˜˜¡…¹•Ím-et¤±½…Ñ¥½¸¹É•±½… ¤ì(€ô¤ì((€¥¹¥Ð ¤ì)ô¤ ¤ì(