/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.menu

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import java.io.File
import java.security.MessageDigest

internal object StandaloneWebAppIconStore {
    private const val PREFS_NAME = "standalone_web_app_icons"
    private const val KEY_PREFIX = "icon_file_"
    private const val DIRECTORY = "standalone_webapp_icons"
    private const val MAX_ICON_SIZE = 256
    private const val KEY_SPLASH_COLOR_PREFIX = "splash_color_"

    fun save(context: Context, url: String, sourceUri: Uri): File? =
        runCatching {
            val bitmap =
                context.contentResolver.openInputStream(sourceUri)?.use(BitmapFactory::decodeStream)
                    ?: return@runCatching null

            val square = cropToSquare(bitmap)
            val scaled =
                if (square.width > MAX_ICON_SIZE) {
                    Bitmap.createScaledBitmap(square, MAX_ICON_SIZE, MAX_ICON_SIZE, true)
                } else {
                    square
                }

            val directory = File(context.filesDir, DIRECTORY).apply { mkdirs() }
            val file = File(directory, "${fileKey(url)}.png")

            file.outputStream().use { output ->
                scaled.compress(Bitmap.CompressFormat.PNG, 100, output)
            }

            val splashColor = sampleColor(scaled)

            if (scaled !== square) scaled.recycle()
            if (square !== bitmap) square.recycle()
            bitmap.recycle()

            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(key(url), file.absolutePath)
                .putInt(colorKey(url), splashColor)
                .apply()

            file
        }.getOrNull()

    fun get(context: Context, url: String): File? {
        val path =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(key(url), null)
                ?: return null
        return File(path).takeIf { it.isFile }
    }

    fun clear(context: Context, url: String) {
        get(context, url)?.delete()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(key(url))
            .remove(colorKey(url))
            .apply()
    }

    fun getSplashColor(context: Context, url: String): Int? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.contains(colorKey(url))) {
            return prefs.getInt(colorKey(url), Color.rgb(32, 32, 32))
        }

        val bitmap = get(context, url)?.let { BitmapFactory.decodeFile(it.absolutePath) } ?: return null
        val color = sampleColor(bitmap)
        bitmap.recycle()
        prefs.edit().putInt(colorKey(url), color).apply()
        return color
    }

    private fun cropToSquare(bitmap: Bitmap): Bitmap {
        val size = minOf(bitmap.width, bitmap.height)
        return Bitmap.createBitmap(
            bitmap,
            (bitmap.width - size) / 2,
            (bitmap.height - size) / 2,
            size,
            size,
        )
    }

    private fun key(url: String): String = KEY_PREFIX + fileKey(url)

    private fun colorKey(url: String): String = KEY_SPLASH_COLOR_PREFIX + fileKey(url)

    private fun sampleColor(bitmap: Bitmap): Int {
        var red = 0L
        var green = 0L
        var blue = 0L
        var count = 0L
        val stepX = maxOf(1, bitmap.width / 16)
        val stepY = maxOf(1, bitmap.height / 16)

        for (y in 0 until bitmap.height step stepY) {
            for (x in 0 until bitmap.width step stepX) {
                val pixel = bitmap.getPixel(x, y)
                val alpha = Color.alpha(pixel)
                if (alpha < 32) continue
                red += Color.red(pixel) * alpha
                green += Color.green(pixel) * alpha
                blue += Color.blue(pixel) * alpha
                count += alpha
            }
        }

        if (count == 0L) return Color.rgb(32, 32, 32)
        return Color.rgb(
            (red / count).toInt(),
            (green / count).toInt(),
            (blue / count).toInt(),
        )
    }

    private fun fileKey(url: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }
}
