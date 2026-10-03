// This file t.js serves two purposes:
// 1. It avoids pollution of the uDarkExtendedBackground with content script specific code
// 2. It allows the code mappiong and navigation of vscode to work properly

class uDarkExtendedContentScript  {
  
}
class Common {
  static appCompat(res) {

    if (uDark.browserInfo.version < 105 && uDark.browserInfo.name == "Firefox") {
      res.imageEditionEnabled = false;
      console.warn("Sandfox Dark", "Image edition is disabled on Firefox versions below 105, as it is not supported");
      globalThis.browser.storage.local.set(res);
    }
  }
};
class uDarkExtended extends uDarkExtendedContentScript {

  noBodyStatusCodes = {
    enforcedNoBody: {
      100: "Continue",
      101: "Switching Protocols",
      102: "Processing",
      103: "Early Hints",
      204: "No Content",
      205: "Reset Content",
      304: "Not Modified"
    },

    // Responses that are TYPICALLY EMPTY but NOT ENFORCED
    typicallyNoBody: {
      301: "Moved Permanently",
      302: "Found",
      303: "See Other",
      307: "Temporary Redirect",
      308: "Permanent Redirect"
    }
  }
  getNoBodyStatus_heuristic(details) {
    return false;
  }
  getNoBodyStatus(details) {
    let heuristic = this.getNoBodyStatus_heuristic(details);

    let resultStatus = {
      is_enforced_nobody: uDark.noBodyStatusCodes.enforcedNoBody[details.statusCode] || false,
      is_typical_nobody: uDark.noBodyStatusCodes.typicallyNoBody[details.statusCode] || false,
      is_heuristic_nobody: heuristic
    }
    return resultStatus;
  }
  handleCSSChunk_sync(data, verify, details, filter) {
    let str = details.rejectedValues;

    if (data && details.dataCount == 1) {
      details.dataBOMInfo = extractTextEncoderSupportedBOM(data)
      // If a BOM was preset we are sure about the charset; text decoder will override the charset if needed
      // But if there is none and we are in unspecifiedCharset (header) mode, we have to verify the charset from @charset
      if (!details.dataBOMInfo && details.unspecifiedCharset) {
        // console.log("Checking CSS @charset for charset detection", details.url);
        // console.log("Current charset", details.charset);
        // console.log("detectCSSCharset(data)", detectCSSCharset(data));
        // console.log("details.documentCharset", uDark.getPort(details).documentCharset);
        let fallBackCharset = detectCSSCharset(data) || uDark.getPort(details).documentCharset || "utf-8";
        details.charset = fallBackCharset;
      }
      details.unspecifiedCharset = false;

    }

    if (data) { str += uDarkDecode(details.charset, data, { stream: true }, details); }


    let options = {};

    options.chunk = uDark.edit_str(str, false, verify, details, false, options);


    if (options.chunk.message) {
      details.rejectedValues = str;  // Keep rejected values for later use
      return;
    } else {
      details.rejectedValues = "";
      if (options.chunk.rejected) {
        details.rejectedValues = options.chunk.rejected;

        options.chunk = options.chunk.str;
      }
    }

    filter.write(uDarkEncode(details.overrideEncodeCharset || details.charset, options.chunk));
  }
  settingsInContentScriptCSS() {
    let editedCSS = this.inject_css_override;
    let settingsToInject = {
      uDark_darken_A: this.userSettings.max_bright_bg,
      uDark_darken_B: this.userSettings.min_bright_bg,
      uDark_lighten_A: this.userSettings.min_bright_fg,
      uDark_lighten_B: this.userSettings.max_bright_fg,
      uDark_treshold: this.userSettings.min_bright_bg_trigger,
      uDark_darken_O1: this.userSettings.bg_negative_modifier,
      uDark_darken_O2: this.userSettings.fg_negative_modifier
    }
    Object.entries(settingsToInject).forEach(([key, value]) => {
      editedCSS = editedCSS.replace(new RegExp(`--${key}:\\s*[^;]+;`), `--${key}: ${value};`);
    });
    if (this.userSettings.bg_negative_modifier > 0 || this.userSettings.fg_negative_modifier > 0) {
      editedCSS = editedCSS.replace(/O1O2MModifiers_disabled:root/g, ":root");
    }
    return editedCSS;
  }
  getInjectCSS(resourcesPaths, actions = {}) {
    if (typeof resourcesPaths == "string") resourcesPaths = [resourcesPaths]
    return Promise.all(resourcesPaths.map(resourcePath =>
      fetch(resourcePath).then(r => r.text()).then(t => {
        let aCSSsrc = new CSSStyleSheet();
        aCSSsrc.replaceSync(t)
        return aCSSsrc;
      }).then(aCSSsrc => {
        uDark.edit_cssRules(aCSSsrc.cssRules, false, {}, function (rule) {
          // It's important to use Object.values as it retrieves values that could be ignored by "for var of rules.style"
          for (let key of Object.values(rule.style)) {

            // Here value can be empty string, if the key used in CSS is a shorthand property
            // like "background" and a var(--var) is used in the CSS but it's ok as we are here only searching for 
            // non conventional colors in gre-resources or removal of non-color properties and they don't use --vars.
            // !! Warning about css injected, or override css : var(--colors) does not match expected regex for colors but 
            // for this part xfunction is called with non-color properties so it falls OK
            let value = rule.style.getPropertyValue(key);

            if (actions.detectRareColors) {

              value = value.replace(/[a-z-0-9]+/g, function (match) {
                let is_color = uDark.is_color(match);
                return is_color ? uDark.rgba(...is_color, uDark.rgba_val) : match
              })
              if (actions.unsetMode == "fill_minimum" && value == "unset" && ["color", "background-color"].includes(key)) {
                value = uDark.hsla_val(0, 0, uDark.userSettings.max_bright_bg, 1)
              }
              let priority = rule.style.getPropertyPriority(key);
              rule.style.setProperty(key, value, priority);

            }

            if (actions.removeNonColors && !(value.match(uDark.hsl_a_colorsRegex) || value.match(uDark.rgb_a_colorsRegex))) {
              rule.style.removeProperty(key)
            }
          }
        })
        return aCSSsrc
      }).then(aCSS => {
        actions.edit_css && uDark.edit_css(aCSS)
        return aCSS
      }).then(aCSS => [...aCSS.cssRules].map(rule => rule.cssText).join("\n")).then(text => {
        for (let [key, item] of Object.entries(actions.set || {})) {
          item[key] = text
        }
        for (let [key, item] of Object.entries(actions.append || {})) {
          item[key] = (item[key] || "") + text
        }

      })));
  }
  registerCS(contentScriptRegister) {
    let defaultCS = {
      matches: uDark.userSettings.properWhiteList,
      runAt: "document_start",
      matchAboutBlank: true,
      allFrames: true
    };
    if (uDark.browserInfo.Mozilla_Firefox >= 128) {
      defaultCS.matchOriginAsFallback = true // This crucial feature is only available since FF 128
    }
    if (uDark.userSettings.properBlackList.length) {
      defaultCS.excludeMatches = uDark.userSettings.properBlackList;
    }
    let contentScript = {
      ...defaultCS,
      ...contentScriptRegister
    }

    const registrationPromise = browser.contentScripts.register(contentScript)
      .then(registration => {
        uDark.registeredCS.push(registration);
        return registration;
      });
    uDark.pendingCSRegistrations.add(registrationPromise);
    const removePendingRegistration = () => {
      uDark.pendingCSRegistrations.delete(registrationPromise);
    };
    registrationPromise.then(removePendingRegistration, removePendingRegistration);

    return registrationPromise;
  }
  properListToRegex(list) {
    return list.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Sanitize regex
      .replace(/(^<all_urls>|\\\*)/g, "(.*?)") // Allow wildcards
      .replace(/^(.*)$/g, "^$1$")).join("|").replace(/^$/, "no_match") // User multi match
  }
  async asyncFilter(array, asyncPredicate) {
    const results = await Promise.all(array.map(asyncPredicate));
    return array.filter((_, i) => results[i]);
  }
  setListener(initial) {
    const listenerUpdate = uDark.listenerUpdateQueue.then(
      () => uDark.applyListenerSettings(initial)
    );
    uDark.listenerUpdateQueue = listenerUpdate.catch(error => {
      uDark.error("Failed to update listeners", error);
    });
    return listenerUpdate;
  }
  async applyListenerSettings(initial) {
    let userSettings = uDark.userSettings;
    initial && Common.appCompat(userSettings);


    uDark.ensureBestRGBAFuncRef(); // Ensure the best rgba function is used, depending on user settings
    await uDark.getInjectAllCSS();
    uDark.userSettings.properWhiteList = (userSettings.inclusionPatterns).split("\n");

    uDark.userSettings.properWhiteList = await uDark.asyncFilter(uDark.userSettings.properWhiteList, uDark.filterValidExpression);

    // Process all exclusion patterns
    const allBlacklistPatterns = (userSettings.exclusionPatterns).split("\n");

    // Helper to filter by flag
    function filterByFlag(flagArr) {
      return allBlacklistPatterns
        .map(x => uDark.mapRegexAndRemoveUdFlag(x, flagArr, "erased"))
        .filter(x => x !== "erased" && x !== null && x !== undefined);
    }

    // Full exclusion (no flag or #ud_all)
    uDark.userSettings.properBlackList = filterByFlag(["", "all"]);
    uDark.userSettings.properBlackList = await uDark.asyncFilter(uDark.userSettings.properBlackList, uDark.filterValidExpression);
    uDark.userSettings.exclude_regex = uDark.properListToRegex(uDark.userSettings.properBlackList);

    // Images only
    uDark.userSettings.properBlackListImg = filterByFlag(["img"]);
    uDark.userSettings.properBlackListImg = await uDark.asyncFilter(uDark.userSettings.properBlackListImg, uDark.filterValidExpression);
    uDark.userSettings.exclude_regexImg = uDark.properListToRegex(uDark.userSettings.properBlackListImg);

    // CSS only
    uDark.userSettings.properBlackListCss = filterByFlag(["css"]);
    uDark.userSettings.properBlackListCss = await uDark.asyncFilter(uDark.userSettings.properBlackListCss, uDark.filterValidExpression);
    uDark.userSettings.exclude_regexCss = uDark.properListToRegex(uDark.userSettings.properBlackListCss);

    // Image resource only (#ud_imgr)
    uDark.userSettings.properBlackListImgr = filterByFlag(["imgr"]);
    uDark.userSettings.properBlackListImgr = await uDark.asyncFilter(uDark.userSettings.properBlackListImgr, uDark.filterValidExpression);
    uDark.userSettings.exclude_regexImgr = uDark.properListToRegex(uDark.userSettings.properBlackListImgr);

    // Resources only (CSS, JS, images)
    uDark.userSettings.properBlackListRes = filterByFlag(["res"]);
    uDark.userSettings.properBlackListRes = await uDark.asyncFilter(uDark.userSettings.properBlackListRes, uDark.filterValidExpression);
    uDark.userSettings.exclude_regexRes = uDark.properListToRegex(uDark.userSettings.properBlackListRes);



    uDark.fixedRandom = Math.random();

    {
      // Fix for Firefox filterResponseData bug:      
      browser.webNavigation.onBeforeNavigate.removeListener(Listeners.fixForFilterResponseDataFirefoxBug.registerOrUnregisterInternalPage);

    }
    {
      // Embeds inheritenance unregistering : 
      browser.runtime.onMessage.removeListener(Listeners.askSynchronousBgIdHelper);
      browser.webRequest.onBeforeRequest.removeListener(Listeners.askSynchronousBgId);
    }
    {
      // eligibility listeners removal
      browser.runtime.onConnect.removeListener(uDark.portConnected);
      browser.webNavigation.onBeforeNavigate.removeListener(Listeners.setEligibleRequestBeforeDataWL);
      browser.webNavigation.onBeforeNavigate.removeListener(Listeners.setEligibleRequestBeforeDataBL);
    }
    {
      // Main listeners removals
      browser.webRequest.onHeadersReceived.removeListener(Listeners.editBeforeData);
      browser.webRequest.onBeforeRequest.removeListener(Listeners.editBeforeRequestStyleSheet_sync);
      browser.webRequest.onHeadersReceived.removeListener(Listeners.editOnHeadersReceivedStyleSheet);
      browser.webRequest.onBeforeRequest.removeListener(Listeners.editBeforeRequestImage);
      browser.webRequest.onHeadersReceived.removeListener(Listeners.editOnHeadersImage);
    }
    await Promise.allSettled([...uDark.pendingCSRegistrations]);
    if (uDark.registeredCS && uDark.registeredCS.length) {
      const registrations = uDark.registeredCS.splice(0);
      await Promise.allSettled(
        registrations.map(registration => registration.unregister())
      );
    }
    if (uDark.stopListenersNow) {
      uDark.info("Listeners stopped by request");
      return;
    }
    // { // EvenOff listeners
    //   uDark.log("EvenOff listeners removed");
    //   browser.webRequest.onBeforeRequest.removeListener(Listeners.cancelPopupXHRCalls);
    //   browser.webRequest.onBeforeRequest.addListener(Listeners.cancelPopupXHRCalls, {
    //     urls: ["<all_urls>"],
    //     types: ["xmlhttprequest"]
    //   }, ["blocking"]);
    //   uDark.info("EvenOff listeners added");
    // }      
    // { // EvenOff listeners
    //   uDark.log("EvenOff listeners removed");
    //   browser.webRequest.onBeforeRequest.removeListener(Listeners.cancelPopupXHRCalls);
    //   browser.webRequest.onBeforeRequest.addListener(Listeners.cancelPopupXHRCalls, {
    //     urls: ["<all_urls>"],
    //     types: ["xmlhttprequest"]
    //   }, ["blocking"]);
    //   uDark.info("EvenOff listeners added");
    // }
    // uDark.registerCS({matches:["<all_urls>"],excludeMatches:null,js: [{file: "contentScriptEvenOff.js"}],css:[{file: "contentScriptEvenOff.css"}]});
    let isLightMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    let isAutoAndLight = (userSettings.isEnabled === 'auto' && isLightMode);

    if (userSettings.isEnabled && userSettings.properWhiteList.length && !isAutoAndLight) {


      browser.runtime.onConnect.addListener(uDark.portConnected);

      {
        // Firefox bug workaround:

        //     // https://bugzilla.mozilla.org/buglist.cgi?quicksearch=filterResponseData

        //     // https://bugzilla.mozilla.org/show_bug.cgi?id=1982934
        //     // https://bugzilla.mozilla.org/show_bug.cgi?id=1806476
        //     // https://bugzilla.mozilla.org/show_bug.cgi?id=1561604
        browser.webNavigation.onBeforeNavigate.addListener(Listeners.fixForFilterResponseDataFirefoxBug.registerOrUnregisterInternalPage);

      }
      if (userSettings.embedsInheritanceBehavior === "inheritFromParent") {
        uDark.info("Embeds inheritance behavior enabled, registering handlers");
        browser.runtime.onMessage.addListener(Listeners.askSynchronousBgIdHelper);


        browser.webRequest.onBeforeRequest.addListener(Listeners.askSynchronousBgId, {
          urls: [
            "*://isparentudark.udark/*"
          ],
          types: ["xmlhttprequest"]
        },
          ["blocking"]);
      }


      browser.webNavigation.onBeforeNavigate.addListener(Listeners.setEligibleRequestBeforeDataWL, {
        url: [{ urlMatches: uDark.properListToRegex(uDark.userSettings.properWhiteList) }],
      },);
      browser.webNavigation.onBeforeNavigate.addListener(Listeners.setEligibleRequestBeforeDataBL);

      browser.webRequest.onHeadersReceived.addListener(Listeners.editBeforeData, {
        urls: userSettings.properWhiteList,
        types: ["main_frame", "sub_frame"]
      },
        ["blocking", "responseHeaders"]);


      {

        browser.webRequest.onBeforeRequest.addListener(Listeners.editBeforeRequestStyleSheet_sync, {
          // urls: uDark.userSettings.properWhiteList, // We can't assume the css is on a whitelisted domain, we do it either via finding a registered content script or via checking later the documentURL
          urls: ["<all_urls>"],
          types: ["stylesheet"]
        },
          ["blocking"]);
        browser.webRequest.onHeadersReceived.addListener(Listeners.editOnHeadersReceivedStyleSheet, {
          // urls: uDark.userSettings.properWhiteList, // We can't assume the css is on a whitelisted domain, we do it either via finding a registered content script or via checking later the documentURL
          urls: ["<all_urls>"],
          types: ["stylesheet"]
        },
          ["blocking", "responseHeaders"]);
      }



      if (uDark.userSettings.imageEditionEnabled) {
        uDark.log("Image edition enabled", "Registering handlers");
        browser.webRequest.onBeforeRequest.addListener(Listeners.editBeforeRequestImage, {
          urls: ["<all_urls>"],


          // urls: uDark.userSettings.properWhiteList, // We can't assume the image is on a whitelisted domain, we do it either via finding a registered content script or via checking later the documentURL
          types: ["image", "imageset"]
        },
          ["blocking"]);
        browser.webRequest.onHeadersReceived.addListener(Listeners.editOnHeadersImage, {
          urls: ["<all_urls>"],
          // urls: uDark.userSettings.properWhiteList, // We can't assume the image is on a whitelisted domain, we do it either via finding a registered content script or via checking later the documentURL
          types: ["image", "imageset"]
        },
          ["blocking", "responseHeaders"]);

      }


      let contentScript = {
        js: [
          {
            file: "websitesOverrideScript.js"
          },
          {
            file: "contentScriptClass.js"
          },
          {
            code: `
                this.uDarkExtended=uDarkExtendedContentScript;
                window.userSettings = ${JSON.stringify(uDark.userSettings)};`
          },
          {
            file: "background.js",
          },
        ], // Forced overrides
        css: [{
          code: uDark.settingsInContentScriptCSS()
        }], // Forced overrides
      };
      if (uDark.browserInfo.Mozilla_Firefox >= 128) {
        contentScript.js[0] = { code: `window.world_injection_available = 1;` }
        uDark.registerCS({
          css: [{
            code: uDark.inject_css_override_top_only
          }],
          allFrames: false
        });

        uDark.registerCS({
          js: [
            {
              code: `class uDarkExtended{ install(){
              uDark.userSettings = ${JSON.stringify(uDark.getSafeUserSettings(uDark.userSettings))};
            }}`
            },
            {
              file: "background.js",
            },
            {
              file: "websitesOverrideScript.js"
            },
            {
              code: `WebsitesOverrideScript.override_website();`
            }
          ],
          world: "MAIN",
        });
      }

      uDark.registerCS({
        css: [{
          code: uDark.inject_css_override_top_only
        }],
        allFrames: false
      });
      uDark.registerCS(contentScript);
      uDark.registerCS({
        css: [{
          code: uDark.inject_css_override_top_only
        }],
        allFrames: false
      }); // Register a default content script, to be able to edit the page before the other one is loaded

    } else {
      uDark.info("UD Did not load : ",
        "White list", uDark.userSettings.properWhiteList,
        "UltimaDark enable state :", uDark.userSettings.isEnabled)
    }

    await Promise.allSettled([...uDark.pendingCSRegistrations]);

    browser.webRequest.handlerBehaviorChanged().then(x => uDark.info(`In-memory cache flushed`), error => console.error(`Error: ${error}`));
    browser.browsingData.removeCache({}).then(x => uDark.info(`Browser cache flushed`), error => console.error(`Error: ${error}`));

  }
  filterContentScript(x) {
    return x.match(/<all_urls>|^(https?|wss?|file|ftp|\*):\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^file:\/\/\/.*$|^resource:\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^about:$/)
  }
  async filterValidExpression(x) {
    try {
      await browser.contentScripts.register({ matches: [x], runAt: "#<udark>" })
    } catch (e) {
      return e.message.includes("#<udark>");
    }
  }
  mapRegexAndRemoveUdFlag(x, keepFlags = ["", "all"], notFoundValue = null) {
    let [pattern, flag] = x.split("#ud_");
    if (keepFlags.includes(flag) || !flag) {
      return pattern;
    }
    return notFoundValue;
  }

  getInjectAllCSS() {
    //reset suggested, override and top only:
    return Promise.all([
      this.getInjectCSS("/inject_css_suggested.css", {
        set: {
          inject_css_suggested: uDark,
        },
        edit_css: true
      }),
      this.getInjectCSS("/inject_css_suggested_no_edit.css", {
        append: {
          inject_css_suggested: uDark
        }
      }),
      this.getInjectCSS("/inject_css_override.css", {
        set: {
          inject_css_override: uDark
        },
        edit_css: true
      }),
      this.getInjectCSS("/inject_css_override_top_only.css", {
        set: {
          inject_css_override_top_only: uDark
        },
        edit_css: true
      }),
      this.getInjectCSS("/inject_css_override_no_edit.css", {
        append: {
          inject_css_override: uDark
        }
      }),
    ]).then(x => {
      uDark.info("All inject CSS loaded");
    });
  }

  async preparePool() {

    if (uDark.workerPoolReady) {
      uDark.info("Terminating previous worker pool");
      await uDark.imageWorkerPool.destroy();
      uDark.imageWorkerPool = null;
      uDark.workerPoolReady = false;
    }
    if (uDark.userSettings.pooledWorkersEnabled && uDark.userSettings.isEnabled && uDark.userSettings.imageEditionEnabled) {

      console.log("Preparing image worker pool", uDark.userSettings);
      let usedPoolWorker = uDark.imageWorkerJsFile[uDark.userSettings.imageDecisionLogic];

      uDark.workerPoolReady = true;
      let workerData = {};
      if (["pooledBench", "pooledAI"].includes(uDark.userSettings.imageDecisionLogic)) {
        let iaModelJsonClonable = fetch("imageWorker/imageClassifierModel.json").then(r => r.arrayBuffer());
        let iaModelWeightsClonable = fetch("imageWorker/imageClassifierModel.weights.bin").then(r => r.arrayBuffer());
        uDark.iaModelJsonBuffer = await iaModelJsonClonable;
        uDark.iaModelWeightsBuffer = await iaModelWeightsClonable;
        workerData.iaModelJsonBuffer = uDark.iaModelJsonBuffer;
        workerData.iaModelWeightsBuffer = uDark.iaModelWeightsBuffer;
        console.log("Image classification model buffers loaded");
      }

      const pool = new uDark.workerPool({
        size: navigator.hardwareConcurrency * 2,

        url: usedPoolWorker,
        workerData,

      });
      uDark.imageWorkerPool = pool;
      console.log("[Pool] sera prêt avec", pool.size, "workers.");
      await pool.init();

      console.log("[Pool] prêt avec", pool.size, "workers.");
    }
    else {
      uDark.info("Pooled workers disabled");
    }





  }

  install() {
    this.logPrefix = "UD";
    fetch("manifest.json").then(x => x.text()).then(x => JSON.parse(x.replace(/\s+\/\/.+/g, ""))).then(x => {
      uDark.production = x.browser_specific_settings.gecko.id;
      uDark.production = uDark.production && uDark.production != "{0a0f6dea-3957-4bb9-9eec-2ef2b9e5bcec}"
      if (uDark.production) {
        uDark.success("Production mode", uDark.production);
        [console.log, console.warn, console.table, console.info] = Array(20).fill(z => { })
      }
      else {
        uDark.success("Development mode", uDark);
      }

    });

    browser.runtime.onInstalled.addListener(uDark.onInstalled);
    Promise.all([
      browser.runtime.getBrowserInfo().then(x => {
        uDark.browserInfo = x;
        uDark.browserInfo.version = parseInt(x.version.split(".")[0]);
        uDark.browserInfo[[uDark.browserInfo.vendor, uDark.browserInfo.name].join("_")] = uDark.browserInfo.version;
      }),
      uDark.getInjectCSS("/inject_css_suggested.css", {
        append: {
          inject_css_suggested: uDark,
        },
        edit_css: true
      }),
      uDark.getInjectAllCSS(),
      new Promise(uDark.getSettings).then(uDark.preparePool),
      new Promise(uDark.installToggleSiteCommand)
    ]).then(x => uDark.info("CSS processed")).then(r => uDark.setListener(true));
    browser.storage.onChanged.addListener((changes, area) => {
      const isSyncUpdate = area == "sync" && (uDark.userSettings.syncSettingsEnabled || uDark.userSettings.syncListsEnabled);
      const isLocalUpdate = area == "local" && !(uDark.installOrUpdate++ == true);
      if (isLocalUpdate || isSyncUpdate) {
        uDark.success(isSyncUpdate ? "Sync data changed from another device" : "Settings changed");
        new Promise(uDark.getSettings).then(uDark.preparePool).then(uDark.setListener);
      }
    });
    {
      const mediaWatch = window.matchMedia('(prefers-color-scheme: light)');
      mediaWatch.addEventListener('change', e => {
        uDark.info("Color scheme changed, updating listeners");
        uDark.setListener();
      });
    }

  }

  async findMatchingTabPatterns(tab, patterns) {
    const matches = await Promise.all(patterns.map(async pattern => {
      try {
        const matchingTabs = await browser.tabs.query({
          url: pattern,
          windowId: tab.windowId,
          index: tab.index,
        });
        return matchingTabs.length ? pattern : null;
      } catch (error) {
        uDark.warn("Unable to test shortcut pattern", pattern, error);
        return null;
      }
    }));
    return matches.filter(Boolean);
  }

  async persistShortcutToggleLists(lists) {
    Object.assign(uDark.userSettings, lists);
    await browser.storage.local.set(lists);
    if (uDark.userSettings.syncListsEnabled) {
      await browser.storage.sync.set(lists);
    }
  }

  async toggleCurrentSiteFromShortcut() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    let url;
    try {
      url = new URL(tab.url);
    } catch (error) {
      uDark.warn("Shortcut ignored for invalid tab URL", tab.url);
      return;
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      uDark.warn("Shortcut ignored for unsupported tab", tab.url);
      return;
    }

    const hostParts = url.hostname.split(".");
    const precision = Math.min(Number(uDark.userSettings.precisionNumber) || 2, hostParts.length);
    const targetHost = hostParts.slice(-precision).join(".");
    const targetPatterns = [`*://${targetHost}/*`, `*://*.${targetHost}/*`];
    const exclusions = uDark.userSettings.exclusionPatterns.split("\n").filter(pattern => pattern.trim());
    const inclusions = uDark.userSettings.inclusionPatterns.split("\n").filter(pattern => pattern.trim());
    const fullExclusionBases = exclusions
      .filter(pattern => {
        const flag = pattern.split("#ud_")[1];
        return !flag || flag === "all";
      })
      .map(pattern => pattern.split("#ud_")[0]);
    const matchingExclusions = await uDark.findMatchingTabPatterns(tab, fullExclusionBases);

    if (matchingExclusions.length) {
      const matchingSet = new Set(matchingExclusions);
      const nextExclusions = exclusions.filter(pattern => {
        const [base, flag] = pattern.split("#ud_");
        return !matchingSet.has(base) || (flag && flag !== "all");
      });
      for (const pattern of targetPatterns) {
        if (!inclusions.includes(pattern)) inclusions.push(pattern);
      }
      await uDark.persistShortcutToggleLists({
        exclusionPatterns: nextExclusions.join("\n"),
        inclusionPatterns: inclusions.join("\n"),
      });
      uDark.success("Shortcut included current site", targetHost);
    } else {
      for (const pattern of targetPatterns) {
        if (!exclusions.includes(pattern)) exclusions.push(pattern);
      }
      await uDark.persistShortcutToggleLists({
        exclusionPatterns: exclusions.join("\n"),
      });
      uDark.success("Shortcut excluded current site", targetHost);
    }

    if (uDark.userSettings.autoRefreshOnToggle) {
      await browser.tabs.reload(tab.id);
    }
  }

  async openShortcutToggleReview() {
    const actionApi = browser.browserAction || browser.action;
    if (!actionApi?.setPopup || !actionApi?.openPopup) {
      uDark.warn("Unable to open shortcut review popup");
      return;
    }
    const previousPopupPromise = actionApi.getPopup
      ? actionApi.getPopup({})
      : Promise.resolve("/popup/popup.html?mode=uDark-popup");
    const setPopupPromise = actionApi.setPopup({
      popup: "/popup/popup.html?mode=uDark-popup&action=toggleSite",
    });
    // Call openPopup immediately while the keyboard command still carries
    // user activation. Awaiting extension API calls first can lose it.
    const openPopupPromise = actionApi.openPopup();
    try {
      await Promise.all([setPopupPromise, openPopupPromise]);
    } finally {
      previousPopupPromise.then(previousPopup => {
        setTimeout(() => {
          actionApi.setPopup({ popup: previousPopup });
        }, 1000);
      });
    }
  }

  installToggleSiteCommand(resolve) {
    if (!browser.commands) {
      uDark.warn("Browser does not support commands, toggle site command will not be available");
      resolve();
      return;
    }
    browser.commands.onCommand.addListener(async command => {
      if (command === "toggle-site") {
        console.log("Shortcut triggered: toggle-site");
        if (uDark.userSettings.headlessShortcutToggleEnabled) {
          await uDark.toggleCurrentSiteFromShortcut();
        } else {
          await uDark.openShortcutToggleReview();
        }
      }
    });
    resolve();
  }
  onInstalled(details) {

    uDark.installOrUpdate = true;
    if (details.reason === "install") {
      uDark.info("Extension installed");
      browser.storage.local.set(uDark.userSettings).then(() => {
        uDark.info("Default user settings saved");
      });
    }
    else if (details.reason === "update") {
      uDark.info("Extension updated");
      browser.storage.local.get(null).then((res) => {
        uDark.info("Current user settings", res);
        let mergeSettings = {};
        Object.entries(uDark.userSettings).forEach(([key, value]) => {
          if (res[key] === undefined) {
            mergeSettings[key] = value;
          }
        });
        if (res.black_list) { // Legacy cleanup
          mergeSettings.exclusionPatterns = res.black_list;
          mergeSettings.inclusionPatterns = res.white_list;
          mergeSettings.isEnabled = !res.disable_webext;
          mergeSettings.imageEditionEnabled = !res.disable_image_edition;
          browser.storage.local.remove(["black_list", "white_list", "disable_webext", "disable_image_edition", "disable_cache"]);
        }
        uDark.info("Merging user settings", mergeSettings);
        browser.storage.local.set(mergeSettings).then(() => {
          uDark.info("User settings merged");
        });
      });
    }
  }
  // popupEmbedXHRHelperOnConnect(port)
  // {
  //   port.listenersXHRCancel=[]
  //   for(indexedDB, pattern of uDark.userSettings.properWhiteList) {

  //     let listenerFunc = details=>{
  //       // find a "X-Uark header and its value";
  //       if(details.requestHeaders) {
  //         details.requestHeaders.forEach(header => {
  //           if(header.name.toLowerCase() === "x-uark") {
  //             uDark.info("X-Uark header found", header.value);
  //             //tell port we f
  //           }
  //         });
  //       }
  //     }


  //     browser.webRequest.addListener(Listeners.popupEmbedXHRHelper, {
  //       urls: [pattern],
  //       types: ["xmlhttprequest"]
  //     }, ["blocking"]);
  //   }
  // }

  portConnected(connectedPort) {
    uDark.info("Connected", connectedPort.sender.url, connectedPort.sender.contextId, connectedPort.sender);
    if (connectedPort.name == "port-from-cs" && connectedPort.sender.tab) {
      // At first, we used exclude_regex here to not register some content scripts, but thent we used it earlier, in the content script registration

      let portKey = `port-from-cs-${connectedPort.sender.tab.id}-${connectedPort.sender.frameId}`
      let prevport = uDark.connected_cs_ports[portKey]
      if (prevport && prevport.parsePageIsDoneAndConnected) {
        prevport.parsePageIsDoneAndConnected(connectedPort);
      }
      uDark.connected_cs_ports[portKey] = connectedPort;
      connectedPort.onDisconnect.addListener(disconnectedPort => {
        let portValue = uDark.connected_cs_ports[portKey]

        uDark.info("Disconnected", disconnectedPort.sender.url, disconnectedPort.sender.contextId);
        if (portValue === disconnectedPort) { // If the port is the same, we can delete it, otherwise, we are on a late disconnection, the port is already replaced either by a new one or by one that will arrive soon
          uDark.info("Deleting", portKey)
          delete uDark.connected_cs_ports[portKey];

        }
      });
    }
    if (connectedPort.name == "port-from-popup") {

      if (connectedPort.sender.tab) {
        let portKey = `port-from-popup-${connectedPort.sender.tab.id}`
        // Knowing if my options are open or not, to change requests behaviour in these windows
        // Basicaly i want them to be able to frame any website
        // Popup does not have a tab, this may be how we could differenciate popup from options 
        uDark.connected_cs_ports[`port-from-popup-${connectedPort.sender.tab.id}`] = connectedPort;
        uDark.connected_options_ports_count++;
        connectedPort.onDisconnect.addListener(disconnectedPort => {

          let portValue = uDark.connected_cs_ports[portKey]
          if (portValue === disconnectedPort) {
            delete uDark.connected_cs_ports[portKey]
          }
          uDark.connected_options_ports_count--;
        });
      }
    }

  }


  switchOffCSSInFrame(tabId, frameId) {
    browser.tabs.insertCSS(tabId, {
      code: uDark.cssSwitchOffString,
      frameId: frameId,
    });
  }


  connected_cs_ports = {}
  getPortKey(details) {
    return "port-from-cs-" + details.tabId + "-" + details.frameId
  }
  getPort(details) {
    return uDark.connected_cs_ports[uDark.getPortKey(details)];
  }
  deletePort(details, moment) {
    delete uDark.connected_cs_ports[uDark.getPortKey(details)];
  }
  setPort(details, port, moment) {
    uDark.connected_cs_ports[uDark.getPortKey(details)] = port;
  }
  extractCharsetFromHeaders(details, defaultCT = "text/html", defaultCharset = "utf-8") {
    // We have seen cases where the charset was not specified in the content-type header, and the browser document.characterSet was defaulting to <meta> tag charset.
    // This is why we need to extract the charset from the headers, to knwo if we are in this kind of cases.

    let contentTypeHeader = details.responseHeaders?.find(x => x.name.toLowerCase() == "content-type");
    if (!contentTypeHeader) {
      details.noContentTypeHeader = true;
      contentTypeHeader = { value: defaultCT };
    }
    details.contentType = contentTypeHeader.value;
    details.charset = details.contentType.match(/charset=([0-9A-Z-_]+)/i)
    details.unspecifiedCharset = !details.charset;
    details.charset = (details.charset || ["", defaultCharset])[1].toLowerCase();
  }
  headersDo = {
    "link"(x) {
      // Remove the integrity attribute from Link headers, as it can block
      // UltimaDark CSS injection.
      x.value = x.value.replace(
        "integrity=",
        "data-no-integrity="
      );

      return true;
    },

    "content-security-policy-report-only": (x, details) => {
      return false;
    },

    "content-security-policy": (x, details, stop = 0) => {

      /*
       * Since Firefox 148, `require-trusted-types-for 'script'` also protects
       * DOMParser.parseFromString().
       *
       * Keep the site's Trusted Types enforcement and existing policy allowlist,
       * but allow UltimaDark to create its DOMParser policy.
       *
       * This also covers empty directives, `'none'`, ASCII whitespace,
       * line breaks, different casing and concatenated CSP headers.
       */
      if (uDark.browserInfo.Mozilla_Firefox >= 148) {
        x.value = x.value.replace(
          /(^|[;,])([ \t\n\f\r]*)trusted-types(?=[ \t\n\f\r;,]|$)/gi,
          "$1$2trusted-types ultimadark"
        );
      }

      // uDark.log(
      //   "CSP",
      //   x.value,
      //   details.hasHashCSP,
      //   uDark.byPassCSPNonce
      // );

      /*
       * Since Firefox 128, UltimaDark can inject code into the appropriate
       * world, so a full CSP bypass is no longer required.
       */
      if (uDark.browserInfo.Mozilla_Firefox >= 128) {
        x.value = x.value.replaceAll(
          "data:",
          "https://data-image/ data:"
        );

        x.value = x.value.replaceAll(
          /(['"]sha[0-9]{1,3}-)/gi,
          (match, hashPrefix) => {
            details.hasHashCSP = true;

            /*
             * Add UltimaDark's nonce before the original hash source.
             * The original hash is preserved.
             */
            return `'nonce-${uDark.byPassCSPNonce}' ${hashPrefix}`;
          }
        );

        return true;
      }

      /*
       * Legacy CSP bypass for Firefox versions below 128.
       *
       * Quoted CSP values cannot contain literal commas or semicolons.
       * URLs containing these characters must encode them, so no additional
       * protection is needed before splitting.
       */
      const cspArray = x.value
        .toLowerCase()
        .split(/[;,]/g)
        .map(directive => directive.trim())
        .filter(Boolean);

      const cspObject = {};

      for (const directive of cspArray) {
        /*
         * CSP recognizes the following ASCII whitespace characters:
         * space, tab, LF, FF and CR.
         */
        const separatorIndex = directive.search(/[ \t\n\f\r]/);

        if (separatorIndex === -1) {
          /*
           * A directive may have no value. For source-list directives,
           * an empty value is equivalent to `'none'`.
           */
          cspObject[directive] = "";
          continue;
        }

        const key = directive.slice(0, separatorIndex);
        const value = directive
          .slice(separatorIndex)
          .trim();

        cspObject[key] = value;
      }

      const CSPBypass_map = {
        /*
         * Example for replacing directives instead of deleting them:
         *
         * "* 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:":
         *   ["default-src"],
         */
        delete: new Set([
          "default-src",
          "report-uri",
          "report-to",
          "require-trusted-types-for",
          "img-src",
          "script-src",
          "script-src-attr",
          "style-src-attr",
          "script-src-elem",
          "style-src",
        ]),
      };

      for (
        const [newCSPValue, cspDirectiveKeys]
        of Object.entries(CSPBypass_map)
      ) {
        for (const cspDirective of cspDirectiveKeys) {
          if (newCSPValue === "delete") {
            delete cspObject[cspDirective];
            continue;
          }

          /*
           * Use `in` rather than a truthiness check because a directive may
           * exist with an empty value.
           */
          if (cspDirective in cspObject) {
            cspObject[cspDirective] = newCSPValue;
          }
        }
      }

      x.value = Object.entries(cspObject)
        .map(([key, value]) => {
          return value
            ? `${key} ${value}`
            : key;
        })
        .join("; ");

      /*
       * Keep the CSP header. Removing it entirely could make an accompanying
       * X-Frame-Options header take priority.
       */
      return true;
    },
  }
  registeredCS = []
  pendingCSRegistrations = new Set()
  listenerUpdateQueue = Promise.resolve()
  is_background = true // Tell ultimadark that we are in the background script and is_color_var is not available for instance
  LoggingWorker = class LoggingWorker extends Worker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', function (e) {
        if (e.data.logMessage) {
          uDark.log("imageWorker:", ...e.data.logMessage);
        }
      });

    }
  }

  workerPool = class WorkerPool {
    /**
    * @param {Object} options
    * @param {number} [options.size=12] - nombre de workers
    * @param {number} [options.highWaterMark=64] - HWM des streams
    */
    constructor({ size = 12, url = "", highWaterMark = 64, workerData } = {}) {
      this.size = size;
      this.workerData = workerData;
      this.highWaterMark = highWaterMark;

      this._workers = [];   // liste de handles
      this._idle = [];      // pile de handles inactifs
      this._waiters = [];   // file d'attente de promesses pour getIdleWorker()

      // Prépare le Blob du worker une seule fois.
      this._workerURL = url;
    }

    /** Crée et câble les workers du pool. */
    async init() {
      const createOne = async (idx) => {
        const worker = new Worker(this._workerURL);

        // Deux TransformStreams pour le duplex main<->worker
        const toWorker = new TransformStream(undefined, undefined, { highWaterMark: this.highWaterMark });
        const fromWorker = new TransformStream(undefined, undefined, { highWaterMark: this.highWaterMark });

        // Attente du "ready" émis par le worker
        const ready = new Promise(resolve => {
          const onMsg = (e) => {
            if (e?.data?.ready) {
              worker.removeEventListener('message', onMsg);
              resolve();
            }
          };
          worker.addEventListener('message', onMsg);
        });

        // Transfert des extrémités (avant tout lock)
        worker.postMessage(
          { inReadable: toWorker.readable, outWritable: fromWorker.writable, workerData: this.workerData },
          [toWorker.readable, fromWorker.writable]
        );
        await ready;

        // Verrous côté main
        const writer = toWorker.writable.getWriter();
        const reader = fromWorker.readable.getReader();

        // Handle logique
        const handle = {
          idx,
          worker,
          writer,
          reader,
          _busy: false,
          /** Vrai si le worker traite une requête. */
          get busy() { return this._busy; },

          /**
          * Traite un payload unique (une écriture -> une lecture).
          * @param {Uint8Array|ArrayBuffer} payload - Données binaires à traiter
          * @param {Object} [details] - Métadonnées JS à transmettre (optionnel)
          * @returns {Promise<Uint8Array>} réponse XORée
          *
          * Format du buffer envoyé :
          *   [8 octets: taille JSON little endian] [JSON UTF-8] [payload binaire]
          */
          async process(payload, details = undefined) {
            this._busy = true;
            try {
              // Encapsulation details+payload dans un buffer
              let meta = details ? new TextEncoder().encode(JSON.stringify(details)) : new Uint8Array(0);
              let metaLen = BigInt(meta.length);
              let metaLenBuf = new Uint8Array(8);
              let dv = new DataView(metaLenBuf.buffer);
              dv.setBigUint64(0, metaLen, true); // little endian
              const u8payload = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
              let packet = new Uint8Array(8 + meta.length + u8payload.length);
              packet.set(metaLenBuf, 0);
              if (meta.length) packet.set(meta, 8);
              packet.set(u8payload, 8 + meta.length);
              await writer.write(packet);                // push (respecte la backpressure)
              const { value, done } = await reader.read(); // attend le retour
              if (done) throw new Error('Worker stream closed');
              return value instanceof Uint8Array ? value : new Uint8Array(value);
            } finally {
              this._busy = false;
              // Notifie le pool que ce handle est redevenu idle
              this._notifyIdle?.(this);
            }
          },

          /** Libère et termine le worker. */
          async destroy() {
            try { await writer.close(); } catch (_) { }
            try { reader.releaseLock(); } catch (_) { }
            worker.terminate();
          },
        };

        // Lien inverse pour notifier le pool quand process() se termine
        handle._notifyIdle = (h) => this._notifyIdle(h);

        return handle;
      };

      // Création séquentielle (simple et stable) ; peut être parallélisée si souhaité.
      for (let i = 0; i < this.size; i++) {
        console.log("[Pool] Creating worker", i + 1, "/", this.size, "with file", this._workerURL);
        const h = await createOne(i);
        this._workers.push(h);
        this._idle.push(h);
      }
    }

    /**
    * Rend un worker **inactif** (ou attend qu’un se libère).
    * À l’appelant de l’utiliser puis de le relâcher (via `handle.process()` qui relâche automatiquement,
    * ou en appelant explicitement `release(handle)` s’il manipule writer/readers manuellement).
    * @returns {Promise<Handle>}
    */
    async getIdleWorker() {
      // Si on a un idle disponible, retour immédiat
      for (let i = 0; i < this._idle.length; i++) {
        const h = this._idle[i];
        if (!h.busy) {
          this._idle.splice(i, 1);
          return h;
        }
      }
      // Sinon on attend
      return new Promise(resolve => this._waiters.push(resolve));
    }

    /** Relâche explicitement un handle si vous n'utilisez pas handle.process(). */
    release(handle) {
      if (!handle) return;
      handle._busy = false;
      this._notifyIdle(handle);
    }

    /** Raccourci: envoie `payload` en choisissant un worker idle et retourne la réponse. */
    async run(payload) {
      const h = await this.getIdleWorker();
      return h.process(payload); // process() déclenche le retour à l'état idle
    }

    /** Termine et nettoie tout le pool. */
    async destroy() {
      await Promise.all(this._workers.map(h => h.destroy()));
      this._workers.length = 0;
      this._idle.length = 0;
      this._waiters.length = 0;
      if (this._workerURL) {
        URL.revokeObjectURL(this._workerURL);
        this._workerURL = null;
      }
    }

    /** Interne: remet un handle dans la file idle ou réveille un waiter. */
    _notifyIdle(handle) {
      // Si quelqu’un attend un idle, le réveiller en priorité
      if (this._waiters.length) {
        const resolve = this._waiters.shift();
        resolve(handle);
        return;
      }
      // Sinon, le replacer parmi les idle (éviter les doublons)
      if (!this._idle.includes(handle) && !handle.busy) {
        this._idle.push(handle);
      }
    }
  }
}


