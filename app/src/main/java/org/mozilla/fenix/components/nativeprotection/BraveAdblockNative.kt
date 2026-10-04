package org.mozilla.fenix.components.nativeprotection

object BraveAdblockNative {
    init { System.loadLibrary("sandfox_adblock") }
    external fun build(host: String, listsJson: String): Boolean
    external fun hasGlobal(): Boolean
    external fun load(host: String, data: ByteArray): Boolean
    external fun serialize(host: String): ByteArray?
    external fun check(url: String, source: String, requestType: String, method: String): Boolean
    external fun cosmetic(url: String): String?
    external fun dynamic(classesJson: String, idsJson: String, exceptionsJson: String): String?
}
