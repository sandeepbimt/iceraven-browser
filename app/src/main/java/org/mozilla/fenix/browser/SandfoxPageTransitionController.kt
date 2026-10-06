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
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import androidx.lifecycle.LifecycleOwner
import mozilla.components.concept.engine.EngineView
import mozilla.components.concept.engine.EngineSession

internal class SandfoxPageTransitionController(
    private val container: ViewGroup,
    private val engineView: EngineView,
    private val lifecycleOwner: LifecycleOwner,
) {
    private var session: EngineSession? = null
    private var transitionView: ImageView? = null
    private var transitionAnimator: ValueAnimator? = null
    private var generation = 0L
    private var lastLoading = false
    private var readyGeneration: Long? = null
    private var navigationRequested = false
    private var directBlurTransition = false

    private val observer = object : EngineSession.Observer {
        override fun onLoadRequest(url: String, triggeredByRedirect: Boolean, triggeredByWebContent: Boolean) {
            if (!triggeredByRedirect) startNavigationTransition()
        }

        override fun onNavigateBack() {
            startNavigationTransition()
        }

        override fun onLocationChange(url: String) {
            if (transitionView == null && !navigationRequested) startNavigationTransition()
        }

        override fun onLoadingStateChange(loading: Boolean) {
            if (loading && !lastLoading && !navigationRequested) startNavigationTransition()
            lastLoading = loading
        }

        override fun onFirstContentfulPaint() {
            val currentGeneration = generation
            readyGeneration = currentGeneration
            if (directBlurTransition && transitionView == null) {
                revealDirectBlur(currentGeneration)
            } else {
                transitionView?.let { image ->
                    if (transitionAnimator == null) revealLivePage(image, currentGeneration)
                }
            }
        }

        override fun onPaintStatusReset() {
            readyGeneration = null
            if (transitionView == null) {
                engineView.asView().alpha = 1f
                clearEngineEffect()
            }
        }
    }

    fun bind(session: EngineSession?) {
        if (this.session === session) return
        cancelTransition()
        engineView.asView().alpha = 1f
        clearEngineEffect()
        this.session?.unregister(observer)
        this.session = session
        generation++
        lastLoading = false
        readyGeneration = null
        navigationRequested = false
        session?.register(observer, lifecycleOwner, autoPause = false)
    }

    fun startNavigationTransition() {
        if (session == null || navigationRequested) return
        navigationRequested = true
        generation++
        readyGeneration = null
        directBlurTransition = false
        cancelTransition()
        val currentGeneration = generation
        engineView.asView().alpha = 1f
        captureCurrentPage(currentGeneration)
    }

    private fun captureCurrentPage(currentGeneration: Long) {
        engineView.captureThumbnail { bitmap ->
            if (currentGeneration != generation || !navigationRequested) return@captureThumbnail
            container.post {
                if (currentGeneration != generation || !navigationRequested) return@post
                if (bitmap != null) {
                    showOutgoingCover(bitmap, currentGeneration)
                } else {
                    showDirectBlur(currentGeneration)
                }
            }
        }
    }

    private fun showDirectBlur(transitionGeneration: Long) {
        if (transitionGeneration != generation || !navigationRequested) return
        directBlurTransition = true
        val liveView = engineView.asView()
        liveView.alpha = 1f
        liveView.scaleX = REVEAL_START_SCALE
        liveView.scaleY = REVEAL_START_SCALE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            liveView.setRenderEffect(
                RenderEffect.createBlurEffect(
                    MAX_BLUR_RADIUS,
                    MAX_BLUR_RADIUS,
                    Shader.TileMode.CLAMP,
                ),
            )
        }
        if (readyGeneration == transitionGeneration) {
            revealDirectBlur(transitionGeneration)
        }
    }

    private fun revealDirectBlur(transitionGeneration: Long) {
        if (!directBlurTransition || transitionGeneration != generation) return
        val liveView = engineView.asView()
        val animator = ValueAnimator.ofFloat(MAX_BLUR_RADIUS, 0f).apply {
            duration = INCOMING_DURATION_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener { value ->
                val radius = value.animatedValue as Float
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    liveView.setRenderEffect(
                        RenderEffect.createBlurEffect(
                            radius,
                            radius,
                            Shader.TileMode.CLAMP,
                        ),
                    )
                }
                val scale = 1f + ((REVEAL_START_SCALE - 1f) * (radius / MAX_BLUR_RADIUS))
                liveView.scaleX = scale
                liveView.scaleY = scale
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    transitionAnimator = null
                    directBlurTransition = false
                    navigationRequested = false
                    liveView.alpha = 1f
                    liveView.scaleX = 1f
                    liveView.scaleY = 1f
                    clearEngineEffect()
                }
            })
        }
        transitionAnimator = animator
        animator.start()
    }

    private fun showOutgoingCover(bitmap: Bitmap, transitionGeneration: Long) {
        cancelTransition()
        val image = ImageView(container.context).apply {
            setImageBitmap(bitmap)
            scaleType = ImageView.ScaleType.FIT_XY
            alpha = 1f
            scaleX = REVEAL_START_SCALE
            scaleY = REVEAL_START_SCALE
        }
        engineView.asView().alpha = 0f
        container.addView(image, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        transitionView = image
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runOutgoingSettle(image, transitionGeneration)
        } else {
            image.animate().scaleX(1f).scaleY(1f).setDuration(OUTGOING_DURATION_MS)
                .setInterpolator(DecelerateInterpolator()).withEndAction {
                    transitionAnimator = null
                    if (readyGeneration == transitionGeneration) revealLivePage(image, transitionGeneration)
                }.start()
        }
    }

    private fun runOutgoingSettle(image: ImageView, transitionGeneration: Long) {
        val animator = ValueAnimator.ofFloat(0f, MAX_BLUR_RADIUS).apply {
            duration = OUTGOING_DURATION_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener { value ->
                val radius = value.animatedValue as Float
                image.setRenderEffect(RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP))
                val progress = radius / MAX_BLUR_RADIUS
                image.scaleX = REVEAL_START_SCALE - ((REVEAL_START_SCALE - HOLD_SCALE) * progress)
                image.scaleY = image.scaleX
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    transitionAnimator = null
                    if (readyGeneration == transitionGeneration) revealLivePage(image, transitionGeneration)
                }
            })
        }
        transitionAnimator = animator
        animator.start()
    }

    private fun revealLivePage(image: ImageView, transitionGeneration: Long) {
        if (readyGeneration != transitionGeneration || transitionView !== image) return
        val liveView = engineView.asView()
        liveView.alpha = 1f
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            liveView.setRenderEffect(RenderEffect.createBlurEffect(MAX_BLUR_RADIUS, MAX_BLUR_RADIUS, Shader.TileMode.CLAMP))
        }
        val animator = ValueAnimator.ofFloat(1f, 0f).apply {
            duration = INCOMING_DURATION_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener { value ->
                val alpha = value.animatedValue as Float
                image.alpha = alpha
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val radius = MAX_BLUR_RADIUS * alpha
                    liveView.setRenderEffect(RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP))
                    image.setRenderEffect(RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP))
                }
                val scale = 1f - ((1f - HOLD_SCALE) * alpha)
                image.scaleX = scale
                image.scaleY = scale
                liveView.scaleX = scale
                liveView.scaleY = scale
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    transitionAnimator = null
                    navigationRequested = false
                    liveView.alpha = 1f
                    liveView.scaleX = 1f
                    liveView.scaleY = 1f
                    clearEngineEffect()
                    removeTransition()
                }
            })
        }
        transitionAnimator = animator
        animator.start()
    }

    private fun cancelTransition() {
        transitionAnimator?.cancel()
        transitionAnimator = null
        removeTransition()
        directBlurTransition = false
        engineView.asView().alpha = 1f
        engineView.asView().scaleX = 1f
        engineView.asView().scaleY = 1f
        clearEngineEffect()
    }

    private fun removeTransition() {
        val view = transitionView ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) view.setRenderEffect(null)
        view.setImageDrawable(null)
        (view.parent as? ViewGroup)?.removeView(view)
        transitionView = null
    }

    private fun clearEngineEffect() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            engineView.asView().setRenderEffect(null)
        }
    }

    fun destroy() {
        generation++
        readyGeneration = null
        navigationRequested = false
        directBlurTransition = false
        cancelTransition()
        engineView.asView().alpha = 1f
        session?.unregister(observer)
        session = null
    }

    private companion object {
        const val OUTGOING_DURATION_MS = 140L
        const val INCOMING_DURATION_MS = 220L
        const val MAX_BLUR_RADIUS = 8f
        const val REVEAL_START_SCALE = 1.012f
        const val HOLD_SCALE = 0.998f
    }
}
