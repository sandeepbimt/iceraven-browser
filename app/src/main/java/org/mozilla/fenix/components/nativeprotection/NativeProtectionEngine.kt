/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.content.Context
import android.net.Uri
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import mozilla.components.concept.engine.EngineSession
import mozilla.components.concept.engine.request.RequestInterceptor

/**
 * Browser-native ad/tracker protection.
 *
 * V1: lazy network/subframe matching, persistent compiled filter database,
 * selectable uBO-compatible filter lists, global/per-site controls.
 *
 * V2: bounded cosmetic filtering and custom filters from the browser layer.
 * No WebExtension is installed or registered.
 *
 * Gecko's native Content Blocking/ETP remains responsible for its own
 * resource-level protection; this layer adds Sandfox-managed rules.
 */
class NativeProtectionEngine private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val databaseRef = AtomicReference<FilterDatabase?>()
    private val globalEnabled = AtomicReference(prefs.getBoolean(KEY_ENABLED, true))
    private val disabledSites = AtomicReference(prefs.getStringSet(KEY_DISABLED_SITES, emptySet())?.toSet() ?: emptySet())
    private val blockCount = AtomicLong(prefs.getLong(KEY_BLOCK_COUNT, 0L))
    private val updateExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "SandfoxFilterUpdate").apply { isDaemon = true }
    }

    fun isGloballyEnabled(): Boolean = globalEnabled.get()

    fun isEnabledForUrl(url: String): Boolean {
        if (!isGloballyEnabled()) return false
        return isEnabledForHost(Uri.parse(url).host)
    }

    fun isEnabledForHost(host: String?): Boolean {
        if (!isGloballyEnabled()) return false
        val normalized = normalizeHost(host) ?: return false
        return disabledSites.get().none { hostMatches(normalized, it) }
    }

    fun setGlobalEnabled(enabled: Boolean) {
        globalEnabled.set(enabled)
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
        if (!enabled) databaseRef.set(null)
    }

    fun setSiteEnabled(host: String, enabled: Boolean) {
        val normalized = normalizeHost(host) ?: return
        val sites = prefs.getStringSet(KEY_DISABLED_SITES, emptySet())?.toMutableSet() ?: mutableSetOf()
        if (enabled) sites.remove(normalized) else sites.add(normalized)
        disabledSites.set(sites)
        prefs.edit().putStringSet(KEY_DISABLED_SITES, sites).apply()
    }

    fun selectedListIds(): Set<String> =
        prefs.getStringSet(KEY_SELECTED_LISTS, DEFAULT_LISTS)?.toSet() ?: DEFAULT_LISTS

    fun setSelectedListIds(ids: Set<String>) {
        prefs.edit().putStringSet(KEY_SELECTED_LISTS, ids).apply()
        databaseRef.set(null)
        compileFromStoredLists()
    }

    fun customFilters(): String = prefs.getString(KEY_CUSTOM_FILTERS, "") ?: ""

    fun setCustomFilters(filters: String) {
        prefs.edit().putString(KEY_CUSTOM_FILTERS, filters).apply()
        databaseRef.set(null)
        compileFromStoredLists()
    }

    fun blockCount(): Long = blockCount.get()

    fun cosmeticEnabled(): Boolean = prefs.getBoolean(KEY_COSMETIC_ENABLED, true)

    fun setCosmeticEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_COSMETIC_ENABLED, enabled).apply()
    }

    fun intercept(
        engineSession: EngineSession,
        uri: String,
        isSubframeRequest: Boolean,
    ): RequestInterceptor.InterceptionResponse? {
        if (!isEnabledForUrl(uri)) return null
        val host = normalizeHost(Uri.parse(uri).host) ?: return null
        val database = database()
        if (database.isAllowed(host)) return null
        if (database.isBlocked(host)) {
            val count = blockCount.incrementAndGet()
            if (count % 50L == 0L) prefs.edit().putLong(KEY_BLOCK_COUNT, count).apply()
            return RequestInterceptor.InterceptionResponse.Deny
        }
        return null
    }

    fun cosmeticCss(host: String?): String? {
        if (!isGloballyEnabled() || !cosmeticEnabled()) return null
        val normalized = normalizeHost(host) ?: return null
        val database = database()
        val selectors = LinkedHashSet<String>()
        database.genericCosmetic.take(MAX_GENERIC_COSMETIC).forEach(selectors::add)
        database.addCosmeticSelectors(normalized, selectors, MAX_COSMETIC_RULES)
        if (selectors.isEmpty()) return null
        return selectors.joinToString("\n") { selector ->
            "$selector { display: none !important; }"
        }.take(MAX_CSS_BYTES)
    }

    fun updateSelectedListsAsync(onFinished: (UpdateResult) -> Unit = {}) {
        updateExecutor.execute {
            val result = updateSelectedLists()
            onFinished(result)
        }
    }

    private fun updateSelectedLists(): UpdateResult {
        val listDir = File(context.filesDir, "sandfox/native-protection/lists").apply { mkdirs() }
        var updated = 0
        var failed = 0
        selectedListIds().forEach { id ->
            val definition = FILTER_LISTS.firstOrNull { it.id == id } ?: return@forEach
            try {
                val content = download(definition)
                val temp = File(listDir, "$id.tmp")
                temp.writeText(content)
                val target = File(listDir, "$id.txt")
                val backup = File(listDir, "$id.bak")
                if (backup.exists()) backup.delete()
                if (target.exists()) check(target.renameTo(backup)) { "Could not stage old filter list" }
                if (!temp.renameTo(target)) {
                    target.delete()
                    backup.renameTo(target)
                    throw IllegalStateException("Could not install filter list")
                }
                backup.delete()
                updated++
            } catch (_: Throwable) {
                failed++
            }
        }
        val compiled = compileFromStoredLists()
        return UpdateResult(updated, failed, compiled)
    }

    private fun download(definition: FilterListDefinition): String {
        var lastError: Throwable? = null
        definition.urls.forEach { source ->
            try {
                val parsed = Uri.parse(source)
                check(parsed.scheme == "https") { "Only HTTPS filter sources are accepted" }
                check(TRUSTED_HOSTS.contains(parsed.host)) { "Untrusted filter source" }

                val connection = (URL(source).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8_000
                    readTimeout = 15_000
                    instanceFollowRedirects = false
                    setRequestProperty("User-Agent", "Sandfox/1 NativeProtection")
                    setRequestProperty("Accept", "text/plain,*/*;q=0.8")
                }
                try {
                    val code = connection.responseCode
                    check(code in 200..299) { "HTTP $code" }
                    val length = connection.contentLengthLong
                    check(length <= MAX_LIST_BYTES || length < 0) { "Filter list too large" }
                    val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    check(text.toByteArray(Charsets.UTF_8).size <= MAX_LIST_BYTES) { "Filter list too large" }
                    // The default lists do not expose one common detached-signature
                    // mechanism. We therefore enforce HTTPS, a fixed trusted-origin
                    // allowlist and bounded content. Optional SHA-256 verification can
                    // be added to a signed manifest without changing this DB format.
                    return text
                } finally {
                    connection.disconnect()
                }
            } catch (t: Throwable) {
                lastError = t
            }
        }
        throw lastError ?: IllegalStateException("No filter source")
    }

    private fun compileFromStoredLists(): Int {
        val listDir = File(context.filesDir, "sandfox/native-protection/lists")
        val temp = File(context.filesDir, "sandfox/native-protection/filter-db.tmp")
        temp.parentFile?.mkdirs()
        val compiler = FilterCompiler()
        selectedListIds().forEach { id ->
            val file = File(listDir, "$id.txt")
            if (file.isFile) compiler.add(file)
        }
        compiler.addLines(customFilters().lineSequence())
        val database = compiler.build()
        temp.writeText(database.serialize())
        val target = File(context.filesDir, "sandfox/native-protection/filter-db.v1")
        val backup = File(context.filesDir, "sandfox/native-protection/filter-db.bak")
        if (backup.exists()) backup.delete()
        if (target.exists()) check(target.renameTo(backup)) { "Could not stage old filter database" }
        if (!temp.renameTo(target)) {
            target.delete()
            backup.renameTo(target)
            return 0
        }
        backup.delete()
        databaseRef.set(database)
        return database.ruleCount
    }

    private fun database(): FilterDatabase {
        databaseRef.get()?.let { return it }
        synchronized(databaseRef) {
            databaseRef.get()?.let { return it }
            val target = File(context.filesDir, "sandfox/native-protection/filter-db.v1")
            val loaded = if (target.isFile) FilterDatabase.load(target) else FilterDatabase.empty()
            databaseRef.set(loaded)
            return loaded
        }
    }

    private fun normalizeHost(host: String?): String? =
        host?.trim('.')?.lowercase()?.takeIf { it.isNotEmpty() }

    private fun hostMatches(host: String, ruleHost: String): Boolean =
        host == ruleHost || host.endsWith(".$ruleHost")

    data class UpdateResult(val updated: Int, val failed: Int, val compiledRules: Int)

    data class FilterListDefinition(
        val id: String,
        val title: String,
        val group: String,
        val urls: List<String>,
    )

    companion object {
        private const val PREFS = "sandfox_native_protection"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_DISABLED_SITES = "disabled_sites"
        private const val KEY_SELECTED_LISTS = "selected_lists"
        private const val KEY_CUSTOM_FILTERS = "custom_filters"
        private const val KEY_BLOCK_COUNT = "block_count"
        private const val KEY_COSMETIC_ENABLED = "cosmetic_enabled"
        private const val MAX_LIST_BYTES = 8L * 1024L * 1024L
        private const val MAX_GENERIC_COSMETIC = 120
        private const val MAX_COSMETIC_RULES = 800
        private const val MAX_CSS_BYTES = 48_000
        private val TRUSTED_HOSTS = setOf(
            "ublockorigin.github.io",
            "ublockorigin.pages.dev",
            "cdn.jsdelivr.net",
            "easylist.to",
            "easylist-downloads.adblockplus.org",
            "malware-filter.gitlab.io",
            "malware-filter.pages.dev",
            "pgl.yoyo.org",
        )
        val DEFAULT_LISTS = setOf(
            "ublock-filters",
            "ublock-badware",
            "ublock-privacy",
            "ublock-unbreak",
            "easylist",
            "easyprivacy",
            "urlhaus-1",
            "plowe-0",
        )
        val FILTER_LISTS = listOf(
            FilterListDefinition("ublock-filters", "uBlock filters – Ads", "Default",
                listOf("https://ublockorigin.github.io/uAssets/filters/filters.min.txt")),
            FilterListDefinition("ublock-badware", "uBlock filters – Badware risks", "Default",
                listOf("https://ublockorigin.github.io/uAssets/filters/badware.min.txt")),
            FilterListDefinition("ublock-privacy", "uBlock filters – Privacy", "Privacy",
                listOf("https://ublockorigin.github.io/uAssets/filters/privacy.min.txt")),
            FilterListDefinition("ublock-unbreak", "uBlock filters – Unbreak", "Default",
                listOf("https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt")),
            FilterListDefinition("easylist", "EasyList", "Advertising",
                listOf("https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt")),
            FilterListDefinition("easyprivacy", "EasyPrivacy", "Privacy",
                listOf("https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt")),
            FilterListDefinition("urlhaus-1", "Online Malicious URL Blocklist", "Malware",
                listOf("https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt")),
            FilterListDefinition("plowe-0", "Peter Lowe’s Ad and tracking server list", "Multipurpose",
                listOf("https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext")),
            FilterListDefinition("easylist-annoyances", "EasyList – Other Annoyances", "Annoyances",
                listOf("https://ublockorigin.github.io/uAssets/thirdparties/easylist-annoyances.txt")),
            FilterListDefinition("ublock-annoyances", "uBlock filters – Annoyances", "Annoyances",
                listOf("https://ublockorigin.github.io/uAssets/filters/annoyances.min.txt")),
            FilterListDefinition("adguard-mobile", "AdGuard – Mobile Ads", "Advertising",
                listOf("https://filters.adtidy.org/extension/ublock/filters/11.txt")),
            FilterListDefinition("indianlist", "IndianList", "Regional",
                listOf("https://easylist-downloads.adblockplus.org/indianlist.txt")),
        )
        private val INSTANCE = AtomicReference<NativeProtectionEngine?>()

        fun get(context: Context): NativeProtectionEngine =
            INSTANCE.get() ?: synchronized(INSTANCE) {
                INSTANCE.get() ?: NativeProtectionEngine(context.applicationContext).also { INSTANCE.set(it) }
            }
    }
}

