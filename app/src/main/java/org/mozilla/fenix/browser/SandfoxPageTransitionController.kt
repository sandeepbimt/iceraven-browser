/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.browser

import android.animation.ValueAnimator
import android.graphics.Bitmap
import android.os.Build
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import androidx.annotation.RequiresApi
import androidx.lifecycle.LifecycleOwner
import mozilla.components.concept.engine.EngineView
import mozilla.components.concept.engine.EngineSession

/**
 * Readiness-gated page handoff. The outgoing rendered page covers Gecko immediately while the
 * next page loads underneath. Once first contentful paint is available, the cover fades away.
 */
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

    private val observer = object : EngineSession.Observer {
        override fun onLoadingStateChange(loading: Boolean) {
            if (loading && !lastLoading) {
                generation++
                readyGeneration = null
                cancelTransition()

                val currentGeneration = generation
                engineView.captureThumbnail { bitmap ->
                    if (bitmap == null || currentGeneration != generation) return@captureThumbnail
                    container.post {
                        if (currentGeneration == generation && readyGeneration != currentGeneration) {
                            showOutgoingCover(bitmap, currentGeneration)
                        }
                    }
                }
            }
            lastLoading = loading
        }

        override fun onFirstContentfulPaint() {
            val currentGeneration = generation
            readyGeneration = currentGeneration
            transitionView?.let { image ->
                if (transitionAnimator == null) revealLivePage(image, currentGeneration)
            }
        }

        override fun onPaintStatusReset() {
            generation++
            readyGeneration = null
            cancelTransition()
            engineView.asView().alpha = 1f
        }
    }

    fun bind(session: EngineSession?) {
        if (this.session === session) return
        cancelTransition()
        engineView.asView().alpha = 1f
        this.session?.unregister(observer)
        this.session = session
        generation++
        lastLoading = false
        readyGeneration = null
        session?.register(observer, lifecycleOwner, autoPause = false)
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
            image.animate()
                .scaleX(1f).scaleY(1f)
                .setDuration(OUTGOING_DURATION_MS)
                .setInterpolator(DecelerateInterpolator())
                .withEndAction {
                    transitionAnimator = null
                    if (readyGeneration == transitionGeneration) revealLivePage(image, transitionGeneration)
                }.start()
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun runOutgoingSettle(image: ImageView, transitionGeneration: Long) {
        val animator = ValueAnimator.ofFloat(MAX_BLUR_RADIUS, HOLD_BLUR_RADIUS).apply {
            duration = OUTGOING_DURATION_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener { value ->
                val radius = value.animatedValue as Float
                image.setRenderEffect(android.graphics.RenderEffect.createBlurEffect(
                    radius, radius, android.graphics.Shader.TileMode.CLAMP))
                val progress = (MAX_BLUR_RADIUS - radius) / (MAX_BLUR_RADIUS - HOLD_BLUR_RADIUS)
                image.scaleX = REVEAL_START_SCALE - ((REVEAL_START_SCALE - HOLD_SCALE) * progress)
                image.scaleY = image.scaleX
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
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
        val animator = ValueAnimator.ofFloat(1f, 0f).apply {
            duration = INCOMING_DURATION_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener { value ->
                val alpha = value.animatedValue as Float
                image.alpha = alpha
                engineView.asView().alpha = 1f - alpha
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val radius = HOLD_BLUR_RADIUS * alpha
                    image.setRenderEffect(android.graphics.RenderEffect.createBlurEffect(
                        radius, radius, android.graphics.Shader.TileMode.CLAMP))
                }
                val scale = 1f - ((1f - HOLD_SCALE) * alpha)
                image.scaleX = scale
                image.scaleY = scale
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    transitionAnimator = null
                    engineView.asView().alpha = 1f
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
    }

    private fun removeTransition() {
        val view = transitionView ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) view.setRenderEffect(null)
        view.setImageDrawable(null)
        (view.parent as? ViewGroup)?.removeView(view)
        transitionView = null
    }

    fun destroy() {
        generation++
        readyGeneration = null
        cancelTransition()
        engineView.asView().alpha = 1f
        session?.unregister(observer)
        session = null
    }

    private companion object {
        const val OUTGOING_DURATION_MS = 180L
        const val INCOMING_DURATION_MS = 220L
        const val MAX_BLUR_RADIUS = 10f
        const val HOLD_BLUR_RADIUS = 3f
        const val REVEAL_START_SCALE = 1.012f
        const val HOLD_SCALE = 0.998f
    }
}
