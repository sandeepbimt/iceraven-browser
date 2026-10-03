/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.perf

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.mozilla.fenix.FenixApplication
import org.mozilla.geckoview.GeckoSession

/**
 * Warms Gecko and, when uBlock Origin is installed, starts its background runtime
 * after device boot or an app update.
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

        val application = context.applicationContext as? FenixApplication ?: return
        val runtime = application.components.core.geckoRuntime

        // #71 baseline: warm Gecko itself first.
        runtime.warmUp()

        // Keep extension process spawning available if Gecko previously disabled it
        // after an extension-process crash threshold was reached.
        runtime.webExtensionController.enableExtensionProcessSpawning()

        runtime.webExtensionController.list().accept { extensions ->
            val uBlock = extensions.firstOrNull {
                it.id == UBLOCK_ORIGIN_ID ||
                    it.metaData.name.equals(UBLOCK_NAME, ignoreCase = true)
            } ?: return@accept

            if (!uBlock.metaData.enabled) {
                return@accept
            }

            prewarmUBlockBackground(runtime, uBlock.id)
        }
    }

    private fun prewarmUBlockBackground(
        runtime: org.mozilla.geckoview.GeckoRuntime,
        extensionId: String,
    ) {
        val session = GeckoSession()
        val handler = Handler(Looper.getMainLooper())
        var closed = false

        fun closeSession() {
            if (closed) return
            closed = true
            handler.removeCallbacksAndMessages(null)
            if (session.isOpen) {
                session.close()
            }
        }

        session.setProgressDelegate(
            object : GeckoSession.ProgressDelegate {
                override fun onPageStop(session: GeckoSession, success: Boolean) {
                    closeSession()
                }
            },
        )

        try {
            session.open(runtime)
            session.loadUri("moz-extension://$extensionId/dashboard.html")

            // Safety valve: never leave the hidden bootstrap session alive indefinitely.
            handler.postDelayed(::closeSession, UBlockPrewarmTimeoutMs)
        } catch (throwable: Throwable) {
            Log.d(TAG, "uBlock background prewarm unavailable", throwable)
            closeSession()
        }
    }

    companion object {
        private const val TAG = "SandfoxUBlockPrewarm"
        private const val UBLOCK_ORIGIN_ID = "uBlock0@raymondhill.net"
        private const val UBLOCK_NAME = "uBlock Origin"
        private const val UBlockPrewarmTimeoutMs = 8_000L
    }
}
