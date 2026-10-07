/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.customtabs

import android.app.assist.AssistContent
import android.os.Bundle
import android.view.MotionEvent
import android.view.ViewGroup
import androidx.annotation.VisibleForTesting
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import mozilla.components.browser.state.selector.findCustomTab
import mozilla.components.browser.state.state.SessionState
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.engine.utils.ABOUT_HOME_URL
import mozilla.components.support.utils.OnEnterAnimationCompleteListener
import mozilla.components.support.utils.SafeIntent
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.debug.IceravenDebugTrace
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.ext.getIntentSessionId

const val EXTRA_IS_SANDBOX_CUSTOM_TAB = "org.mozilla.fenix.customtabs.EXTRA_IS_SANDBOX_CUSTOM_TAB"

/**
 * Activity that holds the [ExternalAppBrowserFragment] that is launched within an external app, such as custom tabs and
 * progressive web apps.
 */
@Suppress("TooManyFunctions")
open class ExternalAppBrowserActivity : HomeActivity() {
    private var isFinishedAnimating = false
    private var pwaLaunchSplash: PwaLaunchSplashView? = null

    internal fun hidePwaLaunchSplash() {
        val splash = pwaLaunchSplash ?: return
        (splash.parent as? ViewGroup)?.removeView(splash)
        if (pwaLaunchSplash === splash) pwaLaunchSplash = null
    }

    internal fun showPwaLaunchSplashIfNeeded() {
        val session = getExternalTab() as? mozilla.components.browser.state.state.CustomTabSessionState ?: return
        if (session.config.externalAppType != mozilla.components.browser.state.state.ExternalAppType.PROGRESSIVE_WEB_APP) return
        if (pwaLaunchSplash != null) return

        val root = findViewById<ViewGroup>(android.R.id.content) ?: return
        val splash = PwaLaunchSplashView(this)
        pwaLaunchSplash = splash
        root.addView(splash, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        val url = session.content.url
        lifecycleScope.launch(Dispatchers.IO) {
            val bitmap = PwaLaunchSplashView.loadIcon(applicationContext, url)
            withContext(Dispatchers.Main) {
                if (pwaLaunchSplash === splash && !isFinishing && !isDestroyed) {
                    splash.setIcon(bitmap)
                } else {
                    bitmap?.takeIf { !it.isRecycled }?.recycle()
                }
            }
        }
    }


    override fun onResume() {
        super.onResume()

        IceravenDebugTrace.log(
            "PWA_ACTIVITY_RESUME",
            "sessionId" to getExternalTabId(),
            "hasExternalTab" to hasExternalTab(),
            "intentFlags" to intent.flags,
            "isFinishing" to isFinishing,
        )

        if (!hasExternalTab()) {
            // An ExternalAppBrowserActivity is always bound to a specific tab. If this tab doesn't
            // exist anymore on resume then this activity has nothing to display anymore. Let's just
            // finish it AND remove this task to avoid it hanging around in the recent apps screen.
            // Without this the parent HomeActivity class may decide to show the browser UI and we
            // end up with multiple browsers (causing "display already acquired" crashes).
            IceravenDebugTrace.log(
                "PWA_ACTIVITY_FINISH_NO_TAB",
                "sessionId" to getExternalTabId(),
            )
            finishAndRemoveTask()
            return
        }
    }

    override fun onDestroy() {
        pwaLaunchSplash?.let { splash ->
            (splash.parent as? ViewGroup)?.removeView(splash)
        }
        pwaLaunchSplash = null

        IceravenDebugTrace.log(
            "PWA_ACTIVITY_DESTROY_ENTER",
            "sessionId" to getExternalTabId(),
            "isFinishing" to isFinishing,
            "hasExternalTab" to hasExternalTab(),
        )
        super.onDestroy()

        if (isFinishing) {
            // When this activity finishes, the process is staying around and the session still
            // exists then remove it now to free all its resources. Once this activity is finished
            // then there's no way to get back to it other than relaunching it.
            val tabId = getExternalTabId()
            val customTab = tabId?.let { components.core.store.state.findCustomTab(it) }
            if (tabId != null && customTab != null) {
                IceravenDebugTrace.log(
                    "PWA_SESSION_REMOVE",
                    "sessionId" to tabId,
                    "url" to customTab.content.url,
                    "engineSessionPresent" to (customTab.engineState.engineSession != null),
                )
                components.useCases.customTabsUseCases.remove(tabId)
            }
        }
    }

    /**
     * [ExternalAppBrowserActivity], which is responsible for custom tabs, shares the [BrowserStore] and observing
     * [AboutHomeBinding] would navigate the custom tab to the homepage when the selected tab's URL is [ABOUT_HOME_URL],
     * so this is intentionally a no-op.
     */
    @VisibleForTesting override fun addAboutHomeBinding(lifecycle: Lifecycle) = Unit

    @VisibleForTesting override fun addHomepageTabBinding(lifecycle: Lifecycle) = Unit

    @VisibleForTesting(otherwise = VisibleForTesting.PRIVATE)
    internal fun hasExternalTab(): Boolean {
        return getExternalTab() != null
    }

    @VisibleForTesting(otherwise = VisibleForTesting.PRIVATE)
    internal fun getExternalTab(): SessionState? {
        val id = getExternalTabId() ?: return null
        return components.core.store.state.findCustomTab(id)
    }

    @VisibleForTesting(otherwise = VisibleForTesting.PRIVATE)
    internal fun getExternalTabId(): String? {
        return getIntentSessionId(SafeIntent(intent))
    }

    override fun onProvideAssistContent(outContent: AssistContent?) {
        super.onProvideAssistContent(outContent)
        val currentTabUrl = getExternalTab()?.content?.url
        outContent?.webUri = currentTabUrl?.let { it.toUri() }
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        isFinishedAnimating = true
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        if (!isFinishedAnimating) {
            return true
        }

        return super.dispatchTouchEvent(ev)
    }

    override fun onEnterAnimationComplete() {
        super.onEnterAnimationComplete()
        isFinishedAnimating = true

        val fragments = supportFragmentManager.fragments.toMutableList()
        while (fragments.isNotEmpty()) {
            val fragment = fragments.removeAt(0)
            if (fragment is OnEnterAnimationCompleteListener) {
                fragment.onEnterAnimationComplete()
            }
            fragments.addAll(fragment.childFragmentManager.fragments)
        }
    }
}
