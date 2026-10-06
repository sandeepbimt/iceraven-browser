/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.browser

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import androidx.lifecycle.LifecycleOwner
import mozilla.components.concept.engine.EngineView
import mozilla.components.concept.engine.EngineSession

/**
 * Destination-first page transition engine.
 *
 * The live Gecko surface is never blurred or hidden speculatively. During a navigation the
 * current page is therefore allowed to remain normal while Gecko loads the destination.
 *
 * Once the destination has meaningful content and is sufficiently far through loading, SANDFOX
 * captures the destination frame, places that bitmap above Gecko, and reveals it by removing the
 * blur. This makes the blur describe "the page that is loading" instead of blurring the page
 * the user just left.
 *
 * The same destination overlay is used for normal links, address-bar loads, Back/Forward and
 * standalone PWA launches. It is deliberately an Android ImageView overlay so it also works
 * with GeckoView's normal SurfaceView-backed rendering without changing the Gecko surface type.
 */
internal class SandfoxPageTransitionController(
    private val container: ViewGroup,
    private val engineView: EngineView,
    private val lifecycleOwner: LifecycleOwner,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    private var session: EngineSession? = null
    private var transitionView: ImageView? = null
    private var sourceHandoffView: ImageView? = null
    private var pwaSplashView: ImageView? = null
    private var transitionAnimator: ValueAnimator? = null

    private var generation = 0L
    private var lastLoading = false
    private var loadProgress = 0
    private var firstPaintSeen = false

    private var navigationCandidate = false
    private var directPwaTransition = false
    private var revealStarted = false
    private var firstFrameCapturePending = false
    private var firstFrameShown = false
    private var firstFrameShownAt = 0L
    private var sourceHandoffPending = false
    private var preserveCandidateOnNextBind = false
    private var safetyTimeout: Runnable? = null

    private val observer = object : EngineSession.Observer {
        override fun onLoadRequest(
            url: String,
            triggeredByRedirect: Boolean,
            triggeredByWebContent: Boolean,
        ) {
            if (!triggeredByWebContent || triggeredByRedirect || directPwaTransition) return

            beginNavigationCandidate(hasPreviousPage = true, preserveAcrossTabSwitch = false)
        }

        override fun onNavigateBack() {
            // Back/Forward is armed explicitly by BaseBrowserFragment before the history action.
            // Do not start a second transition here.
        }

        override fun onProgress(progress: Int) {
            if (!navigationCandidate && !directPwaTransition) return

            loadProgress = progress.coerceIn(0, 100)
            maybeStartDestinationCover()
            maybeRevealDestination()
        }

        override fun onLoadingStateChange(loading: Boolean) {
            lastLoading = loading

            if (!navigationCandidate && !directPwaTransition) return

            maybeStartDestinationCover()
            maybeRevealDestination()
        }

        override fun onFirstContentfulPaint() {
            firstPaintSeen = true
            maybeStartDestinationCover()
            maybeRevealDestination()
        }

        override fun onPaintStatusReset() {
            // A paint reset can happen during a valid navigation. Keep the state machine alive;
            // the destination progress/FCP events decide when it is safe to reveal.
        }
    }

    fun bind(session: EngineSession?) {
        if (this.session === session) return

        if (navigationCandidate && preserveCandidateOnNextBind) {
            this.session?.unregister(observer)
            this.session = session
            preserveCandidateOnNextBind = false
            session?.register(observer, lifecycleOwner, autoPause = false)
            return
        }

        cancelTransition()
        this.session?.unregister(observer)
        this.session = session

        generation++
        resetNavigationState()

        session?.register(observer, lifecycleOwner, autoPause = false)
    }

    /**
     * Arms a destination transition before browser-initiated Back/Forward.
     *
     * No visual mutation happens here. This is intentionally cheap so cached history restores
     * can leave the old page immediately and only animate the destination frame.
     */
    fun prepareNavigationTransition(
        hasPreviousPage: Boolean = true,
        preserveAcrossTabSwitch: Boolean = false,
    ) {
        if (session == null || directPwaTransition) return
        beginNavigationCandidate(hasPreviousPage, preserveAcrossTabSwitch)
    }

    /**
     * Starts the standalone PWA transition. There is no outgoing page to animate; the first
     * meaningful PWA frame is shown blurred and then revealed.
     *
     * We never apply RenderEffect to the live Gecko surface because GeckoView normally uses a
     * SurfaceView-backed renderer. The transition is therefore entirely overlay-based.
     */
    fun startPwaLaunchTransition(splashColor: Int? = null) {
        if (session == null) return

        generation++
        clearVisualTransition()

        resetNavigationState()
        directPwaTransition = true
        showPwaSplash(splashColor)

        val currentGeneration = generation
        scheduleSafetyTimeout(currentGeneration, PWA_SAFETY_TIMEOUT_MS)

        // If the PWA is already visually ready when this hook runs, give the observer a short
        // window to deliver FCP/progress. This does not force a blank screenshot onto the user.
        mainHandler.postDelayed(
            {
                if (currentGeneration == generation && directPwaTransition && !revealStarted) {
                    maybeStartDestinationCover()
                    maybeRevealDestination()
                }
            },
            PWA_LATE_READY_CHECK_MS,
        )
    }

    /**
     * Cancels an armed navigation candidate when the browser action did not navigate.
     */
    fun cancelNavigationTransition() {
        if (!navigationCandidate || directPwaTransition) return

        generation++
        resetNavigationState()
        cancelSafetyTimeout()
        removeTransitionView()
    }

    private fun beginNavigationCandidate(
        hasPreviousPage: Boolean,
        preserveAcrossTabSwitch: Boolean,
    ) {
        if (session == null || navigationCandidate || directPwaTransition) return

        generation++
        clearVisualTransition()
        resetNavigationState()
        navigationCandidate = true
        preserveCandidateOnNextBind = preserveAcrossTabSwitch

        if (hasPreviousPage) {
            sourceHandoffPending = true
            captureSourceHandoff(generation)
        }

        val currentGeneration = generation
        scheduleSafetyTimeout(currentGeneration, NAVIGATION_SAFETY_TIMEOUT_MS)
    }

    /**
     * FCP is the start of the visual transition, not its end. GeckoView explicitly notes that
     * FCP can be as little as the page background, so we capture that first visible frame and
     * keep it blurred while the destination continues rendering. Only after the visible load is
     * sufficiently complete do we capture the final frame and run the blur-out animation.
     */
    private fun captureSourceHandoff(transitionGeneration: Long) {
        engineView.captureThumbnail { bitmap ->
            if (transitionGeneration != generation) return@captureThumbnail
            container.post {
                if (transitionGeneration != generation || !navigationCandidate || !sourceHandoffPending) return@post
                sourceHandoffPending = false
                if (bitmap != null) showSourceHandoff(bitmap, transitionGeneration)
            }
        }
    }

    private fun showSourceHandoff(bitmap: Bitmap, transitionGeneration: Long) {
        sourceHandoffView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        val image = ImageView(container.context).apply {
            setImageBitmap(bitmap)
            scaleType = ImageView.ScaleType.FIT_XY
            alpha = 1f
        }
        container.addView(image, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        sourceHandoffView = image
        image.animate().alpha(0f).setDuration(SOURCE_HANDOFF_DURATION_MS)
            .setInterpolator(DecelerateInterpolator()).withEndAction {
                if (transitionGeneration == generation) {
                    sourceHandoffView = null
                    (image.parent as? ViewGroup)?.removeView(image)
                    image.setImageDrawable(null)
                }
            }.start()
    }

    private fun showPwaSplash(splashColor: Int?) {
        val image = ImageView(container.context).apply {
            setBackgroundColor(splashColor ?: Color.rgb(32, 32, 32))
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            alpha = 1f
        }
        container.addView(image, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        pwaSplashView = image
        applyBlur(image, PWA_SPLASH_BLUR)
    }

    private fun dismissPwaSplash() {
        val splash = pwaSplashView ?: return
        splash.animate().alpha(0f).setDuration(PWA_SPLASH_TO_PAGE_MS)
            .setInterpolator(DecelerateInterpolator()).withEndAction {
                if (pwaSplashView === splash) {
                    pwaSplashView = null
                    (splash.parent as? ViewGroup)?.removeView(splash)
                }
            }.start()
    }

    private fun maybeStartDestinationCover() {
        if (
            firstFrameShown ||
            firstFrameCapturePending ||
            !firstPaintSeen ||
            (!navigationCandidate && !directPwaTransition)
        ) {
            return
        }

        firstFrameCapturePending = true
        val transitionGeneration = generation

        engineView.captureThumbnail { bitmap ->
            if (transitionGeneration != generation) return@captureThumbnail

            container.post {
                if (
                    transitionGeneration != generation ||
                    (!navigationCandidate && !directPwaTransition)
                ) {
                    return@post
                }

                firstFrameCapturePending = false
                if (bitmap == null) return@post

                showBlurredDestinationFrame(bitmap)
                if (directPwaTransition) dismissPwaSplash()
                firstFrameShown = true
                firstFrameShownAt = SystemClock.uptimeMillis()
                maybeRevealDestination()
            }
        }
    }

    /**
     * Reveal only after the destination has enough evidence to be useful. The first blurred
     * frame is deliberately kept visible until then, so fast and slow pages follow the same
     * visual sequence instead of sometimes skipping the animation entirely.
     */
    private fun maybeRevealDestination() {
        if (revealStarted || (!navigationCandidate && !directPwaTransition)) return
        if (!firstPaintSeen || !firstFrameShown) return

        val sufficientlyLoaded = loadProgress >= REVEAL_PROGRESS || !lastLoading
        if (!sufficientlyLoaded) return

        val elapsed = SystemClock.uptimeMillis() - firstFrameShownAt
        val remainingMinimumDisplay = MIN_BLUR_DISPLAY_MS - elapsed
        if (remainingMinimumDisplay > 0L) {
            mainHandler.postDelayed(
                { maybeRevealDestination() },
                remainingMinimumDisplay,
            )
            return
        }

        revealDestination(generation)
    }

    private fun revealDestination(transitionGeneration: Long) {
        if (
            transitionGeneration != generation ||
            revealStarted ||
            (!navigationCandidate && !directPwaTransition)
        ) {
            return
        }

        revealStarted = true
        cancelSafetyTimeout()

        engineView.captureThumbnail { bitmap ->
            if (transitionGeneration != generation) return@captureThumbnail

            container.post {
                if (
                    transitionGeneration != generation ||
                    (!navigationCandidate && !directPwaTransition)
                ) {
                    return@post
                }

                if (bitmap == null) {
                    // A failed final capture must never leave the browser covered indefinitely.
                    finishWithoutAnimation()
                    return@post
                }

                showDestinationOverlay(bitmap, transitionGeneration)
            }
        }
    }

    private fun showBlurredDestinationFrame(bitmap: Bitmap) {
        removeTransitionView()

        val image =
            ImageView(container.context).apply {
                setImageBitmap(bitmap)
                scaleType = ImageView.ScaleType.FIT_XY
                alpha = 1f
                scaleX = DESTINATION_START_SCALE
                scaleY = DESTINATION_START_SCALE
            }

        container.addView(
            image,
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        transitionView = image
        applyBlur(image, MAX_DESTINATION_BLUR)
    }

    private fun showDestinationOverlay(
        bitmap: Bitmap,
        transitionGeneration: Long,
    ) {
        removeTransitionView()

        val image =
            ImageView(container.context).apply {
                setImageBitmap(bitmap)
                scaleType = ImageView.ScaleType.FIT_XY
                alpha = 1f
                scaleX = DESTINATION_START_SCALE
                scaleY = DESTINATION_START_SCALE
            }

        container.addView(
            image,
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        transitionView = image
        applyBlur(image, MAX_DESTINATION_BLUR)

        val animator =
            ValueAnimator.ofFloat(1f, 0f).apply {
                duration = REVEAL_DURATION_MS
                interpolator = DecelerateInterpolator()
                addUpdateListener { value ->
                    if (transitionGeneration != generation) return@addUpdateListener

                    val alpha = value.animatedValue as Float
                    image.alpha = alpha

                    val blur = MAX_DESTINATION_BLUR * alpha
                    applyBlur(image, blur)

                    val scale =
                        1f +
                            ((DESTINATION_START_SCALE - 1f) * alpha)
                    image.scaleX = scale
                    image.scaleY = scale
                }
                addListener(
                    object : AnimatorListenerAdapter() {
                        override fun onAnimationEnd(animation: Animator) {
                            if (transitionAnimator === animation) {
                                transitionAnimator = null
                            }

                            if (transitionGeneration == generation) {
                                navigationCandidate = false
                                directPwaTransition = false
                                resetNavigationState()
                                removeTransitionView()
                            }
                        }

                        override fun onAnimationCancel(animation: Animator) {
                            if (transitionAnimator === animation) {
                                transitionAnimator = null
                            }
                        }
                    },
                )
            }

        transitionAnimator = animator
        animator.start()
    }

    private fun finishWithoutAnimation() {
        generation++
        navigationCandidate = false
        directPwaTransition = false
        resetNavigationState()
        cancelSafetyTimeout()
        removeTransitionView()
    }

    private fun scheduleSafetyTimeout(
        transitionGeneration: Long,
        delayMs: Long,
    ) {
        cancelSafetyTimeout()

        val timeout =
            Runnable {
                if (transitionGeneration != generation) return@Runnable

                // Never leave a stale transition layer over a live page. If meaningful content
                // arrived, reveal it even if progress stalled; otherwise simply abandon the
                // visual transition and let Gecko continue normally.
                if (firstPaintSeen) {
                    revealDestination(transitionGeneration)
                } else {
                    navigationCandidate = false
                    directPwaTransition = false
                    resetNavigationState()
                    removeTransitionView()
                }
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
    }

    private fun removeTransitionView() {
        transitionView?.let { view ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) view.setRenderEffect(null)
            view.setImageDrawable(null)
            (view.parent as? ViewGroup)?.removeView(view)
        }
        transitionView = null
        sourceHandoffView?.let {
            it.animate().cancel()
            it.setImageDrawable(null)
            (it.parent as? ViewGroup)?.removeView(it)
        }
        sourceHandoffView = null
        pwaSplashView?.let {
            it.animate().cancel()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) it.setRenderEffect(null)
            (it.parent as? ViewGroup)?.removeView(it)
        }
        pwaSplashView = null
    }

    private fun resetNavigationState() {
        lastLoading = false
        loadProgress = 0
        firstPaintSeen = false
        revealStarted = false
        firstFrameCapturePending = false
        firstFrameShown = false
        firstFrameShownAt = 0L
        sourceHandoffPending = false
        preserveCandidateOnNextBind = false
    }

    private fun applyBlur(view: android.view.View, radius: Float) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (radius <= 0f) {
                view.setRenderEffect(null)
            } else {
                view.setRenderEffect(
                    RenderEffect.createBlurEffect(
                        radius,
                        radius,
                        Shader.TileMode.CLAMP,
                    ),
                )
            }
        }
    }

    private fun cancelTransition() {
        generation++
        navigationCandidate = false
        directPwaTransition = false
        clearVisualTransition()
        resetNavigationState()
    }

    fun destroy() {
        cancelTransition()
        session?.unregister(observer)
        session = null
    }

    private companion object {
        const val REVEAL_PROGRESS = 95
        const val MIN_BLUR_DISPLAY_MS = 110L
        const val REVEAL_DURATION_MS = 220L
        const val SOURCE_HANDOFF_DURATION_MS = 90L
        const val MAX_DESTINATION_BLUR = 10f
        const val PWA_SPLASH_BLUR = 18f
        const val PWA_SPLASH_TO_PAGE_MS = 180L
        const val DESTINATION_START_SCALE = 1.012f

        const val NAVIGATION_SAFETY_TIMEOUT_MS = 6000L
        const val PWA_SAFETY_TIMEOUT_MS = 8000L
        const val PWA_LATE_READY_CHECK_MS = 250L
    }
}
