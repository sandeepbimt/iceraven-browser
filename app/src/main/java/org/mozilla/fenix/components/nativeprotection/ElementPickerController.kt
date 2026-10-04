package org.mozilla.fenix.components.nativeprotection

import android.content.Context
import mozilla.components.concept.engine.EngineSession
import mozilla.components.concept.engine.webextension.MessageHandler
import mozilla.components.concept.engine.webextension.Port
import mozilla.components.concept.engine.webextension.WebExtensionRuntime
import org.json.JSONObject
import org.mozilla.fenix.components.components

object ElementPickerController {
    private const val EXTENSION_ID = "sandfox-element-picker@sandfox"
    private const val EXTENSION_URL = "resource://android/assets/sandfox_element_picker/"
    private const val NATIVE_APP = "sandfox.elementPicker"

    private var onSelected: ((String, String, Int) -> Unit)? = null
    private var pendingStart = false

    fun start(context: Context, session: EngineSession, onSelected: (String, String, Int) -> Unit) {
        this.onSelected = onSelected
        pendingStart = true
        val runtime = context.components.core.engine as? WebExtensionRuntime ?: return
        runtime.installBuiltInWebExtension(
            id = EXTENSION_ID,
            url = EXTENSION_URL,
            onSuccess = { extension ->
                extension.registerBackgroundMessageHandler(NATIVE_APP, object : MessageHandler {
                    override fun onPortConnected(port: Port) {
                        if (pendingStart) {
                            pendingStart = false
                            port.postMessage(JSONObject().put("type", "startPicker"))
                        }
                    }
                })
                extension.registerContentMessageHandler(session, NATIVE_APP, object : MessageHandler {
                    override fun onMessage(message: Any, source: EngineSession?): Any? {
                        if (message !is JSONObject) return null
                        when (message.optString("type")) {
                            "selected" -> {
                                val domain = message.optString("domain")
                                val selector = message.optString("selector")
                                if (domain.isNotBlank() && selector.isNotBlank()) {
                                    this@ElementPickerController.onSelected?.invoke(domain, selector, message.optInt("matches"))
                                }
                                pendingStart = false
                            }
                            "cancelled" -> pendingStart = false
                        }
                        return null
                    }
                })
                extension.getConnectedPort(NATIVE_APP)?.let { port ->
                    if (pendingStart) {
                        pendingStart = false
                        port.postMessage(JSONObject().put("type", "startPicker"))
                    }
                }
            },
            onError = { pendingStart = false },
        )
    }

    fun addRule(context: Context, domain: String, selector: String) {
        val runtime = context.components.core.engine as? WebExtensionRuntime ?: return
        runtime.installBuiltInWebExtension(
            id = EXTENSION_ID,
            url = EXTENSION_URL,
            onSuccess = { extension ->
                val message = JSONObject()
                    .put("type", "addCosmeticRule")
                    .put("domain", domain)
                    .put("selector", selector)
                extension.registerBackgroundMessageHandler(NATIVE_APP, object : MessageHandler {
                    override fun onPortConnected(port: Port) {
                        port.postMessage(message)
                    }
                })
                extension.getConnectedPort(NATIVE_APP)?.postMessage(message)
            },
        )
    }
}
