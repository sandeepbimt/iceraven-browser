(() => {
  if (window.__sandfoxElementPickerActive) return;
  window.__sandfoxElementPickerActive = true;
  let current = null;
  const overlay = document.createElement("div");
  overlay.id = "__sandfox_picker_overlay";
  overlay.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4da3ff;background:rgba(77,163,255,.12);box-sizing:border-box;display:none;";
  document.documentElement.appendChild(overlay);

  function selectorFor(element) {
    if (!(element instanceof Element)) return null;
    if (element.id) {
      const candidate = "#" + CSS.escape(element.id);
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (_) {}
    }
    const classes = Array.from(element.classList).filter(c => c && !/^css-|^sc-|^jsx-|^ng-/.test(c)).slice(0, 3);
    const candidates = [];
    if (classes.length) candidates.push(element.tagName.toLowerCase() + classes.map(c => "." + CSS.escape(c)).join(""));
    const testid = element.getAttribute("data-testid");
    if (testid) candidates.push(element.tagName.toLowerCase() + "[data-testid=\"" + CSS.escape(testid) + "\"]");
    for (const candidate of candidates) {
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (_) {}
    }
    const parts = [];
    let node = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth++, node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const useful = Array.from(node.classList).filter(c => c && !/^css-|^sc-|^jsx-|^ng-/.test(c)).slice(0, 2);
      part += useful.map(c => "." + CSS.escape(c)).join("");
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (_) {}
    }
    return element.tagName.toLowerCase();
  }

  function highlight(element) {
    current = element;
    const rect = element.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
  }

  function cleanup() {
    overlay.remove();
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("click", pick, true);
    document.removeEventListener("keydown", cancel, true);
    window.__sandfoxElementPickerActive = false;
  }
  function move(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (element && element !== overlay) highlight(element);
  }
  function pick(event) {
    event.preventDefault();
    event.stopPropagation();
    const element = current || event.target;
    const selector = selectorFor(element);
    if (!selector) return;
    let matches = 0;
    try { matches = document.querySelectorAll(selector).length; } catch (_) {}
    const text = (element.innerText || element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 160);
    cleanup();
    browser.runtime.sendNativeMessage("sandfox.elementPicker", {type:"selected", domain:location.hostname, selector:selector, matches:matches, tag:element.tagName.toLowerCase(), text:text});
  }
  function cancel(event) {
    if (event.key === "Escape") {
      cleanup();
      browser.runtime.sendNativeMessage("sandfox.elementPicker", {type:"cancelled"});
    }
  }
  document.addEventListener("pointermove", move, true);
  document.addEventListener("click", pick, true);
  document.addEventListener("keydown", cancel, true);
})();
