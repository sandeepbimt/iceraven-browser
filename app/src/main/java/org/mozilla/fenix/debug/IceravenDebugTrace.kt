package org.mozilla.fenix.debug

import android.os.SystemClock
import android.util.Log

object IceravenDebugTrace {
    private const val TAG = "IceravenDiag"

    @Volatile
    var enabled: Boolean = true

    private val processStart = SystemClock.elapsedRealtime()

    fun log(event: String, vararg fields: Pair<String, Any?>) {
        if (!enabled) return
        val suffix = if (fields.isEmpty()) "" else fields.joinToString(prefix = " | ", separator = " | ") { (key, value) ->
            key + "=" + (value ?: "null")
        }
        Log.d(TAG, "t=" + (SystemClock.elapsedRealtime() - processStart) + "ms [" + event + "]" + suffix)
    }

    fun error(event: String, throwable: Throwable? = null, vararg fields: Pair<String, Any?>) {
        if (!enabled) return
        val suffix = if (fields.isEmpty()) "" else fields.joinToString(prefix = " | ", separator = " | ") { (key, value) ->
            key + "=" + (value ?: "null")
        }
        if (throwable == null) Log.e(TAG, "[" + event + "]" + suffix) else Log.e(TAG, "[" + event + "]" + suffix, throwable)
    }
}