class Listeners {
  static cancelPopupXHRCalls(details) {
    if (details.tabId == uDark.popupTabId) {
      console.log("Canceling popup XHR call", details.url, details);
      // message to popup, we fund his friend
      uDark.connected_cs_ports["port-from-popup-" + details.tabId].postMessage({
        cancelPopupXHRCalls: true,
        url: details.url
      });
      return { cancel: true };
    }
  }
  static askSynchronousBgIdHelper(message, sender, sendResponse) {
    if (message.askSynchronousBackgroundIdentifier) {


      let mapKey = "askSynchronousBG_" + message.askSynchronousBackgroundIdentifier;
      uDark.general_cache.set(mapKey, {
        frameDetails: {
          tabId: sender.tab.id,
          frameId: sender.frameId,
        },
        message: message

      });
    }
  }
  static askSynchronousBgId(details) {
    let questionParts = details.url.split("/");
    let param = questionParts.pop();
    let identifer = questionParts.pop();
    let mapKey = "askSynchronousBG_" + identifer;
    let mapData = uDark.general_cache.get(mapKey);

    // switch off CSS if requested

    if (mapData) {
      uDark.general_cache.delete(mapKey); // One time use
      return browser.webNavigation.getFrame(mapData.frameDetails).then(moreFrameDetails => {
        let isParentUDark = !!uDark.getPort({ tabId: mapData.frameDetails.tabId, frameId: moreFrameDetails.parentFrameId });

        if (!isParentUDark && mapData.message.switchOffCSS) {
          uDark.switchOffCSSInFrame(mapData.frameDetails.tabId, mapData.frameDetails.frameId);
        }
        return { redirectUrl: `data:application/json,{"parentHasUltimaDark":${isParentUDark}}` };
      });
    }
    return {};


  }
  static moreInfoOnImageResult(details, obuffer, event) {

    // uDark.warn("Image editing complete",details.url.split("#"),event.data.is_photo?"photo": event.data.heuristic);
  }
  static isEligibleResource(details) {
    // if(details.tabId == -1 && !details.documentUrl){
    //     console.warn("Preload image (i guess )might cause issues",details);
    // }

    // Check if the resource is eligible for uDark
    const ownerUrl = details.documentUrl || details.originUrl;
    return Boolean(
      uDark.getPort(details)
      || (
        details.tabId == -1
        && ownerUrl
        && !ownerUrl.match(uDark.userSettings.exclude_regex)
      )
    );

  }
  static editOnHeadersImage(details) {

    // Util 2024 jan 02 we were checking details.documentUrl, or details.url to know if a stylesheet was loaded in a excluded page
    // Since only CS ports that matches blaclist and whitelist are connected, we can simply check if this resource has a corresponding CS port
    if (!Listeners.isEligibleResource(details)) {
      // uDark.log("Image","No port found for",details.url,"loaded by webpage:",details.originUrl,"Assuming it is not an eligible webpage, or even blocked by another extension");
      return {}
    }
    // now in 2025 we can exclude all res or image res
    if (details.url.match(uDark.userSettings.exclude_regexRes) || details.url.match(uDark.userSettings.exclude_regexImgr)) {
      // uDark.log("Image","This image is excluded by the user settings",details.url,"loaded by webpage:",details.originUrl,"Assuming it is not an eligible webpage, or even blocked by another extension");
      return {}
    }
    // now in 2025 we can exclude all image from site
    if (details.documentUrl?.match(uDark.userSettings.exclude_regexImg)) {
      return {}
    }

    let imageURLObject = new URL(details.url);
    details.headersLow = {}

    uDark.extractCharsetFromHeaders(details, "image/png",);
    details.isSVGImage = details.contentType.includes("image/svg");

    // Determine if the image deserves to be edited
    if (imageURLObject.pathname.startsWith("/favicon.ico") || imageURLObject.hash.endsWith("#ud_favicon")) {
      return {};
    }
    let { is_enforced_nobody } = uDark.getNoBodyStatus(details);
    if (is_enforced_nobody) {
      return {}; // We cannot edit this request: either it has no body, or it's empty because unmodified, so the webRequestFilter will receive an already edited content from the cache
    }
    let filter = globalThis.browser.webRequest.filterResponseData(details.requestId); // After this instruction, browser espect us to write data to the filter and close it
    let imageWorker;
    let secureTimeout = setTimeout(() => {
      try {
        filter.disconnect();
        imageWorker && imageWorker.terminate("security termination " + details.url);
      } catch (e) { }
    }, 30000) // Take care of very big images 
    details.buffers = details.buffers || [];
    if (details.isSVGImage) {
      filter.ondata = event => details.buffers.push(event.data);
      let svgURLObject = new URL(details.url);
      { // Sometimes the website reencodes as html chars the data
        let HTMLDecoderOption = new Option();
        HTMLDecoderOption.p_ud_innerHTML = svgURLObject.hash;
        svgURLObject.hash = HTMLDecoderOption.textContent;
      }
      let complementIndex = svgURLObject.hash.indexOf(uDark.imageSrcInfoMarker);
      let notableInfos = new URLSearchParams(complementIndex == -1 ? "" : svgURLObject.hash.slice(complementIndex + 6))
      notableInfos = Object.fromEntries(notableInfos.entries());
      notableInfos.remoteSVG = true;
      filter.onstop = event => {
        new Blob(details.buffers).arrayBuffer().then((buffer) => {
          let svgString = uDarkDecode(details.charset, buffer, {
            stream: true
          })

          let svgStringEdited = uDark.frontEditHTML(false, svgString, details, {
            notableInfos,
            svgImage: true,
            remoteSVG: true,
            remoteSVGURL: svgURLObject.href,
          });
          filter.write(uDarkEncode(details.charset, svgStringEdited));
          filter.disconnect();
          clearInterval(secureTimeout);
        });
      }
    } else {

      if (uDark.userSettings.pooledWorkersEnabled) {
        let allBuffers = [];



        filter.ondata = event => {
          allBuffers.push(event.data);
        }

        filter.onstop = event => {

          // console.log("Image", "Filter stopped, sending to worker", performance.now(), details.url);
          let t0_perf = performance.now();
          let blob = new Blob(allBuffers);
          Promise.all([
            blob.arrayBuffer(),
            uDark.imageWorkerPool.getIdleWorker()
          ]).then(([arrayBuffer, h]) => {
            h.process(arrayBuffer, details).then(out => {
              filter.write(out);
              filter.disconnect();
              let t1_perf = performance.now();
              // console.log("Image", "Filter disconnected after worker t1_perf:", t1_perf, "t0_perf:", t0_perf, "total:", t1_perf - t0_perf, details.url, details.requestId);
            });
          })
        }
      }


      else {
        imageWorker = new uDark.LoggingWorker(uDark.imageWorkerJsFile.native);
        imageWorker.addEventListener("message", event => {
          if (event.data.editionComplete) {
            Listeners.moreInfoOnImageResult(details, details.buffers, event);


            for (let buffer of event.data.buffers) {
              try {
                filter.write(buffer);
              } catch (e) {
                uDark.error("Error during write", e, e.message, buffer, details, event.data.buffers.indexOf(buffer));
              }

            }

            filter.disconnect();
            imageWorker.terminate("normal use " + details.url);
            clearInterval(secureTimeout);
          }
        })

        let firstChunk = true;
        filter.ondata = event => {

          let onDataMessage = {
            oneImageBuffer: event.data
          };
          let onDataTransfer = [event.data];
          // onDataTransfer = [];
          // if (firstChunk && !uDark.disableModelTransfer) {
          //   firstChunk = false;
          //   onDataMessage.iaModelJsonBuffer = uDark.iaModelJsonBuffer;
          //   onDataMessage.iaModelWeightsBuffer = uDark.iaModelWeightsBuffer;
          //   onDataMessage.details = details;
          //   onDataMessage.hasIA = true;
          //   onDataMessage.transferStart = Date.now() / 1;
          //   // DISABLED : WE PREFER COPY FOR THESE BUFFERS onDataTransfer.push(onDataMessage.iaModelJsonBuffer,onDataMessage.iaModelWeightsBuffer ); // 
          // }

          imageWorker.postMessage(onDataMessage, onDataTransfer) // Explicityly transfer the ArrayBuffer to the worker

        }



        filter.onstop = event => {
          imageWorker.postMessage({
            filterStopped: 1,
            details
          });
        }
      }

    }
    // Here we catch any image, including data:images <3 ( in the form of https://data-image/data:image/png;base64,....)
    let resultEdit = {}

    // If resultEdit is a promise, image will be edited (foreground or background), otherwise it may be a big background image to include under text
    // Lets inform the content script about it
    if (uDark.enable_registering_background_images && (!resultEdit.then || !resultEdit.edited)) {
      // uDark.registerBackgroundItem(false,{selectorText:`img[src='${details.url}']`},details);
      let imageURLObject = new URL(details.url);
      if (imageURLObject.searchParams.has("uDark_cssClass")) {
        let cssClass = decodeURIComponent(imageURLObject.searchParams.get("uDark_cssClass"));
        // console.log("Found a background image via property",cssClass);
        uDark.registerBackgroundItem(false, {
          selectorText: cssClass
        }, details);
        imageURLObject.searchParams.delete("uDark_cssClass");
        imageURLObject.searchParams.set("c", uDark.fixedRandom);
        return {
          redirectUrl: imageURLObject.href
        };
      } else if (!imageURLObject.searchParams.has("c")) {
        // uDark.log("Found an img element",details.url)
        // uDark.log(details.url,"is not a background image, but an img element",details)
        uDark.registerBackgroundItem(false, {
          selectorText: `img[src='${details.url}']`
        }, details);
      }
    }
    return resultEdit;

  }
  static editBeforeRequestImage(details) {
    if (details.url.startsWith("https://data-image/?base64IMG=")) {
      const dataUrl = details.url.slice(30);


      // now in 2025 we can exclude all res or image res
      if (details.documentUrl?.match(uDark.userSettings.exclude_regexImg) || details.url.match(uDark.userSettings.exclude_regexRes) || details.url.match(uDark.userSettings.exclude_regexImgr)) {
        // uDark.log("Image","This image is excluded by the user settings",details.url,"loaded by webpage:",details.originUrl,"Assuming it is not an eligible webpage, or even blocked by another extension");
        return {
          redirectUrl: dataUrl
        }
      }
      const reader = new FileReader() // Faster but ad what cost later ? 



      if (uDark.userSettings.pooledWorkersEnabled) {

        return Promise.all([
          fetch(dataUrl).then(r => r.arrayBuffer()).then(arrayBuffer => arrayBuffer),
          uDark.imageWorkerPool.getIdleWorker()])
          .then(([arrayBuffer, h]) => {
            return h.process(arrayBuffer, details);
          }).then(out => {
            reader.readAsDataURL(new Blob([out]));
            return new Promise(resolve => reader.onload = (e) => resolve({ redirectUrl: reader.result }));
          });
      }
      else {

        const imageWorker = new uDark.LoggingWorker(uDark.imageWorkerJsFile.native);
        imageWorker.addEventListener("message", event => {
          if (event.data.editionComplete) {

            reader.readAsDataURL(new Blob(event.data.buffers));

            Listeners.moreInfoOnImageResult(Object.assign(details, { url: dataUrl }), undefined, event);
          }
        })


        fetch(dataUrl).then(r => r.arrayBuffer()).then(arrayBuffer => { // Does not block the main thread with await. Cant tell if it is faster or not

          imageWorker.postMessage({
            oneImageBuffer: arrayBuffer,
            iaModelJsonBuffer: uDark.iaModelJsonBuffer,
            iaModelWeightsBuffer: uDark.iaModelWeightsBuffer,
            hasIA: true,
            transferStart: Date.now() / 1,
            filterStopped: 1,
            details: details
          }, [arrayBuffer]) // Explicitly transfer the ArrayBuffer to the worker
        })

        let to_return = new Promise(resolve => reader.onload = (e) => resolve({
          redirectUrl: reader.result
        }));

        to_return.then(x => imageWorker.terminate("normal use b64")); // Very needed : non terminated workers will avoid new workers to reveive messages

        // console.log("PASSING",(globalThis["passing"+details.url+details.requestId]=(globalThis["passing"+details.url+details.requestId]||0)+1),details);

        return to_return;
      }
    }
  }
  static editOnHeadersReceivedStyleSheet(details) {
    uDark.extractCharsetFromHeaders(details, "text/css")
    uDark.general_cache.set(`request_${details.requestId}_more_details`, details);

    let { is_enforced_nobody } = uDark.getNoBodyStatus(details);
    details.already_edited_or_empty = is_enforced_nobody // We cannot edit this request: either it has no body, or it's empty because unmodified, so the webRequestFilter will receive an already edited content from the cache

  }
  static TopCSSFlag = `@import "${browser.runtime.getURL("ultimaDark.css")}";\n`
  static editBeforeRequestStyleSheet_sync(details) {
    let options = {};

    // console.log("Loading CSS", details.url, details.requestId, details.fromCache)

    // Util 2024 jan 02 we were checking details.documentUrl, or details.url to know if a stylesheet was loaded in a excluded page
    // Since only CS ports that matches blaclist and whitelist are connected, we can simply check if this resource has a corresponding CS port
    if (!Listeners.isEligibleResource(details)) {
      // console.log("CSS", "No port found for", details.url, "loaded by webpage:", details.originUrl, "Assuming it is not an eligible webpage, or even blocked by another extension");
      // console.log("If i'm lacking of knowledge, here is what i know about this request", details.tabId, details.frameId);
      return {}
    }
    // now in 2025 we can exclude all res or css res
    if (details.url.match(uDark.userSettings.exclude_regexRes) || details.url.match(uDark.userSettings.exclude_regexCss)) {
      // console.log("CSS", "This CSS is excluded by the user settings", details.url, "loaded by webpage:", details.originUrl, "Assuming it is not an eligible webpage, or even blocked by another extension");
      // console.log("It matches :", details.url.match(uDark.userSettings.exclude_regexRes) ? uDark.userSettings.exclude_regexRes : uDark.userSettings.exclude_regexCss);
      // console.log("basic exclude_regex",uDark.userSettings.exclude_regex);
      return {}
    }




    let filter = globalThis.browser.webRequest.filterResponseData(details.requestId); // After this instruction, browser espect us to write data to the filter and close it



    filter.onstart = event => {
      if (uDark.overrideEncodeCharsetForCSS) {
        details.overrideEncodeCharset = uDark.overrideEncodeCharsetForCSS;
        // write  EF BB BF as BOM to specify utf8 charset and priorize over any other charset rule whatever
        // https://developer.mozilla.org/fr/docs/Web/CSS/Reference/At-rules/@charset
        filter.write(new Uint8Array([0xEF, 0xBB, 0xBF]));
      }


      // console.log("CSS filter started",details.url,details.requestId,details.fromCache)
      // filter.write(uDarkEncode("UTF-8", Listeners.TopCSSFlag)); // Write the top CSS flag to be able to check if the CSS is already edited 
      if (uDark.general_cache.has(`request_${details.requestId}_more_details`)) {
        let moreDetails = uDark.general_cache.get(`request_${details.requestId}_more_details`);
        Object.assign(details, moreDetails);
        // uDark.log("Success : More details found for",details.requestId,details);
      }
      else {
        uDark.warn("onHeaderReceived was not called for", details.requestId, details.url, "not a big deal, but now defaulting to utf 8 & text/css");
        uDark.extractCharsetFromHeaders(details, "text/css");
      }

      details.dataCount = 0;
      details.rejectedValues = "";
    }

    // // ondata event handler
    filter.ondata = event => {
      if (details.already_edited_or_empty) {
        // console.log("Already edited or empty",details.url,details.requestId,details.fromCache);
        filter.write(event.data);
        return;
      }
      details.dataCount++;
      uDark.handleCSSChunk_sync(event.data, true, details, filter);
    };

    // onstop event handler
    filter.onstop = event => {
      if (details.rejectedValues.length > 0) {
        uDark.handleCSSChunk_sync(null, false, details, filter);
      }
      filter.disconnect();  // Ensure disconnection after completion
      uDark.general_cache.delete(`request_${details.requestId}_more_details`); // Clean up the cache
      // console.log("CSS filter stopped",details.url,details.requestId,details.fromCache)
    };
    // return {redirectUrl:details.url};
    // return {responseHeaders:[{name:"Vary",value:"*"},{name:"Location",value:details.url}]};
    // return {};
    // must not return this closes filter//
  }

