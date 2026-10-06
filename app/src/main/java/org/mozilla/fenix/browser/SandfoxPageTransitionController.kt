/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.browser

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.graphics.Color
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.coordinatorlayout.widget.CoordinatorLayout
import androidx.lifecycle.LifecycleOwner
import mozilla.components.concept.engine.EngineSession
import org.mozilla.fenix.R

/** Lightweight, non-blocking visual handoff for page loading. */
internal class SandfoxPageTransitionController(
    private val container: ViewGroup,
    private val lifecycleOwner: LifecycleOwner,
) {
    private var session: EngineSession? = null
    private var progressView: View? = null
    private var coverView: FrameLayout? = null
    private var showRunnable: Runnable? = null
    private var initialCoverEnabled = false
    private var hasPainted = false
    private var finishing = false

    private val observer = object : EngineSession.Observer {
        override fun onLoadingStateChange(loading: Boolean) {
            if (loading) beginLoading() else finishTransition()
        }

        override fun onProgress(progress: Int) {
            val view = progressView ?: return
            if (view.alpha == 0f) return
            val target = progress.coerceIn(4, 90) / 100f
            view.animate()
                .scaleX(maxOf(view.scaleX, target))
                .setDuration(90L)
                .setInterpolator(DecelerateInterpolator())
                .start()
        }

        override fun onFirstContentfulPaint() {
            hasPainted = true
            finishTransition()
        }

        override fun onPaintStatusReset() {
            hasPainted = false
        }
    }

    fun bind(session: EngineSession?, showInitialCover: Boolean, isLoading: Boolean) {
        if (this.session === session && initialCoverEnabled == showInitialCover) return

        cancelPendingShow()
        removeVisuals()
        this.session?.unregister(observer)
        this.session = session
        initialCoverEnabled = showInitialCover
        hasPainted = false
        finishing = false

        session?.register(observer, lifecycleOwner, autoPause = false)
        if (isLoading) beginLoading()
    }

    private fun beginLoading() {
        finishing = false
        cancelPendingShow()
        showRunnable = Runnable {
            showRunnable = null
            showVisualsIfStillLoading()
        }.also { container.postDelayed(it, SHOW_DELAY_MS) }
    }

    private fun showVisualsIfStillLoading() {
        if (finishing) return

        ensureProgressView()
        progressView?.let { view ->
            view.alpha = 0f
            view.scaleX = MIN_PROGRESS_SCALE
            view.animate()
                .alpha(1f)
                .scaleX(PROGRESS_START_SCALE)
                .setDuration(120L)
                .setInterpolator(DecelerateInterpolator())
                .start()
        }

        if (initialCoverEnabled && !hasPainted) showCover()
    }

    private fun ensureProgressView() {
        if (progressView != null) return
        val view = View(container.context).apply {
            setBackgroundColor(resolveAccentColor())
            alpha = 0f
            pivotX = 0f
            pivotY = 0f
            scaleX = 0f
        }
        val params = CoordinatorLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dpToPx(PROGRESS_HEIGHT_DP),
        ).apply {
            gravity = Gravity.TOP
        }
        container.addView(view, params)
        progressView = view
    }

    private fun showCover() {
        if (coverView != null) return
        val cover = FrameLayout(container.context).apply {
            setBackgroundColor(resolveBackgroundColor())
            isClickable = true
            isFocusable = true
            alpha = 0f
        }
        val icon = ImageView(container.context).apply {
            setImageResource(R.drawable.ic_splash_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            alpha = 0f
            scaleX = 0.94f
            scaleY = 0.94f
        }
        cover.addView(icon, FrameLayout.LayoutParams(dpToPx(96), dpToPx(96), Gravity.CENTER))
        val params = CoordinatorLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        container.addView(cover, params)
        coverView = cover

        cover.animate()
            .alpha(1f)
            .setDuration(90L)
            .setInterpolator(DecelerateInterpolator())
            .start()
        icon.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(140L)
            .setInterpolator(DecelerateInterpolator())
            .start()

        container.postDelayed({
            if (!hasPainted && coverView === cover) finishTransition()
        }, MAX_COVER_MS)
    }

    private fun finishTransition() {
        cancelPendingShow()
        if (finishing) return
        finishing = true

        progressView?.animate()
            ?.scaleX(1f)
            ?.alpha(0f)
            ?.setDuration(PROGRESS_FINISH_MS)
            ?.setInterpolator(DecelerateInterpolator())
            ?.withEndAction { removeProgressView() }
            ?.start()

        val cover = coverView ?: return
        cover.animate()
            .alpha(0f)
            .setDuration(COVER_FADE_MS)
            .setInterpolator(DecelerateInterpolator())
            .setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    if (coverView === cover) {
                        (cover.parent as? ViewGroup)?.removeView(cover)
                        coverView = null
                    }
                }
            })
            .start()
    }

    private fun removeVisuals() {
        removeProgressView()
        coverView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        coverView = null
        finishing = false
    }

    private fun removeProgressView() {
        progressView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        progressView = null
    }

    private fun cancelPendingShow() {
        showRunnable?.let(container::removeCallbacks)
        showRunnable = null
    }

    fun destroy() {
        cancelPendingShow()
        session?.unregister(observer)
        session = null
        removeVisuals()
    }

    private fun resolveBackgroundColor(): Int {
        val value = TypedValue()
        return if (
            container.context.theme.resolveAttribute(android.R.attr.colorBackground, value, true)
        ) {
            value.data
        } else {
            Color.BLACK
        }
    }

    private fun resolveAccentColor(): Int {
        val value = TypedValue()
        return if (
            container.context.theme.resolveAttribute(android.R.attr.colorAccent, value, true)
        ) {
            value.data
        } else {
            Color.WHITE
        }
    }

    private fun dpToPx(dp: Int): Int =
        (dp * container.resources.displayMetrics.density).toInt()

    private companion object {
        const val SHOW_DELAY_MS = 120L
        const val MAX_COVER_MS = 700L
        const val COVER_FADE_MS = 120L
        const val PROGRESS_FINISH_MS = 120L
        const val PROGRESS_HEIGHT_DP = 2
        const val MIN_PROGRESS_SCALE = 0.02f
        const val PROGRESS_START_SCALE = 0.18f
    }
}
