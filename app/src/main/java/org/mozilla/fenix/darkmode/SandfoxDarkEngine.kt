/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.darkmode

import android.util.Log
import org.mozilla.geckoview.GeckoRuntime

/**
 * Installs the first-party Sandfox dark-page engine as a privileged built-in WebExtension.
 *
 * The extension is deliberately kept independent from the browser UI. Gecko persists the
 * built-in extension between runtime restarts, while ensureBuiltIn upgrades it only when its
 * manifest version changes.
 */
object SandfoxDarkEngine {
    private const val TAG = "SandfoxDarkEngine"
    private const val EXTENSION_LOCATION = "resource://android/assets/sandfox_dark/"
    private const val EXTENSION_ID = "sandfox-dark-engine@sandfox.local"

    fun install(runtime: GeckoRuntime) {
        runtime.getWebExtensionController()
            .ensureBuiltIn(EXTENSION_LOCATION, EXTENSION_ID)
            .accept(
                { extension ->
                    Log.i(TAG, "Dark engine ready: ${extension?.id ?: EXTENSION_ID}")
                },
                { error ->
                    Log.e(TAG, "Failed to install the Sandfox dark engine", error)
                },
            )
    }
}
