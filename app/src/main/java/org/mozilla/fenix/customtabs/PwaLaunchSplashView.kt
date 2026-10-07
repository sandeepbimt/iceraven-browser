package org.mozilla.fenix.customtabs

import android.animation.Animator
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.content.Context
import android.graphics.RenderEffect
import android.graphics.Shader
import android.view.animation.DecelerateInterpolator
import android.os.Build
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.mozilla.fenix.components.menu.StandaloneWebAppIconStore
import kotlin.math.max
import kotlin.math.min

/**
 * PWA-only launch cover. It is a lightweight ViewGroup with property animations only.
 *
 * It never pauses Gecko, navigation, networking, or page rendering. It is removed immediately
 * when the existing Sandfox page-transition overlay becomes visible.
 */
internal class PwaLaunchSplashView(context: Context) : FrameLayout(context) {
    private val glowOne = View(context)
    private val glowTwo = View(context)
    private val glowThree = View(context)
    private val ambientView =
        ImageView(context).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            isClickable = false
            isFocusable = false
            alpha = 0f
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRenderEffect(
                    RenderEffect.createBlurEffect(
                        dp(34).toFloat(),
                        dp(34).toFloat(),
                        Shader.TileMode.CLAMP,
                    ),
                )
            }
        }

    private val iconView =
        ImageView(context).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            isClickable = false
            isFocusable = false
            alpha = 0f
        }

    private var primary = Color.rgb(88, 88, 98)
    private var secondary = Color.rgb(42, 42, 50)
    private val animators = mutableListOf<Animator>()

    init {
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        addView(glowOne, circleParams())
        addView(glowTwo, circleParams())
        addView(glowThree, circleParams())
        addView(ambientView, LayoutParams(dp(120), dp(120), Gravity.CENTER))
        addView(iconView, LayoutParams(dp(120), dp(120), Gravity.CENTER))
        applyPalette()
    }

    override fun onDetachedFromWindow() {
        animators.forEach { it.cancel() }
        animators.clear()
        ambientView.setImageDrawable(null)
        iconView.setImageDrawable(null)
        super.onDetachedFromWindow()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val circleSize = max(w, h) * 0.86f
        listOf(glowOne, glowTwo, glowThree).forEach { view ->
            view.layoutParams =
                (view.layoutParams as LayoutParams).apply {
                    width = circleSize.toInt()
                    height = circleSize.toInt()
                    gravity = Gravity.CENTER
                }
        }
        val ambientSize = (min(w, h) * 0.34f).toInt().coerceAtLeast(dp(140))
        ambientView.layoutParams =
            (ambientView.layoutParams as LayoutParams).apply {
                width = ambientSize
                height = ambientSize
                gravity = Gravity.CENTER
            }

        val iconSize = (min(w, h) * 0.22f).toInt().coerceAtLeast(dp(88))
        iconView.layoutParams =
            (iconView.layoutParams as LayoutParams).apply {
                width = iconSize
                height = iconSize
                gravity = Gravity.CENTER
            }
        glowOne.translationX = -w * 0.18f
        glowOne.translationY = -h * 0.08f
        glowTwo.translationX = w * 0.18f
        glowTwo.translationY = h * 0.12f
        glowThree.translationY = -h * 0.20f
    }

    fun setIcon(bitmap: Bitmap?) {
        ambientView.setImageBitmap(bitmap)
        iconView.setImageBitmap(bitmap)
        iconView.alpha = if (bitmap == null) 0f else 1f

        val colors = extractColors(bitmap)
        primary = colors[0]
        secondary = colors[1]
        applyPalette()
        startMotion()
    }

    private fun applyPalette() {
        background =
            GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(darken(primary, 0.18f), darken(secondary, 0.28f)),
            )
        glowOne.background = circleDrawable(primary, 0.10f)
        glowTwo.background = circleDrawable(secondary, 0.09f)
        glowThree.background = circleDrawable(primary, 0.07f)
        iconView.background =
            GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(24).toFloat()
                setColor(darken(primary, 0.34f))
            }
        iconView.setPadding(dp(10), dp(10), dp(10), dp(10))
    }

    private fun circleDrawable(color: Int, alpha: Float) =
        GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(withAlpha(color, alpha))
        }

    private fun startMotion() {
        animators.forEach { it.cancel() }
        animators.clear()

        val glowOneAnimator = repeatingScale(glowOne, 0.82f, 1.10f, 1500L)
        val glowTwoAnimator = repeatingScale(glowTwo, 0.88f, 1.14f, 1750L)
        val glowThreeAnimator = repeatingScale(glowThree, 0.84f, 1.08f, 1950L)

        val ambientReveal =
            AnimatorSet().apply {
                playTogether(
                    ObjectAnimator.ofFloat(ambientView, View.ALPHA, 0f, 0.86f),
                    ObjectAnimator.ofFloat(ambientView, View.SCALE_X, 0.72f, 5.2f),
                    ObjectAnimator.ofFloat(ambientView, View.SCALE_Y, 0.72f, 5.2f),
                )
                duration = 1050L
                interpolator = DecelerateInterpolator(1.8f)
            }

        val iconExpansion =
            AnimatorSet().apply {
                playTogether(
                    ObjectAnimator.ofFloat(iconView, View.SCALE_X, 1f, 4.8f),
                    ObjectAnimator.ofFloat(iconView, View.SCALE_Y, 1f, 4.8f),
                    ObjectAnimator.ofFloat(iconView, View.ALPHA, 1f, 0f),
                )
                duration = 760L
                interpolator = DecelerateInterpolator(2f)
            }

        animators += glowOneAnimator
        animators += glowTwoAnimator
        animators += glowThreeAnimator
        animators += ambientReveal
        if (iconView.drawable != null) {
            animators += iconExpansion
        }

        animators.forEach { it.start() }
    }

    private fun repeatingScale(view: View, from: Float, to: Float, duration: Long): Animator =
        ObjectAnimator.ofPropertyValuesHolder(
            view,
            PropertyValuesHolder.ofFloat(View.SCALE_X, from, to),
            PropertyValuesHolder.ofFloat(View.SCALE_Y, from, to),
        ).apply {
            this.duration = duration
            repeatMode = ObjectAnimator.REVERSE
            repeatCount = ObjectAnimator.INFINITE
        }

    private fun circleParams() = LayoutParams(dp(120), dp(120), Gravity.CENTER)

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val ICON_MAX_SIZE = 192

        suspend fun loadIcon(context: Context, url: String): Bitmap? =
            withContext(Dispatchers.IO) {
                runCatching {
                    StandaloneWebAppIconStore.get(context, url)
                        ?.takeIf { it.isFile }
                        ?.let { decodeIconFile(it.absolutePath) }
                }.getOrNull()
            }

        private fun decodeIconFile(path: String): Bitmap? {
            val bounds = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(path, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

            val largestDimension = max(bounds.outWidth, bounds.outHeight)
            val sampleSize = max(1, (largestDimension + ICON_MAX_SIZE - 1) / ICON_MAX_SIZE)
            val options = BitmapFactory.Options().apply {
                inSampleSize = sampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            return BitmapFactory.decodeFile(path, options)
        }

        private fun extractColors(bitmap: Bitmap?): IntArray {
            if (bitmap == null || bitmap.isRecycled) {
                return intArrayOf(Color.rgb(88, 88, 98), Color.rgb(42, 42, 50))
            }

            data class Bucket(var r: Float = 0f, var g: Float = 0f, var b: Float = 0f, var weight: Float = 0f)
            val buckets = HashMap<Int, Bucket>()
            val hsv = FloatArray(3)
            val step = max(1, max(bitmap.width, bitmap.height) / 48)

            var y = 0
            while (y < bitmap.height) {
                var x = 0
                while (x < bitmap.width) {
                    val pixel = bitmap.getPixel(x, y)
                    if (Color.alpha(pixel) >= 48) {
                        Color.colorToHSV(pixel, hsv)
                        if (hsv[2] > 0.03f) {
                            val key =
                                ((Color.red(pixel) shr 4) shl 8) or
                                    ((Color.green(pixel) shr 4) shl 4) or
                                    (Color.blue(pixel) shr 4)
                            val weight = 1f + hsv[1] * 2f
                            val bucket = buckets.getOrPut(key) { Bucket() }
                            bucket.r += Color.red(pixel) * weight
                            bucket.g += Color.green(pixel) * weight
                            bucket.b += Color.blue(pixel) * weight
                            bucket.weight += weight
                        }
                    }
                    x += step
                }
                y += step
            }

            val colors = buckets.values
                .filter { it.weight > 0f }
                .sortedByDescending { it.weight }
                .map {
                    Color.rgb(
                        (it.r / it.weight).toInt().coerceIn(0, 255),
                        (it.g / it.weight).toInt().coerceIn(0, 255),
                        (it.b / it.weight).toInt().coerceIn(0, 255),
                    )
                }

            val first = colors.firstOrNull() ?: Color.rgb(88, 88, 98)
            val second =
                colors.drop(1).firstOrNull { distance(first, it) >= 3500 }
                    ?: adjustHue(first)
            return intArrayOf(first, second)
        }

        private fun distance(a: Int, b: Int): Int {
            val dr = Color.red(a) - Color.red(b)
            val dg = Color.green(a) - Color.green(b)
            val db = Color.blue(a) - Color.blue(b)
            return dr * dr + dg * dg + db * db
        }

        private fun adjustHue(color: Int): Int {
            val hsv = FloatArray(3)
            Color.colorToHSV(color, hsv)
            hsv[0] = (hsv[0] + 42f) % 360f
            hsv[1] = min(1f, hsv[1] + 0.12f)
            hsv[2] = max(0.15f, hsv[2] * 0.82f)
            return Color.HSVToColor(hsv)
        }

        private fun withAlpha(color: Int, alpha: Float): Int =
            Color.argb(
                (255f * alpha).toInt().coerceIn(0, 255),
                Color.red(color),
                Color.green(color),
                Color.blue(color),
            )

        private fun darken(color: Int, factor: Float): Int {
            val hsv = FloatArray(3)
            Color.colorToHSV(color, hsv)
            hsv[2] = (hsv[2] * factor).coerceIn(0.04f, 0.42f)
            hsv[1] = (hsv[1] * 0.82f).coerceIn(0f, 1f)
            return Color.HSVToColor(hsv)
        }
    }
}