private data class FilterDatabase(
    val blockedDomains: Set<String>,
    val allowedDomains: Set<String>,
    val genericCosmetic: List<String>,
    val domainCosmetic: Map<String, List<String>>,
) {
    val ruleCount: Int
        get() = blockedDomains.size + allowedDomains.size + genericCosmetic.size + domainCosmetic.values.sumOf { it.size }

    fun isAllowed(host: String): Boolean = matchesHost(allowedDomains, host)

    fun isBlocked(host: String): Boolean = matchesHost(blockedDomains, host)

    fun addCosmeticSelectors(host: String, destination: MutableSet<String>, limit: Int) {
        var current = host
        while (true) {
            domainCosmetic[current]?.forEach { if (destination.size < limit) destination.add(it) }
            if (destination.size >= limit) return
            val dot = current.indexOf('.')
            if (dot < 0 || dot == current.lastIndex) return
            current = current.substring(dot + 1)
        }
    }

    private fun matchesHost(rules: Set<String>, host: String): Boolean {
        var current = host
        while (true) {
            if (rules.contains(current)) return true
            val dot = current.indexOf('.')
            if (dot < 0 || dot == current.lastIndex) return false
            current = current.substring(dot + 1)
        }
    }

    fun serialize(): String = buildString {
        blockedDomains.sorted().forEach { append("B|").append(it).append('\n') }
        allowedDomains.sorted().forEach { append("A|").append(it).append('\n') }
        genericCosmetic.distinct().forEach { append("G|").append(escape(it)).append('\n') }
        domainCosmetic.toSortedMap().forEach { (domain, selectors) ->
            selectors.distinct().forEach { selector ->
                append("C|").append(domain).append('|').append(escape(selector)).append('\n')
            }
        }
    }

    companion object {
        fun empty() = FilterDatabase(emptySet(), emptySet(), emptyList(), emptyMap())

        fun load(file: File): FilterDatabase {
            val blocked = LinkedHashSet<String>()
            val allowed = LinkedHashSet<String>()
            val generic = LinkedHashSet<String>()
            val domain = linkedMapOf<String, MutableList<String>>()
            file.forEachLine { line ->
                when {
                    line.startsWith("B|") -> blocked.add(line.substring(2))
                    line.startsWith("A|") -> allowed.add(line.substring(2))
                    line.startsWith("G|") -> unescape(line.substring(2))?.let(generic::add)
                    line.startsWith("C|") -> {
                        val parts = line.split('|', limit = 3)
                        if (parts.size == 3) {
                            unescape(parts[2])?.let { domain.getOrPut(parts[1]) { mutableListOf() }.add(it) }
                        }
                    }
                }
            }
            return FilterDatabase(blocked, allowed, generic.toList(), domain)
        }

        private fun escape(value: String): String =
            value.replace("\\", "\\\\").replace("\n", "\\n").replace("|", "\\p")

        private fun unescape(value: String): String =
            value.replace("\\n", "\n").replace("\\p", "|").replace("\\\\", "\\")
    }
}

