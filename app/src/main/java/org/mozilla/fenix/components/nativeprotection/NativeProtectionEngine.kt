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
import org.mozilla.fenix.ext.components

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
        applyPreferences()
        scheduleUpdates()
    }

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
        require(filters.toByteArray(Charsets.UTF_8).size <= MAX_CUSTOM_FILTER_BYTES) {
            "My filters are too large"
        }
        prefs.edit().putString(KEY_CUSTOM_FILTERS, filters).apply()
        if (isEnabled()) applyPreferences(forceReload = true)
    }

    fun refreshFilters() {
        if (isEnabled()) applyPreferences(forceReload = true)
    }

    fun siteExceptionStore() = context.components.core.engine.trackingProtectionExceptionStore

    private fun applyPreferences(forceReload: Boolean = false) {
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
                onSuccess = { setListUrls(runtime, listUrls) },
                onError = { setListUrls(runtime, listUrls) },
            )
        } else {
            runtime.setBrowserPrefs(
                values + SetBrowserPreference.setStringPref(
                    PREF_PROTECTION_LIST_URLS,
                    listUrls,
                    Branch.USER,
                ),
                onSuccess = {},
                onError = {},
            )
        }
    }

    private fun setListUrls(runtime: BrowserPreferencesRuntime, listUrls: String) {
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
            onSuccess = {},
            onError = {},
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
        private const val KEY_ENABLED = "enabled"
        private const val KEY_SELECTED_LISTS = "selected_lists"
        private const val KEY_CUSTOM_FILTERS = "custom_filters"
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
            "ublock-filters", "ublock-badware", "ublock-privacy", "ublock-unbreak",
            "easylist", "easyprivacy", "pgl", "urlhaus",
        )

        val FILTER_LISTS = listOf(
            FilterListDefinition("ublock-filters", "uBlock filters – Ads",
                "https://ublockorigin.github.io/uAssets/filters/filters.min.txt"),
            FilterListDefinition("ublock-badware", "uBlock filters – Badware risks",
                "https://ublockorigin.github.io/uAssets/filters/badware.min.txt"),
            FilterListDefinition("ublock-privacy", "uBlock filters – Privacy",
                "https://ublockorigin.github.io/uAssets/filters/privacy.min.txt"),
            FilterListDefinition("ublock-unbreak", "uBlock filters – Unbreak",
                "https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt"),
            FilterListDefinition("easylist", "EasyList",
                "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt"),
            FilterListDefinition("easyprivacy", "EasyPrivacy",
                "https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt"),
            FilterListDefinition("pgl", "Peter Lowe – Ads, trackers, and more",
                "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext"),
            FilterListDefinition("urlhaus", "Malicious URL Blocklist",
                "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt"),
            FilterListDefinition("ublock-annoyances", "uBlock filters – Annoyances",
                "https://ublockorigin.github.io/uAssets/filters/annoyances.min.txt"),
            FilterListDefinition("adguard-mobile", "AdGuard/uBO – Mobile Ads",
                "https://filters.adtidy.org/extension/ublock/filters/11.txt"),
            FilterListDefinition("indianlist", "IndianList",
                "https://easylist-downloads.adblockplus.org/indianlist.txt"),
        )

        @Volatile private var instance: NativeProtectionEngine? = null

        fun get(context: Context): NativeProtectionEngine =
            instance ?: synchronized(this) {
                instance ?: NativeProtectionEngine(context.applicationContext).also { instance = it }
            }
    }
}
