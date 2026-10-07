package org.mozilla.fenix.customtabs

import android.animation.Animator
import android.animation.PropertyValuesHolder
import android.animation.ObjectAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.mozilla.fenix.R
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
    private val iconView =
        ImageView(context).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            isClickable = false
            isFocusable = false
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
        addView(iconView, LayoutParams(dp(120), dp(120), Gravity.CENTER))
        applyPalette()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        startMotion()
    }

    override fun onDetachedFromWindow() {
        animators.forEach { it.cancel() }
        animators.clear()
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
        iconView.setImageBitmap(bitmap)
        val colors = extractColors(bitmap)
        primary = colors[0]
        secondary = colors[1]
        applyPalette()
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
        animators += repeatingScale(glowOne, 0.82f, 1.08f, 1500L)
        animators += repeatingScale(glowTwo, 0.88f, 1.12f, 1750L)
        animators += repeatingScale(glowThree, 0.84f, 1.06f, 1950L)
        animators += repeatingScale(iconView, 0.975f, 1.025f, 1100L)
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
                        ?: drawableToBitmap(ContextCompat.getDrawable(context, R.mipmap.ic_launcher))
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

        private fun drawableToBitmap(drawable: Drawable?): Bitmap? {
            drawable ?: return null
            return runCatching {
                Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888).also { bitmap ->
                    drawable.setBounds(0, 0, 192, 192)
                    drawable.draw(android.graphics.Canvas(bitmap))
                }
            }.getOrNull()
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
