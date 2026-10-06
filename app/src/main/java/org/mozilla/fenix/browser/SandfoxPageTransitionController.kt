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
 * Non-blocking page handoff that reveals the actual rendered page from a short blur.
 *
 * Gecko keeps loading/rendering normally. Once first contentful paint is available, Gecko's
 * rendered thumbnail is placed above the live page and animated from blurred to sharp. This
 * gives navigation a polished visual handoff without holding first paint behind a splash.
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
    private var captureGeneration: Long? = null

    private val observer = object : EngineSession.Observer {
        override fun onLoadingStateChange(loading: Boolean) {
            if (loading && !lastLoading) {
                generation++
                cancelTransition()
            }
            lastLoading = loading
        }

        override fun onFirstContentfulPaint() {
            val currentGeneration = generation
            if (captureGeneration == currentGeneration) return
            captureGeneration = currentGeneration
            engineView.captureThumbnail { bitmap ->
                if (bitmap == null || currentGeneration != generation) {
                    if (currentGeneration == generation) captureGeneration = null
                    return@captureThumbnail
                }
                container.post {
                    if (currentGeneration == generation) showReveal(bitmap)
                }
            }
        }

        override fun onPaintStatusReset() {
            generation++
            cancelTransition()
        }
    }

    fun bind(session: EngineSession?, showInitialCover: Boolean, isLoading: Boolean) {
        if (this.session === session) return

        cancelTransition()
        this.session?.unregister(observer)
        this.session = session
        generation++
        lastLoading = false
        captureGeneration = null
        session?.register(observer, lifecycleOwner, autoPause = false)
    }

    private fun showReveal(bitmap: Bitmap) {
        cancelTransition()

        val image = ImageView(container.context).apply {
            setImageBitmap(bitmap)
            scaleType = ImageView.ScaleType.FIT_XY
            alpha = 1f
            scaleX = REVEAL_START_SCALE
            scaleY = REVEAL_START_SCALE
        }
        container.addView(image, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        transitionView = image

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runBlurReveal(image)
        } else {
            image.animate()
                .alpha(0f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(REVEAL_DURATION_MS)
                .setInterpolator(DecelerateInterpolator())
                .withEndAction { removeTransition() }
                .start()
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun runBlurReveal(image: ImageView) {
        val animator = ValueAnimator.ofFloat(MAX_BLUR_RADIUS, 0f).apply {
            duration = REVEAL_DURATION_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener { value ->
                val radius = value.animatedValue as Float
                image.setRenderEffect(
                    android.graphics.RenderEffect.createBlurEffect(
                        radius,
                        radius,
                        android.graphics.Shader.TileMode.CLAMP,
                    ),
                )
                val progress = 1f - (radius / MAX_BLUR_RADIUS)
                image.scaleX = REVEAL_START_SCALE - ((REVEAL_START_SCALE - 1f) * progress)
                image.scaleY = image.scaleX
                image.alpha = if (progress < 0.78f) 1f else 1f - ((progress - 0.78f) / 0.22f)
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            view.setRenderEffect(null)
        }
        view.setImageDrawable(null)
        (view.parent as? ViewGroup)?.removeView(view)
        transitionView = null
    }

    fun destroy() {
        generation++
        cancelTransition()
        session?.unregister(observer)
        session = null
    }

    private companion object {
        const val REVEAL_DURATION_MS = 450L
        const val MAX_BLUR_RADIUS = 18f
        const val REVEAL_START_SCALE = 1.012f
    }
}
