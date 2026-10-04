/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.adblock

import android.content.Context
import mozilla.components.ExperimentalAndroidComponentsApi
import mozilla.components.concept.engine.preferences.BrowserPreferencesRuntime
import mozilla.components.concept.engine.preferences.Branch
import mozilla.components.concept.engine.preferences.SetBrowserPreference
import org.mozilla.fenix.ext.components

/**
 * First SANDFOX native-adblock foundation slice.
 *
 * The network decision is made by Gecko's existing ContentClassifierService and
 * its embedded Rust adblock engine. This class does not intercept requests,
 * install a WebExtension, proxy traffic, or perform Kotlin-side matching.
 *
 * A single bundled canary rule is intentionally used at this stage. It gives us
 * a deterministic proof that the Gecko-native path is alive before we add the
 * real filter-list/profile/update machinery.
 */
@OptIn(ExperimentalAndroidComponentsApi::class)
object SandfoxNativeAdblockBootstrap {
    private const val PREF_PROTECTION_ENABLED =
        "privacy.trackingprotection.content.protection.enabled"
    private const val PREF_PROTECTION_ENGINES =
        "privacy.trackingprotection.content.protection.engines"
    private const val PREF_PROTECTION_ENGINES_PBM =
        "privacy.trackingprotection.content.protection.engines.pbmode"
    private const val PREF_PROTECTION_TEST_LIST_URLS =
        "privacy.trackingprotection.content.protection.test_list_urls"

    private const val ENGINE = "test_block"
    private const val CANARY_RULE_URL =
        "resource://android/assets/sandfox_adblock/bootstrap.txt"

    fun initialize(context: Context) {
        val runtime = context.components.core.engine as? BrowserPreferencesRuntime ?: return

        runtime.setBrowserPrefs(
            listOf(
                SetBrowserPreference.setStringPref(
                    PREF_PROTECTION_TEST_LIST_URLS,
                    CANARY_RULE_URL,
                    Branch.USER,
                ),
                SetBrowserPreference.setStringPref(
                    PREF_PROTECTION_ENGINES,
                    ENGINE,
                    Branch.USER,
                ),
                SetBrowserPreference.setStringPref(
                    PREF_PROTECTION_ENGINES_PBM,
                    ENGINE,
                    Branch.USER,
                ),
                SetBrowserPreference.setBoolPref(
                    PREF_PROTECTION_ENABLED,
                    true,
                    Branch.USER,
                ),
            ),
            onSuccess = {},
            onError = {},
        )
    }
}
