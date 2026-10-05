package org.mozilla.fenix.darkmode

import android.content.Context
import org.json.JSONObject
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

object SandfoxDarkPages {
    private const val PREFS = "sandfox_dark_pages_v4"
    private const val KEY_MODE = "global_mode"
    private const val KEY_THEME = "global_theme"
    private const val KEY_SITES = "site_modes"
    private const val KEY_CUSTOM_THEMES = "custom_themes"

    enum class Mode(val wire: String) {
        OFF("OFF"), NATIVE("NATIVE"), SMART("SMART");
        companion object { fun fromWire(value: String?) = entries.firstOrNull { it.wire == value } ?: OFF }
    }

    enum class Theme(val wire: String, val title: String) {
        DARK("dark", "SANDFOX Dark"),
        GREY("grey", "SANDFOX Grey"),
        DEEP("deep", "SANDFOX Deep"),
        AMOLED("amoled", "SANDFOX AMOLED"),
        OLED("oled", "SANDFOX OLED"),
        BLUE("blue", "SANDFOX Blue"),
        WARM("warm", "SANDFOX Warm");
        companion object { fun fromWire(value: String?) = entries.firstOrNull { it.wire == value } ?: DARK }
    }

    fun getMode(context: Context): Mode =
        Mode.fromWire(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_MODE, Mode.OFF.wire))

    fun getTheme(context: Context): Theme =
        Theme.fromWire(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_THEME, Theme.DARK.wire))

    fun getSiteMode(context: Context, host: String): Mode? =
        if (host.isBlank()) null else {
            val sites = readSites(context)
            if (sites.has(host)) Mode.fromWire(sites.optString(host)) else null
        }

    fun setMode(context: Context, runtime: GeckoRuntime, mode: Mode) {
        prefs(context).edit().putString(KEY_MODE, mode.wire).apply()
        runtime.settings.setPreferredColorScheme(
            when (mode) {
                Mode.OFF -> GeckoRuntimeSettings.COLOR_SCHEME_SYSTEM
                Mode.NATIVE, Mode.SMART -> GeckoRuntimeSettings.COLOR_SCHEME_DARK
            },
        )
        SandfoxDarkEngine.pushConfig()
    }

    fun setTheme(context: Context, theme: Theme) {
        prefs(context).edit().putString(KEY_THEME, theme.wire).apply()
        SandfoxDarkEngine.pushConfig()
    }

    fun setSiteMode(context: Context, host: String, mode: Mode?) {
        if (host.isBlank()) return
        val sites = readSites(context)
        if (mode == null) sites.remove(host) else sites.put(host, mode.wire)
        prefs(context).edit().putString(KEY_SITES, sites.toString()).apply()
        SandfoxDarkEngine.pushConfig()
    }

    fun exportJson(context: Context): String =
        JSONObject().apply {
            put("format", "sandfox-settings")
            put("version", 1)
            put("darkPages", configJson(context))
        }.toString(2)

    fun importJson(context: Context, runtime: GeckoRuntime, text: String): Boolean =
        runCatching {
            val root = JSONObject(text)
            require(root.optString("format") == "sandfox-settings")
            require(root.optInt("version", 0) == 1)
            val dark = root.getJSONObject("darkPages")
            val mode = Mode.fromWire(dark.optString("globalMode", Mode.OFF.wire))
            val theme = Theme.fromWire(dark.optString("globalTheme", Theme.DARK.wire))
            val sites = dark.optJSONObject("sites") ?: JSONObject()
            prefs(context).edit()
                .putString(KEY_MODE, mode.wire)
                .putString(KEY_THEME, theme.wire)
                .putString(KEY_SITES, sites.toString())
                .putString(KEY_CUSTOM_THEMES, dark.optJSONArray("customThemes")?.toString() ?: "[]")
                .apply()
            setMode(context, runtime, mode)
        }.isSuccess

    internal fun configJson(context: Context): JSONObject =
        JSONObject().apply {
            put("globalMode", getMode(context).wire)
            put("globalTheme", getTheme(context).wire)
            put("sites", readSites(context))
            put("customThemes", readCustomThemes(context))
        }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun readSites(context: Context): JSONObject =
        runCatching { JSONObject(prefs(context).getString(KEY_SITES, "{}") ?: "{}") }.getOrElse { JSONObject() }
    private fun readCustomThemes(context: Context): org.json.JSONArray =
        runCatching { org.json.JSONArray(prefs(context).getString(KEY_CUSTOM_THEMES, "[]") ?: "[]") }.getOrElse { org.json.JSONArray() }
}
