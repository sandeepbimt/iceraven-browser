package org.mozilla.fenix.debug

import android.os.SystemClock

/**
 * Lightweight phase timing for Sandfox cold-start diagnostics.
 *
 * Logging is intentionally centralized so the profiling build can be compared
 * without changing browser behavior or adding telemetry.
 */
object SandfoxStartupTrace {
    private const val TAG = "SandfoxStartup"

    private val startNanos = SystemClock.elapsedRealtimeNanos()

    fun mark(event: String, vararg fields: Pair<String, Any?>) {
        val elapsedMs = (SystemClock.elapsedRealtimeNanos() - startNanos) / 1_000_000
        IceravenDebugTrace.log(
            "STARTUP_$event",
            "elapsedMs" to elapsedMs,
            *fields,
        )
    }
}