  static fixForFilterResponseDataFirefoxBug = {
    // Fix for Firefox filterResponseData bug:
    //     // https://bugzilla.mozilla.org/buglist.cgi?quicksearch=filterResponseData

    //     // https://bugzilla.mozilla.org/show_bug.cgi?id=1982934
    //     // https://bugzilla.mozilla.org/show_bug.cgi?id=1806476
    //     // https://bugzilla.mozilla.org/show_bug.cgi?id=1561604
    noIssuesIntetrnalPagesRegex:
      /^about:(blank|welcome|studies|protections|privatebrowsing|newtab|loginsimportreport|logins|home|compat|certificate|blank)$/,

    registerOrUnregisterInternalPage(details) {
      // Firefox bug workaround:
      if (details.frameId != 0) {
        return; // We only care about main frames
      }


      if (details.url.startsWith("about:")) {
        console.log("Checking internal page for Firefox filterResponseData bug workaround:", details.tabId, details.url);
        if (!details.url.match(
          Listeners.fixForFilterResponseDataFirefoxBug.noIssuesIntetrnalPagesRegex
        )) {
          console.warn("Registering internal page for Firefox filterResponseData bug workaround:", details.tabId, details.url);
          uDark.general_cache.set(`fixing_about_tab_${details.tabId}`, true);
          return
        }
      }
      if (uDark.general_cache.has(`fixing_about_tab_${details.tabId}`)) {
        console.warn("Unregistering internal page for Firefox filterResponseData bug workaround:", details.tabId, details.url);
        uDark.general_cache.delete(`fixing_about_tab_${details.tabId}`);
        if (!details.url.startsWith("about:")) {
          browser.tabs.update(details.tabId, { url: `${browser.runtime.getURL("uDarkTools.htm")}?redirect=${details.url}` });// Reload the tab to make sure filterResponseData will work
        }
      }
    },


  }


  static setEligibleRequestBeforeDataWL(details) {
    if (details.frameId !== 0 && uDark.userSettings.embedsInheritanceBehavior === "inheritFromParent") {
      if (!uDark.getPort({ tabId: details.tabId, frameId: details.parentFrameId })) {
        return
      }
    };

    // console.log("Whitelisted page detected for uDark");
    uDark.setPort(details, { arrivingSoon: true, isWhiteList: true }, 0);
  }
  static setEligibleRequestBeforeDataBL(details) {

    details.unEligibleRequest = (details.documentUrl || details.url).match(uDark.userSettings.exclude_regex);
    details.eligibleRequest = !details.unEligibleRequest && uDark.getPort(details)?.isWhiteList;
    // Here we have to check the url or the documentUrl to know if this webpage is excluded
    // It already has passed the whitelist check, this is why we only check the blacklist
    // However this code executes before the content script is conn ected, so we can't check if it will connect or not
    // Even if we could do this, like sending some bytes and waiting for he content script to connect,
    // and it would be not so musch costly in terms of time, some pages as YouTube as the time i write this, somehow manages
    // to send in this very first request tabID -1 and frameID 0, which is not a valid combination, and the content script will never be found
    // stackoverflow says it might be related to worker threads. It's probably true with serviceWorkers

    // console.log("Will check",details.url,"made by",details.documentUrl || details.url,0)
    // console.log("Is eligible for uDark",details.eligibleRequest)




    if (!details.eligibleRequest) {

      uDark.deletePort(details); // Remove any previous port, we will set a new one if needed
      // As bellow is marking as arriving soon
      // It is possible to have a page that starts loading, we mark it as arriving soon
      // loading stops, for whatever reason, and the content script does not connect and therefore does not disconnects and get not deleted.
      // In this case, the port will not be erased, and all resources will darkened, even if the page is not eligible for uDark
      // It is testable by disablising the content script, assignation and line above; loading a darkened page, in a tab, to set the arriving soon flag, 
      // then loading an uneligible page in the same tab, and see if it not dakening.
      // A simple delete when the page is not eligible is enough and very low cost.
      // In the end we need to be in this if to avoid darkening the page, we wont be lazy and delete the port.
      return;

    }
    // Lets be the MVP here, sometimes the content script is not connected yet, and the CSS will arrive in few milliseconds.
    // This page is eligible for uDark
    // console.log("I'm telling the world that",details.url,"is eligible for uDark", "on", details.tabId,details.frameId)
    // This code must absolutely eb executed before the parsing of headers of the page since the page can have  link header wich will be considered as a <link> tag
    // See https://developer.mozilla.org/fr/docs/Web/HTTP/Headers/Link for details
    // console.log("Eligible page detected for uDark", details.url, "on", details.tabId, details.frameId);
    uDark.setPort(details, { arrivingSoon: true }, 0);


  }
  static editBeforeData(details) {
    if (details.tabId == -1 && uDark.connected_options_ports_count || uDark.connected_cs_ports["port-from-popup-" + details.tabId]) { // -1 Happens sometimes, like on https://www.youtube.com/ at the time i write this, stackoverflow talks about worker threads

      // Here we are covering the needs of the option page: Be able to frame any page
      let removeHeaders = ["content-security-policy", "x-frame-options", "content-security-policy-report-only"]
      details.responseHeaders = details.responseHeaders.filter(x => !removeHeaders.includes(x.name.toLowerCase()))
    }
    let port = uDark.getPort(details);
    if (!port) { // If setEligibleRequestBeforeData removed the port, we don't want to darken the page
      return { responseHeaders: details.responseHeaders };
    }

    uDark.extractCharsetFromHeaders(details);

    if (!details.contentType.includes("text/html") && !details.contentType.includes("application/xhtml+xml")) {
      return { responseHeaders: details.responseHeaders };
    }
    details.responseHeaders = details.responseHeaders.filter(x => {
      var a_filter = uDark.headersDo[x.name.toLowerCase()];
      return a_filter ? a_filter(x,details) : true;
    })




    let { is_enforced_nobody } = uDark.getNoBodyStatus(details);
    if (is_enforced_nobody) {
      return { responseHeaders: details.responseHeaders }; // We cannot edit this request: either it has no body, or it's empty because unmodified, so the webRequestFilter will receive an already edited content from the cache
    }



    // console.log("Editing", details.url, details.requestId, details.fromCache)
    let filter = globalThis.browser.webRequest.filterResponseData(details.requestId);

    details.dataCount = 0;
    details.writeEnd = [];
    filter.ondata = event => {
      details.dataCount++
      details.writeEnd.push(event.data);

    }
    filter.onstop = async event => {

      // Note the headers are already returned since a long time, so we can't edit them here. Fortunately we don't need to, and if we realy need.. use http equiv.
      details.dataCount = 1;
      details.writeEnd = await new Blob(details.writeEnd).arrayBuffer();


      let decodedValue = uDarkDecode(details.charset, details.writeEnd, { stream: true }, details);

      if (details.dataBOMInfo) {
        console.log("BOM found in data for", details.url, details.dataBOMInfo);
        filter.write(details.dataBOMInfo.bytes);
        details.charset = details.dataBOMInfo.charset;
        details.unspecifiedCharset = false;
      }

      details.writeEnd = uDark.parseAndEditHtmlContentBackend4(decodedValue, details);

      port.parsePageIsDoneAndConnected = newPort => { // Will be called when the content script connects. Its safe to not set it now because we have an "arriving soon" port
        newPort.documentCharset = details.charset;
        port.parsePageIsDoneAndConnected = null;
      };
      port.documentCharset = details.charset; // But what if a css loads before the content script connects ? We set it now too it's free.


      filter.write(uDarkEncode(details.charset, details.writeEnd));

      filter.disconnect(); // Low perf if not disconnected !
    }
    return { responseHeaders: details.responseHeaders }
  }
}



class uDarkC extends uDarkExtended {

  overrideEncodeCharsetForCSS = "utf-8"; /*// We can safely re-encode CSS as UTF-8 with a BOM,
  // ignoring original charset / @charset or charset attribute.
  // This fixes all CSS `content` encoding issues elegantly */
  exportFunction = f => f; // Emulate the exportFunction function of the content script to avoid many ternary operators
  logPrefix = "Sandfox Dark:";
  log(...args) {
    console.log("%c" + this.logPrefix, "color:white;font-weight:bolder", ...args);
  };
  warn(...args) {
    console.warn("%c" + this.logPrefix, "color:yellow;font-weight:bolder", ...args);
  }
  error(text, ...args) {
    console.error("%c" + this.logPrefix, "color:red;font-weight:bolder", ...args, new Error(text));
  }
  info(...args) {
    console.info("%c" + this.logPrefix, "color:lightblue;font-weight:bolder", ...args);
  }

  success(...args) {
    console.log("%c" + this.logPrefix, "color:lightgreen;font-weight:bolder", ...args);
  }
  keypoint(...args) {
    console.info("%c" + this.logPrefix, "color:lime;font-weight:bolder;font-size:14px", ...args);
  }
  static CSS_COLOR_NAMES = [
    //"currentcolor",
    "AliceBlue", "AntiqueWhite", "Aqua", "Aquamarine", "Azure", "Beige", "Bisque", "Black", "BlanchedAlmond", "Blue", "BlueViolet", "Brown", "BurlyWood", "CadetBlue", "Chartreuse", "Chocolate", "Coral", "CornflowerBlue", "Cornsilk", "Crimson", "Cyan", "DarkBlue", "DarkCyan", "DarkGoldenRod", "DarkGray", "DarkGrey", "DarkGreen", "DarkKhaki", "DarkMagenta", "DarkOliveGreen", "DarkOrange", "DarkOrchid", "DarkRed", "DarkSalmon", "DarkSeaGreen", "DarkSlateBlue", "DarkSlateGray", "DarkSlateGrey", "DarkTurquoise", "DarkViolet", "DeepPink", "DeepSkyBlue", "DimGray", "DimGrey", "DodgerBlue", "FireBrick", "FloralWhite", "ForestGreen", "Fuchsia", "Gainsboro", "GhostWhite", "Gold", "GoldenRod", "Gray", "Grey", "Green", "GreenYellow", "HoneyDew", "HotPink", "IndianRed", "Indigo", "Ivory", "Khaki", "Lavender", "LavenderBlush", "LawnGreen", "LemonChiffon", "LightBlue", "LightCoral", "LightCyan", "LightGoldenRodYellow", "LightGray", "LightGrey", "LightGreen", "LightPink", "LightSalmon", "LightSeaGreen", "LightSkyBlue", "LightSlateGray", "LightSlateGrey", "LightSteelBlue", "LightYellow", "Lime", "LimeGreen", "Linen", "Magenta", "Maroon", "MediumAquaMarine", "MediumBlue", "MediumOrchid", "MediumPurple", "MediumSeaGreen", "MediumSlateBlue", "MediumSpringGreen", "MediumTurquoise", "MediumVioletRed", "MidnightBlue", "MintCream", "MistyRose", "Moccasin", "NavajoWhite", "Navy", "OldLace", "Olive", "OliveDrab", "Orange", "OrangeRed", "Orchid", "PaleGoldenRod", "PaleGreen", "PaleTurquoise", "PaleVioletRed", "PapayaWhip", "PeachPuff", "Peru", "Pink", "Plum", "PowderBlue", "Purple", "RebeccaPurple", "Red", "RosyBrown", "RoyalBlue", "SaddleBrown", "Salmon", "SandyBrown", "SeaGreen", "SeaShell", "Sienna", "Silver", "SkyBlue", "SlateBlue", "SlateGray", "SlateGrey", "Snow", "SpringGreen", "SteelBlue", "Tan", "Teal", "Thistle", "Tomato", "Turquoise", "Violet", "Wheat", "White", "WhiteSmoke", "Yellow", "YellowGreen"]
  static SHORTHANDS = ["all", "animation", "animation-range", "background", "border", "border-block", "border-block-end", "border-block-start", "border-bottom", "border-color", "border-image", "border-inline", "border-inline-end", "border-inline-start", "border-left", "border-radius", "border-right", "border-style", "border-top", "border-width", "column-rule", "columns", "contain-intrinsic-size", "container", "flex", "flex-flow", "font", "font-synthesis", "font-variant", "gap", "grid", "grid-area", "grid-column", "grid-row", "grid-template", "inset", "inset-block", "inset-inline", "list-style", "margin", "margin-block", "margin-inline", "mask", "mask-border", "offset", "outline", "overflow", "overscroll-behavior", "padding", "padding-block", "padding-inline", "place-content", "place-items", "place-self", "position-try", "scroll-margin", "scroll-margin-block", "scroll-margin-inline", "scroll-padding", "scroll-padding-block", "scroll-padding-inline", "scroll-timeline", "text-decoration", "text-emphasis", "text-wrap", "transition"]
    .map(s => `(?:-moz-|-webkit-|-ms-)?${s}`); // Add vendor prefixes
  static TAGS_TO_PROTECT = ["head",// "html", "body", "frameset", "frame",
    // We stopped using this for backend, since for https://myanimelist.net/manga/1 being broken we stoped to encapsulate. In theory we parse exactly as the final rendering. 
    "table", // Protecting inner elements of <table> creates the situation where we need to protect table too, logically
    "tr", "thead", "th", "tfoot", "td", "tbody", "col", "colgroup", "caption" // However pn front side, users can insert TR in tables and parser would not understand ortphans table inner elements and keep only their text content
  ]
  static safeExportKeys = [ // Keys that can be exported to the client page without compromising security or confidentiality
    "cacheEnabled",
    "serviceWorkersEnabled",
    "imageEditionEnabled",
    "foregroundBordersEnabled",
    "min_bright_fg",
    "max_bright_fg",
    "min_bright_bg_trigger",
    "max_bright_bg",
    "min_bright_bg",
    "bg_negative_modifier",
    "fg_negative_modifier",
  ];



