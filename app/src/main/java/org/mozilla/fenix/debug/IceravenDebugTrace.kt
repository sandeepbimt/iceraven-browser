package org.mozilla.fenix.debug

import android.util.Log

object IceravenDebugTrace {
    private const val TAG = "IceravenDiag"

    @Volatile
    var enabled: Boolean = true

    fun log(event: String, vararg fields: Pair<String, Any?>) {
        if (!enabled) return
        val suffix = if (fields.isEmpty()) "" else fields.joinToString(prefix = " | ", separator = " | ") { (key, value) ->
            key + "=" + (value ?: "null")
        }
        Log.d(TAG, "[" + event + "]" + suffix)
    }

    fun error(event: String, throwable: Throwable? = null, vararg fields: Pair<String, Any?>) {
        if (!enabled) return
        val suffix = if (fields.isEmpty()) "" else fields.joinToString(prefix = " | ", separator = " | ") { (key, value) ->
            key + "=" + (value ?: "null")
        }
        if (throwable == null) Log.e(TAG, "[" + event + "]" + suffix) else Log.e(TAG, "[" + event + "]" + suffix, throwable)
    }
}
