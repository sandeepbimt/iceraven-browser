package org.mozilla.fenix.darkmode

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.WebExtension

object SandfoxDarkEngine {
    private const val TAG = "SandfoxDarkEngine"
    private const val LOCATION = "resource://android/assets/sandfox_dark/"
    private const val ID = "sandfox-dark-pages@sandfox.local"
    private const val NATIVE_APP = "browser"
    @Volatile private var nativePort: WebExtension.Port? = null
    @Volatile private var appContext: Context? = null

    fun install(context: Context, runtime: GeckoRuntime) {
        appContext = context.applicationContext
        runtime.getWebExtensionController().ensureBuiltIn(LOCATION, ID).accept(
            { extension ->
                extension?.setMessageDelegate(object : WebExtension.MessageDelegate {
                    override fun onMessage(nativeApp: String, message: Any, sender: WebExtension.MessageSender): GeckoResult<Any> {
                        return if (nativeApp == NATIVE_APP) {
                            GeckoResult.fromValue(JSONObject().apply {
                                put("type", "sandfox-config")
                                put("config", SandfoxDarkPages.configJson(appContext ?: context))
                            })
                        } else {
                            GeckoResult.fromValue(JSONObject())
                        }
                    }

                    override fun onConnect(port: WebExtension.Port) {
                        if (port.name != NATIVE_APP) return
                        nativePort = port
                        pushConfig()
                    }
                }, NATIVE_APP)
                Log.i(TAG, "SANDFOX V4 Dark Pages ready")
            },
            { error -> Log.e(TAG, "Failed to install SANDFOX V4 Dark Pages", error) },
        )
    }

    fun pushConfig() {
        val context = appContext ?: return
        val port = nativePort ?: return
        runCatching {
            port.postMessage(JSONObject().apply {
                put("type", "sandfox-config")
                put("config", SandfoxDarkPages.configJson(context))
            })
        }.onFailure { Log.w(TAG, "Unable to send Dark Pages configuration", it) }
    }
}
