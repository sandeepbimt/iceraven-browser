package org.mozilla.fenix.components.nativeprotection

object BraveAdblockNative {
    init { System.loadLibrary("sandfox_adblock") }
    external fun build(host: String, rules: String): Boolean
    external fun load(host: String, data: ByteArray): Boolean
    external fun serialize(host: String): ByteArray?
    external fun check(url: String, source: String, requestType: String, method: String): String?
    external fun cosmetic(url: String): String?
    external fun dynamic(url: String, classesJson: String, idsJson: String, exceptionsJson: String): String?
}