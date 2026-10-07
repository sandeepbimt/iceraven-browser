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
    private var viewportCheckPending = false
    private var viewportStableSamples = 0
    private var lastViewportSignature: IntArray? = null
    private var firstViewportFrameAt = 0L
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
    fun startPwaLaunchTransition() {
        if (session == null) return

        generation++
        clearVisualTransition()

        resetNavigationState()
        directPwaTransition = true

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
        container.addView(
            image,
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        sourceHandoffView = image
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
                firstFrameShown = true
                firstFrameShownAt = SystemClock.uptimeMillis()
                firstViewportFrameAt = firstFrameShownAt
                lastViewportSignature = viewportSignature(bitmap)
                viewportStableSamples = 0
                scheduleViewportReadinessCheck(transitionGeneration)
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

        if (!viewportReady()) return

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

    private fun scheduleViewportReadinessCheck(transitionGeneration: Long) {
        if (viewportCheckPending) return
        viewportCheckPending = true

        mainHandler.postDelayed(
            {
                viewportCheckPending = false
                if (transitionGeneration != generation || !firstFrameShown) return@postDelayed

                engineView.captureThumbnail { bitmap ->
                    if (transitionGeneration != generation) return@captureThumbnail

                    container.post {
                        if (
                            transitionGeneration != generation ||
                            !firstFrameShown ||
                            revealStarted
                        ) {
                            return@post
                        }

                        if (bitmap == null) {
                            scheduleViewportReadinessCheck(transitionGeneration)
                            return@post
                        }

                        val signature = viewportSignature(bitmap)
                        val previous = lastViewportSignature
                        val difference =
                            if (previous == null) {
                                Float.MAX_VALUE
                            } else {
                                viewportDifference(previous, signature)
                            }

                        lastViewportSignature = signature

                        val enoughSettleTime =
                            SystemClock.uptimeMillis() - firstViewportFrameAt >=
                                MIN_VIEWPORT_SETTLE_MS

                        if (enoughSettleTime && difference <= VIEWPORT_STABILITY_THRESHOLD) {
                            viewportStableSamples++
                        } else {
                            viewportStableSamples = 0
                        }

                        if (viewportStableSamples >= VIEWPORT_STABLE_REQUIRED_SAMPLES) {
                            maybeRevealDestination()
                        } else {
                            scheduleViewportReadinessCheck(transitionGeneration)
                        }
                    }
                }
            },
            VIEWPORT_SAMPLE_INTERVAL_MS,
        )
    }

    private fun viewportReady(): Boolean =
        viewportStableSamples >= VIEWPORT_STABLE_REQUIRED_SAMPLES

    private fun viewportSignature(bitmap: Bitmap): IntArray {
        val columns = VIEWPORT_SIGNATURE_COLUMNS
        val rows = VIEWPORT_SIGNATURE_ROWS
        val result = IntArray(columns * rows)
        val width = bitmap.width
        val height = bitmap.height

        for (row in 0 until rows) {
            val y = ((row + 0.5f) * height / rows).toInt().coerceIn(0, height - 1)
            for (column in 0 until columns) {
                val x = ((column + 0.5f) * width / columns).toInt().coerceIn(0, width - 1)
                val pixel = bitmap.getPixel(x, y)
                val luminance =
                    (77 * Color.red(pixel) + 150 * Color.green(pixel) + 29 * Color.blue(pixel)) shr 8
                result[row * columns + column] = luminance
            }
        }

        return result
    }

    private fun viewportDifference(first: IntArray, second: IntArray): Float {
        if (first.size != second.size) return Float.MAX_VALUE

        var difference = 0L
        for (index in first.indices) {
            difference += kotlin.math.abs(first[index] - second[index]).toLong()
        }
        return difference.toFloat() / first.size
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
        transitionView?.let {
            it.animate().cancel()
            it.setImageDrawable(null)
            (it.parent as? ViewGroup)?.removeView(it)
        }

        val image =
            ImageView(container.context).apply {
                setImageBitmap(bitmap)
                scaleType = ImageView.ScaleType.FIT_XY
                alpha = 0f
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

        val source = sourceHandoffView
        if (source != null) {
            source.animate().cancel()
            image.animate()
                .alpha(1f)
                .setDuration(SOURCE_TO_DESTINATION_FADE_MS)
                .setInterpolator(DecelerateInterpolator())
                .start()
            source.animate()
                .alpha(0f)
                .setDuration(SOURCE_TO_DESTINATION_FADE_MS)
                .setInterpolator(DecelerateInterpolator())
                .withEndAction {
                    if (sourceHandoffView === source) {
                        sourceHandoffView = null
                    }
                    source.setImageDrawable(null)
                    (source.parent as? ViewGroup)?.removeView(source)
                }
                .start()
        } else {
            image.animate()
                .alpha(1f)
                .setDuration(FRESH_DESTINATION_FADE_MS)
                .setInterpolator(DecelerateInterpolator())
                .start()
        }
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
        viewportCheckPending = false
        viewportStableSamples = 0
        lastViewportSignature = null
        firstViewportFrameAt = 0L
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
        const val SOURCE_TO_DESTINATION_FADE_MS = 180L
        const val FRESH_DESTINATION_FADE_MS = 180L
        const val MAX_DESTINATION_BLUR = 10f
        const val DESTINATION_START_SCALE = 1.008f
        const val VIEWPORT_SAMPLE_INTERVAL_MS = 120L
        const val MIN_VIEWPORT_SETTLE_MS = 240L
        const val VIEWPORT_STABILITY_THRESHOLD = 3.0f
        const val VIEWPORT_STABLE_REQUIRED_SAMPLES = 2
        const val VIEWPORT_SIGNATURE_COLUMNS = 16
        const val VIEWPORT_SIGNATURE_ROWS = 16

        const val NAVIGATION_SAFETY_TIMEOUT_MS = 6000L
        const val PWA_SAFETY_TIMEOUT_MS = 8000L
        const val PWA_LATE_READY_CHECK_MS = 250L
    }
}
