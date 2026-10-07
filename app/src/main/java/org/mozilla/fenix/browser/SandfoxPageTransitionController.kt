package org.mozilla.fenix.browser

import android.animation.ValueAnimator
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import mozilla.components.concept.engine.EngineSession
import mozilla.components.concept.engine.EngineView

/**
 * Destination-only visual transition for browser content.
 *
 * This controller never starts or changes navigation, rendering, networking, JavaScript,
 * layout, or resource loading. It only observes engine milestones and presents a short-lived
 * snapshot of the destination viewport while the live Gecko content continues underneath.
 */
class SandfoxPageTransitionController(
    private val engineView: EngineView,
    private val overlay: ImageView,
    private val overlayParent: ViewGroup,
) : EngineSession.Observer {

    private val engineViewAndroid = engineView.asView()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val layoutChangeListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
        updateOverlayBounds()
    }

    private var session: EngineSession? = null
    private var generation = 0L
    private var navigationArmed = false
    private var transitionStarted = false
    private var loading = false
    private var backNavigation = false
    private var readyCaptureRequested = false
    private var pendingLocationUrl: String? = null
    private var startUptime = 0L
    private var safetyRelease: Runnable? = null
    private var revealAnimator: ValueAnimator? = null
    private var destroyed = false

    init {
        overlay.visibility = View.GONE
        overlay.isClickable = false
        overlay.isFocusable = false
        overlay.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        engineViewAndroid.addOnLayoutChangeListener(layoutChangeListener)
        overlayParent.post(::updateOverlayBounds)
    }

    fun attach(engineSession: EngineSession) {
        if (destroyed || session === engineSession) return
        session?.unregister(this)
        session = engineSession
        engineSession.register(this)
        cancelTransition()
        updateOverlayBounds()
    }

    fun primeForExistingLoad() {
        if (!destroyed && !navigationArmed) {
            armNavigation(back = false)
        }
    }

    fun detach() {
        if (destroyed) return
        destroyed = true
        session?.unregister(this)
        session = null
        engineViewAndroid.removeOnLayoutChangeListener(layoutChangeListener)
        cancelTransition()
        overlay.setImageBitmap(null)
        overlay.visibility = View.GONE
    }

    override fun onLocationChange(url: String) {
        if (navigationArmed && pendingLocationUrl == null) {
            pendingLocationUrl = url
            return
        }
        if (navigationArmed && pendingLocationUrl == url) return
        armNavigation(back = false, locationUrl = url)
    }

    override fun onLoadingStateChange(loading: Boolean) {
        this.loading = loading
        if (loading && !navigationArmed) {
            armNavigation(back = false)
        }
        if (!loading) {
            maybeRequestReadyCapture()
        }
    }

    override fun onNavigateBack() {
        armNavigation(back = true)
    }

    override fun onFirstContentfulPaint() {
        if (!navigationArmed || transitionStarted || destroyed) return

        transitionStarted = true
        startUptime = SystemClock.uptimeMillis()
        readyCaptureRequested = false
        scheduleSafetyRelease()

        // Capture only after the destination has produced its first contentful view. This is
        // the first point at which a destination-only visual layer is allowed to exist.
        captureDestinationSnapshot(generation, forReveal = false)
    }

    override fun onPaintStatusReset() {
        // The rendered destination is no longer valid. Drop any visual state and wait for the
        // next first-contentful-paint signal for this navigation generation.
        if (transitionStarted) {
            cancelVisualOnly()
            transitionStarted = false
            readyCaptureRequested = false
        }
    }

    override fun onCrash() {
        cancelTransition()
    }

    override fun onProcessKilled() {
        cancelTransition()
    }

    private fun armNavigation(back: Boolean, locationUrl: String? = null) {
        if (destroyed) return

        generation += 1
        navigationArmed = true
        transitionStarted = false
        loading = true
        backNavigation = back
        pendingLocationUrl = locationUrl
        readyCaptureRequested = false
        cancelVisualOnly()
    }

    private fun captureDestinationSnapshot(captureGeneration: Long, forReveal: Boolean) {
        if (destroyed || captureGeneration != generation || !transitionStarted) return

        engineView.captureThumbnail { bitmap ->
            mainHandler.post {
                if (destroyed || captureGeneration != generation || !transitionStarted) {
                    return@post
                }

                if (bitmap == null) {
                    if (forReveal) {
                        revealNow(captureGeneration)
                    }
                    return@post
                }

                overlay.setImageBitmap(bitmap)
                updateOverlayBounds()

                if (!forReveal) {
                    overlay.alpha = 1f
                    applyBlur(BLUR_RADIUS)
                    overlay.visibility = View.VISIBLE
                    maybeRequestReadyCapture()
                } else {
                    reveal(captureGeneration)
                }
            }
        }
    }

    private fun maybeRequestReadyCapture() {
        if (!transitionStarted || readyCaptureRequested || destroyed) return
        if (loading) return

        readyCaptureRequested = true
        captureDestinationSnapshot(generation, forReveal = true)
    }

    private fun scheduleSafetyRelease() {
        safetyRelease?.let(mainHandler::removeCallbacks)
        val captureGeneration = generation
        val delay = if (backNavigation) BACK_MAX_DURATION_MS else SAFETY_RELEASE_MS
        val runnable = Runnable {
            if (captureGeneration != generation || destroyed || !transitionStarted) return@Runnable
            revealNow(captureGeneration)
        }
        safetyRelease = runnable
        mainHandler.postDelayed(runnable, delay)
    }

    private fun reveal(captureGeneration: Long) {
        if (destroyed || captureGeneration != generation || !transitionStarted) return

        val elapsed = SystemClock.uptimeMillis() - startUptime
        val remaining = if (backNavigation) BACK_MAX_DURATION_MS - elapsed else REVEAL_DURATION_MS
        if (remaining <= 0L) {
            revealNow(captureGeneration)
            return
        }

        revealAnimator?.cancel()
        val duration = if (backNavigation) minOf(REVEAL_DURATION_MS, remaining) else REVEAL_DURATION_MS
        revealAnimator = ValueAnimator.ofFloat(1f, 0f).apply {
            this.duration = duration
            interpolator = DecelerateInterpolator()
            addUpdateListener { animator ->
                if (destroyed || captureGeneration != generation) return@addUpdateListener
                val value = animator.animatedValue as Float
                overlay.alpha = value
                applyBlur(BLUR_RADIUS * value)
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (captureGeneration == generation && !destroyed) {
                        finishTransition(captureGeneration)
                    }
                }
            })
            start()
        }
    }

    private fun revealNow(captureGeneration: Long) {
        if (destroyed || captureGeneration != generation || !transitionStarted) return
        finishTransition(captureGeneration)
    }

    private fun finishTransition(captureGeneration: Long) {
        if (destroyed || captureGeneration != generation) return
        revealAnimator?.cancel()
        revealAnimator = null
        safetyRelease?.let(mainHandler::removeCallbacks)
        safetyRelease = null
        overlay.alpha = 0f
        applyBlur(0f)
        overlay.visibility = View.GONE
        overlay.setImageBitmap(null)
        navigationArmed = false
        transitionStarted = false
        readyCaptureRequested = false
        pendingLocationUrl = null
    }

    private fun cancelTransition() {
        generation += 1
        navigationArmed = false
        transitionStarted = false
        readyCaptureRequested = false
        pendingLocationUrl = null
        cancelVisualOnly()
    }

    private fun cancelVisualOnly() {
        revealAnimator?.cancel()
        revealAnimator = null
        safetyRelease?.let(mainHandler::removeCallbacks)
        safetyRelease = null
        overlay.alpha = 0f
        applyBlur(0f)
        overlay.visibility = View.GONE
        overlay.setImageBitmap(null)
    }

    private fun applyBlur(radius: Float) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            overlay.setRenderEffect(
                if (radius > 0f) {
                    RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
                } else {
                    null
                }
            )
        }
    }

    private fun updateOverlayBounds() {
        if (destroyed || !engineViewAndroid.isAttachedToWindow) return

        val parentLocation = IntArray(2)
        val engineLocation = IntArray(2)
        overlayParent.getLocationInWindow(parentLocation)
        engineViewAndroid.getLocationInWindow(engineLocation)

        val left = engineLocation[0] - parentLocation[0]
        val top = engineLocation[1] - parentLocation[1]
        val params = overlay.layoutParams as? ViewGroup.MarginLayoutParams ?: return
        if (
            params.width != engineViewAndroid.width ||
            params.height != engineViewAndroid.height ||
            params.leftMargin != left ||
            params.topMargin != top
        ) {
            params.width = engineViewAndroid.width
            params.height = engineViewAndroid.height
            params.leftMargin = left
            params.topMargin = top
            overlay.layoutParams = params
        }
    }

    private companion object {
        const val BLUR_RADIUS = 18f
        const val REVEAL_DURATION_MS = 160L
        const val BACK_MAX_DURATION_MS = 100L
        const val SAFETY_RELEASE_MS = 750L
    }
}
