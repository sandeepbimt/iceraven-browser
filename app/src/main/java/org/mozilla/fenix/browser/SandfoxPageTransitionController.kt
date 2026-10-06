/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.browser

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.graphics.Bitmap
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import androidx.lifecycle.LifecycleOwner
import mozilla.components.concept.engine.EngineView
import mozilla.components.concept.engine.EngineSession

/**
 * Readiness-gated page handoff inspired by Chromium's Android navigation blur transition.
 *
 * Navigation is first identified and the outgoing surface is prepared without immediately
 * covering the live page. The cover is shown only after a real loading edge is observed.
 * The destination remains underneath until first contentful paint, then the cover is removed
 * with a short cross-fade. A bounded safety timeout always restores the live Gecko view.
 *
 * Fresh PWA launches use the same reveal mechanism without an outgoing-page screenshot:
 * the live Gecko surface is blurred immediately and is revealed at first contentful paint.
 */
internal class SandfoxPageTransitionController(
    private val container: ViewGroup,
    private val engineView: EngineView,
    private val lifecycleOwner: LifecycleOwner,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    private var session: EngineSession? = null
    private var transitionView: ImageView? = null
    private var transitionAnimator: ValueAnimator? = null

    private var generation = 0L
    private var lastLoading = false

    private var navigationCandidate = false
    private var loadingConfirmed = false
    private var readyForReveal = false
    private var pendingBitmap: Bitmap? = null

    private var directBlurTransition = false
    private var safetyTimeout: Runnable? = null

    private val observer = object : EngineSession.Observer {
        override fun onLoadRequest(
            url: String,
            triggeredByRedirect: Boolean,
            triggeredByWebContent: Boolean,
        ) {
            if (!triggeredByWebContent || triggeredByRedirect || directBlurTransition) return

            // A web-content load request is already a navigation request. Arm immediately so the
            // visual handoff begins at the user's link action rather than waiting for a later
            // loading-state callback.
            beginNavigationCandidate(immediateVisual = true)
        }

        override fun onNavigateBack() {
            // History navigation is initiated explicitly by BaseBrowserFragment. Do not start a
            // transition from this observer callback because it can arrive after Gecko has
            // already changed the rendered surface.
        }

        override fun onLoadingStateChange(loading: Boolean) {
            if (loading && !lastLoading && navigationCandidate) {
                loadingConfirmed = true
                showPreparedCoverIfReady()
            }
            lastLoading = loading
        }

        override fun onFirstContentfulPaint() {
            if (directBlurTransition) {
                readyForReveal = true
                revealDirectBlur(generation)
                return
            }

            if (!navigationCandidate) return

            readyForReveal = true

            // If the destination reached FCP before the screenshot cover was ready, do not
            // introduce a late blur. The page is already usable, so simply abandon the
            // transition candidate.
            transitionView?.let { image ->
                if (transitionAnimator == null) {
                    revealLivePage(image, generation)
                }
            } ?: finishWithoutTransition()
        }

        override fun onPaintStatusReset() {
            // Paint resets can occur while a valid navigation is still loading. They must not
            // cancel a live transition and leave the user behind a frozen screenshot.
            if (!navigationCandidate && !directBlurTransition) {
                restoreLiveView()
            }
        }
    }

    fun bind(session: EngineSession?) {
        if (this.session === session) return

        cancelTransition()
        this.session?.unregister(observer)
        this.session = session

        generation++
        lastLoading = false
        navigationCandidate = false
        loadingConfirmed = false
        readyForReveal = false
        pendingBitmap = null

        session?.register(observer, lifecycleOwner, autoPause = false)
    }

    /**
     * Arms a navigation transition before a browser-initiated Back/Forward action.
     *
     * The screenshot is captured now, but it is not shown until Gecko confirms an actual
     * loading edge. This preserves the old page without interfering with same-document or
     * instant history/BFCache restores.
     */
    fun prepareNavigationTransition() {
        if (session == null || directBlurTransition) return

        beginNavigationCandidate(immediateVisual = true)
    }

    /**
     * Starts the fresh-launch transition used by standalone PWAs.
     *
     * There is no previous page to capture. The live Gecko surface is covered by a light blur
     * immediately, then revealed when FCP arrives. The timeout is only a safety escape.
     */
    fun startPwaLaunchTransition() {
        if (session == null) return

        generation++
        clearVisualTransition()

        navigationCandidate = false
        loadingConfirmed = false
        readyForReveal = false
        pendingBitmap = null
        directBlurTransition = true

        val liveView = engineView.asView()
        liveView.alpha = 1f
        liveView.scaleX = PWA_START_SCALE
        liveView.scaleY = PWA_START_SCALE
        applyBlur(liveView, MAX_BLUR_RADIUS)

        scheduleSafetyTimeout(generation, PWA_SAFETY_TIMEOUT_MS)
    }

    /**
     * Cancels an armed navigation candidate when the browser action did not actually navigate.
     */
    fun cancelNavigationTransition() {
        if (!navigationCandidate || transitionView != null || directBlurTransition) return

        generation++
        navigationCandidate = false
        loadingConfirmed = false
        readyForReveal = false
        pendingBitmap = null
        cancelSafetyTimeout()
    }

    private fun beginNavigationCandidate(immediateVisual: Boolean) {
        if (session == null || navigationCandidate || directBlurTransition) return

        generation++
        clearVisualTransition()

        navigationCandidate = true
        loadingConfirmed = false
        readyForReveal = false
        pendingBitmap = null

        if (immediateVisual) {
            val liveView = engineView.asView()
            liveView.alpha = 1f
            liveView.scaleX = NAVIGATION_START_SCALE
            liveView.scaleY = NAVIGATION_START_SCALE
            applyBlur(liveView, MAX_BLUR_RADIUS)
        }

        val currentGeneration = generation
        captureCurrentPage(currentGeneration)

        // A candidate that never becomes a real loading edge must expire quickly. This is the
        // main guard against blur being triggered later by an unrelated page event.
        scheduleSafetyTimeout(currentGeneration, CANDIDATE_TIMEOUT_MS)
    }

    private fun captureCurrentPage(currentGeneration: Long) {
        engineView.captureThumbnail { bitmap ->
            if (currentGeneration != generation || !navigationCandidate) return@captureThumbnail

            container.post {
                if (currentGeneration != generation || !navigationCandidate) return@post

                pendingBitmap = bitmap

                if (navigationCandidate && !readyForReveal) {
                    showPreparedCoverIfReady()
                }
            }
        }
    }

    private fun showPreparedCoverIfReady() {
        val bitmap = pendingBitmap ?: return
        if (
            !navigationCandidate ||
            readyForReveal ||
            transitionView != null
        ) {
            return
        }

        cancelSafetyTimeout()

        val currentGeneration = generation
        val image = ImageView(container.context).apply {
            setImageBitmap(bitmap)
            scaleType = ImageView.ScaleType.FIT_XY
            alpha = 1f
            scaleX = NAVIGATION_START_SCALE
            scaleY = NAVIGATION_START_SCALE
        }

        val liveView = engineView.asView()
        liveView.alpha = 0f
        clearEngineEffect()

        container.addView(
            image,
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        transitionView = image

        runOutgoingSettle(image, currentGeneration)
        scheduleSafetyTimeout(currentGeneration, NAVIGATION_SAFETY_TIMEOUT_MS)
    }

    private fun runOutgoingSettle(image: ImageView, transitionGeneration: Long) {
        val animator =
            ValueAnimator.ofFloat(0f, MAX_BLUR_RADIUS).apply {
                duration = OUTGOING_DURATION_MS
                interpolator = DecelerateInterpolator()
                addUpdateListener { value ->
                    if (transitionGeneration != generation) return@addUpdateListener

                    val radius = value.animatedValue as Float
                    applyBlur(image, radius)

                    val progress = radius / MAX_BLUR_RADIUS
                    val scale =
                        NAVIGATION_START_SCALE -
                            ((NAVIGATION_START_SCALE - HOLD_SCALE) * progress)
                    image.scaleX = scale
                    image.scaleY = scale
                }
                addListener(
                    object : AnimatorListenerAdapter() {
                        override fun onAnimationEnd(animation: Animator) {
                            if (transitionAnimator === animation) {
                                transitionAnimator = null
                            }

                            if (transitionGeneration == generation && readyForReveal) {
                                revealLivePage(image, transitionGeneration)
                            }
                        }
                    },
                )
            }

        transitionAnimator = animator
        animator.start()
    }

    private fun revealLivePage(image: ImageView, transitionGeneration: Long) {
        if (
            transitionGeneration != generation ||
            !navigationCandidate ||
            transitionView !== image ||
            !readyForReveal
        ) {
            return
        }

        cancelSafetyTimeout()

        val liveView = engineView.asView()
        liveView.alpha = 1f
        liveView.scaleX = HOLD_SCALE
        liveView.scaleY = HOLD_SCALE
        applyBlur(liveView, MAX_BLUR_RADIUS)

        val animator =
            ValueAnimator.ofFloat(1f, 0f).apply {
                duration = INCOMING_DURATION_MS
                interpolator = DecelerateInterpolator()
                addUpdateListener { value ->
                    if (transitionGeneration != generation) return@addUpdateListener

                    val alpha = value.animatedValue as Float
                    image.alpha = alpha

                    val radius = MAX_BLUR_RADIUS * alpha
                    applyBlur(image, radius)
                    applyBlur(liveView, radius)

                    val scale = 1f - ((1f - HOLD_SCALE) * alpha)
                    image.scaleX = scale
                    image.scaleY = scale
                    liveView.scaleX = scale
                    liveView.scaleY = scale
                }
                addListener(
                    object : AnimatorListenerAdapter() {
                        override fun onAnimationEnd(animation: Animator) {
                            if (transitionAnimator === animation) {
                                transitionAnimator = null
                            }

                            if (transitionGeneration == generation) {
                                navigationCandidate = false
                                loadingConfirmed = false
                                readyForReveal = false
                                pendingBitmap = null
                                restoreLiveView()
                                removeTransitionView()
                            }
                        }
                    },
                )
            }

        transitionAnimator = animator
        animator.start()
    }

    private fun revealDirectBlur(transitionGeneration: Long) {
        if (
            !directBlurTransition ||
            transitionGeneration != generation ||
            !readyForReveal
        ) {
            return
        }

        cancelSafetyTimeout()

        val liveView = engineView.asView()

        val animator =
            ValueAnimator.ofFloat(MAX_BLUR_RADIUS, 0f).apply {
                duration = INCOMING_DURATION_MS
                interpolator = DecelerateInterpolator()
                addUpdateListener { value ->
                    if (transitionGeneration != generation) return@addUpdateListener

                    val radius = value.animatedValue as Float
                    applyBlur(liveView, radius)

                    val scale =
                        1f +
                            ((PWA_START_SCALE - 1f) * (radius / MAX_BLUR_RADIUS))
                    liveView.scaleX = scale
                    liveView.scaleY = scale
                }
                addListener(
                    object : AnimatorListenerAdapter() {
                        override fun onAnimationEnd(animation: Animator) {
                            if (transitionAnimator === animation) {
                                transitionAnimator = null
                            }

                            if (transitionGeneration == generation) {
                                directBlurTransition = false
                                restoreLiveView()
                            }
                        }
                    },
                )
            }

        transitionAnimator = animator
        animator.start()
    }

    private fun finishWithoutTransition() {
        generation++
        navigationCandidate = false
        loadingConfirmed = false
        readyForReveal = false
        pendingBitmap = null
        cancelSafetyTimeout()
        clearVisualTransition()
    }

    private fun scheduleSafetyTimeout(
        transitionGeneration: Long,
        delayMs: Long,
    ) {
        cancelSafetyTimeout()

        val timeout =
            Runnable {
                if (transitionGeneration != generation) return@Runnable

                // Safety always wins over visual continuity: never leave a stale blurred page
                // covering Gecko indefinitely.
                navigationCandidate = false
                loadingConfirmed = false
                readyForReveal = false
                pendingBitmap = null
                directBlurTransition = false
                transitionAnimator?.cancel()
                transitionAnimator = null
                restoreLiveView()
                removeTransitionView()
            }

        safetyTimeout = timeout
        mainHandler.postDelayed(timeout, delayMs)
    }

    private fun cancelSafetyTimeout() {
        safetyTimeout?.let(mainHandler::removeCallbacks)
        safetyTimeout = null
    }

    private fun clearVisualTransition() {
        transitionAnimator?.cancel()
        transitionAnimator = null
        cancelSafetyTimeout()
        removeTransitionView()
        restoreLiveView()
        directBlurTransition = false
    }

    private fun restoreLiveView() {
        val liveView = engineView.asView()
        liveView.alpha = 1f
        liveView.scaleX = 1f
        liveView.scaleY = 1f
        clearEngineEffect()
    }

    private fun removeTransitionView() {
        val view = transitionView ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            view.setRenderEffect(null)
        }
        view.setImageDrawable(null)
        (view.parent as? ViewGroup)?.removeView(view)
        transitionView = null
    }

    private fun applyBlur(view: android.view.View, radius: Float) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            view.setRenderEffect(
                RenderEffect.createBlurEffect(
                    radius,
                    radius,
                    Shader.TileMode.CLAMP,
                ),
            )
        }
    }

    private fun clearEngineEffect() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            engineView.asView().setRenderEffect(null)
        }
    }

    private fun cancelTransition() {
        generation++
        navigationCandidate = false
        loadingConfirmed = false
        readyForReveal = false
        pendingBitmap = null
        clearVisualTransition()
        restoreLiveView()
    }

    fun destroy() {
        cancelTransition()
        session?.unregister(observer)
        session = null
    }

    private companion object {
        // Chromium's refined Android blur transition uses a short hold/fade model. SANDFOX keeps
        // the visual effect lighter and uses readiness rather than a fixed-duration reveal.
        const val OUTGOING_DURATION_MS = 100L
        const val INCOMING_DURATION_MS = 150L
        const val MAX_BLUR_RADIUS = 5f

        const val NAVIGATION_START_SCALE = 1.008f
        const val PWA_START_SCALE = 1.006f
        const val HOLD_SCALE = 0.999f

        const val CANDIDATE_TIMEOUT_MS = 900L
        const val NAVIGATION_SAFETY_TIMEOUT_MS = 2500L
        const val PWA_SAFETY_TIMEOUT_MS = 4000L
    }
}
