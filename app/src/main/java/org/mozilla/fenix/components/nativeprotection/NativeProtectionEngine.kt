/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.content.Context
import android.util.Base64
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import mozilla.components.ExperimentalAndroidComponentsApi
import mozilla.components.concept.engine.preferences.BrowserPreferencesRuntime
import mozilla.components.concept.engine.preferences.Branch
import mozilla.components.concept.engine.preferences.SetBrowserPreference
import mozilla.components.concept.engine.webextension.MessageHandler
import mozilla.components.concept.engine.webextension.WebExtensionRuntime
import org.mozilla.fenix.ext.components
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sandfox V1 native protection controller.
 *
 * Gecko's ContentClassifierService performs the actual network classification with
 * its native adblock-rust engine. This class only supplies its preferences and
 * filter-list sources. No WebExtension, request interceptor, proxy, or second
 * filter engine is used.
 */
@OptIn(ExperimentalAndroidComponentsApi::class)
class NativeProtectionEngine private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun initialize() {
        migrateBundledFilters()
        migrateFilterListSelection()
        applyPreferences()
        scheduleUpdates()
    }

    /**
     * Installs the built-in cosmetic WebExtension only after WebExtensionSupport has been
     * initialized by FenixApplication. Calling this from early engine initialization was
     * unsafe because Gecko's WebExtension subsystem is not ready at that point.
     */
    fun installCosmeticEngine() {
        val runtime = context.components.core.engine as? WebExtensionRuntime ?: return
        try {
            runtime.installBuiltInWebExtension(
                id = COSMETIC_EXTENSION_ID,
                url = COSMETIC_EXTENSION_URL,
                onSuccess = { extension ->
                    extension.registerBackgroundMessageHandler(NATIVE_APP, object : MessageHandler {
                        override fun onMessage(message: Any, source: mozilla.components.concept.engine.EngineSession?): Any? {
                            if (message !is JSONObject || message.optString("type") != "getConfig") return null
                            return cosmeticConfigMessage()
                        }
                    })
                },
                onError = { _ -> },
            )
        } catch (_: Throwable) {
            // Cosmetic filtering is additive. A WebExtension installation failure must never
            // make the browser itself fail to start.
        }
    }

    private fun cosmeticConfigMessage(): JSONObject = JSONObject().apply {
        put("type", "config")
        put("enabled", isEnabled())
        put("globalLists", JSONArray(selectedListIds().toList()))
        put("customFilters", customFilters())
        put("siteListOverrides", siteListOverridesJson())
        put("siteEnabledOverrides", siteEnabledOverridesJson())
        put("forceRefresh", consumeCosmeticRefreshRequest())
    }

    private fun consumeCosmeticRefreshRequest(): Boolean {
        val requested = prefs.getLong(KEY_COSMETIC_REFRESH_REQUESTED_AT, 0L)
        if (requested == 0L) return false
        prefs.edit().remove(KEY_COSMETIC_REFRESH_REQUESTED_AT).apply()
        return true
    }

    fun refreshCosmeticFilters() {
        prefs.edit().putLong(KEY_COSMETIC_REFRESH_REQUESTED_AT, System.currentTimeMillis()).apply()
    }

    fun siteListOverride(host: String): Set<String>? {
        val normalized = normalizeSiteHost(host) ?: return null
        val sites = siteListOverridesJson()
        if (!sites.has(normalized)) return null
        val array = sites.optJSONArray(normalized) ?: return emptySet()
        return buildSet {
            for (index in 0 until array.length()) {
                array.optString(index).takeIf { it.isNotBlank() }?.let(::add)
            }
        }
    }

    fun setSiteListOverride(host: String, ids: Set<String>) {
        val normalized = normalizeSiteHost(host) ?: return
        val sites = siteListOverridesJson()
        val valid = ids.filterTo(linkedSetOf()) { id -> FILTER_LISTS.any { it.id == id } }
        sites.put(normalized, JSONArray(valid.toList()))
        prefs.edit().putString(KEY_SITE_LIST_OVERRIDES, sites.toString()).apply()
    }

    fun clearSiteListOverride(host: String) {
        val normalized = normalizeSiteHost(host) ?: return
        val sites = siteListOverridesJson()
        sites.remove(normalized)
        prefs.edit().putString(KEY_SITE_LIST_OVERRIDES, sites.toString()).apply()
    }

    fun siteProtectionOverride(host: String): Boolean? {
        val normalized = normalizeSiteHost(host) ?: return null
        val sites = siteEnabledOverridesJson()
        return if (sites.has(normalized)) sites.optBoolean(normalized) else null
    }

    fun setSiteProtectionOverride(host: String, enabled: Boolean) {
        val normalized = normalizeSiteHost(host) ?: return
        val sites = siteEnabledOverridesJson()
        sites.put(normalized, enabled)
        prefs.edit().putString(KEY_SITE_ENABLED_OVERRIDES, sites.toString()).apply()
    }

    fun clearSiteProtectionOverride(host: String) {
        val normalized = normalizeSiteHost(host) ?: return
        val sites = siteEnabledOverridesJson()
        sites.remove(normalized)
        prefs.edit().putString(KEY_SITE_ENABLED_OVERRIDES, sites.toString()).apply()
    }

    private fun normalizeSiteHost(host: String): String? =
        host.trim().lowercase().takeIf { it.length in 1..253 && !it.contains('/') && !it.contains(' ') }

    private fun siteListOverridesJson(): JSONObject = runCatching {
        JSONObject(prefs.getString(KEY_SITE_LIST_OVERRIDES, "{}") ?: "{}")
    }.getOrDefault(JSONObject())

    private fun siteEnabledOverridesJson(): JSONObject = runCatching {
        JSONObject(prefs.getString(KEY_SITE_ENABLED_OVERRIDES, "{}") ?: "{}")
    }.getOrDefault(JSONObject())

    fun isEnabled(): Boolean = prefs.getBoolean(KEY_ENABLED, true)

    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
        applyPreferences()
        if (enabled) scheduleUpdates()
    }

    fun selectedListIds(): Set<String> =
        prefs.getStringSet(KEY_SELECTED_LISTS, DEFAULT_LISTS)?.toSet() ?: DEFAULT_LISTS

    fun setSelectedListIds(ids: Set<String>) {
        prefs.edit().putStringSet(KEY_SELECTED_LISTS, ids).apply()
        if (isEnabled()) applyPreferences(forceReload = true)
    }

    fun customFilters(): String = prefs.getString(KEY_CUSTOM_FILTERS, "").orEmpty()

    fun setCustomFilters(filters: String) {
        val normalized = normalizeFilterText(filters)
        require(normalized.toByteArray(Charsets.UTF_8).size <= MAX_CUSTOM_FILTER_BYTES) {
            "My filters are too large"
        }
        prefs.edit().putString(KEY_CUSTOM_FILTERS, normalized).apply()
        if (isEnabled()) applyPreferences(forceReload = true)
    }

    fun lastRefreshRequestedAt(): Long =
        prefs.getLong(KEY_LAST_REFRESH_REQUESTED_AT, 0L)

    fun lastRefreshSucceededAt(): Long =
        prefs.getLong(KEY_LAST_REFRESH_SUCCEEDED_AT, 0L)

    fun lastRefreshFailedAt(): Long =
        prefs.getLong(KEY_LAST_REFRESH_FAILED_AT, 0L)

    fun refreshFilters(onResult: ((Boolean) -> Unit)? = null) {
        if (!isEnabled()) {
            onResult?.invoke(false)
            return
        }

        prefs.edit()
            .putLong(KEY_LAST_REFRESH_REQUESTED_AT, System.currentTimeMillis())
            .apply()

        applyPreferences(forceReload = true) { success ->
            val now = System.currentTimeMillis()
            if (success) {
                prefs.edit()
                    .putLong(KEY_LAST_REFRESH_SUCCEEDED_AT, now)
                    .putLong(KEY_LAST_REFRESH_FAILED_AT, 0L)
                    .apply()
            } else {
                prefs.edit()
                    .putLong(KEY_LAST_REFRESH_FAILED_AT, now)
                    .apply()
            }
            onResult?.invoke(success)
        }
    }

    fun siteExceptionStore() = context.components.core.engine.trackingProtectionExceptionStore

    private fun applyPreferences(
        forceReload: Boolean = false,
        onComplete: ((Boolean) -> Unit)? = null,
    ) {
        val runtime = context.components.core.engine as? BrowserPreferencesRuntime
            ?: error("Sandfox native protection requires Gecko browser preferences")

        val enabled = isEnabled()
        val listUrls = buildListUrls()
        val activeEngines = if (enabled && listUrls.isNotEmpty()) TEST_ENGINE else ""

        val values = listOf(
            SetBrowserPreference.setBoolPref(PREF_PROTECTION_ENABLED, enabled, Branch.USER),
            SetBrowserPreference.setStringPref(PREF_PROTECTION_ENGINES, activeEngines, Branch.USER),
            SetBrowserPreference.setStringPref(PREF_PROTECTION_ENGINES_PBM, activeEngines, Branch.USER),
        )

        if (forceReload) {
            runtime.setBrowserPref(
                PREF_PROTECTION_LIST_URLS,
                "",
                Branch.USER,
                onSuccess = { setListUrls(runtime, listUrls, onComplete) },
                onError = { setListUrls(runtime, listUrls, onComplete) },
            )
        } else {
            runtime.setBrowserPrefs(
                values + SetBrowserPreference.setStringPref(
                    PREF_PROTECTION_LIST_URLS,
                    listUrls,
                    Branch.USER,
                ),
                onSuccess = { onComplete?.invoke(true) },
                onError = { onComplete?.invoke(false) },
            )
        }
    }

    private fun setListUrls(
        runtime: BrowserPreferencesRuntime,
        listUrls: String,
        onComplete: ((Boolean) -> Unit)? = null,
    ) {
        runtime.setBrowserPrefs(
            listOf(
                SetBrowserPreference.setBoolPref(PREF_PROTECTION_ENABLED, isEnabled(), Branch.USER),
                SetBrowserPreference.setStringPref(
                    PREF_PROTECTION_ENGINES,
                    if (isEnabled() && listUrls.isNotEmpty()) TEST_ENGINE else "",
                    Branch.USER,
                ),
                SetBrowserPreference.setStringPref(
                    PREF_PROTECTION_ENGINES_PBM,
                    if (isEnabled() && listUrls.isNotEmpty()) TEST_ENGINE else "",
                    Branch.USER,
                ),
                SetBrowserPreference.setStringPref(PREF_PROTECTION_LIST_URLS, listUrls, Branch.USER),
            ),
            onSuccess = { onComplete?.invoke(true) },
            onError = { onComplete?.invoke(false) },
        )
    }

    private fun buildListUrls(): String {
        val urls = selectedListIds().mapNotNull { id ->
            FILTER_LISTS.firstOrNull { it.id == id }?.url
        }.toMutableList()
        val custom = customFilters()
        if (custom.isNotBlank()) {
            val encoded = Base64.encodeToString(custom.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            urls += "data:text/plain;base64,$encoded"
        }
        return urls.distinct().joinToString("|")
    }

    private fun migrateBundledFilters() {
        val currentVersion = prefs.getInt(KEY_BUNDLED_FILTER_VERSION, 0)
        if (currentVersion >= BUNDLED_FILTER_VERSION) return

        val normalized = normalizeFilterText(
            sequenceOf(
                prefs.getString(KEY_CUSTOM_FILTERS, null).orEmpty(),
                DEFAULT_CUSTOM_FILTERS,
            ).joinToString("\n"),
        )
        require(normalized.toByteArray(Charsets.UTF_8).size <= MAX_CUSTOM_FILTER_BYTES) {
            "Bundled filters exceed the custom-filter limit"
        }
        prefs.edit()
            .putString(KEY_CUSTOM_FILTERS, normalized)
            .putInt(KEY_BUNDLED_FILTER_VERSION, BUNDLED_FILTER_VERSION)
            .apply()
    }

    private fun migrateFilterListSelection() {
        val currentVersion = prefs.getInt(KEY_FILTER_LIST_VERSION, 0)
        if (currentVersion >= FILTER_LIST_VERSION) return

        val selected = prefs.getStringSet(KEY_SELECTED_LISTS, null)?.toMutableSet()
        if (selected != null) {
            selected += "ublock-annoyances"
            selected += "adguard-annoyances"
            prefs.edit()
                .putStringSet(KEY_SELECTED_LISTS, selected)
                .putInt(KEY_FILTER_LIST_VERSION, FILTER_LIST_VERSION)
                .apply()
        } else {
            prefs.edit()
                .putInt(KEY_FILTER_LIST_VERSION, FILTER_LIST_VERSION)
                .apply()
        }
    }

    private fun normalizeFilterText(filters: String): String =
        filters.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toCollection(linkedSetOf())
            .joinToString("\n")

    private fun scheduleUpdates() {
        val request = PeriodicWorkRequestBuilder<NativeProtectionUpdateWorker>(
            UPDATE_INTERVAL_HOURS,
            TimeUnit.HOURS,
        ).build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UPDATE_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    data class FilterListDefinition(val id: String, val title: String, val url: String)

    companion object {
        private const val PREFS = "sandfox_native_protection"
        private const val COSMETIC_EXTENSION_ID = "sandfox-cosmetics@sandfox"
        private const val COSMETIC_EXTENSION_URL = "resource://android/assets/sandfox_cosmetics/"
        private const val NATIVE_APP = "sandfox.cosmetics"
        private const val KEY_SITE_LIST_OVERRIDES = "site_cosmetic_list_overrides"
        private const val KEY_SITE_ENABLED_OVERRIDES = "site_cosmetic_enabled_overrides"
        private const val KEY_COSMETIC_REFRESH_REQUESTED_AT = "cosmetic_refresh_requested_at"
            private const val KEY_ENABLED = "enabled"
        private const val KEY_SELECTED_LISTS = "selected_lists"
        private const val KEY_CUSTOM_FILTERS = "custom_filters"
        private const val KEY_BUNDLED_FILTER_VERSION = "bundled_filter_version"
        private const val KEY_LAST_REFRESH_REQUESTED_AT = "last_refresh_requested_at"
        private const val KEY_LAST_REFRESH_SUCCEEDED_AT = "last_refresh_succeeded_at"
        private const val KEY_LAST_REFRESH_FAILED_AT = "last_refresh_failed_at"
        private const val BUNDLED_FILTER_VERSION = 2
        private const val KEY_FILTER_LIST_VERSION = "filter_list_version"
        private const val FILTER_LIST_VERSION = 2
        private const val TEST_ENGINE = "test_block"

        private const val PREF_PROTECTION_ENABLED =
            "privacy.trackingprotection.content.protection.enabled"
        private const val PREF_PROTECTION_ENGINES =
            "privacy.trackingprotection.content.protection.engines"
        private const val PREF_PROTECTION_ENGINES_PBM =
            "privacy.trackingprotection.content.protection.engines.pbmode"
        private const val PREF_PROTECTION_LIST_URLS =
            "privacy.trackingprotection.content.protection.test_list_urls"

        private const val MAX_CUSTOM_FILTER_BYTES = 128 * 1024
        private const val UPDATE_INTERVAL_HOURS = 24L
        private const val UPDATE_WORK_NAME = "sandfox-native-protection-filter-refresh"

        val DEFAULT_LISTS = linkedSetOf(
            "ublock-filters", "ublock-privacy", "ublock-quick-fixes", "ublock-unbreak",
            "easylist", "adguard-generic", "adguard-mobile", "easyprivacy",
            "adguard-spyware-url", "urlhaus-1", "curben-phishing", "plowe-0", "dpollock-0",
            "fanboy-cookiemonster", "adguard-cookies", "ublock-cookies-adguard",
            "fanboy-social", "adguard-social", "fanboy-thirdparty_social",
            "fanboy-ai-suggestions", "ublock-annoyances", "adguard-annoyances", "easylist-chat", "easylist-newsletters",
            "easylist-notifications", "easylist-annoyances", "IND-0",
        )

        val FILTER_LISTS = listOf(
            FilterListDefinition("ublock-filters", "uBlock filters – Ads",
                "https://ublockorigin.github.io/uAssets/filters/filters.min.txt"),
            FilterListDefinition("ublock-privacy", "uBlock filters – Privacy",
                "https://ublockorigin.github.io/uAssets/filters/privacy.min.txt"),
            FilterListDefinition("ublock-quick-fixes", "uBlock filters – Quick fixes",
                "https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt"),
            FilterListDefinition("ublock-unbreak", "uBlock filters – Unbreak",
                "https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt"),
            FilterListDefinition("easylist", "EasyList",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt"),
            FilterListDefinition("adguard-generic", "AdGuard – Ads",
                "https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt"),
            FilterListDefinition("adguard-mobile", "AdGuard – Mobile Ads",
                "https://filters.adtidy.org/extension/ublock/filters/11.txt"),
            FilterListDefinition("easyprivacy", "EasyPrivacy",
                "https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt"),
            FilterListDefinition("adguard-spyware-url", "AdGuard/uBO – URL Tracking Protection",
                "https://ublockorigin.github.io/uAssets/filters/privacy-removeparam.txt"),
            FilterListDefinition("urlhaus-1", "Online Malicious URL Blocklist",
                "https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt"),
            FilterListDefinition("curben-phishing", "Phishing URL Blocklist",
                "https://malware-filter.gitlab.io/phishing-filter/phishing-filter.txt"),
            FilterListDefinition("plowe-0", "Peter Lowe’s Ad and tracking server list",
                "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext"),
            FilterListDefinition("dpollock-0", "Dan Pollock’s hosts file",
                "https://someonewhocares.org/hosts/hosts"),
            FilterListDefinition("fanboy-cookiemonster", "EasyList – Cookie Notices",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist-cookies.txt"),
            FilterListDefinition("adguard-cookies", "AdGuard – Cookie Notices",
                "https://filters.adtidy.org/extension/ublock/filters/18.txt"),
            FilterListDefinition("ublock-cookies-adguard", "uBlock filters – Cookie Notices",
                "https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt"),
            FilterListDefinition("fanboy-social", "EasyList – Social Widgets",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist-social.txt"),
            FilterListDefinition("adguard-social", "AdGuard – Social Widgets",
                "https://filters.adtidy.org/extension/ublock/filters/4.txt"),
            FilterListDefinition("fanboy-thirdparty_social", "Fanboy – Anti-Facebook",
                "https://secure.fanboy.co.nz/fanboy-antifacebook.txt"),
            FilterListDefinition("fanboy-ai-suggestions", "EasyList – AI Widgets",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist-ai.txt"),
            FilterListDefinition("ublock-annoyances", "uBlock filters – Annoyances",
                "https://ublockorigin.github.io/uAssets/filters/annoyances.txt"),
            FilterListDefinition("adguard-annoyances", "AdGuard – Annoyances",
                "https://filters.adtidy.org/extension/ublock/filters/14.txt"),
            FilterListDefinition("easylist-chat", "EasyList – Chat Widgets",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist-chat.txt"),
            FilterListDefinition("easylist-newsletters", "EasyList – Newsletter Notices",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist-newsletters.txt"),
            FilterListDefinition("easylist-notifications", "EasyList – Notifications",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist-notifications.txt"),
            FilterListDefinition("easylist-annoyances", "EasyList – Other Annoyances",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist-annoyances.txt"),
            FilterListDefinition("IND-0", "IndianList",
                "https://easylist-downloads.adblockplus.org/indianlist.txt"),
        )

        private val DEFAULT_CUSTOM_FILTERS = """
! 2 Feb 2026 https://m.economictimes.com
m.economictimes.com##.floating_app_btn
m.economictimes.com##.feeds.etcontent
accounts.google.com/gsi*
! 20 Aug 2026 https://timesofindia.indiatimes.com
||static.toiimg.com/thumb/msid-131903473,width-150,resizemode-4/131903473.jpg${'$'}image
! 16 Sept 2026 https://www.aljazeera.com
www.aljazeera.com##.amp-leaderboard-atf
! 16 Sept 2026 https://www.cricbuzz.com
www.cricbuzz.com##.text-sm.font-semibold.px-3.p-1\.5.rounded-full.text-cbGrnCyn.bg-cbWhite
! 16 Sept 2026 https://www.ndtv.com
www.ndtv.com###Layer_1
! 18 Sept 2026 https://www.bhaskar.com
www.bhaskar.com##.e96634e0 > div > button
! 18 Sept 2026 https://www.hindustantimes.com
||www.hindustantimes.com/ht-img/cdp/echo_images/178938029134161.png${'$'}image
www.hindustantimes.com##.ProgressBar_progress_bar__qyhA9
www.hindustantimes.com##.ProgressBar_progress_container__7ym1x
www.hindustantimes.com###googlePreferredSource-101789735214285 > .googlePreferHT > .googlePreferHTText > span
||www.hindustantimes.com/static-content/1y/ht/flipcoin_google_2x.png${'$'}image
||www.hindustantimes.com/static-content/1y/ht/flipcoin_ht_2x.png${'$'}image
www.hindustantimes.com###googlePreferredSource-101789735214285 > .googlePreferHT
! 18 Sept 2026 https://www.thehindu.com
www.thehindu.com##.btns-handeler > div > .btn-subscribe.btn
! 18 Sept 2026 https://www.telegraphindia.com
www.telegraphindia.com##.m_bottom_sticky_mobile_ad_wrap.stkybtmadbox
! 19 Sept 2026 https://timesofindia.indiatimes.com
timesofindia.indiatimes.com##._zqap
timesofindia.indiatimes.com##.JgF3m.Mr86Q
timesofindia.indiatimes.com##.fixed_elements_on_page.phShimmerFBN.dPpSq
||endedstrung.com^
! 20 Sept 2026 https://www.bhaskar.com
www.bhaskar.com##.APP_INSTALL_POPUP_DISMISS_BUTTON_CLASS.e433b067
www.bhaskar.com###APP_INSTALL_POPUP_CONTAINER_ID
||images.bhaskarassets.com/web2images/web-frontend/prefered-sources-gif/google-follow-us.gif${'$'}image
www.bhaskar.com##[href="/national/news/pune-ketan-agarwal-murder-case-lohagad-fake-instagram-account-siya-139088638.html"]
www.bhaskar.com##.f7399328
! 20 Sept 2026 https://timesofindia.indiatimes.com
||static.toiimg.com/thumb/msid-133343172,width-700,resizemode-4/133343172.jpg${'$'}image
timesofindia.indiatimes.com##.f1fA_
timesofindia.indiatimes.com##.T9Qbv.Wur9z
! 20 Sept 2026 https://theprint.in
theprint.in###article-mobile-top-support-banner
! 20 Sept 2026 https://www.indiatoday.in
||akm-img-a-in.tosshub.com/sites/indiatoday/resources/img/it-google-web.gif${'$'}image
www.indiatoday.in##.googprefer.Story_googprefer__Znq1Z.jsx-533259399.jsx-73334835.jsx-ace90f4eca22afc7
! 20 Sept 2026 https://www.hindustantimes.com
www.hindustantimes.com###googlePreferredSource-101789813872010 > .googlePreferHT
! 21 Sept 2026 https://www.thehindu.com
www.thehindu.com##.btn-ebooks.btn > span
www.thehindu.com##.btn-ebooks.btn
||www.thehindu.com/theme/images/th-online/google-playstore-icon.svg${'$'}image
||www.thehindu.com/theme/images/th-online//apple-store-icon.svg${'$'}image
! 21 Sept 2026 https://www.reuters.com
www.reuters.com##.site-header-module__subscribe-link__AnyBo.body-module__extra_small_body__Bfz20.body-module__base__o--Cl.text-module__extra_small__8Buss.text-module__medium__2Rl30.text-module__graphite__fZRmg.text-module__text__0GDob
! 21 Sept 2026 https://www.aljazeera.com
www.aljazeera.com##.site-header__live-cta--mobile > div > .live-cta > .live-cta__title--black.live-cta__title
www.aljazeera.com##.site-header__live-cta--mobile > div > .live-cta > .live-cta__icon-wrapper > .icon--24.icon--primary.icon--play.icon > .icon-main-color
www.aljazeera.com##.icon--24.icon--grey.icon--account.icon
www.thehindu.com##.thgsignin.btn-signup.btn > span
www.thehindu.com##.thgsignin.btn-signup.btn
! 21 Sept 2026 https://www.bbc.com
www.bbc.com##.vzgip.AccountButtons-styles__AccountMobileToggleButtonStyled-sc-32916240-0
www.bbc.com##.piOtT.bVJMmx.cHhxqu.Button-styles__UnboxedShareButton-sc-c0f7f974-6.Button-styles__UnboxedButton-sc-c0f7f974-5.Button-styles__ButtonBase-sc-c0f7f974-2 > .bLCQBA.Button-styles__ButtonText-sc-c0f7f974-1
www.bbc.com##.piOtT.bVJMmx.cHhxqu.Button-styles__UnboxedShareButton-sc-c0f7f974-6.Button-styles__UnboxedButton-sc-c0f7f974-5.Button-styles__ButtonBase-sc-c0f7f974-2 > .bljxtJ.Button-styles__ButtonIcon-sc-c0f7f974-0 > .iosMJz.Icon-styles__IconStyled-sc-4d91d42a-0
www.bbc.com##.hYvtJu.Byline-styles__ActionsContainerStyled-sc-66f6383-3
www.aljazeera.com##.container--ads-leaderboard-atf--sticky.container--ads-leaderboard-atf--delayed-scroll.container--ads-leaderboard-atf.container--ads > .ads > .ads__slot > div
! 21 Sept 2026 https://www.reddit.com
www.reddit.com##alert-controller
www.reddit.com###sticky-community-header-open-app-cta > .justify-center.items-center.flex > .gap-xs.items-center.flex > span
www.reddit.com##.inline-flex.button.justify-center.items-center.button-brand.px-\[calc\(var\(--rem10\)-var\(--button-border-width\,0px\)\)\].button-small
! 22 Sept 2026 https://www.livelaw.in
www.livelaw.in##.sub-pre.header_extng_sbcrb_col.col-md-4.col-sm-4.col-xs-4 > [href^="/pricing"]
www.livelaw.in##.headr_extng_user_txt
www.livelaw.in###gs_id51 > tbody > tr > .gsib_a
www.livelaw.in###gs_id51 > tbody > tr > .gsib_b
www.livelaw.in##.dsktp_tab_none.header_search_col.col-md-0.col-sm-0.col-xs-12
! 23 Sept 2026 https://indianexpress.com
indianexpress.com###ie-above-breadcrumb-ad-div
! 23 Sept 2026 https://timesofindia.indiatimes.com
timesofindia.indiatimes.com##.ffdj8
||static.toiimg.com/thumb/msid-134326301,width-150,resizemode-4/134326301.jpg${'$'}image
! 23 Sept 2026 https://www.cnbc.com
www.cnbc.com##.WatchLive-container
www.cnbc.com##.CNBCGlobalNav-livestreamWrapper > .WatchLivestream-lsLoggedOut.WatchLivestream-watchContainer > .WatchLivestream-watchItems > .WatchLivestream-dynamicTitleWrapper > .WatchLivestream-lsContainer > [href="/live-tv/"] > .WatchLivestream-streamTxt
www.cnbc.com##.SignInMenu-signInMenu > [href="#"]
www.cnbc.com##.CNBCGlobalNav-livestreamWrapper > .WatchLivestream-lsLoggedOut.WatchLivestream-watchContainer > .WatchLivestream-watchItems > .WatchLivestream-alertIconWrapper > svg > path
! 23 Sept 2026 https://www.livemint.com
www.livemint.com##.subscription.mr12.headerBtn.btnPrimary
www.livemint.com##.headerBtn.btnSecondary
www.livemint.com##div.linkRight:nth-of-type(3)
! 23 Sept 2026 https://www.telegraphindia.com
www.telegraphindia.com##.mt-24.shareiconbox
! 23 Sept 2026 https://www.thehindu.com
||www.thehindu.com/theme/images/th-online/menu-hamber-mobile-icon.svg${'$'}image
! 23 Sept 2026 https://www.ndtv.com
www.ndtv.com##.hr-crd-stp_wrp
www.ndtv.com##.hr-crd-stp_int-wr
www.ndtv.com##.d_non.hr-crd-stp
www.ndtv.com##.ASum_acd-wr
www.ndtv.com##.ASum_Mnon.ASum_wr
||www.ndtv.com/video/embed-player/id/1161897/play-via-app-wap?pWidth=100&pHeight=100&embed_type=story&site=classic&mute=1&autostart=1&mutestart=true&featured=1${'$'}subdocument
www.ndtv.com##.ArtFtVid_ttl
www.ndtv.com##.ArtFtVid_txt
||www.ndtv.com/video/embed-player/id/1162614/play-via-app-wap?pWidth=100&pHeight=100&embed_type=story&site=classic&mute=1&autostart=1&mutestart=true&featured=1${'$'}subdocument
||www.ndtv.com/video/embed-player/id/1161371/play-via-app-wap?pWidth=100&pHeight=100&embed_type=story&site=classic&mute=1&autostart=1&mutestart=true&featured=1${'$'}subdocument
www.ndtv.com##.ArtFtVid_wr
www.ndtv.com##.AskWg1_ttl-lnk
www.ndtv.com##.AskWg1_suggest
www.ndtv.com##.AskWg1_logo-mob.AskWg1_logo
www.ndtv.com##.AskWg1_input
www.ndtv.com##.AskWg1_srch
! 24 Sept 2026 https://www.cricbuzz.com
www.cricbuzz.com##.wb\:hidden.rounded-lg.border-2.p-2.gap-4.justify-between.items-center.flex
! 25 Sept 2026 https://timesofindia.indiatimes.com
timesofindia.indiatimes.com##[href^="https://timesofindia.sng.link/Eqhd4/a58l"]
""".trimIndent()

        @Volatile private var instance: NativeProtectionEngine? = null

        fun get(context: Context): NativeProtectionEngine =
            instance ?: synchronized(this) {
                instance ?: NativeProtectionEngine(context.applicationContext).also { instance = it }
            }
    }
}