private class FilterCompiler {
    private val blocked = LinkedHashSet<String>()
    private val allowed = LinkedHashSet<String>()
    private val generic = LinkedHashSet<String>()
    private val domain = linkedMapOf<String, MutableSet<String>>()

    fun add(file: File) {
        file.bufferedReader(Charsets.UTF_8).useLines { lines -> addLines(lines) }
    }

    fun addLines(lines: Sequence<String>) {
        lines.forEach { raw ->
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith("!") || line.startsWith("[") || line.startsWith("##+js")) {
                return@forEach
            }
            parseCosmetic(line)?.let { rule ->
                if (rule.selector.length <= 500) {
                    if (rule.domain == null) {
                        if (generic.size < MAX_COMPILED_GENERIC) generic.add(rule.selector)
                    } else {
                        val selectors = domain.getOrPut(rule.domain) { linkedSetOf() }
                        if (selectors.size < MAX_COMPILED_DOMAIN) selectors.add(rule.selector)
                    }
                }
                return@forEach
            }
            parseNetwork(line)
        }
    }

    private data class CosmeticRule(val domain: String?, val selector: String)

    private fun parseCosmetic(line: String): CosmeticRule? {
        val normalIndex = line.indexOf("##")
        if (normalIndex < 0 || line.contains("#@#")) return null
        val left = line.substring(0, normalIndex).trim()
        val selector = line.substring(normalIndex + 2).trim()
        if (selector.isEmpty() || selector.contains("+js")) return null
        val domain = left.takeIf { it.isNotEmpty() && !it.contains(",") }?.lowercase()
        return CosmeticRule(domain, selector)
    }

    private fun parseNetwork(line: String) {
        var value = line
        var isException = false
        if (value.startsWith("@@")) {
            isException = true
            value = value.substring(2)
        }
        val modifierPart = value.substringAfterLast('$', "")
        if (modifierPart.contains("redirect") || modifierPart.contains("csp") || modifierPart.contains("replace")) return

        val host = when {
            value.startsWith("||") -> value.removePrefix("||").substringBeforeAny("^", "/", "*", "|")
            value.startsWith("http://") || value.startsWith("https://") -> Uri.parse(value).host
            else -> {
                val tokens = value.trim().split(' ', '\t').filter { it.isNotBlank() }
                if (tokens.size >= 2 && looksLikeIpv4(tokens[0])) tokens[1]
                else value.substringBeforeAny("^", "/", "*", "|").takeIf { it.contains('.') && !it.contains(' ') }
            }
        } ?: return
        val normalized = host.trim('.').lowercase().removePrefix("www.")
        if (normalized.isBlank() || normalized.contains("*") || normalized.contains("[")) return
        if (isException) allowed.add(normalized) else blocked.add(normalized)
    }

    private fun looksLikeIpv4(value: String): Boolean {
        val parts = value.split('.')
        return parts.size == 4 && parts.all { it.toIntOrNull()?.let { n -> n in 0..255 } == true }
    }

    private fun String.substringBeforeAny(vararg delimiters: String): String {
        val indexes = delimiters.mapNotNull { indexOf(it).takeIf { it >= 0 } }
        return if (indexes.isEmpty()) this else substring(0, indexes.min())
    }

    fun build(): FilterDatabase = FilterDatabase(blocked, allowed, generic.toList(), domain.mapValues { it.value.toList() })

    companion object {
        private const val MAX_COMPILED_GENERIC = 2_000
        private const val MAX_COMPILED_DOMAIN = 200
    }
}
