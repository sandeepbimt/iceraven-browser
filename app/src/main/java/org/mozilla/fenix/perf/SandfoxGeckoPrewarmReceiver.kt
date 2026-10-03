/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.perf

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.mozilla.fenix.FenixApplication

/**
 * Warms the already-initialized Gecko engine after device boot or an app update.
 *
 * The receiver deliberately does not start a foreground service or keep a wake lock.
 * Android may still reclaim the cached process; the normal browser/PWA path must remain
 * fully functional when that happens.
 */
class SandfoxGeckoPrewarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (
            intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        (context.applicationContext as? FenixApplication)
            ?.components
            ?.core
            ?.engine
            ?.warmUp()
    }
}
