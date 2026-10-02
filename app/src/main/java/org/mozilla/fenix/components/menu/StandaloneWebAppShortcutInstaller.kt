/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.menu

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import java.security.MessageDigest
import mozilla.components.browser.state.state.SessionState
import org.mozilla.fenix.IntentReceiverActivity
import org.mozilla.fenix.R
import org.mozilla.fenix.customtabs.FennecWebAppIntentProcessor

/**
 * Creates launcher shortcuts which reopen a URL through Iceraven's existing Fennec web-app
 * intent pipeline, without requiring a web-app manifest.
 */
internal object StandaloneWebAppShortcutInstaller {
    private const val SHORTCUT_ID_PREFIX = "iceraven-webapp-"
    private const val MAX_LABEL_LENGTH = 25

    fun requestPinShortcut(
        context: Context,
        session: SessionState,
        customIconUri: Uri? = null,
    ) {
        val url = session.content.url
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return
        }

        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) {
            return
        }

        if (customIconUri != null) {
            StandaloneWebAppIconStore.save(context, url, customIconUri)
        }

        val uri = Uri.parse(url)
        val label =
            session.content.title
                .trim()
                .takeIf { it.isNotEmpty() }
                ?.take(MAX_LABEL_LENGTH)
                ?: uri.host?.take(MAX_LABEL_LENGTH)
                ?: context.getString(R.string.app_name)

        val launchIntent =
            Intent(context, IntentReceiverActivity::class.java).apply {
                action = FennecWebAppIntentProcessor.ACTION_FENNEC_WEBAPP
                data = uri
                putExtra(FennecWebAppIntentProcessor.EXTRA_SANDFOX_STANDALONE, true)
                // The receiver is transient. The PWA processor adds NEW_DOCUMENT to the actual
                // ExternalAppBrowserActivity launch so this shortcut does not create an intermediate task.
            }

        val shortcut =
            ShortcutInfoCompat.Builder(context, shortcutId(url))
                .setShortLabel(label)
                .setLongLabel(label)
                .setIcon(
                    StandaloneWebAppIconStore.get(context, url)
                        ?.let { BitmapFactory.decodeFile(it.absolutePath) }
                        ?.let { IconCompat.createWithBitmap(it) }
                        ?: IconCompat.createWithResource(context, R.mipmap.ic_launcher)
                )
                .setIntent(launchIntent)
                .build()

        ShortcutManagerCompat.requestPinShortcut(context, shortcut, null)
    }

    private fun shortcutId(url: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
        val hash = digest.joinToString("") { "%02x".format(it) }.take(24)
        return SHORTCUT_ID_PREFIX + hash
    }
}
