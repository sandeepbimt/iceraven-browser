/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components

import android.net.Uri
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.engine.EngineSession
import mozilla.components.support.base.feature.LifecycleAwareFeature

/**
 * Applies Sandfox's reader-style typography directly from the browser layer.
 *
 * This is deliberately not a WebExtension. The browser asks the existing
 * EngineSession to execute a javascript: URL after the page load completes.
 * The page remains in its normal Gecko document; no extension is installed,
 * registered, or kept alive.
 */
class ReaderTypographyFeature(
    private val store: BrowserStore,
) : LifecycleAwareFeature {
    private val observedSessions = mutableMapOf<String, ObservedSession>()
    private var subscription: BrowserStore.Subscription<*, *>? = null

    override fun start() {
        if (subscription != null) return

        subscription =
            store.observeManually { state ->
                syncSessions(state.tabs.associate { it.id to it.engineState.engineSession })
            }.also {
                it.resume()
            }
    }

    override fun stop() {
        subscription?.unsubscribe()
        subscription = null

        observedSessions.values.forEach { observed ->
            observed.session.unregister(observed.observer)
        }
        observedSessions.clear()
    }

    private fun syncSessions(sessions: Map<String, EngineSession?>) {
        observedSessions.entries.toList().forEach { (tabId, observed) ->
            if (sessions[tabId] !== observed.session) {
                observed.session.unregister(observed.observer)
                observedSessions.remove(tabId)
            }
        }

        sessions.forEach { (tabId, session) ->
            if (session == null || observedSessions.containsKey(tabId)) return@forEach

            val observer =
                object : EngineSession.Observer {
                    private var loading = false
                    private var currentUrl: String? = null

                    override fun onLocationChange(url: String) {
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

                        session.loadUrl(
                            url = javascriptUrl(),
                            flags = EngineSession.LoadUrlFlags.select(
                                EngineSession.LoadUrlFlags.ALLOW_JAVASCRIPT_URL,
                            ),
                        )
                    }
                }

            session.register(observer)
            observedSessions[tabId] = ObservedSession(session, observer)
        }
    }

    private data class ObservedSession(
        val session: EngineSession,
        val observer: EngineSession.Observer,
    )

    companion object {
        private const val SCRIPT = """
(function () {
    'use strict';

    const STYLE_ID = 'sandfox-reader-typography-v1';
    const CLASS_NAME = 'sandfox-reader-paragraph';

    const CSS = `
        .${'$'}{CLASS_NAME} {
            font-size: clamp(
                0.97rem,
                4vw,
                1.06rem
            ) !important;

            line-height: 1.58 !important;
            text-align: justify !important;
            text-wrap: pretty !important;
            hyphens: auto !important;
            -webkit-hyphens: auto !important;
            word-spacing: normal !important;
            letter-spacing: normal !important;
        }

        .${'$'}{CLASS_NAME} {
            text-wrap: pretty;
        }
    `;

    const EXCLUDED = [
        'nav',
        'header',
        'footer',
        'aside',
        'form',
        'button',
        'textarea',
        'input',
        'select',
        'figure',
        '[role="navigation"]',
        '[role="button"]',
        '[contenteditable="true"]',
        '[aria-hidden="true"]',
        '.comments',
        '#comments'
    ].join(',');

    function validParagraph(p) {
        if (!p || p.closest(EXCLUDED)) return false;

        const text = (p.innerText || '').trim();
        if (text.length < 80) return false;

        const rect = p.getBoundingClientRect();

        return rect.width >= 280 && rect.height >= 10;
    }

    function findArticle() {
        const paragraphs = [
            ...document.querySelectorAll('p')
        ].filter(validParagraph);

        if (paragraphs.length < 3) return null;

        const candidates = new Map();

        for (const p of paragraphs) {
            let el = p.parentElement;

            for (let i = 0; i < 7 && el; i++) {
                candidates.set(
                    el,
                    (candidates.get(el) || 0) + 1
                );

                el = el.parentElement;
            }
        }

        let best = null;
        let bestScore = -Infinity;

        for (const [el, count] of candidates) {
            if (count < 3) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width < 280) continue;

            const widthPenalty =
                Math.abs(Math.min(rect.width, 850) - 650);

            const score =
                count * 1000 - widthPenalty;

            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }

        return best;
    }

    function injectCSS() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;

        (document.head || document.documentElement).appendChild(style);
    }

    function apply(container) {
        if (!container) return;

        injectCSS();

        container
            .querySelectorAll('p')
            .forEach(p => {
                if (validParagraph(p)) {
                    p.classList.add(CLASS_NAME);
                }
            });
    }

    let articleFound = false;
    let observer = null;
    let attempts = 0;

    function detect() {
        if (articleFound) return;

        const article = findArticle();
        if (!article) return;

        apply(article);
        articleFound = true;

        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    detect();

    if (!articleFound) {
        observer = new MutationObserver(() => {
            attempts++;
            detect();

            if (attempts >= 25 && observer) {
                observer.disconnect();
                observer = null;
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }, 10000);
    }
})();
"""

        private fun javascriptUrl(): String =
            "javascript:(function(){" +
                "try{" +
                Uri.encode(SCRIPT) +
                "}catch(e){}})()"
    }
}
