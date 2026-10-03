/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class NativeProtectionUpdateWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        NativeProtectionEngine.get(applicationContext).refreshFilters()
        return Result.success()
    }
}