  nonConnectedImagesAndSources = new Set();
  lateConnectionReferences = new WeakMap();
  lateConnectionStates = new WeakMap();
  lateConnectionErrorTargets = new WeakSet();
  lateConnectionErrorCaptureInstalled = false;
  lateConnectionModifier = "data:text/ud-late-connection;";
  lateConnectionStageByHost = new WeakMap();
  lateConnectionStageByRoot = new WeakMap();
  lateConnectionActiveStages = new Set();
  lateConnectionStagingFacadeInstalled = false;
  static CSS_COLOR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "color", "color-mix", "oklch", "oklab"]
  shortHandRegex = new RegExp(`(?<![\\w-])(${uDarkC.SHORTHANDS.join("|")})([\s\t]*:)`, "gi") // The \t is probably not needed, as \s includes it
  tagsToProtectRegex = new RegExp(`(</?)(${uDarkC.TAGS_TO_PROTECT.join("|")})(?![\\w-])`, "gi")
  // How much the color syntax can be complex: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value#formal_syntax
  fastColorRegex = new RegExp(`(?<![\\w-])(${uDarkC.CSS_COLOR_FUNCTIONS.join("|")})\\(.*?\\)`, "gi")

  static colorWorkSource = {
    canvasWidth: 5,
    canvasHeight: 3,
  }
  colorWork = {
    canvasContext: (() => {

      let canvas = document instanceof XMLDocument ?
        new OffscreenCanvas(5, 3) // Canvas in XMLDocuments does not have a getContext method. Using OffscreenCanvas instead.
        //Even using a DomPArser has no advantages, Canvas & CanvasText colors are not recognized in XML documents
        : Object.assign(document.createElement("canvas"), { width: 5, height: 3 });
      return canvas.getContext("2d")
    })()

  }
  attributes_function_map = {
    "color": (r, g, b, a, render, elem) => {
      elem.style.p_ud_setProperty("--ud-html4-color", uDark.revert_rgba(r, g, b, a, render));
      elem.setAttribute("ud-html4-support", true);
      elem.removeAttribute("color");
    },
    "text": "color",
    "bgcolor": this.rgba
  }

  colorRegex = new RegExp(`(?<![\\w-])(?:${uDarkC.CSS_COLOR_FUNCTIONS.join("|")})` + uDarkC.generateNestedParenthesisRegexNC(10), "gi")
  variableRegex = new RegExp(`(?<![\\w-])(?:${["var"].join("|")})` + uDarkC.generateNestedParenthesisRegexNC(10), "gi")
  imageSetRegex = new RegExp(`(?<![\\w-])(?:${["image-set"].join("|")})` + uDarkC.generateNestedParenthesisRegexNC(10), "gi")
  parenthesisRegex = new RegExp(uDarkC.generateNestedParenthesisRegexNC(10), "gi")
  hexadecimalColorsRegex = /#[0-9a-f]{3,4}(?:[0-9a-f]{2})?(?:[0-9a-f]{2})?/gi // hexadecimal colors
  cssSwitchOffString = ":root { --ud-bg-css-switchoff:off }"
  // Cant't use \b because of the possibility of a - next to the identifier, it's a word character
  namedColorsRegex = (new RegExp(`(?<![\\w-])(${uDarkC.CSS_COLOR_NAMES.join("|")})(?![\\w-])`, "gi"))
  quotedContentRegex = /'.+?(?<!\\)'|(".+?(?<!\\)")/g
  regex_search_for_url = /url\("(.+?)(?<!\\)("\))/g
  regex_search_for_url_raw = /url\(\s*?(('.+?(?<!\\)'|(".+?(?<!\\)")|[^\)'"]*)\s*?)\)/gsi
  background_match = /background|sprite|(?<![a-z])(bg|box|panel|fond|fundo|bck)(?![a-z])/i
  logo_match = /nav|avatar|logo|icon|alert|notif|cart|menu|tooltip|dropdown|control/i
  background_color_css_properties_regex = /color|fill|(?:box|text)-shadow|border|^background(?:-image|-color)?$|^--ud-ptd-background/ // Background images can contain colors // css properties that are background colors

  exactAtRuleProtect = true
  matchAllCssCommentsRegex = /\/\*[^*]*\*+([^/*][^*]*\*+)*\/|\/\*[^*]*\*+([^/*][^*]*\*+)*|\/\*[^*]*(\*+[^/*][^*]*)*/g
  // At-rules : https://developer.mozilla.org/fr/docs/Web/CSS/At-rule

  // @charset, @import or @namespace, followed by some space or \n, followed by some content, followed by a code block a semicolon; or end of STRING
  // Surpisingly and fortunately end of LINE does not delimits the end of the at-rule and forces devs & minifers either to add a ; or end of STRING 
  // which and fortunately simplifies a LOT the handling 
  // See https://www.w3.org/TR/css-syntax-3/#block-at-rule ( Block at-rules )
  // 'm' flag is not set on purpose to avoid matching $ as a line end, and keeping it at end of STRING
  // Content must not be interupted while between quotes or parenthesis.
  // It wont break on string ("te\"st") or this one('te\'st') or @import ('abc\)d;s'); thanks to
  // priority matches (\\\)) and (\\') and (\\")  
  //-------------------v-Rule name----space or-CR--v-----v--Protected values-v----v-the content dot
  cssAtRulesRegex = /@(charset|import|namespace)(\n|\s)+((\((\\\)|.)+?\))|("(\\"|.)+?")|('(\\'|.)+?')|.)+?({.+?}|;|$)/gs

  direct_window_export = true
  general_cache = new Map()
  CSSCommentAnchors = class {
    constructor(css) {
      this.originalCss = css;
      this.cleanCss = "";
      this.comments = [];
      this.anchorAttribute = "data-ud-comment-anchor";
      while (css.includes(`[${this.anchorAttribute}`)) {
        this.anchorAttribute += "-x";
      }
      this.scan();
    }

    mergeWithCssRules(cssRules) {
      const prefix = `[${this.anchorAttribute}="`;

      return cssRules.map(rule => {
        const selector = rule && rule.selectorText;
        const isAnchor = typeof selector === "string" &&
          selector.startsWith(prefix) &&
          selector.endsWith('"]');
        const indexText = isAnchor
          ? selector.slice(prefix.length, -2)
          : "";

        if (/^\d+$/.test(indexText)) {
          const comment = this.comments[Number(indexText)];

          if (comment !== undefined) {
            return {
              type: "comment",
              cssText: comment,
            };
          }
        }

        return rule;
      });
    }

    scan() {
      const css = this.originalCss;
      const out = [];

      let i = 0;
      let depth = 0;
      let lastSignificant = "SOF";
      // SOF | RULE_END | COMMENT_TOP | OTHER

      const isWhitespace = ch =>
        ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f";

      const isNewline = ch =>
        ch === "\n" || ch === "\r" || ch === "\f";

      const whitespaceLike = text =>
        text.replace(/[^\n\r]/g, " ");

      const consumeString = quote => {
        const start = i;
        i++;

        while (i < css.length) {
          const ch = css[i];

          if (ch === "\\") {
            i += 2;
            continue;
          }

          i++;

          if (ch === quote) break;
          if (isNewline(ch)) break;
        }

        out.push(css.slice(start, i));

        if (depth === 0) {
          lastSignificant = "OTHER";
        }
      };

      const consumeComment = () => {
        const start = i;
        const end = css.indexOf("*/", i + 2);

        if (end === -1) {
          out.push(css.slice(i));
          i = css.length;
          return;
        }

        const text = css.slice(start, end + 2);

        const topLevelComment =
          depth === 0 &&
          (
            lastSignificant === "SOF" ||
            lastSignificant === "RULE_END" ||
            lastSignificant === "COMMENT_TOP"
          );

        if (topLevelComment) {
          const commentIndex = this.comments.push(text) - 1;
          out.push(
            `[${this.anchorAttribute}="${commentIndex}"] {}`
          );

          lastSignificant = "COMMENT_TOP";
        } else {
          out.push(whitespaceLike(text));
          lastSignificant = "OTHER";
        }

        i = end + 2;
      };

      while (i < css.length) {
        const ch = css[i];
        const next = css[i + 1];

        if (ch === '"' || ch === "'") {
          consumeString(ch);
          continue;
        }

        if (ch === "/" && next === "*") {
          consumeComment();
          continue;
        }

        if (ch === "{") {
          depth++;
          out.push(ch);
          lastSignificant = "OTHER";
          i++;
          continue;
        }

        if (ch === "}") {
          out.push(ch);

          if (depth > 0) depth--;

          if (depth === 0) {
            lastSignificant = "RULE_END";
          }

          i++;
          continue;
        }

        if (ch === ";" && depth === 0) {
          out.push(ch);
          lastSignificant = "RULE_END";
          i++;
          continue;
        }

        if (depth === 0 && !isWhitespace(ch)) {
          lastSignificant = "OTHER";
        }

        out.push(ch);
        i++;
      }

      this.cleanCss = out.join("");
    }
  }
  userSettings = { // Default user settings
    isEnabled: true,
    inclusionPatterns: ["<all_urls>", "*://*/*", "https://*.w3schools.com/*"].join('\n'),
    exclusionPatterns: ["*://example.com/*"].join('\n'),
    min_bright_fg: 0.65, // Text with luminance  under this value will be brightened
    max_bright_fg: 1, // Text over this value will be darkened
    min_bright_bg_trigger: 0.2, // backgrounds with luminace under this value will remain as is
    min_bright_bg: 0.1, // background with value over min_bright_bg_trigger will be darkened from this value up to max_bright_bg
    max_bright_bg: 0.4, // background with value over min_bright_bg_trigger will be darkened from min_bright_bg up to this value
    bg_negative_modifier: 0, // handy transformer for OLED displays : modifier for background colors
    fg_negative_modifier: 0, // Handy transformer for OLED displays : modifier for foreground colors
    foregroundBordersEnabled: false, // Transform border colors as foreground colors for a brighter outline effect
    precisionNumber: 2,
    preserve_comments: true,
    cacheEnabled: false, // Enable or disable caching
    inject_css_suggestedimageEditionEnabled: true, // Enable or disable image edition
    serviceWorkersEnabled: false, // Enable or disable service workers
    imageEditionEnabled: true, // Enable or disable image edition
    autoRefreshOnToggle: false,
    autoRefreshOnAnySettingChange: false,
    headlessShortcutToggleEnabled: false,
    embedsInheritanceBehavior: "inheritFromParent", // Sandfox: inherit the parent page decision for embedded frames

    //Image working model
    imageDecisionLogic: "native", // from concat.js : pooledAI, pooledHeuristic, native, nativeOldSlow, bench ..
    pooledWorkersEnabled: false, // Sandfox: lazy image workers; avoid startup worker fan-out

    // Sync settings (these flags themselves are always stored in local only)
    syncSettingsEnabled: false, // Sync scalar settings across devices via Firefox Sync
    syncListsEnabled: false, // Sync inclusion/exclusion lists across devices via Firefox Sync
  }
  defaultSettings = { ...this.userSettings }

  // Keys that must never leave storage.local (sync flags themselves, transient state, etc.)
  static localOnlyKeys = ["syncSettingsEnabled", "syncListsEnabled"]

  // Keys that are synced as lists (union-merged across devices) rather than overwritten
  static syncableListKeys = ["inclusionPatterns", "exclusionPatterns"]

  // All other userSettings keys are syncable scalar settings (derived automatically)
  static get syncableSettingsKeys() {
    return Object.keys(uDark.defaultSettings).filter(k =>
      !uDarkC.localOnlyKeys.includes(k) && !uDarkC.syncableListKeys.includes(k)
    );
  }

  getSafeUserSettings(usedSettings) {

    return uDarkC.safeExportKeys.reduce((obj, key) => {
      obj[key] = usedSettings[key];
      return obj;
    }, {});

  }
  getSettings(resolve) {
    browser.storage.local.get(null, function (localRes) {
      Object.assign(uDark.userSettings, localRes);
      // If sync is enabled, overlay synced values on top of local
      const needsSyncSettings = localRes.syncSettingsEnabled;
      const needsSyncLists = localRes.syncListsEnabled;
      if (needsSyncSettings || needsSyncLists) {
        browser.storage.sync.get(null, function (syncRes) {
          if (needsSyncSettings) {
            for (const key of uDarkC.syncableSettingsKeys) {
              if (syncRes[key] !== undefined) uDark.userSettings[key] = syncRes[key];
            }
          }
          if (needsSyncLists) {
            for (const key of uDarkC.syncableListKeys) {
              if (syncRes[key] !== undefined) uDark.userSettings[key] = syncRes[key];
            }
          }
          resolve(uDark.userSettings);
        });
      } else {
        resolve(localRes);
      }
    });
  }
  byPassCSPNonce = "8IBTHwOdqNKAWeKl7plt8g=="
  imageSrcInfoMarker = "_uDark"
  imageWorkerJsFile = {
    pooledAI: "imageWorker/imageWorkerBundle-pooledAI.js",
    pooledBench: "imageWorker/imageWorkerBundle-pooledBench.js",
    pooledHeuristic: "imageWorker/imageWorkerBundle-pooledHeuristic.js",
    native: "imageWorker/imageWorkerBundle-native.js",
    native_old: "imageWorker/imageWorker-old.js",
    // native: "imageWorker/imageWorkerBundle-nativeOldSlow.js",
  }
  foreground_color_css_properties = ["color", "caret-color"] // css properties that are foreground colors;, putting caret-color or any other property will edit the caret color with lightening and preventing the caret from being darkened
  foreground_complex_color_css_properties = []
  foreground_border_properties = [
    "border", "border-color",
    "border-top", "border-top-color",
    "border-right", "border-right-color",
    "border-bottom", "border-bottom-color",
    "border-left", "border-left-color",
    "border-block", "border-block-color",
    "border-block-start", "border-block-start-color",
    "border-block-end", "border-block-end-color",
    "border-inline", "border-inline-color",
    "border-inline-start", "border-inline-start-color",
    "border-inline-end", "border-inline-end-color",
  ]


  static generateNestedParenthesisRegex(depth) { // Generates a regex that matches nested parenthesis
    if (depth === 1) {
      return "\\((.)*?\\)";
    }
    return `\\((${uDarkC.generateNestedParenthesisRegex(depth - 1)}|.)*?\\)`;
  }
  static generateNestedParenthesisRegexNC(depth) { // Generates a regex that matches nested parenthesis, non-capturing
    // It's broken by (((')')). If someday we encounter this we'll consider fixing it
    if (depth === 1) {
      return "\\(.*?\\)";
    }
    return `\\((?:${uDarkC.generateNestedParenthesisRegexNC(depth - 1)}|.)*?\\)`;
  }

  css_properties_wording_action_dict = {
    "mix-blend-mode": {
      replace: ["multiply", "normal"]
    },
    "scrollbar-color": {
      remove: 1
    },
    "color-scheme": {
      replace: ["light", "dark"]
    },

    "fill": {

      // TODO: Needs rework since we replaced prefix_fg_vars by prefix_vars
      callBacks: [(cssStyle, cssRule, details, options) => {

        let value = cssStyle.getPropertyValue("fill");
        this.edit_all_cssRule_colors_cb(cssRule, "color", value, options, {
          key_prefix: "--ud-fg--fill-",
          l_var: "--uDark_transform_lighten",
          fastValue0: true
        })

      }]
    },
    // "mask-image": {
    //   stickConcatToPropery: {
    //     sValue: "url(",
    //     rKey: "filter",
    //     stick: "brightness(10)"
    //   }
    // },
    "background-image": {
      callBacks: [this.edit_css_urls]
    },
    "background": {
      callBacks: [this.edit_css_urls]
    },
    "--ud-ptd-background": {
      variables: {
        property: "--ud-ptd-background",
        regex: this.regex_search_for_url_raw,
        use_other_property: "background-image",
        originalProperty: "background"
      },
      callBacks: [this.edit_css_urls]
    },

    // Not good for wayback machine time selector
    // "color":{ stickConcatToPropery: {sValue:"(",rKey:"mix-blend-mode", stick:"difference"}}, // Not good for wayback machine time selector
    // "position":{ stickConcatToPropery: {sValue:"fixed",rKey:"filter", stick:"contrast(110%)"}}, // Not good for wayback machine time selector
  }
  /* 
  Took comments from w3.org/csswg-drafts/css-syntax-3/#comments
  First part: \/\*[^*]*\*+([^/*][^*]*\*+)*\/ — This matches valid CSS comments.
  Second part: \/\*[^*]*\*+([^/*][^*]*\*+)* — This matches incomplete comments that look like they are improperly closed (badcomment1).
  Third part: \/\*[^*]*(\*+[^/*][^*]*)* — This also matches another form of incomplete comments (badcomment2).
  */
  edit_css(cssStyleSheet, details, options = {}) {
    if (!details) {
      details = {};
    }
    if (!details.transientCache) {
      details.transientCache = new Map();
    }
    uDark.edit_cssRules(cssStyleSheet.cssRules, details, options);
  }

  str_protect(str, regexSearch, protectWith) {
    // sore values into an array:
    var values = str.match(regexSearch);
    if (values) {
      str = str.replace(regexSearch, protectWith);
    }
    return {
      str,
      values,
      protectWith
    };
  }
  str_unprotect(str, protection) {
    if (protection.values) {
      protection.values.forEach((value, index) => {
        // I've learnt the hard way to care about some $' or $1 the protected value:
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#specifying_a_string_as_the_replacement
        // This is why we use a function to replace the protected value
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#specifying_a_function_as_the_replacement
        str = str.replace(protection.protectWith, () => value);
      })
    }
    return str;
  }
  str_protect_numbered(str, regexSearch, protectWith, condition = true) {
    // sore values into an array:
    if (!condition) {
      return false;
    }
    var values = str.match(regexSearch);
    if (values) {
      let index = 0;
      str = str.replace(regexSearch, function (match, g1) {
        return protectWith.replace("{index}", index++);
      });
    }
    return {
      str,
      values,
      protectWith
    };
  }
  str_unprotect_numbered(str, protection, condition = true) {
    if (protection.values && condition) {
      protection.values.forEach((value, index) => {
        // I've learnt the hard way tto care about some $' or $1 the protected value:
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#specifying_a_string_as_the_replacement
        // This is why we use a function to replace the protected value
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#specifying_a_function_as_the_replacement

        str = str.replace(protection.protectWith.replace("{index}", index), () => value);
      })
    }
    return str;
  }
  sRGBtoLin(colorChannel) {
    // Send this function a decimal sRGB gamma encoded color value
    // between 0.0 and 1.0, and it returns a linearized value.

    if (colorChannel <= 0.04045) {
      return colorChannel / 12.92;
    } else {
      return Math.pow(((colorChannel + 0.055) / 1.055), 2.4);
    }
  }
  getLuminance(r, g, b) {
    return (0.2126 * uDark.sRGBtoLin(r / 255) + 0.7152 * uDark.sRGBtoLin(g / 255) + 0.0722 * uDark.sRGBtoLin(b / 255));
  }
  getPerceivedLightness(r, g, b) {
    return uDark.YtoLstar(uDark.getLuminance(r, g, b));
  }
  getPerceivedLightness_approx(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  YtoLstar(Y) {
    // Send this function a luminance value between 0.0 and 1.0,
    // and it returns L* which is "perceptual lightness"

    if (Y <= (216 / 24389)) { // The CIE standard states 0.008856 but 216/24389 is the intent for 0.008856451679036
      return Y * (24389 / 27); // The CIE standard states 903.3, but 24389/27 is the intent, making 903.296296296296296
    } else {
      return Math.pow(Y, (1 / 3)) * 116 - 16;
    }
  }
  search_container_logo(element, notableInfos) {

    let parent = (element.parentNode || element)
    parent = (parent.parentNode || parent)
    return uDark.logo_match.test(parent.outerHTML + notableInfos.uDark_cssClass)
  }
  search_clickable_parent(documentElement, selectorText) {
    return documentElement.querySelector(`a ${selectorText},button ${selectorText}`);
  }
  search_logo_match(documentElement, selectorText) {
    return documentElement.querySelector(`a[href*=index] ${selectorText},a[href*=logo] ${selectorText}, a[href*=icon] ${selectorText},a[href='/'] ${selectorText}`);
  }
  image_element_strip_late_connection(value) {
    return String(value || "").replaceAll(uDark.lateConnectionModifier, "");
  }
  image_element_restore_original_href(value) {
    let originalValue = String(value || "")
      .split(new RegExp("#?" + uDark.imageSrcInfoMarker))[0];
    if (originalValue.startsWith("https://data-image/?base64IMG=")) {
      originalValue = originalValue.slice(30);
    }
    return uDark.image_element_strip_late_connection(originalValue);
  }
  image_element_restore_original_srcset(value) {
    return uDark.processSRCset(value).map(([srcSource, descriptor]) => {
      const originalSource = uDark.image_element_restore_original_href(srcSource);
      return descriptor ? `${originalSource} ${descriptor}` : originalSource;
    }).join(", ");
  }
  image_element_prepare_srcset(image, value, options = {}) {
    return uDark.processSRCset(value).map(([srcSource, descriptor]) => {
      const preparedSource = uDark.image_element_prepare_href(image, srcSource, options);
      return descriptor ? `${preparedSource} ${descriptor}` : preparedSource;
    }).join(", ");
  }
  image_element_late_connection_group(element) {
    let image = element instanceof HTMLImageElement ? element : null;
    const picture = element instanceof HTMLSourceElement && element.parentElement instanceof HTMLPictureElement
      ? element.parentElement
      : image?.parentElement instanceof HTMLPictureElement
        ? image.parentElement
        : null;

    if (!image && picture) {
      image = [...picture.children].find(child => child instanceof HTMLImageElement) || null;
    }

    const sources = picture
      ? [...picture.children].filter(child => child instanceof HTMLSourceElement)
      : element instanceof HTMLSourceElement
        ? [element]
        : [];

    return {
      image,
      elements: image ? [...sources, image] : sources,
    };
  }
  image_element_has_late_connection_marker(element) {
    return ["src", "srcset"].some(attribute =>
      element.hasAttribute?.(attribute) &&
      element.getAttribute(attribute).includes(uDark.lateConnectionModifier)
    );
  }
  image_element_track_late_connection(element) {
    if (uDark.lateConnectionReferences.has(element)) {
      return;
    }
    const reference = new WeakRef(element);
    uDark.lateConnectionReferences.set(element, reference);
    uDark.nonConnectedImagesAndSources.add(reference);
  }
  image_element_untrack_late_connection(element) {
    const reference = uDark.lateConnectionReferences.get(element);
    if (reference) {
      uDark.nonConnectedImagesAndSources.delete(reference);
      uDark.lateConnectionReferences.delete(element);
    }
  }
  image_element_install_staging_facade() {
    if (uDark.lateConnectionStagingFacadeInstalled) {
      return;
    }
    uDark.lateConnectionStagingFacadeInstalled = true;

    const parentNode = Object.getOwnPropertyDescriptor(Node.prototype, "parentNode");
    const parentElement = Object.getOwnPropertyDescriptor(Node.prototype, "parentElement");
    const getRootNode = Node.prototype.getRootNode;
    uDark.lateConnectionNativeParentNode = parentNode.get;
    uDark.lateConnectionNativeParentElement = parentElement.get;
    uDark.lateConnectionNativeGetRootNode = getRootNode;
    uDark.lateConnectionNativeAppendChild = Node.prototype.appendChild;

    Object.defineProperty(Node.prototype, "parentNode", {
      ...parentNode,
      get() {
        if (uDark.image_element_is_actively_staged_root(this)) {
          return null;
        }
        return parentNode.get.call(this);
      },
    });
    Object.defineProperty(Node.prototype, "parentElement", {
      ...parentElement,
      get() {
        if (uDark.image_element_is_actively_staged_root(this)) {
          return null;
        }
        return parentElement.get.call(this);
      },
    });
    Node.prototype.getRootNode = function (...args) {
      const nativeRoot = getRootNode.apply(this, args);
      return uDark.lateConnectionStageByHost.get(nativeRoot)?.root || nativeRoot;
    };

    ["remove", "before", "after", "replaceWith"].forEach(methodName => {
      const prototype = Element.prototype;
      const nativeMethod = prototype[methodName];
      if (typeof nativeMethod !== "function") {
        return;
      }
      Object.defineProperty(prototype, methodName, {
        configurable: true,
        writable: true,
        value: function (...args) {
          if (uDark.image_element_is_actively_staged_root(this)) {
            return undefined;
          }
          return nativeMethod.apply(this, args);
        },
      });
    });
  }
  image_element_is_actively_staged_root(element) {
    const stage = uDark.lateConnectionStageByRoot.get(element);
    return Boolean(
      stage &&
      uDark.lateConnectionNativeParentNode.call(element) === stage.host
    );
  }
  image_element_native_root(element) {
    return uDark.lateConnectionNativeGetRootNode.call(element, { composed: true });
  }
  image_element_cleanup_stage(stage) {
    if (!stage) {
      return;
    }
    uDark.lateConnectionStageByHost.delete(stage.host);
    if (stage.root) {
      uDark.lateConnectionStageByRoot.delete(stage.root);
    }
    uDark.lateConnectionActiveStages.delete(stage);
    stage.elements.forEach(element => {
      const state = uDark.lateConnectionStates.get(element);
      if (state?.stage === stage) {
        state.stage = null;
      }
    });
    stage.elements.clear();
  }
  image_element_poll_unstageable_late_connection(element) {
    const state = uDark.lateConnectionStates.get(element);
    if (!state || state.pollingConnection) {
      return;
    }
    state.pollingConnection = true;
    const reference = new WeakRef(element);
    const inspect = () => {
      const currentElement = reference.deref();
      const currentState = currentElement && uDark.lateConnectionStates.get(currentElement);
      if (!currentElement || !currentState) {
        return;
      }
      if (currentElement.isConnected) {
        currentState.pollingConnection = false;
        uDark.image_element_recover_late_connection(currentElement);
        return;
      }
      const root = uDark.image_element_native_root(currentElement);
      if (!(root instanceof DocumentFragment) || root instanceof ShadowRoot) {
        currentState.pollingConnection = false;
        uDark.image_element_stage_late_connection(currentElement);
        return;
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  }
  image_element_stage_late_connection(element) {
    const state = uDark.lateConnectionStates.get(element);
    if (!state || element.isConnected) {
      if (element.isConnected && state?.failureCaught) {
        uDark.image_element_recover_late_connection(element);
      }
      return;
    }

    const nativeRoot = uDark.image_element_native_root(element);
    const existingStage = uDark.lateConnectionStageByHost.get(nativeRoot);
    if (existingStage) {
      existingStage.elements.add(element);
      state.stage = existingStage;
      return;
    }
    if (nativeRoot instanceof DocumentFragment) {
      uDark.image_element_poll_unstageable_late_connection(element);
      return;
    }
    if (!(nativeRoot instanceof Element)) {
      return;
    }

    const host = document.createElement("udark-image-stage");
    const shadowRoot = host.attachShadow({ mode: "closed" });
    const slot = document.createElement("slot");
    const stage = {
      host,
      slot,
      root: nativeRoot,
      elements: new Set([element]),
      handling: false,
    };
    shadowRoot.appendChild(slot);
    uDark.lateConnectionStageByHost.set(host, stage);
    uDark.lateConnectionStageByRoot.set(nativeRoot, stage);
    uDark.lateConnectionActiveStages.add(stage);
    state.stage = stage;
    slot.addEventListener("slotchange", () => {
      if (stage.handling) {
        return;
      }
      const actualParent = uDark.lateConnectionNativeParentNode.call(stage.root);
      if (actualParent === stage.host) {
        return;
      }
      stage.handling = true;
      const elements = [...stage.elements];
      uDark.image_element_cleanup_stage(stage);
      elements.forEach(lateElement => {
        const lateState = uDark.lateConnectionStates.get(lateElement);
        if (!lateState) {
          return;
        }
        const group = uDark.image_element_late_connection_group(lateElement);
        if (group.image) {
          uDark.image_element_install_decode_waiter(group.image);
          uDark.image_element_install_late_connection_error(group.image);
        }
        if (lateElement.isConnected) {
          if (lateState.failureCaught) {
            uDark.image_element_recover_late_connection(group.image || lateElement);
          }
        } else {
          uDark.image_element_stage_late_connection(lateElement);
        }
      });
    });
    uDark.lateConnectionNativeAppendChild.call(host, nativeRoot);
  }
  image_element_install_decode_waiter(image) {
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    let state = uDark.lateConnectionStates.get(image);
    if (!state) {
      state = {
        options: {},
        failureCaught: false,
        recovering: false,
        decodeWaiters: [],
        originalOwnDecode: Object.getOwnPropertyDescriptor(image, "decode"),
        originalOwnDecodeCaptured: true,
      };
      uDark.lateConnectionStates.set(image, state);
    }
    if (!state.originalOwnDecodeCaptured) {
      state.originalOwnDecode = Object.getOwnPropertyDescriptor(image, "decode");
      state.originalOwnDecodeCaptured = true;
    }
    if (state.decodeInstalled) {
      return;
    }

    state.decodeInstalled = true;
    Object.defineProperty(image, "decode", {
      configurable: true,
      writable: true,
      value: () => new Promise((resolve, reject) => {
        state.decodeWaiters.push({ resolve, reject });
      }),
    });
  }
  image_element_restore_decode(image, state) {
    if (!(image instanceof HTMLImageElement) || !state?.decodeInstalled) {
      return;
    }

    if (state.originalOwnDecode) {
      Object.defineProperty(image, "decode", state.originalOwnDecode);
    } else {
      delete image.decode;
    }
    state.decodeInstalled = false;

    if (!state.decodeWaiters.length) {
      return;
    }

    let decodeResult;
    try {
      decodeResult = HTMLImageElement.prototype.decode.call(image);
    } catch (error) {
      state.decodeWaiters.splice(0).forEach(waiter => waiter.reject(error));
      return;
    }

    Promise.resolve(decodeResult).then(
      value => state.decodeWaiters.splice(0).forEach(waiter => waiter.resolve(value)),
      error => state.decodeWaiters.splice(0).forEach(waiter => waiter.reject(error))
    );
  }
  image_element_register_late_connection(element, options = {}) {
    let state = uDark.lateConnectionStates.get(element);
    if (!state) {
      state = {
        options,
        failureCaught: false,
        recovering: false,
        decodeWaiters: [],
        originalOwnDecodeCaptured: false,
      };
      uDark.lateConnectionStates.set(element, state);
    } else {
      // A detached preloader can be reused for another URL after its first
      // native load. Start a fresh marker/error/release cycle for that URL.
      if (state.releasedDetached) {
        state.failureCaught = false;
        state.recovering = false;
        state.releasedDetached = false;
        state.originalAttributes = undefined;
      }
      state.options = options;
    }

    uDark.image_element_track_late_connection(element);
    element.setAttribute("ud-non-connected", "1");
    uDark.image_element_stage_late_connection(element);

    const group = uDark.image_element_late_connection_group(element);
    if (group.image) {
      uDark.image_element_install_decode_waiter(group.image);
      uDark.image_element_install_late_connection_error(group.image);
    }
    uDark.image_element_ensure_late_connection_error_capture();
  }
  image_element_install_late_connection_error(image) {
    if (!(image instanceof HTMLImageElement) || uDark.lateConnectionErrorTargets.has(image)) {
      return;
    }

    uDark.lateConnectionErrorTargets.add(image);
    image.addEventListener("error", event => {
      uDark.image_element_handle_late_connection_error(event);
    }, { capture: true });
    image.addEventListener("load", event => {
      const state = uDark.lateConnectionStates.get(image);
      if (!state?.suppressContextualLoad) {
        return;
      }
      // The website already received the native detached preload. Rewriting
      // the now-connected URL with UltimaDark context can produce another
      // native load, which is an internal implementation detail.
      event.stopPropagation();
      event.stopImmediatePropagation();
      state.suppressContextualLoad = false;
      uDark.lateConnectionStates.delete(image);
    }, { capture: true });
  }
  image_element_handle_late_connection_error(event) {
    const image = event.target instanceof HTMLImageElement
      ? event.target
      : event.currentTarget instanceof HTMLImageElement
        ? event.currentTarget
        : null;
    if (!image) {
      return;
    }

    const group = uDark.image_element_late_connection_group(image);
    if (!group.elements.some(uDark.image_element_has_late_connection_marker)) {
      return;
    }

    event.stopPropagation();
    event.stopImmediatePropagation();

    group.elements.forEach(element => {
      const state = uDark.lateConnectionStates.get(element) || {
        options: {},
        decodeWaiters: [],
      };
      state.failureCaught = true;
      uDark.lateConnectionStates.set(element, state);
      uDark.image_element_track_late_connection(element);
    });

    if (image.isConnected) {
      uDark.image_element_recover_late_connection(image);
    } else {
      uDark.image_element_release_detached_late_connection(image);
    }
  }
  image_element_release_detached_late_connection(element) {
    const group = uDark.image_element_late_connection_group(element);
    const elements = group.elements.length ? group.elements : [element];
    const states = elements.map(groupElement => uDark.lateConnectionStates.get(groupElement));
    if (states.some(state => state?.recovering || state?.releasedDetached)) {
      return;
    }

    const releaseAttribute = (groupElement, attribute) => {
      const value = groupElement.getAttribute?.(attribute);
      if (!value?.includes(uDark.lateConnectionModifier)) {
        return;
      }
      const state = uDark.lateConnectionStates.get(groupElement);
      const originalValue = uDark.image_element_strip_late_connection(value);
      state.originalAttributes ||= {};
      state.originalAttributes[attribute] = originalValue;
      state.releasedDetached = true;
      // Deliberately bypass the patched property setter. The website must
      // receive a genuine native load/decode before it decides to insert the
      // image; contextual UltimaDark processing happens at insertion.
      groupElement.setAttribute(attribute, originalValue);
    };

    elements.filter(groupElement => groupElement instanceof HTMLSourceElement)
      .forEach(source => releaseAttribute(source, "srcset"));
    if (group.image) {
      releaseAttribute(group.image, "srcset");
      releaseAttribute(group.image, "src");
      uDark.image_element_restore_decode(
        group.image,
        uDark.lateConnectionStates.get(group.image)
      );
    } else {
      elements.forEach(groupElement => {
        releaseAttribute(groupElement, "srcset");
        releaseAttribute(groupElement, "src");
      });
    }
  }
  image_element_ensure_late_connection_error_capture() {
    if (!document?.documentElement) {
      return;
    }

    if (!uDark.lateConnectionErrorCaptureInstalled) {
      uDark.lateConnectionErrorCaptureInstalled = true;
      document.addEventListener("error", event => {
        uDark.image_element_handle_late_connection_error(event);
      }, true);
    }
  }
  image_element_recover_late_connection(element) {
    const group = uDark.image_element_late_connection_group(element);
    const elements = group.elements.length ? group.elements : [element];
    const states = elements.map(groupElement => uDark.lateConnectionStates.get(groupElement));

    if (states.some(state => state?.recovering)) {
      return;
    }
    states.forEach(state => {
      if (state) state.recovering = true;
    });

    new Set(states.map(state => state?.stage).filter(Boolean))
      .forEach(stage => uDark.image_element_cleanup_stage(stage));

    elements.forEach(groupElement => {
      groupElement.removeAttribute?.("ud-non-connected");
    });

    try {
      const imageState = group.image
        ? uDark.lateConnectionStates.get(group.image)
        : null;
      if (imageState?.releasedDetached) {
        imageState.suppressContextualLoad = true;
      }

      const restoreAttribute = (groupElement, attribute) => {
        const currentValue = groupElement.getAttribute?.(attribute);
        const state = uDark.lateConnectionStates.get(groupElement);
        const cleanValue = currentValue?.includes(uDark.lateConnectionModifier)
          ? uDark.image_element_strip_late_connection(currentValue)
          : state?.releasedDetached
            ? state.originalAttributes?.[attribute]
            : null;
        if (!cleanValue) {
          return;
        }

        const options = {
          ...(state?.options || {}),
          dontEditNonConnected: true,
        };
        const preparedValue = attribute === "srcset"
          ? uDark.image_element_prepare_srcset(groupElement, cleanValue, options)
          : uDark.image_element_prepare_href(groupElement, cleanValue, options);
        groupElement.setAttribute(attribute, preparedValue);
      };

      // In a picture element, responsive sources must be valid before the img
      // fallback is restored, otherwise Firefox can retain the fallback preview.
      elements.filter(groupElement => groupElement instanceof HTMLSourceElement)
        .forEach(source => restoreAttribute(source, "srcset"));
      if (group.image) {
        restoreAttribute(group.image, "srcset");
        restoreAttribute(group.image, "src");
      } else {
        elements.forEach(groupElement => {
          restoreAttribute(groupElement, "srcset");
          restoreAttribute(groupElement, "src");
        });
      }
    } finally {
      elements.forEach(groupElement => {
        uDark.image_element_untrack_late_connection(groupElement);
        const state = uDark.lateConnectionStates.get(groupElement);
        if (groupElement === group.image) {
          uDark.image_element_restore_decode(groupElement, state);
        }
        if (!(groupElement === group.image && state?.suppressContextualLoad)) {
          uDark.lateConnectionStates.delete(groupElement);
        }
      });
    }
  }
  elements_or_ancestor_parents_is_tagNames(tagNames, elements) {
    return elements.some(element => {
      let parent = element;
      console.log(parent);
      while (parent) {
        console.log(parent.tagName.toLowerCase(), tagNames, tagNames.has(parent.tagName.toLowerCase()));
        if (tagNames.has(parent.tagName.toLowerCase())) {
          return true;
        }
        parent = parent.parentNode;
      }
    })
  }
  image_element_prepare_href(image, src_override, options = {}) // Adds notable infos to the image element href, used by the image edition feature
  {
    // Do not parse url preventing adding context to it or interpreting it as a relative url or correcting its content by any way
    let imageTrueSrc = src_override || image.getAttribute("src")

    imageTrueSrc = imageTrueSrc?.trim();

    if (!uDark.userSettings.imageEditionEnabled || !imageTrueSrc) {

      return imageTrueSrc;
    }

    if (!image.hasAttribute("data-ud-selector")) {
      image.setAttribute("data-ud-selector", Math.random());
    }
    let selectorText = image.tagName + `[data-ud-selector='${image.getAttribute("data-ud-selector")}']`;


    let notableInfos = options.notableInfos || {};
    for (const attribute of image.attributes) {
      if (attribute.value.length > 0 && !(/[.\/]/i).test(attribute.value) && !(["src", "data", "data-ud-selector"]).includes(attribute.name)) {
        notableInfos[attribute.name] = attribute.value;
      }
    }
    if (imageTrueSrc.includes(uDark.imageSrcInfoMarker)) {
      return imageTrueSrc;
    }
    if (!image.isConnected && !options.dontEditNonConnected) {
      // console.warn("UltimaDark: Image is not connected to DOM, delaying its processing until it is connected", image,`${modifer}${imageTrueSrc}`,new Error());
      uDark.image_element_register_late_connection(image, options);
      return `${uDark.lateConnectionModifier}${imageTrueSrc}`; // Wait for the captured error and DOM connection before processing with full context
    }
    if (uDark.search_clickable_parent(image.getRootNode(), selectorText)) {
      notableInfos.inside_clickable = true;
    }
    // console.log("Searching logo for ", image, selectorText);
    if (uDark.search_logo_match(image.getRootNode(), selectorText)) {
      notableInfos.logo_match = true;
    }
    if (uDark.search_container_logo(image, notableInfos)) {
      notableInfos.logo_match = true;
    }
    let usedChar = uDark.imageSrcInfoMarker;
    if (!imageTrueSrc.includes("#")) {
      usedChar = "#" + usedChar;
    }
    imageTrueSrc = uDark.send_data_image_to_parser(imageTrueSrc, false, {
      ...options,
      notableInfos,
      image
    });

    return imageTrueSrc + usedChar + new URLSearchParams(notableInfos).toString();
  }
  valuePrototypeEditor(leType, atName, setter = false, conditon = false, aftermath = false, getter = false) {

    uDark.info("Editing property :", leType, atName)

    if (leType.concat) {
      return leType.forEach(aType => uDark.valuePrototypeEditor(aType, atName, setter, conditon, aftermath, getter))
    }

    if (leType.wrappedJSObject) { // Cross compatibilty with content script
      leType = leType.wrappedJSObject;
    }

    var originalProperty = Object.getOwnPropertyDescriptor(leType.prototype, atName);
    if (!originalProperty) {
      console.error("No existing property for '", atName, "'", leType, leType.name, leType.prototype)
      return;
    }

    Object.defineProperty(leType.prototype, "o_ud_" + atName, originalProperty);
    let override_get_set = {};
    if (setter) {
      override_get_set.set = uDark.exportFunction(function (value) { // getters must be exported like regular functions
        if (value instanceof Error && value.message === "CancelledCall") {
          return originalProperty.get.call(this); // Return the original value without modification if the call was cancelled
        }
        var new_value = (!conditon || conditon(this, value) === true) ? setter(this, value) : value;
        let call_result = originalProperty.set.call(this, new_value || value);
        aftermath && aftermath(this, value, new_value);
        return call_result;
      }, window);
    }
    if (getter) {
      override_get_set.get = uDark.exportFunction(function () { // getters must be exported like regular functions
        let call_result = originalProperty.get.call(this);
        return getter(this, call_result);
      }, window);
    }
    // uDark.general_cache["o_ud_"+atName]=originalSet
    Object.defineProperty(leType.prototype, atName, override_get_set);
  }

  functionWrapper(leType, laFonction, fName, watcher = x => x, conditon = true, result_editor = x => x) {
    uDark.info("Wrapping function :", leType, laFonction, fName)
    let originalFunction = leType.prototype["o_ud_wrap_" + fName] = laFonction;
    leType.prototype[fName] = function (...args) {
      if (conditon === true || conditon(this, arguments) === true) {
        let watcher_result = watcher(this, arguments);
        let result = originalFunction.apply(...watcher_result)
        return result_editor(result, this, watcher_result);
      } else {
        return (originalFunction.apply(this, arguments));
      }
    }
  }
  repairFunctionNames(proto, aFunction) {
    if (aFunction && typeof aFunction.name === "string" && aFunction.name !== "") {
      return aFunction.name;
    }
    /*
    UltimaDark patches browser prototypes early, but other extensions may run
    first and modify the same APIs. Some (e.g., SingleFile) override the
    "name" property on native methods so that .name becomes "", while the
    function itself is still native. This can break UltimaDark logic that
    relies on correct function names. This helper restores the proper names
    without replacing the functions or touching the prototype chain.
    */
    const keys = Object.getOwnPropertyNames(proto);
    for (const key of keys) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc?.get || desc?.set) continue;
      const fn = desc.value;
      if (typeof fn !== "function") continue;
      const nameDesc = Object.getOwnPropertyDescriptor(fn, "name");
      if (!nameDesc) continue;
      if (nameDesc.value !== "" || !nameDesc.configurable) continue;
      delete fn.name;
      if (fn.name === "") {
        Object.defineProperty(fn, "name", { value: key, configurable: true });
      }
    }
    return aFunction.name;
  }


  functionPrototypeEditor(leType, laFonction, watcher = x => x, conditon = x => x, result_editor = x => x) {
    if (laFonction.concat) {
      return laFonction.forEach(aFonction => {
        uDark.functionPrototypeEditor(leType, aFonction, watcher, conditon, result_editor)
      })
    }
    if (leType.wrappedJSObject) { // Cross compatibilty with content script
      leType = leType.wrappedJSObject;
    }
    uDark.info("Editing function :", leType, laFonction)

    uDark.repairFunctionNames(leType.prototype, laFonction);

    leType.prototype.count = (leType.prototype.count || 0) + 1;
    if (!Object.getOwnPropertyDescriptor(leType.prototype, laFonction.name)) {
      uDark.error("No getter for '", leType, laFonction, new Error(), leType.prototype.count, document.location.href)
      return;
    }
    let originalFunctionKey = "o_ud_" + laFonction.name
    var originalFunction = uDark.exportFunction(Object.getOwnPropertyDescriptor(leType.prototype, laFonction.name).value, window);

    // store original function
    Object.defineProperty(leType.prototype, originalFunctionKey, {
      value: originalFunction,
      writable: true
    });

    // create a named wrapper
    const wrappedFunction = uDark.exportFunction(function wrapper() {

      if (conditon === true || conditon.apply(this, arguments)) {
        const watcher_result = watcher(this, arguments);

        if (watcher_result[0] instanceof Error && watcher_result[0].message === "CancelledCall") {

          return originalFunction.apply(this, arguments[0].altArgs); // Return the original value without modification if the call was cancelled
        }
        const result = originalFunction.apply(this, watcher_result);
        return result_editor(result, this, arguments, watcher_result, originalFunction);
      }
      return originalFunction.apply(this, arguments);
    }, window);

    // now **set the visible name**
    Object.defineProperty(wrappedFunction, "name", {
      value: laFonction.name,
      configurable: true
    });

    // install it
    Object.defineProperty(leType.prototype, laFonction.name, {
      value: {
        [laFonction.name]: wrappedFunction
      }[laFonction.name]
    });
  }

  edit_str_restore_imports_all_way(str, rules) {
    // This regexp seems a bit complex
    // because @import url("") can includes ";" which is also the css instruction separator like in following example
    // @charset "UTF-8";@import url("https://use.typekit.net/lls1fmf.css");
    // @import url("https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap");
    // .primary-1{ color: rgb(133, 175, 255); }

    // This code is sensible to some edge cases, like @rules put in a comment, or in a string, and this is why i now use the protect system
    // It was breaking https://www.pascalgamedevelopment.com/content.php .
    // It would be possible to fix this by adding a condition to the regex to avoid matching @rules in comments or strings, but it would be a bit more complex
    // Or even protecting the @rules individually wit a numbered css class, but it would be a bit more complex too regarding the occurences of the @rules in strings or comments

    let imports = str.match(uDark.cssAtRulesRegex) || [];
    rules.unshift(...imports);

  }
  send_data_image_to_parser(str, details, options) {

    // uDark.disable_data_image_edition=true;
    if (str.trim().toLowerCase().startsWith('data:') && uDark.userSettings.imageEditionEnabled && !uDark.disable_data_image_edition) {
      let {
        b64,
        dataHeader,
        data,
        failure
      } = options.cut || uDark.decodeBase64DataURIifIsDataURI(str);
      let imageData = data;
      options.changed = true; // We have changed the image, notify calle, like edit_css_url action
      options.is_data_image = true;

      if (!failure && dataHeader.includes('svg')) // Synchronous edit for data SVGs images, we have some nice context and functions to work with
      { // This avoids loosing svg data including the size of the image, and the tags in the image
        uDark.disable_svg_data_url_edition = false;
        options.svgImage = true;
        options.svgDataImage = true;
        if (uDark.disable_svg_data_url_edition) {
          return str;
        }

        if (!b64) {

          // This replaces searches for unencoded % in image data, and replaces them by the equivalent %25.
          // Some websites uses % in their svg data eg for percentage value, while not encoding them.
          // This results in a probalby broken image, since we are in a dataURL image.
          // I dont care too much about this,but it can lead to decodeURI errors. and therefore to a broken page. 
          imageData = imageData.replace(/(%[0-9a-z]{2}){1,3}/gi, (match) => {
            try {
              return decodeURIComponent(match);
            }
            catch {
              return "%25" + match.slice(1);  // Would still break on a str like %RE%RE ( two invalid percent encodings in a row)
            }
          });
        };
        imageData = uDark.frontEditHTML(false, imageData, details, options);

        let encoded = undefined;
        // uDark.disable_reencode_data_svg_to_base64=true;
        if (uDark.disable_reencode_data_svg_to_base64) {
          if (b64) {
            dataHeader = dataHeader.replace("base64", "")
          };
          encoded = dataHeader + encodeURIComponent(imageData)
        } else if (uDark.respect_site_svgs_dataurls) {
          if (!b64) {
            imageData = encodeURIComponent(imageData);
          }
          let encoded = uDark.rencodeToURI(imageData, dataHeader, b64);
          if (encoded.message) {
            console.warn(encoded)
            encoded = encodeURIComponent(imageData);
          }
          str = encoded;
        } else {
          if (!b64) {
            encoded = uDark.rencodeToURI(imageData, dataHeader.split(",").join(";base64,"), true);
          } else {
            encoded = uDark.rencodeToURI(imageData, dataHeader, true);
          }
          if (encoded.message) {
            encoded = encodeURIComponent(imageData);
            encoded = uDark.rencodeToURI(encoded, dataHeader.replace("base64", ""), false);
          }

        }

        str = encoded;
      } else {
        str = "https://data-image?base64IMG=" + str; // Sending other images to the parser via the worker,
        if (options.image) {
          options.image.removeAttribute("crossorigin"); // data images are not CORS with this domain, so we remove the attribute to avoid CORS errors
        }
      }
    }
    return str;
  }
  get_fill_for_svg_elem(fillElem, override_value = false, options = {}, class_name = "udark-fill", transform = true) {
    let fillValue = override_value || fillElem.getAttribute("fill");
    if (override_value == "none" || !uDark.is_color(fillValue)) {
      fillValue = "#000000";
    }
    if (["animate"].includes(fillElem.tagName)) {
      return fillValue
    } // fill has another meaning for animate
    let is_text = options.notableInfos.guessed_type == "logo" || ["text", "tspan"].includes(fillElem.tagName);

    if (!is_text && ["path"].includes(fillElem.tagName)) {
      let draw_path = fillElem.getAttribute("d");
      // Lot of stop path in in path, it's probably a text
      is_text = draw_path && ([...draw_path.matchAll(/Z/ig)].length >= 2 || draw_path.length > 170)

    }
    fillElem.setAttribute("udark-edit", true);
    fillElem.setAttribute(class_name, `${options.notableInfos.guessed_type}${is_text ? "-text" : ""}`);

    if (transform) {
      // Wont work with new mthod, will need to be updated
      let edit_result = uDark.eget_color(fillValue, is_text ? uDark.revert_rgba : uDark.rgba, false, true)
      return edit_result;
    }
    return "UDark : Not implemented";
  }
  frontEditSVG(svg, details, options = {}) {
    if (!uDark.userSettings.imageEditionEnabled) {
      return;
    }
    uDark.edit_styles_attributes(svg, details, options);
    uDark.edit_styles_elements(svg, details, "ud-edited-background", options);
    options = {
      ...options, // Do not edit the original object, it may be used by other functions by reference
      notableInfos: options.notableInfos || {},
      lighten: uDark.rgba,
      darken: uDark.revert_rgba,
    }
    svg.setAttribute("udark-fill", true);
    svg.setAttribute("udark-id", Math.random());
    let svgUdarkId = svg.getAttribute("udark-id"); // Toto use XPATH istead of CSS to search parent elements and stuff
    if (!options.notableInfos.inside_clickable) {
      if (uDark.search_clickable_parent(svg.getRootNode(), `svg[udark-id='${svgUdarkId}']`)) {
        options.notableInfos.inside_clickable = true;
      }
    }

    if (!options.notableInfos.logo_match) {
      if (uDark.search_container_logo(svg, options.notableInfos)) {
        options.notableInfos.logo_match = true;
      }
    }
    if (options.notableInfos.logo_match || options.notableInfos.inside_clickable) {
      options.notableInfos.guessed_type = "logo";
    }

    if (options.notableInfos.guessed_type == "logo") {

      svg.setAttribute("fill", "white");
      // svg.removeAttribute("fill");
      // svg.setAttribute("fill", "currentColor");

      if (options.remoteSVG || options.svgDataImage) // If there is no style element, we don't need to create one
      {
        let styleElem = svg.getRootNode().createElement("style");
        styleElem.id = "udark-styled";
        styleElem.append(svg.getRootNode().createTextNode(uDark.inject_css_override))
        styleElem.append(svg.getRootNode().createTextNode("svg{color:white}")) // Allows "currentColor" to take effect

        svg.append(styleElem);
      }

    }
    svg.querySelectorAll("[fill]:not([udark-fill])").forEach(fillElem => {
      fillElem.setAttribute("fill", uDark.get_fill_for_svg_elem(fillElem, false, options))
    })
    svg.querySelectorAll("[stroke]:not([udark-stroke])").forEach(fillElem => {
      fillElem.setAttribute("stroke", uDark.get_fill_for_svg_elem(fillElem, fillElem.getAttribute("stroke"), options).replace(/currentColor/i, "white"), "udark-stroke")
    })

    svg.setAttribute("udark-guess", options.notableInfos.guessed_type);
    svg.setAttribute("udark-infos", new URLSearchParams(options.notableInfos).toString());

  }
  edit_styles_elements(
    parentElement,
    details,
    add_class = "ud-edited-background",
    options = {}
  ) {

    const styles = parentElement.querySelectorAll(
      `style:not(.${add_class})`
    );


    styles.forEach(astyle => {
      if (!details || details.hasHashCSP) {
        if (!astyle.nonce) {
          astyle.setAttribute("nonce", uDark.byPassCSPNonce);
        }
      }

      astyle.p_ud_innerHTML = uDark.edit_str(
        astyle.innerHTML.unprotect_simple(
          "ud-tag-ptd-"
        ),
        false,
        false,
        details,
        false,
        options
      );

      astyle.classList.add(add_class);
    });
  }

  setDocType(html, parsedDocument, details) {



    /*
    /*
    ===============================================================================
    HTML document prolog parsing – exact-fidelity rationale
    ===============================================================================
    
    Purpose
    -------
    Extract and preserve the document prolog exactly as found in the original
    source, up to (and including) the DOCTYPE if present. This logic is explicitly
    non-normalizing: malformed constructs are preserved verbatim to avoid silently
    changing the document mode (e.g. quirks → standards).
    
    Normative reference:
    https://www.w3.org/TR/2021/NOTE-html53-20210128/syntax.html#writing-html-documents
    
    Per spec, before the <html> element a document may contain, in order:
    an optional BOM, arbitrary whitespace and comments, a DOCTYPE, then again
    arbitrary whitespace and comments.
    
    -------------------------------------------------------------------------------
    Whitespace
    ----------
    Whitespace is not limited to literal characters. TAB, LF, FF, CR and SPACE
    (U+0009, U+000A, U+000C, U+000D, U+0020) may appear either directly or encoded
    as numeric character references (decimal or hexadecimal). The regex therefore
    accepts both literal and entity-encoded forms to prevent premature termination
    before the DOCTYPE.
    
    -------------------------------------------------------------------------------
    Comments and bogus constructs
    -----------------------------
    Valid comments include <!-- ... --> and <!-- ... --!>. In addition, the HTML
    tokenizer may emit bogus comment tokens for malformed markup encountered before
    the document element.
    
    Bogus comment state can be entered from the tag-open state when encountering:
    "/" followed by anything other than an ASCII letter, '>' or EOF
    OR (by entering into Markup declaration open state with "!" if not followed by "DOCTYPE" or --)
    OR "?". Toeknizer will repair this into a comment, but thats none of our business
    
    -------------------------------------------------------------------------------
    Interference minimization rationale
    -----------------------------------
    Although this proxy actively parses and rewrites parts of the document, the
    prolog is treated as a pass-through region where interference must be minimized.
    All constructs that the origin server emitted before <html> are preserved,
    including semantically inert or malformed ones, to ensure that the client
    receives content as close as possible to what the website intended after proxy
    processing.
    
    Dropping, normalizing or reordering these constructs could subtly alter parsing
    behavior, document mode, or downstream client expectations. Preservation here is
    therefore intentional and defensive, not an attempt at validation or cleanup.
    // Stray </...> tags are kept to preserve origin fidelity; they also happen to
    // match the bogus-construct branch cleanly, which simplifies handling.
    -------------------------------------------------------------------------------
    Regex intent
    ------------
    The regex greedily consumes everything that the HTML parser allows before the
    document element: whitespace (literal or entity-encoded), valid comments, bogus
    comments, processing instructions, invalid or removed closing tags, and the
    DOCTYPE itself. Consumption stops at the first construct that returns the
    tokenizer to normal data-state element parsing (typically <html>).

    If no DOCTYPE is present, ud_doctype is left empty to avoid introducing or
    normalizing a DOCTYPE and accidentally altering the rendering mode.
    ===============================================================================
    */

    /*
    

    This regexp ^(  … )* greedily matches everything that is permitted to appear at the
    start of an HTML document *before normal element parsing begins*, stopping
    as soon as the tokenizer would re-enter the DATA state for real markup
    (typically at <html>).

    Each alternative corresponds to a construct that is legal or tolerated by the
    HTML tokenizer in the document prolog:
    1) \s and \0x00
    Matches literal ASCII whitespace and BOM at start (Specific to javascript).

    2) &#0*?(9|10|12|13|32)(?![0-9])
    Matches decimal numeric character references for TAB, LF, FF, CR and SPACE.
    The negative lookahead prevents over-consuming longer numeric entities.

    3) &#x0*?(9|A|C|D|20)(?![0-9A-F])
    Same as above, but for hexadecimal numeric character references.
    3.5) 0*? accepts leading-zero numeric references (&#09;, &#x000A) while staying minimally greedy.
    4) <!--.*?(--!?>|$)
    Matches valid HTML comments, including the non-standard but tolerated
    “comment end bang” form (--!>). Also tolerates unterminated comments to
    preserve malformed input verbatim.
    // Real HTML comments must consume until '-->' or '--!>'; placing this branch
    // first avoids treating them as generic '<!' constructs that stop at '>'.

    5) <[\/!\?].*?(>|$)
    Matches any '<' followed by '/', '!' or '?', covering:
    - removed or invalid closing tags (</...>)
    - DOCTYPE declarations (<!DOCTYPE ...>)
    - comments not caught above
    - processing instructions (<?...?>)
    These forms may legitimately lead the tokenizer into the bogus comment
    state and must be preserved.
    */
    let usedRegex =
      /^(\x00|\s|&#0*?(?:9|10|12|13|32)(?![0-9])|&#x0*?(?:9|A|C|D|20)(?![0-9A-F])|<!--.*?(--!?>|$)|<[\/!\?].*?(>|$))*/si
    const fullmatch = html.match(usedRegex);
    parsedDocument.ud_doctype = fullmatch ? fullmatch[0] : ""; // Do not return doctype if not found, to avoid transforming a quirk to Standard
  }
  workAroundUnspecifiedCharset(aDocument, details) {
    // As we seen document.characterSet will default <meta http-equiv> we need to account the meta tag charset and re decode the document properly
    // It Falbacks from http header charset to meta tag charset, then to http-equiv charset then to OS charset.
    // We can use queryselector safely as it takes the first meta tag it finds
    let metaContentType = aDocument.querySelector("meta[charset],meta[http-equiv='Content-Type']");
    // If both charset and http-equiv attributes are set in the same tag , charset wins

    if (metaContentType) {
      let usedContentType = metaContentType.getAttribute("content");
      if (metaContentType.hasAttribute("charset")) {
        let usedCharset = metaContentType.getAttribute("charset");
        usedContentType = (details.XHTML ? `application/xhtml+xml;` : `text/html;`) + ` charset=${usedCharset}`;
      }
      let metaDetails = {
        responseHeaders: [{
          name: "Content-Type",
          value: usedContentType
        }]
      }
      uDark.extractCharsetFromHeaders(metaDetails);
      if (metaDetails.charset != "utf-8") {
        details.metaContentType = usedContentType;
        details.unspecifiedCharset = false;
        details.charset = metaDetails.charset;
        const redDecoded = uDarkDecode(metaDetails.charset, details.writeEnd, {
          stream: true
        });
        return uDark.parseAndEditHtmlContentBackend4(redDecoded, details);
      }
    }
    return false; // No workaround applied
  }
  createInclusiveDOMQueryScope(root, excludedSubtrees = false) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return false;
    }

    // Backend documents and parsed DocumentFragments keep their native query
    // methods. Only an Element root needs an inclusive/filtered facade.
    if (!excludedSubtrees && !(root instanceof Element)) {
      return root;
    }

    const isExcluded = node => {
      if (!excludedSubtrees) {
        return false;
      }

      for (let current = node; current; current = current.parentNode) {
        if (excludedSubtrees.has(current)) {
          return true;
        }
        if (current === root) {
          break;
        }
      }

      return false;
    };

    const querySelectorAll = selector => {
      const nodes = [];

      if (
        root instanceof Element &&
        root.matches(selector) &&
        !isExcluded(root)
      ) {
        nodes.push(root);
      }

      for (const node of root.querySelectorAll(selector)) {
        if (!isExcluded(node)) {
          nodes.push(node);
        }
      }

      return nodes;
    };

    return {
      querySelectorAll,
      querySelector(selector) {
        return querySelectorAll(selector)[0] || null;
      }
    };
  }
  transformDOMSubtree(root, details, options = {}) {
    const {
      excludedSubtrees = false,
      deferSvgRestore = false,
      deferIntegrityRestore = false,
      fromDocumentWrite: _fromDocumentWrite = false,
      ...editOptions
    } = options;

    const scope = uDark.createInclusiveDOMQueryScope(
      root,
      excludedSubtrees
    );



    const result = { svgElements: [] };

    if (!scope) {
      return result;
    }

    if (root instanceof SVGElement) {
      uDark.frontEditSVG(root, details, editOptions);
      return result;
    }

    let completed = false;
    try {
      result.svgElements = uDark.processSvgElements(scope, details);
      uDark.edit_styles_attributes(scope, details, editOptions);
      uDark.edit_styles_elements(
        scope,
        details,
        "ud-edited-background",
        editOptions
      );
      uDark.processLinks(scope);
      uDark.processImages(scope);
      uDark.processIframes(scope, details, editOptions);
      uDark.processColoredItems(scope);
      completed = true;
      return result;
    } finally {
      // Deferred restoration is part of the successful backend pipeline only.
      // Never leave temporary SVG placeholders behind after an exception.
      if (!deferSvgRestore || !completed) {
        uDark.restoreSvgElements(result.svgElements);
      }
      if (!deferIntegrityRestore) {
        uDark.restoreIntegrityAttributes(scope);
      }
    }
  }
  transformADocumentBackend(aDocument, parsedDocument, details) {

    aDocument.querySelectorAll("meta[http-equiv=content-security-policy]").forEach(meta => {
      let item = { value: meta.getAttribute("content") };
      if (item.value && item.value.trim().length) {
        uDark.headersDo["content-security-policy"](item, details, 1);
        meta.setAttribute("content", item.value);
      }

    }
    );

    if (!details.debugParsing) {

      const transformedSubtree = uDark.transformDOMSubtree(
        parsedDocument,
        details,
        {
          deferSvgRestore: true,
          deferIntegrityRestore: true
        }
      );

      // 12. Inject custom CSS and dark color scheme if required (only for the first data load)
      uDark.injectStylesIfNeeded(parsedDocument, details); // Only benefit of this ; avoids page being white on uDark refresh

      // 13. Restore the original SVG elements that were temporarily replaced
      uDark.restoreSvgElements(transformedSubtree.svgElements);

      uDark.markUnclosedForms(parsedDocument);

    }

    // 15. Remove the integrity attribute from elements and replace it with a custom attribute
    uDark.restoreIntegrityAttributes(aDocument);

    aDocument.querySelectorAll("template").forEach(template => {
      if (template.content instanceof DocumentFragment) {
        uDark.transformADocumentBackend(template.content, parsedDocument, details);
      }
    });

  }
  reparseDocumentWithNoScript(parsedDocument, strO, details) {
    /**
    * Re-parses a document so that <noscript> is treated as an opaque element.
    *
    * DOMParser runs with "scripting = off", which means <noscript> contents are
    * parsed as normal DOM instead of being treated as raw/opaque text. This function
    * reconstructs the document structure so that:
    *
    *  • Elements that are valid inside <head> stay in <head>
    *  • Elements that belong in <body> are moved there
    *  • <noscript> is preserved in the same structural position the browser
    *    would have used when scripting is ON
    *
    * The parser tokenization behavior is still relied upon — we simply correct
    * structural placement afterwards.
    */

    let allowedHead = new Set([
      "title", "base", "link", "style",
      "meta", "script", "noscript", "template"
    ]);
    // These are the elements HTML defines as valid children of <head>.

    let html = parsedDocument.ud_doctype + '<br ud-before-any>' + strO.slice(parsedDocument.ud_doctype.length);

    html = html.replace(new RegExp("<head(?![\\w-])", "i"), "<ud-tag-ptd-head");
    html = html.replace(new RegExp("</head(?![\\w-])", "i"), "</ud-tag-ptd-head");
    let retParsedDocument = uDark.createDocumentFromHtml(html, details.XHTML ? "application/xhtml+xml" : "text/html");

    retParsedDocument.needRestorePTDHead = true;
    retParsedDocument.ud_doctype = parsedDocument.ud_doctype;


    let fnNodeStart = node => {
      retParsedDocument.documentElement.insertBefore(node, retParsedDocument.head);
    }
    let fnNode = fnNodeStart
    let fnNodeHead = node => {
      retParsedDocument.head.append(node);
    };
    let fnNodeAfterHead = (node, infos) => {
      if (!infos.isComment) {
        // Only comment nodes are allowed directly after <head>.
        // Any other type of node found here will be moved into <body>
        // (which will be created if it does not already exist).
        //
        // Note that <script> elements still execute even if <body> has not
        // yet been parsed. If such a script depends on <body> already existing,
        // this relocation could break the page.
        //
        // As a result, a page that has a <head> but no <body> will end up being
        // wrapped — but it's difficult to imagine a real-world case where a
        // script intentionally relies on <body> NOT existing.
        //
        // By doing this, we are also deliberately relocating any elements that
        // originally appeared immediately after <head> into <body>. In practice,
        // the browser would have moved those elements there eventually anyway;
        // we’re simply making that behavior explicit and deterministic.
        //
        // One possible mitigation would be to only return false for <script>
        // nodes instead of all non-comment nodes — but for now this additional
        // check doesn’t seem necessary.

        return false;
      }

      retParsedDocument.documentElement.insertBefore(
        node,
        retParsedDocument.body
      );
    };
    for (let node of [...retParsedDocument.body.childNodes]) { // Use ... to clone the list as we will modify the DOM while iterating

      if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("ud-before-any")) {
        node.remove();
        continue;
      }
      let isPTDHead = node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === "ud-tag-ptd-head"
      if (isPTDHead) {

        retParsedDocument.needRestorePTDHead = false;
        [...node.childNodes].forEach(childNode => { // Use ... to clone the list as we will modify the DOM while iterating
          fnNodeHead(childNode);
        });
        node.getAttributeNames().forEach(attrName => {
          retParsedDocument.head.setAttribute(attrName, node.getAttribute(attrName));
        });
        node.remove();
        fnNode = fnNodeAfterHead;
        continue;
      }

      let isEmptyText = node.nodeType === Node.TEXT_NODE && !node.textContent.trim().length
      let isComment = node.nodeType === Node.COMMENT_NODE
      let isValidElement = node.nodeType === Node.ELEMENT_NODE && allowedHead.has(node.tagName.toLowerCase())





      if (isValidElement && fnNode === fnNodeStart) {

        // Once we encounter the first valid <head> element,
        // all subsequent valid nodes are assumed to belong inside <head>
        // until we exit the head context.
        fnNode = fnNodeHead
      }





      if (
        isComment
        || isEmptyText
        || isValidElement

      ) {
        let fnResult = fnNode(node, { isEmptyText, isComment, isValidElement });
        if (fnResult === false) {
          break;
        }
      }
      else {
        break; // stop at first non-head node
      }

    }

    return retParsedDocument;

  }
  parseAndEditHtmlContentBackend4(strO, details) {
    // return strO;

    let str = strO;
    if (!str || !str.trim().length) {
      return str;
    }

    details.XHTML = details.contentType.includes("application/xhtml+xml");


    let parsedDocument = uDark.createDocumentFromHtml(str, details.XHTML ? "application/xhtml+xml" : "text/html");
    let aDocument = parsedDocument.documentElement;

    uDark.setDocType(strO, parsedDocument, details);

    if (parsedDocument.head.querySelector("noscript")) {
      uDark.info("Reparsing document to handle <noscript> in <head> for", details.url);
      parsedDocument = uDark.reparseDocumentWithNoScript(parsedDocument, strO, details);
      aDocument = parsedDocument.documentElement;
    }

    if (details.unspecifiedCharset) {
      let workAroundResult = uDark.workAroundUnspecifiedCharset(aDocument, details);
      if (workAroundResult) {
        return workAroundResult;
      }
    }
    uDark.transformADocumentBackend(aDocument, parsedDocument, details);
    // 16. Return the final edited HTML
    let will_return = parsedDocument.ud_doctype + aDocument.outerHTML
    if (parsedDocument.hasUnclosedForms) {
      // Our parsing repaired thes unclosed forms but we are able to detect them
      // But in HTML an unclosed form attaches following elements to the form.
      // If we send the repaired version with closing </form> the main page will see a closed form and not attach following elements to it.
      will_return = will_return.replaceAll("</form><!--unclosed-form-->", "");
    }
    if (parsedDocument.needRestorePTDHead) {
      will_return = will_return.replace("<ud-tag-ptd-head", "<head").replace("</ud-tag-ptd-head", "</head");
    }
    return will_return;

  }

  frontEditHTML(elem, strO, details, options = {}) {
    // 0. Return the original value if it's not a string
    if (!(strO instanceof String || typeof strO === "string")) {
      return strO;
    }
    // 1. Ignore <script> elements to prevent unintended modifications to JavaScript
    let str = strO;
    if (elem instanceof HTMLScriptElement) {
      return strO;
    }
    // 2. Special handling for <style> and <svg> style elements (returns edited value directly)
    if (elem instanceof HTMLStyleElement || elem instanceof SVGStyleElement) {
      return uDark.edit_str(str, false, false, undefined, false, options);
    }

    let parsedDocument, aDocument;
    if (options.STRICT_XML) {
      parsedDocument = uDark.createDocumentFromHtml(str, options.STRICT_XML);
      aDocument = parsedDocument;
    }
    else { /*We could do all the stuff the backend does to be sure to perfectly parse
      the document prologue intact <!doctype> and </closing> tags but aside iframe srcdoc frontEditHTML overrides only some innerHTML or inserAdjacentHTML
      that would have no benefits in having the intact prologue. */

      // Cant use \b because of the possibility of a - next to the identifier, it's a word character
      str = str.protect_simple(uDark.tagsToProtectRegex, "$1ud-tag-ptd-$2"); // But for noscripts il will become mandatory some day

      parsedDocument = uDark.createDocumentFromHtml("<html><head>" + str); // Encapsulate in a full HTML document to be able to parse fragments properly

      options.ptd_head = parsedDocument.getElementsByTagName("ud-tag-ptd-head")[0];
      if (options.ptd_head) { // Allows to keep a head with all its forbidden tags and also to know its a full HTML document that was submited
        parsedDocument.head.p_ud_innerHTML = parsedDocument.head.p_ud_innerHTML + options.ptd_head.innerHTML;
        options.ptd_head.remove();
      }
      aDocument = parsedDocument;
    }
    uDark.transformDOMSubtree(aDocument, details, options);

    // 18. After all the edits, return the final HTML output

    let resultEdited;
    if (options.STRICT_XML) {
      resultEdited = aDocument.documentElement.outerHTML.trim();
    }
    else {
      // if a head was found we need to return whole outerHTML
      if (options.ptd_head) {
        resultEdited = aDocument.documentElement.outerHTML.trim();
      } else { // Else we just got encapsulated
        resultEdited = aDocument.head.innerHTML + aDocument.body.innerHTML.trim();
      }
    }
    let will_return = resultEdited.unprotect_simple("ud-tag-ptd-");
    return will_return;
  }
  createDocumentFromHtml(html, type = "text/html") {
    const parser = new uDark.DOMParser();

    // Convert extension-generated strings to TrustedHTML before passing them
    // to a Trusted Types-protected DOM sink, when a policy is available.
    return parser.p_ud_parseFromString(
      uDark.domParserPolicy
        ? uDark.domParserPolicy.createHTML(html)
        : html,
      type
    );
  }

  processSvgElements(documentElement, details) {
    let svgElements = [];
    // Temporarily replace all SVG elements to avoid accidental style modifications
    documentElement.querySelectorAll("svg").forEach(svg => {
      const tempReplace = document.createElement("svg_secured");
      svgElements.push([svg, tempReplace]);
      svg.replaceWith(tempReplace);
      // Edit SVG styles separately, before main style editing
      uDark.frontEditSVG(svg, details);
    });
    return svgElements;
  }

  processMetaTags(documentElement) {
    // Ensure that content-type meta tags are properly set to avoid charset issues
    documentElement.querySelectorAll("meta[http-equiv]").forEach(m => {
      if (m.httpEquiv && m.httpEquiv.toLowerCase().trim() === "content-type" && m.content.includes("charset")) {
        m.content = "text/html; charset=utf-8";
      }
    });
  }

  edit_styles_attributes(parentElement, details, options = {}) {
    parentElement.querySelectorAll("[style]").forEach(astyle => {
      astyle.setAttribute("style", uDark.edit_str(astyle.getAttribute("style").unprotect_simple("ud-tag-ptd-" /*display:table is a thing*/), false, false, details, false, {
        ...options,
        nochunk: true
      }));
    });

  }

  processLinks(documentElement) {
    // Append a custom identifier to favicon links to manage cache more effectively
    documentElement.querySelectorAll("link[rel*='icon' i][href]").forEach(link => {
      link.setAttribute("href", link.getAttribute("href") + "#ud_favicon");
    });
  }
  decodeBase64DataURIifIsDataURI(maybeBase64DataURI) {
    maybeBase64DataURI = maybeBase64DataURI.trim();
    if (!maybeBase64DataURI.startsWith("data:")) {
      return {
        b64: false,
        dataHeader: false,
        data: maybeBase64DataURI
      };
    }
    let commaIndex = maybeBase64DataURI.indexOf(","); // String.split is broken: It limits the number of elems in returned array instead of limiting the number of splits
    let [dataHeader, data] = [maybeBase64DataURI.substring(0, commaIndex + 1).toLowerCase().trim(), maybeBase64DataURI.substring(commaIndex + 1)]
    if (!dataHeader.includes("base64")) {
      return {
        b64: false,
        dataHeader,
        data
      }
    }
    try {
      return {
        b64: true,
        dataHeader,
        data: atob(data)
      }
    } catch {
      console.warn("Error decoding base64 data URI", maybeBase64DataURI)
      return {
        b64: true,
        dataHeader: false,
        data: false,
        failure: true
      }
    }
  }
  rencodeToURI(data, dataHeader, base64 = false) {
    if (!dataHeader) {
      return data;
    }
    if (base64) {
      try {
        return dataHeader + btoa(data);
      } catch {
        return new Error("Error encoding base64 data URI", data)
      }
    }
    return dataHeader + data;
  }
  processSRCset(sourceSRCSET) {
    sourceSRCSET = sourceSRCSET.trim().replaceAll("\n", " ");
    sourceSRCSET = sourceSRCSET.replace(/\s+/g, " ");

    const srcSourceArray = sourceSRCSET.split(/ ,|, /);
    const arrayResult = [];

    srcSourceArray.forEach(srcSource => {
      let breaker1 = " ", breaker2 = ",";
      let link = "", desc = "";
      srcSource = srcSource.trim();

      for (let i = 0, n = srcSource.length; i < n; i++) {
        const ch = srcSource.charAt(i);

        if ((ch === breaker1 || i === n - 1)) {
          if (i === n - 1 && ch !== breaker1)
            breaker1 === " " ? (link += ch) : (desc += ch);

          if (breaker1 === "," || i === n - 1) {
            arrayResult.push([link.trim(), desc.trim()]);
            link = ""; desc = "";
          }

          [breaker1, breaker2] = [breaker2, breaker1];
        } else if (breaker1 === " ")
          link += ch;
        else
          desc += ch;
      }
    });

    return arrayResult;
  }

  processImages(documentElement) {
    // Process image sources to prepare them for custom modifications
    documentElement.querySelectorAll("img[src]").forEach(image => {
      image.setAttribute("src", uDark.image_element_prepare_href(image));
    });
    documentElement.querySelectorAll("img[srcset],picture source[srcset]").forEach(image => {
      let srcSourceArray = uDark.processSRCset(image.getAttribute("srcset")).map(
        ([srcSource, descriptor]) => uDark.image_element_prepare_href(image, srcSource) + " " + descriptor
      );
      image.setAttribute("srcset", srcSourceArray.join(", "));
    });
  }

  frontEditHTMLPossibleDataURL(elem, value, details, options) {

    let {
      b64,
      dataHeader,
      data,
      failure
    } = uDark.decodeBase64DataURIifIsDataURI(value || ""); // Value can be null
    if (!failure && dataHeader) {
      if (dataHeader.includes("image")) {
        return uDark.image_element_prepare_href(elem, value, {
          ...options,
          cut: {
            b64,
            dataHeader,
            data
          }
        });
      } else if (dataHeader.includes("html")) {
        data = uDark.frontEditHTML(elem, data, details, options)
        return uDark.rencodeToURI(data, dataHeader, b64);
      }
    }
    return value;
  }
  processIframes(documentElement, details, options) {
    // Recursively process iframes that use the "srcdoc" attribute by applying the same HTML processing function
    documentElement.querySelectorAll("iframe[srcdoc]").forEach(iframe => {
      iframe.setAttribute("srcdoc", uDark.frontEditHTML(false, iframe.srcdoc, details));
    });

    documentElement.querySelectorAll("object[data],embed[src],iframe[src]").forEach(object => {
      // Use GetAttribute to get the original value, as the src attribute may be changed by the context
      let src = object.getAttribute("src");
      let usedData = src ? src : object.getAttribute("data");

      object.setAttribute(src ? "src" : "data", uDark.frontEditHTMLPossibleDataURL(object, usedData, details, options, documentElement));
    });
  }

  processColoredItems(documentElement) {
    // Process elements with color or bgcolor attributes and ensure proper color handling
    documentElement.querySelectorAll("[color],[bgcolor]").forEach(coloredItem => {
      for (let [key, afunction] of Object.entries(uDark.attributes_function_map)) {
        if (typeof afunction === "string") {
          afunction = uDark.attributes_function_map[afunction];
        }
        let attributeValue = coloredItem.getAttribute(key);
        if (attributeValue && attributeValue.startsWith("#") && attributeValue.length === 6) {
          attributeValue += "0"; // Ensure colors are properly formatted
        }
        const possibleColor = uDark.is_color(attributeValue, true, true);

        if (possibleColor) {
          let callResult = afunction(...possibleColor, uDark.hex_val /* this kind of html4 attributes does not fully supports rgba vals, prefer use hex vals  */, coloredItem);

          if (callResult) {
            coloredItem.setAttribute(key, callResult);
          }
        }
      }
    });
  }

  injectStylesIfNeeded(aDocument, details) {

    // Inject custom CSS and the dark color scheme meta tag if this is the first data load
    if (details.dataCount === 1) {

      // Stopped using inject_css_suggested as direct inection, as it was causing issues with some websites, like react ones that starts with a minimal body

      const udMetaDark = aDocument.querySelector("meta[name='color-scheme']") || document.createElement("meta");
      udMetaDark.id = "ud-meta-dark";
      udMetaDark.name = "color-scheme";
      udMetaDark.content = "dark";
      // Note : looking for a head first is not a problem since aDocument, in the last iteration of parsing is a body.
      if (!udMetaDark.isConnected) {
        let headElem = aDocument.head;
        headElem.prepend(udMetaDark);
      }
    }
  }
  markUnclosedForms(parsedDocument) {
    [...parsedDocument.forms].forEach(form => {
      for (let elem of [...form.elements]) {
        if (!elem.hasAttribute("form")) {
          if (!form.contains(elem)) {
            form.insertAdjacentHTML("afterend", "<!--unclosed-form-->");
            console.warn("Detected unclosed form", form, elem);
            parsedDocument.hasUnclosedForms = true;
            return;
          }
        }
      }
    });
  }
  restoreSvgElements(svgElements) {
    // Restore the original SVG elements that were temporarily replaced
    svgElements.forEach(([svg, tempReplace]) => {
      tempReplace.replaceWith(svg);
    });
  }
  restoreNoscriptElements(aDocument) {
    // Restore <noscript> elements that were converted to <script>
    aDocument.querySelectorAll("script[secnoscript]").forEach(script => {
      let noScript = document.createElement("noscript");
      for (let node of script.attributes) {
        noScript.setAttribute(node.name, node.value)
      }
      let template = aDocument.createElement('template');
      template.innerHTML = script.innerHTML;
      noScript.append(template.content); // We cant put innerHTML directly in a noscript element, it would be html encoded. The template element is used to avoid this, it parse elements for us.
      script.replaceWith(noScript);

    });
  }
  restoreTemplateElements(aDocument) {
    // Restore <noscript> elements that were converted to <template>

    // Using replaceWith() instead of innerHTML to avoid issues with nested elements wich were HTMLencoded
    aDocument.querySelectorAll("template[secnoscript]").forEach(template => {
      let noScript = document.createElement("noscript");
      for (let node of template.attributes) {
        noScript.setAttribute(node.name, node.value)
      }
      noScript.append(template.content);
      template.replaceWith(noScript);
    });
  }

  restoreIntegrityAttributes(aDocument) {
    // Remove the integrity attribute from elements and store it as a custom attribute
    aDocument.querySelectorAll("link[integrity]").forEach(integrityElem => {
      integrityElem.setAttribute("data-no-integ", integrityElem.getAttribute("integrity"));
      integrityElem.removeAttribute("integrity");
    });
  }

  linkIntegrityErrorEvent(elem) {
    // This fix is needed for some websites that use link integrity, i don't know why but sometime even removing the integrity earlier in the code does not work
    uDark.info("Link integrity error", elem, "lead to a reload of this script");
    let href = elem.getAttribute("href");
    href && elem.setAttribute("href", uDark.addNocacheToStrLink(href));
    elem.removeAttribute("onerror");

  }
  str_protect_simple(str, regex, protectWith, condition = true) {
    if (condition) {
      str = str.replaceAll(regex, protectWith)
    }
    return str;
  }
  str_unprotect_simple(str, protectedWith, condition = true, $repl = "") {
    if (condition) {
      str = str.replaceAll(protectedWith, $repl)
    }
    return str;
  }

  edit_str_nochunk(strO) {
    if (strO?.join) {
      strO = strO.join("");
    }
    return uDark.edit_str(strO, false, false, undefined, false, {
      nochunk: true
    });
  }



  edit_str(strO, cssStyleSheet, verifyIntegrity = false, details, options = {}) {
    if (!options || typeof options !== "object") {
      options = {};
    }
    if (!(typeof strO === "string" || strO instanceof String)) {
      return strO; // Do not edit non string values to avoid errors, web is wide and wild
    }

    let str = strO;



    // Protection of imports
    // Unfortunately, this could lead to a reparation of a broken css if the chunking splits the @import in two parts
    // We might someday encounter this very improbable case, and have to check if the last rule is an unclosed @rule, while having some rules before it and reject the CSS chunk
    // In the end the chunk would eventualy come back contatenated with the next chunk, and then we could edit it properly.

    let import_protection = strO.protect_numbered(uDark.cssAtRulesRegex, 'udarkAtRuleProtect { content: "{index}"; }', uDark.exactAtRuleProtect)

    str = import_protection.str;
    str = str.protect_simple(uDark.shortHandRegex, "--ud-ptd-$1:");
    if (uDark.userSettings.preserve_comments) {
      const commentAnchors = new uDark.CSSCommentAnchors(str);
      str = commentAnchors.cleanCss;
      options.commentAnchors = commentAnchors;
    }
    if (!cssStyleSheet) {
      cssStyleSheet = new CSSStyleSheet()
      if (!options.nochunk) { // Avoiding a warning in the console when we know we are not chunking
        let valueReplace = str + (verifyIntegrity ? "\n.integrity_rule{}" : "");
        cssStyleSheet.p_ud_replaceSync(valueReplace);
      }
    } else if (!cssStyleSheet.rules.length) {
      return strO; // Empty styles from domparser can't be edited as they are not "constructed"
    }

    let rejected_str = false;

    // Protection of CSS shorthand properties, 
    // let protected_comments=str.protect(uDark.matchAllCssCommentsRegex,"");
    // str=protected_comments.str;

    let nochunk = options.nochunk || !verifyIntegrity && !cssStyleSheet.cssRules.length // if we want to check integrity, it means we have a chunked css

    if (nochunk) {

      // Here if :
      // - We only have properties like background: white; 
      if (import_protection.values) {
        return strO;
      }
      str = `z{${str}}`;
      cssStyleSheet.p_ud_replaceSync(str);
      uDark.edit_css(cssStyleSheet, details, options);
      str = cssStyleSheet.cssRules[0].cssText.slice(4, -2);
    } else {

      /* This does not exist anymore, as we are repairing import locations in the CSS with the import protection, integrity will allways be verifiable.
      // Exists the rare case where css only do imports, no rules with {} and integrity cant be verified because it does not close the import with a ";"
      let returnAsIs = (!cssStyleSheet.cssRules.length && !strO.includes("{")); // More reliable than checking if it starts with an a @ at it may starts with a comment 
      // let returnAsIs = (!cssStyleSheet.cssRules.length && import_protection.values); // More reliable than checking if it starts with an a @ at it may starts with a comment 
      
      if (returnAsIs) {
      uDark.info("Returning as is", strO);
      return strO; //don't even try to edit it .
      // Fortunately it is not a common case, easy to detect with zero cssRules, and it mostly are short strings testables with includes
      };
      */

      if (verifyIntegrity) {

        let last_rule = cssStyleSheet.cssRules[cssStyleSheet.cssRules.length - 1];
        let antp_ult_rule = cssStyleSheet.cssRules[cssStyleSheet.cssRules.length - 2];
        let is_rejected = !last_rule || last_rule.selectorText != ".integrity_rule"; // It must ne an exact match to avoid reparations of broken CSS in the middle of a css identifier
        let is_rejected_at_rule = !is_rejected && antp_ult_rule && antp_ult_rule.selectorText == "udarkAtRuleProtect"; // Our protection of @rules might have repaired a half cut @rule, we have to reject it if the last known rule is an @rule
        if (is_rejected || is_rejected_at_rule) {
          //
          let can_iterate = !is_rejected_at_rule && cssStyleSheet.cssRules.length > 1; // If there is only one rule, and it's rejected, we dont'have to find the previous one
          if (can_iterate && !uDark.disable_live_chunk_repair) // We accept CSS until it breaks, and cut it from there
          {
            rejected_str = ""; // Pass from false to empty string
            let max_iterations = 10; // Fix a limit for timing reasons
            for (let i = 1; i <= max_iterations; i++) {

              // Lets find the last significant bracket.
              // If we are in any part of the string we don't care about the last char as it is either not a bracket or not one that will permit us
              // to fix the CSS. ( As it is in a broken state already)
              let last_bracket_index = str.lastIndexOf("}", str.length - 2); // Doing what said above 

              // Reject CSS as a whole if we can't find a bracket for whaterver messed up CSS we have
              if (last_bracket_index == -1) {
                return new Error("Rejected integrity rule from live chunk repair")
              }

              // Now we have two parts, the one we keep and the one we reject
              rejected_str = str.substring(last_bracket_index + 1) + rejected_str;

              str = str.substring(0, last_bracket_index + 1)

              // Do we have a valid CSS now ? lets add an integrity rule to check it
              let valueReplace = str + "\n.integrity_rule{}";
              cssStyleSheet.p_ud_replaceSync(valueReplace); // Asumig only background script will edit CSS with integrity verification, using replaceSync is ok
              let last_rule = cssStyleSheet.cssRules[cssStyleSheet.cssRules.length - 1];
              if (last_rule && last_rule.selectorText == ".integrity_rule") // We found our rule again, no need to iterate more, this means we have a valid CSS in str
              {
                break;
              } else if (i == max_iterations) {
                return new Error("Rejected integrity rule from live chunk repair, max iterations reached")
              }
            }
          } else { // We reject the whole CSS if it broken for any reason.( @media cut in midle of name like @medi.integrity rule), str sarting with a bracket, etc.
            // Reasons are endless and if Firefox said the CSS is broken, we trust it.
            return new Error("Rejected integrity rule as a whole");
          }
        }
        cssStyleSheet.deleteRule(cssStyleSheet.cssRules.length - 1);
      }

      uDark.edit_css(cssStyleSheet, details, options);

      let rules = [...cssStyleSheet.cssRules];

      if (uDark.userSettings.preserve_comments && options.commentAnchors) {
        rules = options.commentAnchors.mergeWithCssRules(rules);
      }

      str = rules.map(r => r.cssText).join("\n");

    }
    str = str.unprotect_simple("--ud-ptd-").unprotect_numbered(import_protection, uDark.exactAtRuleProtect)
    if (rejected_str) {
      str = {
        str: str,
        rejected: rejected_str,
      }
    }


    return (str || strO); // It's essential to return the original value if the CSS is broken, if e did not knew what to do with it, we should not have edited it. This is demostrated on hub.docker.com that looks into a comment only css
  }
  rgba_val(r, g, b, a) {
    a = typeof a == "number" ? a : 1;
    return "rgba(" + (r) + "," + (g) + "," + (b) + "," + (a) + ")";
  } // https://perf.link : Concatenation is better than foramting
  hsla_val(h, s, l, a) {
    a = typeof a == "number" ? a : 1;
    return "hsla(" + (h * 360) + " " + (s * 100) + "% " + (l * 100) + "% / " + (a) + ")";
  }
  hex_val(r, g, b, a) {
    a = typeof a == "number" ? a : 1
    return "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0") +
      (a == 1 ? "" : (a * 255).toString(16).padStart(2, "0"))
  }

  hslToRgb(h, s, l) {
    let r, g, b;

    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = uDark.hueToRgb(p, q, h + 1 / 3);
      g = uDark.hueToRgb(p, q, h);
      b = uDark.hueToRgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  rgbToHsl_linear(r, g, b) {
    (r /= 255), (g /= 255), (b /= 255);
    const vmax = Math.max(r, g, b),
      vmin = Math.min(r, g, b);
    let h, s, l = (vmax + vmin) / 2;

    if (vmax === vmin) {
      return [0, 0, l]; // achromatic
    }

    const d = vmax - vmin;
    s = l > 0.5 ? d / (2 - vmax - vmin) : d / (vmax + vmin);
    if (vmax === r) h = (g - b) / d + (g < b ? 6 : 0);
    if (vmax === g) h = (b - r) / d + 2;
    if (vmax === b) h = (r - g) / d + 4;
    h /= 6;

    return [h, s, l];
  }

  rgbToHsl(r, g, b) {

    let l = uDark.getPerceivedLightness(r, g, b);
    (r /= 255), (g /= 255), (b /= 255), (l /= 100);
    const vmax = Math.max(r, g, b),
      vmin = Math.min(r, g, b);
    if (vmax === vmin) {
      return [0, 0, l]; // achromatic
    }
    let h;

    const d = vmax - vmin;
    let s = l > 0.5 ? d / (2 - vmax - vmin) : d / (vmax + vmin);
    if (vmax === r) h = (g - b) / d + (g < b ? 6 : 0);
    if (vmax === g) h = (b - r) / d + 2;
    if (vmax === b) h = (r - g) / d + 4;
    h /= 6;

    return [h, s, l];
  }
  RGBToLinearLightness(r, g, b) {
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  }


  eget_color(anycolor, editColorF = false, cssRule = false, no_color = false, fill = false) {
    if (!anycolor || !(anycolor = anycolor.trim())) { // Trying to trim sometime undefiend values was as source of problem in lot of sites
      return anycolor;
    }
    if (!cssRule) { // Cant have matched these values if we are  in a cssRule edit
      if (["unset", "inherit", "none"].includes(anycolor.toLowerCase())) {
        return anycolor
      }
    }
    let theColor = uDark.is_color(anycolor, true, fill, cssRule)
    if (!theColor) {

      // otherwise if it is not a color, we should warn as its a bug in regexpes
      // or frontend does not define a color correctly
      console.info(anycolor, " is not a color (It's ok if frontent does not define a color correctly)",
        // new Error()
      )
      if (no_color) {
        if (no_color === true) return anycolor;
        return no_color;
      }
      return editColorF ? editColorF(...[0, 0, 0, 1]) : [0, 0, 0, 1];
    }
    if (editColorF) {
      // Caller asks us to apply a transformation, probably rgba, hex or revert_rgba
      return editColorF(...theColor)
    }
    return theColor

  }
  is_color(possiblecolor, as_float = true, fill = false, cssRule, spanp = false) {
    let cache_key = `${possiblecolor}${as_float}${fill}`
    if (uDark.userSettings.cacheEnabled && !spanp && uDark.general_cache.has(cache_key)) { // See https://jsben.ch/aXxCT for cache effect on performance
      return uDark.general_cache.get(cache_key);
    }
    if (!possiblecolor || possiblecolor === "none") { // none is not a color, and it not usefull to create a style element for it
      return false
    }
    if (!uDark.is_background && possiblecolor.includes("var(")) {
      return uDark.is_color_var(possiblecolor, as_float, fill, cssRule, spanp)
    }

    let nonColor = "rgba(0, 0, 1, 0.11)"; // Spaces are important, we are looking for an exact match
    uDark.colorWork.canvasContext.fillStyle = nonColor;
    uDark.colorWork.canvasContext.fillStyle = possiblecolor;
    let result = uDark.colorWork.canvasContext.fillStyle;
    if (result == nonColor) {
      return false;
    }
    if (as_float) {
      if (result.startsWith("#")) {
        let hexColor = "0x" + result.slice(1);
        result = [(hexColor >> 16) & 0xFF, (hexColor >> 8) & 0xFF, hexColor & 0xFF]
      } else {
        {
          result = result.match(/[0-9\.]+/g).map(parseFloat)
        }
      }

      if (fill) {
        result = result.concat(Array(4 - result.length).fill(1))
      }

      if (uDark.userSettings.cacheEnabled) {
        uDark.general_cache.set(cache_key, result);
      }
      return result;

    }

  }
  is_color_var(possiblecolor, as_float = true, fill = false, cssRule, spanp = false, use_cache = true) {
    // Must restore spanp feature and use it in frontend capture with flood-color css attribute
    // to catch correctly assignments like style.color=rgba(var(--flood-color),0.5) instead of returning [0,0,0,0]

    // Helped by is_color_var and regexpes, we should not need this block
    if (!possiblecolor || possiblecolor === "none") { // none is not a color, and it not usefull to create a style element for it
      return false
    }

    let cache_key = `${possiblecolor}${as_float}${fill}`
    if (uDark.userSettings.cacheEnabled && !spanp && use_cache && uDark.general_cache.has(cache_key)) { // See https://jsben.ch/aXxCT for cache effect on performance
      return uDark.general_cache.get(cache_key);
    }
    possiblecolor = possiblecolor.trim().toLowerCase();
    let option = new Option();
    let style = option.style;
    if (cssRule) {
      // apply specific class variables to style
      Object.values(cssRule.style).filter(x => x.startsWith("--")).forEach(x => {
        style.p_ud_setProperty(x, cssRule.style.getPropertyValue(x))
      })
    }

    style.floodColor = possiblecolor;

    let result = style.floodColor; // Must be done in 2 steps to avoid same value as possiblecolor

    if (!style.floodColor) {
      // Impossible color : browser said so
      return false;
    }
    if (possiblecolor.replace(/\)+$/, "") == style.floodColor.replace(/\)+$/, "")) {
      // Browser has a tendancy of repairing colors: var(--flood-color => var(--flood-color)
      // rgb => rgba(0,0,0,1) // rgba => rgba(0,0,0,1)
      // rgb(55,55,55,calc(1*1 => rgba(55,55,55,1)
      // rgb(55,55,55,var(--test, var(--test => rgb(55,55,55,var(--test, var(--test))
      // I D K how much else it can repair colors, but it is a good thing to know
      // Best solution i ffound i to remove the rightiests parenthesis and compare them
      // It does not affects spaces, it only appends parenthesis at the end of the string as far as I know

      // Browser said it is a color but doubt it is a valid one, we need a further check.
      document.head.appendChild(option);

      style.p_ud_backgroundColor = possiblecolor;

      let computedStyle = getComputedStyle(option); // On invalid colors, background will be none here
      result = computedStyle.floodColor || possiblecolor; // Sometimes on frontend, computedStyle is empty, i d k why. Looks like a bug in browser 

      if (computedStyle.floodColor != computedStyle.backgroundColor) // Probably an invalid color
      { // backgroundColor is the only poperty wich returns rgba(0, 0, 0, 0) an alpha value on unresolved vars/invalid 
        result = false;
      }

      option.remove();
    }
    if (result) {

      if (as_float) {
        result = result.match(/[0-9\.]+/g).map(parseFloat)
        if (fill) {
          result = result.concat(Array(4 - result.length).fill(1))
        }
      }

      if (uDark.userSettings.cacheEnabled && use_cache) {
        uDark.general_cache.set(cache_key, result);
      }
    }
    return result;
  }
  revert_rgba_rgb_raw(r, g, b, a, render = false) {
    render = (render || uDark.rgba_val)
    let lightenUnder = 0.196;
    let edit_under = 15.6;
    let plightness = uDark.getPerceivedLightness(r, g, b); // Adding perceived lightness for svg:
    let edit_under_perceived = 35;
    if (plightness < edit_under_perceived && plightness < lightenUnder && plightness < edit_under) {
      [r, g, b] = [r, g, b].map((x) => {
        x = x + Math.pow(
          // Very important to report lighenUnder here, to get the correct calculation
          (lightenUnder - plightness) // The less the lightness the more the color is lightened
          , 1.11); // Increase the lightening effect a bit
        return x;

      });
    }

    return render(...[r, g, b], a);
  }
  rgba_rgb_raw = function (r, g, b, a, render = false) {
    render = (render || uDark.rgba_val)
    a = typeof a == "number" ? a : 1
    let lightness = uDark.getPerceivedLightness(r, g, b);
    let factor = Math.pow(100 / (lightness + 50), lightness / 50 * 2.8)
    if (lightness > 50) {
      r = r * factor;
      g = g * factor;
      b = b * factor;
    }
    return [r, g, b, a];
  };

  ensureBestRGBAFuncRef() { // Ensure the best rgba function is used, depending on user settings
    // this is thefasterst, once its set, it will not change, no need for test each time
    uDark.simple_rgba = uDark.simple_rgba || uDark.rgba;
    let use_oled = uDark.userSettings.fg_negative_modifier !== 0 || uDark.userSettings.bg_negative_modifier != 0
    uDark.rgba = use_oled ? uDark.rgba_oled : uDark.simple_rgba;
  }
  rgba(r, g, b, a, render = false) {
    // return uDark.rgba_oled(r, g, b, a, render);
    // Lets remove any brightness from the color
    render = (render || uDark.rgba_val)
    a = typeof a == "number" ? a : 1

    let [h, s, l] = uDark.rgbToHsl(r, g, b);
    // This whole function could be combined in one line
    if (l > uDark.userSettings.min_bright_bg_trigger) {

      let A = uDark.userSettings.max_bright_bg;
      let B = uDark.userSettings.min_bright_bg;

      // // https://www.desmos.com/calculator/2prydrxwbf
      // l=Math.min(2*A*l,A+2*(B-A)*(l-0.5));
      // Same; Use a ternary operator to avoid calc twice the value of l line in min for comparison
      l = (l < 0.5) ? (2 * A * l) : (A + 2 * (B - A) * (l - 0.5));

      // with l on a scale of 100 : in CSS relative colors
      // l = l<50? (2*A*l): ( 2 * (B - A) * l + 100 * (2 * A - B));

      // 2 * (B - A) * l + 100 * (2 * A - B)
      // Old way to do it, but accuracy is not as good as the above one
      // https://www.desmos.com/calculator/oqqi9nzonh
      // if (l > 0.5) {
      //   l = 1 - l; // Invert the lightness for bightest colors
      // }
      // l = Math.min(2 * l, -2 * l + 2) * (A - B) + B;
      [r, g, b] = uDark.hslToRgb(h, s, l);
    }

    return render(...[r, g, b], a);
  }
  rgba_oled(r, g, b, a, render = false) {
    // Lets remove any brightness from the color
    render = (render || uDark.rgba_val)
    a = typeof a == "number" ? a : 1

    let [h, s, l] = uDark.rgbToHsl(r, g, b);
    // This whole function could be combined in one line
    if (l > uDark.userSettings.min_bright_bg_trigger) {

      const O2 = uDark.userSettings.fg_negative_modifier;
      const B = uDark.userSettings.min_bright_bg - O2;
      const A = uDark.userSettings.max_bright_bg;
      const O1 = uDark.userSettings.bg_negative_modifier;


      // // https://www.desmos.com/calculator/2prydrxwbf
      // l=Math.min(2*(A+O1)*l-O1,A+2*(B-A)*(l-0.5));
      // Same; Use a ternary operator to avoid calc twice the value of l line in min for comparison
      l = (l < 0.5) ? (2 * (A + O1) * l - O1) : (A + 2 * (B - O2 - A) * (l - 0.5));

      // with l on a scale of 100 : in CSS relative colors
      // l = l<50? (2*A*l): ( 2 * (B - A) * l + 100 * (2 * A - B));

      // 2 * (B - A) * l + 100 * (2 * A - B)
      // Old way to do it, but accuracy is not as good as the above one
      // https://www.desmos.com/calculator/oqqi9nzonh
      // if (l > 0.5) {
      //   l = 1 - l; // Invert the lightness for bightest colors
      // }
      // l = Math.min(2 * l, -2 * l + 2) * (A - B) + B;

      [r, g, b] = uDark.hslToRgb(h, s, l);
    }

    return render(...[r, g, b], a);
  }
  revert_rgba(r, g, b, a, render) {
    render = (render || uDark.rgba_val)
    a = typeof a == "number" ? a : 1

    let [h, s, l] = uDark.rgbToHsl(r, g, b);
    let A = uDark.userSettings.min_bright_fg
    let B = uDark.userSettings.max_bright_fg

    //  l=l<0.5 // It would be nice to check if precalulating parts of ternary operator would be faster
    //   ?-0.7*l+1
    //   :0.7*l+0.3;
    // l = Math.min(2 * l, -2 * l + 2) * (A - B) + B;  // Concise but slower than the following one
    l = l < 0.5 // Benched it, it is faster than Math.min
      ?
      2 * l * (A - B) + B :
      2 * l * (B - A) + (2 * A - B);
    // l = Math.sin(Math.PI*l)*(A-B)+B;
    // l = Math.min(2 * l, -2 * l + 2) * (A - B) + B; // Was a good one, but we may boost saturation as folowing lines shows
    // Still not sure about the best way to do it ^ has implicity while indeed a saturation boost might be nice          
    // l = Math.pow(Math.min(2 * l, -2 * l + 2),E) * (A - B) + B;

    if (h > 0.61 && h < 0.72 && l > .60) {
      // FIXME: EXPERIMENTAL:
      h += 0.61 - h; // Avoid blueish colors being purple by sending them back into blues
    }

    // i dont like how saturation boost gives a blue color to some texts like gitlab's ones.
    // s=1-Math.pow(1-s,1/E); // Boost saturation proportionnaly as brightness decrease, but we could have a separate setting for saturation boost

    // h=h-(l-ol)/4; // Keep the same hue, but we could have a separate setting for hue shift

    [r, g, b] = uDark.hslToRgb(h, s, l);

    return render(...[r, g, b], a);
  }
  edit_prefix_vars(value, actions) {
    if (!value.includes("var(")) {
      return value; // No variables to edit;
    }
    return value.replace(/(?<![\w-])--(?!ud-[bf]g--)([\w-])/gi, "--ud-" + actions.prefix_vars + "--$1")
  }
  restore_vars(value) {
    return value.replaceAll("..1..", "var(").replaceAll("..2..", ")").replaceAll("..3..", "calc(");
  }
  wrapIntoColor(color, actions) {
    let l_var = actions.l_var ? `var(${actions.l_var})` : "l";
    let h_var = actions.h_var ? `var(${actions.h_var})` : "h";
    return `hsl(from ${color} ${h_var} s ${l_var} / alpha)`
  }
  edit_fastValue0(value, actions, cssRule) {
    if (actions.js_static_transform) {
      if (!value.includes("var(")) {
        return uDark.eget_color(value, actions.js_static_transform, cssRule, true, true);
      }
    }
    return uDark.wrapIntoColor(value, actions);
  }
  edit_with_regex(key, value, regex, actions, cssRule) {
    return value.replaceAll(regex, (match) => {
      return uDark.edit_fastValue0(match, actions, cssRule);
    });
  }

  edit_all_cssRule_colors_cb(cssRule, key, value, options, actions) {

    // 0. Return the original value if it's not a string
    if (!(value instanceof String || typeof value === "string")) {
      return value;
    }
    // if ((value.match(/\(/g) || []).length !== (value.match(/\)/g) || []).length) {
    //   console.error("Unbalanced parenthesis in value", key, value);
    // }


    let alreadyEditedTestResult = value.match("NotImplemented" + uDark.alreadyEditedTestRegex);
    let key_prefix = actions.key_prefix || "";
    if (alreadyEditedTestResult) {
      uDark.info("Already edited", key, value, alreadyEditedTestResult)
      return value; // Take care of no_edit here, dont forget to return value
    }
    let cssStyle = cssRule.style;
    if (actions.fastValue0) {
      let wrapped = uDark.edit_fastValue0(value, actions, cssRule);
      if (actions.no_edit || wrapped == value && !key_prefix) {
        return wrapped;
      }
      cssStyle.p_ud_setProperty(key_prefix + key, wrapped, cssStyle.getPropertyPriority(key));
      return;
    }

    let url_protected = uDark.str_protect(value, actions.raw_text ? uDark.regex_search_for_url_raw : uDark.regex_search_for_url, "url_protected");

    // url_protected=value.protect(/DISABLED/,"url_protected");
    let new_value = url_protected.str;

    let fastValue1 = !value.match(/\([^\)]+\(/)

    let usedColorRegex = fastValue1 ? uDark.fastColorRegex : uDark.colorRegex;
    if (actions.prefix_vars) {
      new_value = uDark.edit_prefix_vars(new_value, actions);
    }
    new_value = uDark.edit_with_regex(key, new_value, usedColorRegex, actions);
    new_value = uDark.edit_with_regex(key, new_value, uDark.namedColorsRegex, actions); // edit_named_colors
    new_value = uDark.edit_with_regex(key, new_value, uDark.hexadecimalColorsRegex, actions); // edit_hex_colors // The browser auto converts hex to rgb, but some times not like in  var(--123,#00ff00) as it cant resolve the var
    new_value = uDark.str_unprotect(new_value, url_protected);

    if (!actions.no_edit && value != new_value || key_prefix) {
      // Edit the value only if necessary:  setting bacground image removes bacground property for intance
      cssStyle.p_ud_setProperty(key_prefix + key, new_value, cssStyle.getPropertyPriority(key)); // Once we had  an infinite loop here when uDark was loaded twice and redefining setProperty.
    }
    return new_value;
  }
  edit_all_cssRule_colors(cssRule, keys, options, actions = {}, callBack = uDark.edit_all_cssRule_colors_cb) {

    keys.forEach(key => {
      let value = cssRule.style.getPropertyValue(key);
      if (actions.raw_text_prefix) {
        // clone actions to avoid changing the original object, while adding a new property
        actions = Object.assign({ raw_text: key.startsWith(actions.raw_text_prefix) }, actions);
      }
      if (actions.replaces) {
        for (let replace of actions.replaces) {
          value = value.replaceAll(...replace);
        }
      }
      if (value) {
        callBack(cssRule, key, value, options, actions);
      }
    });
  }

  edit_cssProperties(cssRule, details, options) {
    let foregroundFastItems = [],
      foregroundComplexItems = [],
      variablesItems = [],
      backgroundItems = [],
      wordingActions = [];
    for (let x of cssRule.style) {
      if (x.startsWith("--")) {
        if (x.match(/^--ud-[bf]g--/)) {
          continue
        }
        if (!x.startsWith("--ud-ptd-")) { // Now using protection strategy for shorthands, but matching them properly with the regex <3
          variablesItems.push(x);
          continue; // Eliminate Variables, i don't think its usefull to test them againt regexes
        }
      }
      if (uDark.css_properties_wording_action_dict[x]) {
        wordingActions.push(x);
      } // Check if some wording action is needed
      // Shorthands are temporarily stored as --ud-ptd-* custom properties so
      // CSSStyleDeclaration does not expand them into their longhand values.
      // Classify them by their original name while editing the protected key.
      let originalProperty = x.startsWith("--ud-ptd-") ? x.slice("--ud-ptd-".length) : x;
      if (uDark.foreground_color_css_properties.includes(originalProperty)) {
        foregroundFastItems.push(x);
        continue;
      } // Do foreground items first as its faster to check a list
      if (uDark.foreground_complex_color_css_properties.includes(originalProperty)
        || (uDark.userSettings.foregroundBordersEnabled
          && uDark.foreground_border_properties.includes(originalProperty))) {
        foregroundComplexItems.push(x);
        continue;
      } // Complex foreground values need token scanning instead of fastValue0
      if (x.match(uDark.background_color_css_properties_regex)) {
        backgroundItems.push(x);
        continue;
      } // Do background regex match

    }
    let disableNamespaceVars = true; // seems promising but not ready yet.

    wordingActions.length && uDark.css_properties_wording_action(cssRule.style, wordingActions, details, cssRule, options);

    backgroundItems.length && uDark.edit_all_cssRule_colors(cssRule, backgroundItems, options,
      uDark.overrideBGColorActions || {
        prefix_vars: "bg", // in 2025 i tied to get rid of bg prefixed vars by disabling namespace vars, but it's impossible since a variable can be used in a shorthand property like background: var(--ud-bg-color) var(--ud-bg-image), we have to look at the exact value of the var and edit colors where colors realy are
        raw_text_prefix: "--",
        l_var: "--uDark_transform_darken",
        js_static_transform: uDark.rgba,
      })

    foregroundFastItems.length && uDark.edit_all_cssRule_colors(cssRule, foregroundFastItems, options, {
      fastValue0: true,
      l_var: "--uDark_transform_lighten",
      h_var: "--uDark_transform_text_hue",
      js_static_transform: uDark.revert_rgba,
    })

    foregroundComplexItems.length && uDark.edit_all_cssRule_colors(cssRule, foregroundComplexItems, options, {
      l_var: "--uDark_transform_lighten",
      h_var: "--uDark_transform_text_hue",
      js_static_transform: uDark.revert_rgba,
    })

    variablesItems.length && uDark.edit_all_cssRule_colors(cssRule, variablesItems, options,
      {
        prefix_vars: "bg",
        raw_text: true,
        l_var: "--uDark_transform_darken",
        key_prefix: "--ud-bg",
        js_static_transform: uDark.rgba,
      })

  }
  edit_cssRules(cssRules, details, options = {}, callBack = uDark.edit_cssProperties) {
    [...cssRules].forEach(cssRule => {

      if (cssRule.cssRules && cssRule.cssRules.length) {
        uDark.edit_cssRules(cssRule.cssRules, details, options, callBack);
      }
      if (cssRule.style && cssRule.constructor.name != "CSSFontFaceRule") {
        callBack(cssRule, details, options);
      }

    })
  }
  addNocacheToStrLink(linkP1) {
    let linkP2 = "";

    let hashIndex = linkP1.indexOf("#");
    if (hashIndex != -1) {
      linkP2 = linkP1.substring(hashIndex);
      linkP1 = linkP1.substring(0, hashIndex);
    }
    let paramsIndex = linkP1.indexOf("?");
    if (paramsIndex != -1) {
      linkP2 = linkP1.substring(paramsIndex + 1) + linkP2;
      linkP1 = linkP1.substring(0, paramsIndex + 1);
      return linkP1 + "uDnCcK=" + Math.random() + "&" + linkP2;
    }
    return linkP1 + "?uDnCcK=" + Math.random() + linkP2;

  }
  edit_css_urls_ternary(cssStyle, cssRule, details, options, vars) {
    if (!uDark.userSettings.imageEditionEnabled) {
      return;
    }
    vars = vars || {};
    vars.property = vars.property || "background-image";
    let oValue = cssStyle.getPropertyValue(vars.property);
    let value = oValue;

    // Its very neccessary to not edit property if they dont contain a url, as it changes a lot the CSS if there are shorthand properties involved : setting bacground image removes bacground property

    // Instead of registering the image as a background, we will encode the selector in the URL 
    // and register the image as a background image only when it is downloaded, in the filter script

    let used_regex = vars.regex || uDark.regex_search_for_url_raw;

    // Do not edit the options object, it is shared between all calls
    options = {
      ...options,
      changed: false,
      hasImageSet: value.includes("image-set(")
    };
    if (options.hasImageSet) // First ensure we treat image set quoted urls (not using url()) like other urls
    {

      let protectedImageSet = uDark.str_protect(value, uDark.imageSetRegex, "image_set_protect"); // Isolate image-set(...) content to avoid issues quoted content outside the image-set
      value = protectedImageSet.str;

      protectedImageSet.values = protectedImageSet.values.map(v => {
        let localV = v;
        let parenthesisProtected = uDark.str_protect(localV, uDark.parenthesisRegex, "parenthesis_content_protect"); // In image set only quoted content outside parenthesis can be isolated urls
        localV = parenthesisProtected.str;
        localV = localV.replace(uDark.quotedContentRegex, (match) => `url(${match})`); // Transform quoted urls into url(...) to be treated like other urls
        localV = uDark.str_unprotect(localV, parenthesisProtected); // Restore parenthesis content
        return localV;
      });


      value = value.replace(used_regex, (match, g1, g2, g3, g4) => "image-set(" + match + ")"); // Encapsulate each remaining url(...) into image-set(...) to be treated like other urls


      value = uDark.str_unprotect(value, protectedImageSet); // Restore image-set content but with quoted urls transformed into url(...)

    }



    // We dont need to capture type("image/png") here, only the Nx part bothered us;
    used_regex = new RegExp(used_regex.source + '(\\s+\\d+x)?', used_regex.flags);
    if (vars.use_other_property) {
      let transientCSSStylesheet = new CSSStyleSheet();
      vars.transientCSSStylesheet = transientCSSStylesheet;
      transientCSSStylesheet.p_ud_insertRule(["z{", cssStyle.cssText, "}"].join(""));
      transientCSSStylesheet.cssRules[0].style.p_ud_setProperty(vars.originalProperty, value);
      vars.originalBackgroundRepeat = transientCSSStylesheet.cssRules[0].style.backgroundRepeat;
    }
    let alSeenCSSImageUrls = details.transientCache.get("CSSImageUrls");
    if (!alSeenCSSImageUrls) {
      alSeenCSSImageUrls = new Set();
      details.transientCache.set("CSSImageUrls", alSeenCSSImageUrls);
    }

    let valuesToEncapsulate = new Set();
    value = value.replace(used_regex, (match, g1, g2, g3, g4) => {

      if (match.includes(uDark.imageSrcInfoMarker)) {
        return match;
      }
      let ret = ["logo-toggle", "bg-toggle", "original"].map(toggle => {
        if (vars.use_other_property) {
          vars.transientCSSStylesheet.cssRules[0].style.p_ud_setProperty(vars.use_other_property, match);
          let newMatch = vars.transientCSSStylesheet.cssRules[0].style.getPropertyValue(vars.use_other_property);
          if (newMatch.startsWith("url(")) {
            g1 = newMatch.slice(5, -2);
          }
        }
        let link1 = g1.trim();
        let usedQuote = link1.length > 2 && [`'`, `"`].includes(link1[0]) ? link1[0] : "";
        let link = usedQuote ? link1.slice(1, -1) : link1;
        options.changed = true;

        let notableInfos = {
          "uDark_cssClass": encodeURI(cssRule.selectorText),
          "uDark_backgroundRepeat": cssStyle.backgroundRepeat || vars.originalBackgroundRepeat, // Curently broken, we need to fix it
          "css-guess": toggle
        };


        let hasFontRelatedItem = ["font", "font-family", "font-size", "color"].some(x => cssRule.style.getPropertyValue(x));
        if (hasFontRelatedItem) {
          notableInfos["uDark_directCssFont"] = "true";
        }

        options.notableInfos = notableInfos;
        link = uDark.send_data_image_to_parser(link, false, options);
        if (!options.svgImage) {
          let oLink = link;
          if (!options.is_data_image && alSeenCSSImageUrls.has(link)) {
            // On the same request (same details), the browser will not request the same image twice, and therefore use one it fetched without sending it to imageWorker.
            link = uDark.addNocacheToStrLink(link);
          }
          alSeenCSSImageUrls.add(oLink);

          let usedChar = (link.includes("#") ? "" : "#") + uDark.imageSrcInfoMarker
          link += usedChar + new URLSearchParams(notableInfos).toString();

        }
        g4 = g4 || "1x";
        return (`url(${usedQuote}${link}${usedQuote})` + (` var(--ud-bg--${toggle}-css-toggle,${g4 || "1x"})`));
      }).join(",")

      if (!options.hasImageSet) {
        ret = "image-set(" + ret + ")";
      }
      else {
        valuesToEncapsulate.add(ret);
      }
      return ret;
    }

    )

    if (options.changed) {
      if (options.hasImageSet) {
        let protectWith = uDark.str_protect(value, uDark.imageSetRegex, "image_set_protect");
        value = protectWith.str;
        valuesToEncapsulate.forEach(v => {
          value = value.replace(v, elem => {
            return "image-set(" + v + ")"
          });
        })
        value = uDark.str_unprotect(value, protectWith);
      }

      cssStyle.p_ud_setProperty(vars.property, value);
    }

  }
  edit_css_urls(cssStyle, cssRule, details, options, vars) {
    if (!uDark.userSettings.diAdvancedCSSLogoHandling) {
      return uDark.edit_css_urls_ternary(cssStyle, cssRule, details, options, vars);
    }
    if (!uDark.userSettings.imageEditionEnabled) {
      return;
    }
    vars = vars || {};
    vars.property = vars.property || "background-image";
    let oValue = cssStyle.getPropertyValue(vars.property);
    let value = oValue;

    // Its very neccessary to not edit property if they dont contain a url, as it changes a lot the CSS if there are shorthand properties involved : setting bacground image removes bacground property

    // Instead of registering the image as a background, we will encode the selector in the URL 
    // and register the image as a background image only when it is downloaded, in the filter script
    options = {
      ...options,
      changed: false
    }; // Do not edit the options object, it is shared between all calls
    let used_regex = vars.regex || uDark.regex_search_for_url

    if (vars.use_other_property) {
      let transientCSSStylesheet = new CSSStyleSheet();
      vars.transientCSSStylesheet = transientCSSStylesheet;
      transientCSSStylesheet.p_ud_insertRule(["z{", cssStyle.cssText, "}"].join(""));
      transientCSSStylesheet.cssRules[0].style.p_ud_setProperty(vars.originalProperty, value);
      vars.originalBackgroundRepeat = transientCSSStylesheet.cssRules[0].style.backgroundRepeat;
    }
    let alSeenCSSImageUrls = details.transientCache.get("CSSImageUrls");
    if (!alSeenCSSImageUrls) {
      alSeenCSSImageUrls = new Set();
      details.transientCache.set("CSSImageUrls", alSeenCSSImageUrls);
    }
    value = value.replace(used_regex, (match, g1) => {

      if (vars.use_other_property) {
        vars.transientCSSStylesheet.cssRules[0].style.p_ud_setProperty(vars.use_other_property, match);
        let newMatch = vars.transientCSSStylesheet.cssRules[0].style.getPropertyValue(vars.use_other_property);
        if (newMatch.startsWith("url(")) {
          g1 = newMatch.slice(5, -2);
        }
      }

      //changed = true;
      let link = g1.trim();

      options.changed = true;
      let notableInfos = {
        "uDark_cssClass": encodeURI(cssRule.selectorText),
        "uDark_backgroundRepeat": cssStyle.backgroundRepeat || vars.originalBackgroundRepeat, // Curently broken, we need to fix it
      };
      let hasFontRelatedItem = ["font", "font-family", "font-size", "color"].some(x => cssRule.style.getPropertyValue(x));
      if (hasFontRelatedItem) {
        notableInfos["uDark_directCssFont"] = "true";
      }
      options.notableInfos = notableInfos;
      link = uDark.send_data_image_to_parser(link, false, options);
      if (!options.svgImage) {
        let oLink = link;
        if (!options.is_data_image && alSeenCSSImageUrls.has(link)) {
          // On the same request (same details), the browser will not request the same image twice, and therefore use one it fetched without sending it to imageWorker.
          link = uDark.addNocacheToStrLink(link);
        }
        alSeenCSSImageUrls.add(oLink);

        let usedChar = (link.includes("#") ? "" : "#") + uDark.imageSrcInfoMarker
        link += usedChar + new URLSearchParams(notableInfos).toString();

      }

      return 'url("' + link + '")';
    })

    if (options.changed) {
      cssStyle.p_ud_setProperty(vars.property, value);
    }

  }

  css_properties_wording_action(cssStyle, keys, details, cssRule, options) {
    // cssRule.style, wording_action, details, cssRule, options
    keys.forEach(key => {
      let action = uDark.css_properties_wording_action_dict[key];
      if (action) {

        if (action.replace) {
          let value = cssStyle.getPropertyValue(key);
          cssStyle.p_ud_setProperty(key, value.replaceAll(...action.replace));
        }
        if (action.remove) {
          cssStyle.removeProperty(key);
        }
        if (action.stickToProperty) {
          let vars = action.stickToProperty;
          let value = cssStyle.getPropertyValue(key)
          let new_value = vars.stick(value, cssStyle, cssRule, details, options);
          cssStyle.p_ud_setProperty(vars.rKey, new_value);
        }
        if (action.stickConcatToPropery) {
          let vars = action.stickConcatToPropery;
          let value = cssStyle.getPropertyValue(key)
          let new_value = cssStyle.getPropertyValue(vars.rKey) || ""
          if (value && value.includes(vars.sValue)) {
            new_value += " " + vars.stick;
          } else {
            new_value = new_value.replaceAll(vars.stick, "");
          }
          cssStyle.p_ud_setProperty(vars.rKey, new_value);

        }
        if (action.callBacks) {
          action.callBacks.forEach(callBack => {
            callBack(cssStyle, cssRule, details, options, action.variables);
          });
        }
      }

    });
  }
  createInternalProperty = function (leType, atName, condition = true) {
    // We can search in the code for unsafe looping use of the property, and replace it by the internal property with the regex [.](?<!(o|p)_ud_)innerHTML[\s+]*?[+]?= in VSCode
    if (condition) {

      uDark.info("Creating internal property for", leType, atName)

      var originalProperty = Object.getOwnPropertyDescriptor(leType.prototype, atName);
      if (!originalProperty) {
        console.error("No existing property for '", atName, "'", leType, leType.name, leType.prototype, condition)
        return;
      }

      Object.defineProperty(leType.prototype, "p_ud_" + atName, originalProperty);
    }
  }

}

class AllLevels {

  static install = function () {
    {
      globalThis.CSS2Properties = globalThis.CSSStyleProperties || globalThis.CSS2Properties;
      // Any level protected proptotypes for safe intenal use without ternaries or worries.
      CSS2Properties.prototype.p_ud_setProperty = CSS2Properties.prototype.setProperty;
      CSSStyleSheet.prototype.p_ud_replaceSync = CSSStyleSheet.prototype.replaceSync;
      CSSStyleSheet.prototype.p_ud_insertRule = CSSStyleSheet.prototype.insertRule;

      DOMParser.prototype.p_ud_parseFromString = DOMParser.prototype.parseFromString;
      uDark.DOMParser = DOMParser;
      uDark.createInternalProperty(Element, "innerHTML");
      uDark.createInternalProperty(ShadowRoot, "innerHTML");
      uDark.createInternalProperty(CSS2Properties, "backgroundColor");
      uDark.createInternalProperty(Navigator, "serviceWorker", navigator.serviceWorker != undefined);

    }
    {

      String.prototype.protect = function (regexSearch, protectWith) {
        return uDark.str_protect(String(this).valueOf(), regexSearch, protectWith)
      };
      String.prototype.unprotect = function (protectWith) {
        return uDark.str_unprotect(String(this), protectWith)
      };
      String.prototype.protect_numbered = function (regexSearch, protectWith, condition = true) {
        return uDark.str_protect_numbered(String(this), regexSearch, protectWith, condition)
      };
      String.prototype.unprotect_numbered = function (protectWith, condition = true) {
        return uDark.str_unprotect_numbered(String(this), protectWith, condition)
      };
      String.prototype.protect_simple = function (regexSearch, protectWith, condition = true) {
        return uDark.str_protect_simple(String(this), regexSearch, protectWith, condition)
      };
      String.prototype.unprotect_simple = function (protectedWith, condition = true) {
        return uDark.str_unprotect_simple(String(this), protectedWith, condition)
      };
    }

  }
};
const uDark = new uDarkC();
window.uDark = uDark;

const isExtensionPage = document.location.href.startsWith("moz-extension://");
const isSettingsPage = document.title === "UltimaDark Settings";

if (isExtensionPage && isSettingsPage) {
  console.log(
    "Page is UltimaDark Settings, not installing uDark",
    "Loading a lightweight version"
  );

  uDark.getSettings(settings => {
    console.log("Loaded settings:", settings);
  });
} else {

  AllLevels.install();
  new Promise(resolve => {
    resolve(uDark.install())
  }).then((installResult) => {
    installResult !== false && uDark.keypoint("Installed", window.location.href);
  });
}


let namedEntitiesRawObject = fetch("entities.json").then(response => response.json()).then(data => data);
namedEntitiesRawObject.then(data => {
    uDark.success("Named entities loaded");
    window.namedEntities = data;

    let keptValues = new Array()
    for (const [key, value] of Object.entries(window.namedEntities)) {
        if (value.codepoints[0] > 126) {
            keptValues.push(key)
        }
    }
    window.keptValues = keptValues;
    window.regExpNamedEntities = new RegExp("&(" + keptValues.join("|").replaceAll("&", '') + ")", "gi");
});
const BOMS = [
    { sig: [0x00, 0x00, 0xFE, 0xFF], charset: "utf-32be" },
    { sig: [0xFF, 0xFE, 0x00, 0x00], charset: "utf-32le" },
    { sig: [0xEF, 0xBB, 0xBF], charset: "utf-8" },
    { sig: [0xFE, 0xFF], charset: "utf-16be" },
    { sig: [0xFF, 0xFE], charset: "utf-16le" },
    { sig: [0x84, 0x31, 0x95, 0x33], charset: "gb18030" }
];

/*
 * Potential Bug: Misalignment Due to Undefined Byte Values in Multi-byte Encodings
 *
 * In multi-byte encodings like Big5, Shift JIS, EUC-JP, and GBK, certain byte values 
 * (e.g., 0x80 in Big5, 0x80 and 0xA0 in Shift JIS) are undefined or reserved. These 
 * bytes do not form valid parts of any multi-byte character sequences.
 *
 * If these undefined bytes are not treated carefully, they can cause misalignment 
 * within multi-byte sequences. Misalignment occurs when the algorithm mistakenly tries 
 * to interpret these undefined bytes as part of a two-byte sequence, resulting in 
 * parsing errors or incorrect character interpretation.
 * 
 * Solution:
 * - Treat undefined bytes like 0x80 as single-byte characters, effectively isolating 
 *   them so they do not interfere with the expected two-byte sequences.
 * - This approach ensures that each valid two-byte sequence remains aligned and is 
 *   parsed correctly.
 * 
 * Example: In Big5, if 0x80 is received, handle it as a single-byte character to 
 * avoid misalignment in multi-byte processing.
 */

window.encodingByteCounter = {
    "utf-8": (codepoint) => {
        if (codepoint <= 0x007F) return 1; // 1 byte for ASCII
        if (codepoint <= 0x07FF) return 2; // 2 bytes for codepoints up to 0x07FF
        if (codepoint <= 0xFFFF) return 3; // 3 bytes for codepoints up to 0xFFFF
        return 4; // 4 bytes for codepoints up to 0x10FFFF
    },

    "shift_jis": (codepoint) => {

        if (codepoint <= 0x007F) return 1; // 1 byte for ASCII and Katakana
        if (codepoint >= 0x80 && codepoint <= 0x9F) return 1; // 1 byte for additional Katakana but in the range 0x80-0x9F for unicode compatibility
        if (codepoint >= 0xFF61 && codepoint <= 0xFF9F) return 1; // 1 byte for additional Katakana but in the range 0xFF61-0xFF9F for unicode compatibility
        return 2; // 2 bytes for Kanji
    },

    "gbk": (codepoint) => {
        return (codepoint <= 0x007F) ? 1 : 2; // 1 byte for ASCII, 2 bytes otherwise
    },

    "gb18030": (codepoint) => {
        if (codepoint <= 0x007F) return 1; // 1 byte for ASCII
        if (codepoint <= 0xFFFF) return 2; // 2 bytes for codepoints up to 0xFFFF
        return 4; // 4 bytes for higher codepoints
    },

    "big5": (codepoint) => {
        return (codepoint <= 0x007F + 1) ? 1 : 2; // 1 byte for ASCII (+1 : Extended to the invalid inbetween byte 0x80 that will ever be single ), 2 bytes otherwise 
    },
    "windows-31j": (codepoint) => {
        if (codepoint <= 0x007F || (codepoint >= 0xA1 && codepoint <= 0xDF)) return 1; // 1 byte for ASCII and Katakana
        if (codepoint >= 0xE0 && codepoint <= 0xEF) return 1; // 1 byte for additional characters in this range
        return 2; // 2 bytes for Kanji and other characters
    },
    "euc-jp": (codepoint,firstByte) => {
        if (codepoint <= 0x007F) return 1; // 1 byte for ASCII
        if(firstByte==0x8F) return 3; // 3  bytes for characters starting with 0x8F
        return 2; // Default to 2 bytes for unhandled cases
    },


    "iso-2022-jp": (codepoint) => {
        return (codepoint <= 0x007F) ? 1 : -1; // 1 byte for ASCII, special handling for escape sequences
    },

    "euc-kr": (codepoint) => {
        return (codepoint <= 0x007F) ? 1 : 2; // 1 byte for ASCII, 2 bytes otherwise
    },

    "utf-16be": (codepoint) => {
        return (codepoint <= 0xFFFF) ? 2 : 4; // 2 bytes for BMP characters, 4 bytes for supplementary
    },

    "utf-16le": (codepoint) => {
        return (codepoint <= 0xFFFF) ? 2 : 4; // 2 bytes for BMP characters, 4 bytes for supplementary
    }
};

function asciiWarmupUTF16() {
    console.log("Warming up UTF-16 decoders with ASCII data");
    let arr = new Uint8Array(256 * 2);
    for (let i = 0; i < 256; i++) {
        arr[i * 2] = i;
        arr[i * 2 + 1] = 0;
    }
    for (let i = 0; i < 256; i++) {
        arr[i * 2] = 0;
        arr[i * 2 + 1] = i;
    }
    uDarkDecode("utf-16le", arr.buffer);
    uDarkDecode("utf-16be", arr.buffer);
}
function asCiiWarmup07F(charset) {
    console.log("Warming up ascii decoders with 0x00-0x7F data for charset", charset);
    let arr = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
        if([27].includes(i)){
            continue ; // Skip escape character for iso-2022-jp
        }
        arr[i] = i;
    }
    uDarkDecode(charset, arr.buffer);
}


findByteCountEscapeSequences = function (decoder, escapeLength, nextBytes, character, defaultByteCount) {
    for (let i = 1; i <= 4; i++) {
        let byteCount = i;
        let escapeSequence = nextBytes.subarray(0, escapeLength + i);
        let decoded = decoder.decode(escapeSequence);
        if (decoded == character) {
            // uDark.info("Found escape sequence",escapeSequence,"for character",character,"byteCount",byteCount);
            return byteCount;
        }
        // uDark.info("Escape sequence",escapeSequence,"didn't match character",character,"decoded",decoded);
    }
    uDark.error("Couldn't find escape sequence for character", character, "defaultByteCount")
    return defaultByteCount;
}

window.getSafeDecoder = function (charset, decoderOptions = {}) {
    let decoder = null;
    try {
        decoder = new TextDecoder(charset, decoderOptions);
    }
    catch (e) {
        uDark.warn("Couldn't create decoder for charset", charset);
        decoder = new TextDecoder("utf-8", decoderOptions);
    }
    return decoder;
};
window.extractTextEncoderSupportedBOM = function (charUint8Array) {

    // -------------------------------
    // Normalize the input
    // -------------------------------
    if(! (charUint8Array instanceof Uint8Array)) {
        charUint8Array = new Uint8Array(charUint8Array);
    }

    if (charUint8Array.length === 0) {
        return false;
    }

    // -------------------------------
    // List of known BOM signatures
    // Order matters: longest first
    // -------------------------------


    // -------------------------------
    // Try to match a BOM
    // -------------------------------
    for (let bom of BOMS) {

        let sig = bom.sig;

        if (charUint8Array.length < sig.length) {
            continue;
        }

        let matches = true;

        for (let i = 0; i < sig.length; i++) {
            if (charUint8Array[i] !== sig[i]) {
                matches = false;
                break;
            }
        }

        if (matches) {
            return {
                bytes: new Uint8Array(sig).buffer,
                charset: bom.charset
            };
        }
    }

    // -------------------------------
    // No BOM found
    // -------------------------------
    return false;
};

const HEAD = 64; // enough for @charset + value
const UTF8_SIGNATURE = new TextEncoder().encode('@charset "');

// These are the same string encoded manually to UTF-16
const UTF16LE_SIGNATURE = new Uint8Array([
    0x40, 0x00, 0x63, 0x00, 0x68, 0x00, 0x61, 0x00,
    0x72, 0x00, 0x73, 0x00, 0x65, 0x00, 0x74, 0x00,
    0x20, 0x00, 0x22, 0x00
]);

const UTF16BE_SIGNATURE = new Uint8Array([
    0x00, 0x40, 0x00, 0x63, 0x00, 0x68, 0x00, 0x61,
    0x00, 0x72, 0x00, 0x73, 0x00, 0x65, 0x00, 0x74,
    0x00, 0x20, 0x00, 0x22
]);

window.detectCSSCharset = function (buffer) {

    const head = new Uint8Array(buffer).subarray(0, HEAD);

    const isUTF8 = UTF8_SIGNATURE.every((b, i) => head[i] === b);

    if (isUTF8) {
        text = new TextDecoder("utf-8").decode(buffer);
    }
    else if (UTF16LE_SIGNATURE.every((b, i) => head[i] === b)) {
        text = new TextDecoder("utf-16le").decode(buffer);
    } else if (UTF16BE_SIGNATURE.every((b, i) => head[i] === b)) {
        text = new TextDecoder("utf-16be").decode(buffer);
    } else {
        return null; // pas de @charset en tout début
    }
    const match = text.match(/^@charset\s"([a-z0-9_-]{2,15})";/i);
    return match ? match[1].toLowerCase() : null;

}

window.uDarkDecode = function (charsetUnsafe, bufferData, decoderOptions = {}, details = {}, url) {
    charsetUnsafe = charsetUnsafe.toLowerCase();
    let charUint8Array = bufferData instanceof Uint8Array ? bufferData : new Uint8Array(bufferData);

    if (details.dataCount === 1) {
        let bomInfo = details.dataBOMInfo || extractTextEncoderSupportedBOM(charUint8Array);
        details.dataBOMInfo = bomInfo
        charsetUnsafe = bomInfo ? bomInfo.charset : charsetUnsafe;
        // remove bom from bufferdata : 
        if (bomInfo) {
            charUint8Array = charUint8Array.subarray(bomInfo.bytes.byteLength);
        }
    }

    let start = performance.now();

    let decoder = getSafeDecoder(charsetUnsafe, decoderOptions);
    let charset = decoder.encoding;

    uDark.log("Decoding into charset", charset);
    if (charset == "utf-8") {
        return decoder.decode(bufferData);
    }
    if (url) {

        testURLCharset(url, charsetUnsafe);
    }
    if (!(charset in encodingByteCounter)) {
        uDark.log("Creating encoding byte counter for", charset);
        encodingByteCounter[charset] = { monoByte: 1 };
    }
    let fnCharset = encodingByteCounter[charset];
    if (!fnCharset.map) {
        fnCharset.map = new Map();
        let warmup = charset.startsWith("utf-16") ? asciiWarmupUTF16 : asCiiWarmup07F;
        warmup(charset);
    }
    let decoded = "";

    if (charset == "iso-2022-jp") {
        decoded = uDarkDecodeEscapeSequence(decoder, fnCharset, charUint8Array);
    }
    // else if(charset == "shift_jis"){
    //     decoded= dynamicDecoderCharacterCounter(decoder,fnCharset,bufferData);

    // }
    else {
        decoded = uDarkDecodeSimple(decoder, fnCharset, charUint8Array);
    }
    // Now uDarkHTMLEntityProtected as a wholde word is a forbidden string in the page, this is why do the concatenation in two steps, i never want to see this string in a page ever again.
    let replacement = "uDark" + "HTMLEntityProtected$1";
    // Since replacement will never contain a $& it's safe to use it as a replacement string without callback function.
    decoded = decoded.replaceAll(/&(#x?[0-9A-F]+)/g, replacement).replaceAll(window.regExpNamedEntities, replacement);
    let end = performance.now();
    uDark.log("Decoding took", end - start, "ms");
    return decoded;

}

window.uDarkDecodeSimple = function (decoder, fnCharset, charUint8Array) {
    // foreach character in decoded
    // get codepoint
    // get byte count
    // get encoding byte count
    // if byte count != encoding byte count

    let doubleAsciiCharset = decoder.encoding.startsWith("utf-16");
    let decoded = decoder.decode(charUint8Array.buffer); //prefer decoding the whole buffer, rather than the subarray view in case of a bom is present
    let splitDecode = Array.from(decoded); // Using Array.from to split the string into an array of characters because multiple bytes are used for some characters, it handles that correctly

    let dataIndex = 0;



    splitDecode.forEach((char, index) => {

        let codepoint = char.codePointAt(0); // codePointAt handles surrogate pairs correctly

        let knownCodepoint = fnCharset.map.get(codepoint);

        if ((codepoint <= 126 && !doubleAsciiCharset || knownCodepoint) && char != "�") // We cant trust the � character, for the number of bytes of the one we have in map  it can be the result of single bytes or multibyte characters.
        {
            let shifting = knownCodepoint ? knownCodepoint.length : 1;

            // {
            //     let currentNextBytes = charUint8Array.slice(dataIndex,dataIndex+shifting);

            //     let currentNextBytesDecoded = decoder.decode(currentNextBytes);
            //     if(currentNextBytesDecoded!=char)
            //     {
            //         console.error("1 Couldn't find encoding byte count for character,","shifting is",shifting,"'"+char+"'","defaultByteCount",1,currentNextBytes,"decodes to","'"+currentNextBytesDecoded+"'","hex",Array.from(currentNextBytes).map(b=>b.toString(16)));
            //         currentNextBytesDecodedCodepoint=currentNextBytesDecoded.codePointAt(0);
            //         console.log("Codepoints",codepoint,currentNextBytesDecodedCodepoint);
            //         console.log("Known codepoint",knownCodepoint);
            //         console.log("Previous char given current data index",splitDecode[index-1],charUint8Array.slice(dataIndex-1,dataIndex+1));
            //         console.log(index,codepoint,char,dataIndex,currentNextBytes,currentNextBytesDecoded,knownCodepoint);
            //         let aroundSize=5;
            //         let [before,after]=[splitDecode.slice(index-aroundSize,index+aroundSize).join(""),decoded.slice(index-aroundSize,index+aroundSize)];
            //         console.log("Text around is different",before!=after);
            //         console.table({before,after});

            //         throw new Error("1 Couldn't find encoding byte count for character");
            //     }

            //     console.log("1. Pushing data index",dataIndex,"by",shifting,"for",char,"index",index,"getting",dataIndex+shifting);
            // }
            dataIndex += shifting;
            return;
        }

        let nextBytes = null;
        var encodingByteCount = 0;
        if (char == "�") {
            for (encodingByteCount of [2, 1, 3, 4]) {
                // Using variable leakage at our advantage, we will keep the last value of encodingByteCount
                nextBytes = charUint8Array.subarray(dataIndex, dataIndex + encodingByteCount);
                let nextBytesDecoded = decoder.decode(nextBytes);
                if (nextBytesDecoded == char) {
                    break;
                }
            };
            // console.log("�",codepoint,"DataIndex",dataIndex,"Codepoint",codepoint,"char",char,"index",index,"dataIndex",dataIndex,knownCodepoint,"encodingByteCount",encodingByteCount,"nextBytes",nextBytes,"decodedBytes",nextBytesDecoded);
        }
        else {
            let nextByte = charUint8Array[dataIndex];
            encodingByteCount = fnCharset.monoByte || fnCharset(codepoint,nextByte);
        }
        // if(!encodingByteCount)
        // {
        //     console.error("2 Couldn't find encoding byte count for character",char,"defaultByteCount",encodingByteCount,nextBytes,"decodes to","'"+decoder.decode(nextBytes)+"'");
        //     throw new Error("2 Couldn't find encoding byte count for character");
        // }

        // if(isMultiRoleChar)
        // {
        //     let nextBytesDecoded =  decoder.decode(charUint8Array.slice(dataIndex,dataIndex+encodingByteCount));
        //     encodingByteCount = [1,2,3,4].find((byteCount)=>{
        //         let nextBytesDecoded =  decoder.decode(charUint8Array.slice(dataIndex,dataIndex+byteCount));
        //         return nextBytesDecoded==char;
        //     }); 
        // }
        // else
        if (!knownCodepoint) {
            fnCharset.map.set(codepoint, nextBytes || charUint8Array.subarray(dataIndex, dataIndex + encodingByteCount));
        }

        /*

        new TextDecoder().decode(new Uint8Array([128])) == "�"
        true
        new TextDecoder("shift_jis").decode(new Uint8Array([128])) == "�"
        false 
        */


        dataIndex += encodingByteCount;
    })
    return decoded;
}


window.uDarkEncode = function (charsetUnsafe, str, details = {}) {
    uDark.log("Encoding into charset", charsetUnsafe);
    let charset = getSafeDecoder(charsetUnsafe).encoding;
    let encoder = new TextEncoder();
    if (charset == "utf-8") {
        return encoder.encode(str);
    }

    // Now uDarkHTMLEntityProtected as a wholde word is a forbidden string in the page, this is why do the concatenation in two steps
    // I never want to see this string in a page ever again.
    str = str.replaceAll("uDark" + "HTMLEntityProtected", "&");
    let strSplit = Array.from(str); // Using Array.from to split the string into an array of characters because multiple bytes are used for some characters, it handles that correctly

    let fnCharset = encodingByteCounter[charset];
    let doubleAsciiCharset = charset.startsWith("utf-16");
    let start = performance.now();
    let encoded = new Array();

    strSplit.forEach((char, index) => {
        let codepoint = char.codePointAt(0); // codePointAt handles surrogate pairs correctly
        if (codepoint <= 126 && !doubleAsciiCharset) {
            encoded.push(char.charCodeAt(0));
            return;
        }
        let knownCodepoint = fnCharset.map.get(codepoint);

        if (!knownCodepoint) {
            console.warn("Codepoint not found in map", codepoint, "char", char, "index", index, fnCharset.map, charset);
        }
        if (knownCodepoint) {
            for (let i = 0; i < knownCodepoint.length; i++) {
                encoded.push(knownCodepoint[i]);
            }
        }

    });
    let end = performance.now();
    uDark.log("Encoding took", end - start, "ms");
    // let redDecoded=new TextDecoder(charset).decode(new Uint8Array(encoded));
    // for(let i=0;i<1000;i++)
    // {
    //     str=str.replaceAll(String.fromCodePoint(10084+ i),"");
    // }
    // if(redDecoded!=str){
    //     console.warn("Encoding/Decoding Mismatch");

    //     console.log("Original",str);
    //     console.log("Decoded",redDecoded);
    //     // Find first Mismatch character  with codepoint <0xFF00
    //     let aSplit = Array.from(str);
    //     let reSplit = Array.from(redDecoded);

    //     for(let i=0;i<reSplit.length;i++)
    //     {
    //         if(reSplit[i]!=aSplit[i])
    //         {
    //             console.log("Mismatch at",i,"Original",aSplit[i],"Decoded",reSplit[i]);

    //             let aroundSize=40;
    //             let [before,after]=[aSplit.slice(i-aroundSize,i+aroundSize).join(""),reSplit.slice(i-aroundSize,i+aroundSize).join("")]
    //             console.log( "Text around : ",before!=after,before,after);
    //             console.log("bytes around",new Uint8Array(encoded).slice(i-40,i+40),new Uint8Array(encoder.encode(str)).slice(i-40,i+40));

    //             break;
    //         }
    //     }

    // }
    return new Uint8Array(encoded);

}

function splitEscSequences(arr) {
    let sequences = [];
    let start = 0;
    let nextIndex = arr.indexOf(27, start);

    while (nextIndex !== -1) {
        // Slice the array from the current start to the found 27
        if (nextIndex !== start) {
            sequences.push(arr.subarray(start, nextIndex));
        }
        start = nextIndex;  // Update start to the index of 27
        nextIndex = arr.indexOf(27, start + 1);  // Find the next occurrence of 27
    }

    // Push the last sequence from the last found 27 to the end of the array
    if (start < arr.length) {
        sequences.push(arr.subarray(start));
    }

    return sequences;
}


window.dynamicDecoderCharacterCounter = function (decoder, fnCharset, bufferData) {
    console.warn("Using dynamicDecoderCharacterCounter");

    decoded = decoder.decode(bufferData);

    let splitDecode = Array.from(decoded); // Using Array.from to split the string into an array of characters because multiple bytes are used for some characters, it handles that correctly

    let dataIndex = 0;
    let charUint8Array = new Uint8Array(bufferData);

    outerLoop: for (let i = 0; i < splitDecode.length; i++) {
        let char = splitDecode[i];

        let codepoint = char.codePointAt(0); // codePointAt handles surrogate pairs correctly
        let knownCodepoint = fnCharset.map.get(codepoint);

        // console.log("\n");

        // if(codepoint==65533)
        // {
        //     console.warn(codepoint,"DataIndex",dataIndex,"Codepoint",codepoint,"char",char,"index",i,"dataIndex",dataIndex,knownCodepoint);
        // }
        if ((codepoint <= 126 || knownCodepoint) && char != "�") // We cant trust the � character, for the number of bytes of the one we have in map  it can be the result of single bytes or multibyte characters.  
        {
            // if(knownCodepoint)
            // {
            //     console.log("Skipping known codepoint",codepoint,"char",char,"index",i,"dataIndex",dataIndex,"knownCodepoint",knownCodepoint);
            // }
            // else
            // {   
            //     console.log("Skipping ASCII character",codepoint,"char",char,"index",i,"dataIndex",dataIndex);
            // }
            let shifting = knownCodepoint ? knownCodepoint.length : 1;
            // let currentNextBytes = charUint8Array.slice(dataIndex,dataIndex+shifting);

            // let currentNextBytesDecoded = decoder.decode(currentNextBytes);
            // console.log("1 Current nextbytes are",currentNextBytes,"and decodes to",currentNextBytesDecoded, "shifting",shifting);
            // if(currentNextBytesDecoded!=char)
            // {
            //     console.error("1 Couldn't find encoding byte count for character",char,"defaultByteCount",1,currentNextBytes,"decodes to",currentNextBytesDecoded);
            //     throw new Error("1 Couldn't find encoding byte count for character");
            // }
            // console.log("Continuing with",char,"index",i,"dataIndex",dataIndex);
            dataIndex += shifting;
            continue outerLoop;
        }

        let nextBytes = null;
        for (var encodingByteCount of [2, 1, 3, 4]) // Using variable leakage at our advantage, we will keep the last value of encodingByteCount
        {
            nextBytes = charUint8Array.slice(dataIndex, dataIndex + encodingByteCount);
            let nextBytesDecoded = decoder.decode(nextBytes);
            if (nextBytesDecoded == char) { break; }
        }
        if (!encodingByteCount) {
            console.error("2 Couldn't find encoding byte count for character", char, "defaultByteCount", encodingByteCount, nextBytes, "decodes to", "'" + decoder.decode(nextBytes) + "'");
            throw new Error("2 Couldn't find encoding byte count for character");
        }
        // if(codepoint==65533 )
        // {
        //     console.log(codepoint+"setting","DataIndex",dataIndex,"Codepoint",codepoint,"char",char,"index",i,"dataIndex",dataIndex,knownCodepoint,"encodingByteCount",encodingByteCount,"nextBytes",nextBytes,"decodedBytes",decodedBytes);
        //     // throw new Error("Invalid codepoint");
        // }
        if (!knownCodepoint) { // � can be the result of single bytes or multibyte characters. We will keep only the first one we've seen, but we still need to push forward the index.

            fnCharset.map.set(codepoint, nextBytes);

        }

        dataIndex += encodingByteCount;
    }
    return decoded;

}



window.dynamicDecoderCharacterCounter2 = function (decoder, fnCharset, bufferData) {
    console.warn("Using dynamicDecoderCharacterCounter2");
    console.log("The idea was to use find, but it is slower than the for loop");

    decoded = decoder.decode(bufferData);

    let splitDecode = Array.from(decoded); // Using Array.from to split the string into an array of characters because multiple bytes are used for some characters, it handles that correctly

    let dataIndex = 0;
    let charUint8Array = new Uint8Array(bufferData);


    outerLoop: for (let i = 0; i < splitDecode.length; i++) {
        let char = splitDecode[i];

        let codepoint = char.codePointAt(0); // codePointAt handles surrogate pairs correctly
        let knownCodepoint = fnCharset.map.get(codepoint);

        // console.log("\n");

        // if(codepoint==65533)
        // {
        //     console.warn(codepoint,"DataIndex",dataIndex,"Codepoint",codepoint,"char",char,"index",i,"dataIndex",dataIndex,knownCodepoint);
        // }


        if ((codepoint <= 126 || knownCodepoint) && char != "�") // We cant trust the � character, for the number of bytes of the one we have in map  it can be the result of single bytes or multibyte characters.  
        {
            // if(knownCodepoint)
            // {
            //     console.log("Skipping known codepoint",codepoint,"char",char,"index",i,"dataIndex",dataIndex,"knownCodepoint",knownCodepoint);
            // }
            // else
            // {   
            //     console.log("Skipping ASCII character",codepoint,"char",char,"index",i,"dataIndex",dataIndex);
            // }
            let shifting = knownCodepoint ? knownCodepoint.length : 1;
            // let currentNextBytes = charUint8Array.slice(dataIndex,dataIndex+shifting);

            // let currentNextBytesDecoded = decoder.decode(currentNextBytes);
            // console.log("1 Current nextbytes are",currentNextBytes,"and decodes to",currentNextBytesDecoded, "shifting",shifting);
            // if(currentNextBytesDecoded!=char)
            // {
            //     console.error("1 Couldn't find encoding byte count for character",char,"defaultByteCount",1,currentNextBytes,"decodes to",currentNextBytesDecoded);
            //     throw new Error("1 Couldn't find encoding byte count for character");
            // }
            // console.log("Continuing with",char,"index",i,"dataIndex",dataIndex);
            dataIndex += shifting;
            continue outerLoop;
        }
        let nextBytes = null;
        for (var encodingByteCount of [2, 1, 3, 4]) // Using variable leakage at our advantage, we will keep the last value of encodingByteCount
        {
            nextBytes = charUint8Array.subarray(dataIndex, dataIndex + encodingByteCount);
            let nextBytesDecoded = decoder.decode(nextBytes);
            if (nextBytesDecoded == char) { break; }
        }

        if (!encodingByteCount) {
            console.error("2 Couldn't find encoding byte count for character", char, "defaultByteCount", encodingByteCount, nextBytes, "decodes to", "'" + decoder.decode(nextBytes) + "'");
            throw new Error("2 Couldn't find encoding byte count for character");
        }

        if (!knownCodepoint) { // We must not overwrite the known codepoints, especially for the multiroles characters, they can be the result of single bytes or multibyte characters. Once we know one of them we must not overwrite it.
            fnCharset.map.set(codepoint, nextBytes);
        }

        dataIndex += encodingByteCount;
    }
    return decoded;

}


window.uDarkDecodeEscapeSequence = function (decoder, fnCharset, charUint8Array) {

    let escapeSequences = splitEscSequences(charUint8Array);
    fnCharset.escapeSequencesReplacements = fnCharset.escapeSequencesReplacements || new Map();
    let decoded = "";
    let start = performance.now();
    escapeSequences.forEach((sequence) => {
        let decodedSequence = decoder.decode(sequence);
        let usedChar = ""
        if (sequence[0] === 27) {
            let escapeSequence = sequence.subarray(0, 3);
            usedChar = fnCharset.escapeSequencesReplacements.get(escapeSequence.toString());

            let sequenceByteCount = findByteCountEscapeSequences(decoder, 3, sequence.subarray(0, 7), decodedSequence.charAt(0));
            if (!usedChar) {
                let usedCharCodePoint = 10084 + fnCharset.escapeSequencesReplacements.size;
                usedChar = String.fromCodePoint(usedCharCodePoint);
                fnCharset.escapeSequencesReplacements.set(escapeSequence.toString(), usedChar);
                fnCharset.map.set(usedCharCodePoint, escapeSequence);
                if (!sequenceByteCount) {
                    console.error("Couldn't find byte count for escape sequence", decodedSequence.charAt(0), "defaultByteCount")
                    throw new Error("Couldn't find byte count for escape sequence");
                }
                console.info("Inserted escape sequence", "usedChar", usedChar, "escapeSequence", escapeSequence, "sequenceByteCount", sequenceByteCount,);
            }
            Array.from(decodedSequence).forEach((char, index) => {
                let codepoint = char.codePointAt(0);
                if (codepoint > 126 && !fnCharset.map.has(codepoint)) {

                    let dataIndex = index * sequenceByteCount + 3;
                    let charBytes = sequence.subarray(dataIndex, dataIndex + sequenceByteCount);
                    fnCharset.map.set(codepoint, charBytes);
                }
            });

        }
        decoded += usedChar + decodedSequence;
    });


    let end = performance.now();
    console.log("Decoding took", end - start, "ms");
    return decoded;

}


testURLCharset = async (url, charset) => {
    {
        // Fetch an url

        // find out remote encoding via response headers
        let response = await fetch(url);

        let data = await response.arrayBuffer();
        let decoder = new TextDecoder(charset);

        data = new Uint8Array(data);
        console.log("Data", data);

        let decoded = decoder.decode(data);

        // Try to decode the data with the charset using our method
        let uDarkDecoded = uDarkDecode(charset, data);

        // Try to encode the data with the charset using our method
        let uDarkEncoded = uDarkEncode(charset, uDarkDecoded);

        // Check if the original data and the re-encoded data match
        let originalData = new Uint8Array(data);


        console.log("Will check byte by byte");
        for (let i = 0; i < originalData.length; i++) {
            if (originalData[i] != uDarkEncoded[i]) {
                mismatch = true;
                let aroundSize = 3;
                let [before, after] = [originalData.slice(i - aroundSize, i + aroundSize), uDarkEncoded.slice(i - aroundSize, i + aroundSize)];
                decodedBefore = decoder.decode(before);
                decodedAfter = decoder.decode(after);
                if (decodedBefore != decodedAfter) {
                    console.warn("BYTES Mismatch at", i, "Original", originalData[i], "Encoded", uDarkEncoded[i], "charset", charset);
                    console.info("If string matches, its probably a multirole char that can be encoded in multiple ways, especially the unknown character �");

                    console.log("Bytes around is different", before != after, "check for multirole char especialy �");
                    console.table({ decodedBefore, decodedAfter });
                }
                break;
            }
        }

        // Now uDarkHTMLEntityProtected as a wholde word is a forbidden string in the page, this is why do the concatenation in two steps
        // I never want to see this string in a page ever again.

        let myStringVersion = new TextDecoder(charset).decode(uDarkEncoded);

        console.log("Will check char after char:", decoded != myStringVersion);
        let oChars = Array.from(decoded);
        let eChars = Array.from(myStringVersion);
        if (decoded != myStringVersion) {
            console.error("Decoding/Encoding Mismatch");

            console.log("Original", decoded);
            console.log("Decoded", myStringVersion);
        }
        for (let i = 0; i < oChars.length; i++) {
            if (oChars[i] != eChars[i]) {
                let aroundSize = 10;
                console.log("STR Mismatch at", i, "Original", oChars[i], "Encoded", eChars[i], "charset", charset);
                let [before, after] = [decoded.slice(i - aroundSize, i + aroundSize), myStringVersion.slice(i - aroundSize, i + aroundSize)];
                console.log("Text around is different", before != after);
                console.table({ before, after });
                break;
            }
        }




    }
}


// z("http://charset.7jp.net/mojibake.html","shift_jis");
// testURLCharset("http://charset.7jp.net/sjis.html","shift_jis");
// testURLCharset("http://charset.7jp.net/ascii.cgi","shift_jis");
// testURLCharset("http://charset.7jp.net/ascii.cgi","shift_jis");
// testURLCharset("https://www.hyperhosting.gr/grdomains/","ISO-8859-7");