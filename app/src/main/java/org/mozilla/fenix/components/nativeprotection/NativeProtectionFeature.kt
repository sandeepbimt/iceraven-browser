/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.content.Context
import android.net.Uri
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.engine.EngineSession
import mozilla.components.lib.state.Store
import mozilla.components.support.base.feature.LifecycleAwareFeature

/**
 * Applies V2 cosmetic filtering from the browser layer. No WebExtension is
 * installed or registered. Network filtering is attached through AppRequestInterceptor.
 */
class NativeProtectionFeature(
    private val store: BrowserStore,
    context: Context,
) : LifecycleAwareFeature {
    private val engine = NativeProtectionEngine.get(context)
    private var subscription: Store.Subscription<*, *>? = null
    private val observedSessions = mutableMapOf<String, ObservedSession>()

    override fun start() {
        if (subscription != null) return
        subscription = store.observeManually { state ->
            syncSessions(state.tabs.associate { it.id to it.engineState.engineSession })
        }.also { it.resume() }
    }

    override fun stop() {
        subscription?.unsubscribe()
        subscription = null
        observedSessions.values.forEach { it.session.unregister(it.observer) }
        observedSessions.clear()
    }

    private fun syncSessions(sessions: Map<String, EngineSession?>) {
        observedSessions.entries.toList().forEach { (id, observed) ->
            if (sessions[id] !== observed.session) {
                observed.session.unregister(observed.observer)
                observedSessions.remove(id)
            }
        }
        sessions.forEach { (id, session) ->
            if (session == null || observedSessions.containsKey(id)) return@forEach
            val observer = object : EngineSession.Observer {
                private var loading = false
                private var currentUrl: String? = null

                override fun onLocationChange(url: String, hasUserGesture: Boolean) {
                    currentUrl = url
                }

                override fun onLoadingStateChange(loading: Boolean) {
                    if (loading) {
                        this.loading = true
                        return
                    }
                    if (!this.loading) return
                    this.loading = false

                    val url = currentUrl ?: return
                    if (!url.startsWith("http://") && !url.startsWith("https://")) return
                    val host = Uri.parse(url).host ?: return
                    val css = engine.cosmeticCss(host) ?: return
                    val js =
                        "javascript:(function(){try{" +
                            "var s=document.getElementById('sandfox-native-protection-v2');" +
                            "if(!s){s=document.createElement('style');s.id='sandfox-native-protection-v2';" +
                            "(document.head||document.documentElement).appendChild(s);}" +
                            "s.textContent=" + org.json.JSONObject.quote(css) +
                            ";}catch(e){}})()"
                    session.loadUrl(
                        js,
                        flags = EngineSession.LoadUrlFlags.select(
                            EngineSession.LoadUrlFlags.ALLOW_JAVASCRIPT_URL,
                        ),
                    )
                }
            }
            session.register(observer)
            observedSessions[id] = ObservedSession(session, observer)
        }
    }

    private data class ObservedSession(
        val session: EngineSession,
        val observer: EngineSession.Observer,
    )
}
