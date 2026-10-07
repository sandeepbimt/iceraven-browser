package org.mozilla.fenix.browser

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import org.mozilla.geckoview.GeckoView
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
    private var backNavigation = false
    private var readyCaptureRequested = false
    private var firstDrawObserved = false
    private var drawCallback: Runnable? = null
    private var pendingLocationUrl: String? = null
    private var safetyRelease: Runnable? = null
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

    override fun onLocationChange(url: String, hasUserGesture: Boolean) {
        if (navigationArmed && pendingLocationUrl == null) {
            pendingLocationUrl = url
            return
        }
        if (navigationArmed && pendingLocationUrl == url) return
        armNavigation(back = false, locationUrl = url)
    }

    override fun onLoadingStateChange(loading: Boolean) {
        if (loading && !navigationArmed) {
            armNavigation(back = false)
        }
    }

    override fun onNavigateBack() {
        armNavigation(back = true)
    }

    override fun onFirstContentfulPaint() {
        if (!navigationArmed || transitionStarted || destroyed) return

        transitionStarted = true
        readyCaptureRequested = false
        scheduleSafetyRelease()

        // Capture only after the destination has produced its first contentful view. This is
        // the first point at which a destination-only visual layer is allowed to exist.
        captureDestinationSnapshot(generation, forReveal = false)
    }

    private fun onFirstDraw() {
        if (destroyed || !navigationArmed) return

        firstDrawObserved = true
        if (transitionStarted) {
            maybeRequestReadyCapture()
        }
    }

    override fun onPaintStatusReset() {
        // The rendered destination is no longer valid. Drop any visual state and wait for the
        // next first-contentful-paint signal for this navigation generation.
        if (transitionStarted) {
            cancelVisualOnly()
            transitionStarted = false
            readyCaptureRequested = false
            firstDrawObserved = false
            removeFirstDrawObserver()
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
        firstDrawObserved = false
        backNavigation = back
        pendingLocationUrl = locationUrl
        readyCaptureRequested = false
        cancelVisualOnly()
        armFirstDrawObserver()
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
                    // Visible-page readiness is the end point of the transition. Do not add
                    // an animation-duration delay after the destination is ready.
                    revealNow(captureGeneration)
                }
            }
        }
    }

    private fun maybeRequestReadyCapture() {
        if (!transitionStarted || readyCaptureRequested || destroyed) return
        if (!firstDrawObserved) return

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

    private fun revealNow(captureGeneration: Long) {
        if (destroyed || captureGeneration != generation || !transitionStarted) return
        finishTransition(captureGeneration)
    }

    private fun finishTransition(captureGeneration: Long) {
        if (destroyed || captureGeneration != generation) return
        safetyRelease?.let(mainHandler::removeCallbacks)
        safetyRelease = null
        removeFirstDrawObserver()
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
        firstDrawObserved = false
        pendingLocationUrl = null
        cancelVisualOnly()
    }

    private fun cancelVisualOnly() {
        safetyRelease?.let(mainHandler::removeCallbacks)
        safetyRelease = null
        removeFirstDrawObserver()
        overlay.alpha = 0f
        applyBlur(0f)
        overlay.visibility = View.GONE
        overlay.setImageBitmap(null)
    }

    private fun armFirstDrawObserver() {
        removeFirstDrawObserver()

        val geckoView = findGeckoView(engineViewAndroid) ?: return
        val geckoSession = geckoView.session ?: return

        val callback = Runnable { onFirstDraw() }
        drawCallback = callback
        geckoSession.compositorController.addDrawCallback(callback)
    }

    private fun removeFirstDrawObserver() {
        val callback = drawCallback ?: return
        findGeckoView(engineViewAndroid)?.session?.compositorController?.removeDrawCallback(callback)
        drawCallback = null
    }

    private fun findGeckoView(view: View): GeckoView? {
        if (view is GeckoView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                findGeckoView(view.getChildAt(index))?.let { return it }
            }
        }
        return null
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
        const val BACK_MAX_DURATION_MS = 100L
        const val SAFETY_RELEASE_MS = 750L
    }
}
