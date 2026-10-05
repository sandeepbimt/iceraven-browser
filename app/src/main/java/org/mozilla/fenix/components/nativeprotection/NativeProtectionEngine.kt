/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.content.Context
import java.io.File

/**
 * Minimal Android configuration bridge for the SANDFOX native Brave adblock engine.
 *
 * The actual request classification remains inside Gecko's native ContentClassifierService.
 * Android only supplies the initial filter sources before GeckoRuntime is created.
 */
class NativeProtectionEngine private constructor(private val context: Context) {
    fun prepareGeckoStartupConfig() {
        val target = File(context.filesDir, STARTUP_CONFIG_FILE)
        val temporary = File(context.filesDir, "$STARTUP_CONFIG_FILE.tmp")
        val enabled = true
        val engines = TEST_ENGINE
        val listUrls = FILTER_LISTS.joinToString("|")

        val yaml = buildString {
            appendLine("prefs:")
            appendLine("  $PREF_PROTECTION_ENABLED: $enabled")
            appendLine("  $PREF_PROTECTION_ENGINES: \"$engines\"")
            appendLine("  $PREF_PROTECTION_ENGINES_PBM: \"$engines\"")
            appendLine("  $PREF_PROTECTION_LIST_URLS: \"$listUrls\"")
        }

        temporary.writeText(yaml, Charsets.UTF_8)
        if (!temporary.renameTo(target)) {
            temporary.copyTo(target, overwrite = true)
            temporary.delete()
        }
    }

    companion object {
        private const val TEST_ENGINE = "test_block"
        private const val STARTUP_CONFIG_FILE = "sandfox-geckoview-config.yaml"

        private const val PREF_PROTECTION_ENABLED =
            "privacy.trackingprotection.content.protection.enabled"
        private const val PREF_PROTECTION_ENGINES =
            "privacy.trackingprotection.content.protection.engines"
        private const val PREF_PROTECTION_ENGINES_PBM =
            "privacy.trackingprotection.content.protection.engines.pbmode"
        private const val PREF_PROTECTION_LIST_URLS =
            "privacy.trackingprotection.content.protection.test_list_urls"

        private val FILTER_LISTS = listOf(
            "https://ublockorigin.github.io/uAssets/filters/filters.min.txt",
            "https://ublockorigin.github.io/uAssets/filters/privacy.min.txt",
            "https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt",
            "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt",
        )

        @Volatile
        private var instance: NativeProtectionEngine? = null

        fun get(context: Context): NativeProtectionEngine =
            instance ?: synchronized(this) {
                instance ?: NativeProtectionEngine(context.applicationContext).also {
                    instance = it
                }
            }
    }
}
