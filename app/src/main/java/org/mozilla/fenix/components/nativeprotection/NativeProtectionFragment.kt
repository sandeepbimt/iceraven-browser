/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.text.format.DateFormat
import android.widget.EditText
import java.util.Date
import androidx.appcompat.app.AlertDialog
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.SwitchPreferenceCompat
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.requireComponents
import org.mozilla.fenix.ext.showToolbar

class NativeProtectionFragment : PreferenceFragmentCompat() {
    private val engine by lazy { NativeProtectionEngine.get(requireContext()) }

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        val screen = preferenceManager.createPreferenceScreen(requireContext())

        screen.addPreference(SwitchPreferenceCompat(requireContext()).apply {
            title = getString(R.string.native_protection_enabled)
            summaryOn = getString(R.string.native_protection_enabled_summary)
            summaryOff = getString(R.string.native_protection_disabled_summary)
            isChecked = engine.isEnabled()
            setOnPreferenceChangeListener { _, value ->
                engine.setEnabled(value as Boolean)
                reloadSelectedTab()
                true
            }
        })

        val selectedTabId = requireComponents.core.store.state.selectedTabId
        val selectedTab = selectedTabId?.let { id ->
            requireComponents.core.store.state.tabs.firstOrNull { it.id == id }
                ?: requireComponents.core.store.state.customTabs.firstOrNull { it.id == id }
        }
        val host = selectedTab?.content?.url?.let { Uri.parse(it).host?.lowercase()?.removePrefix("www.") }
        val trackingProtectionUseCases = requireComponents.useCases.trackingProtectionUseCases

        screen.addPreference(SwitchPreferenceCompat(requireContext()).apply {
            title = getString(R.string.native_protection_this_site)
            summary = host ?: getString(R.string.native_protection_no_site)
            isEnabled = selectedTabId != null && host != null
            isChecked = host?.let { engine.siteProtectionOverride(it) } ?: true
            selectedTabId?.let { tabId ->
                trackingProtectionUseCases.containsException(tabId) { excluded ->
                    activity?.runOnUiThread {
                        isChecked = !excluded
                        host?.let { engine.setSiteProtectionOverride(it, !excluded) }
                    }
                }
            }
            setOnPreferenceChangeListener { _, value ->
                val enabled = value as Boolean
                host?.let { engine.setSiteProtectionOverride(it, enabled) }
                selectedTabId?.let { tabId ->
                    if (enabled) trackingProtectionUseCases.removeException(tabId)
                    else trackingProtectionUseCases.addException(tabId)
                }
                reloadSelectedTab()
                true
            }
        })

        if (host != null) {
            screen.addPreference(Preference(requireContext()).apply {
                key = SITE_FILTER_LISTS_KEY
                title = getString(R.string.native_protection_site_filter_lists)
                summary = siteFilterSummary(host)
                setOnPreferenceClickListener {
                    showSiteFilterListsDialog(host)
                    true
                }
            })
        }

        screen.addPreference(Preference(requireContext()).apply {
            key = FILTER_LISTS_KEY
            title = getString(R.string.native_protection_filter_lists)
            summary = getString(R.string.native_protection_lists_selected, engine.selectedListIds().size)
            setOnPreferenceClickListener {
                showFilterListsDialog()
                true
            }
        })

        val updatePreference = Preference(requireContext()).apply {
            key = UPDATE_KEY
            title = getString(R.string.native_protection_update_filters)
            summary = refreshSummary()
            setOnPreferenceClickListener {
                summary = getString(R.string.native_protection_updating)
                engine.refreshCosmeticFilters()
                engine.refreshFilters { success ->
                    activity?.runOnUiThread {
                        summary = refreshSummary(success)
                    }
                }
                true
            }
        }
        screen.addPreference(updatePreference)

        screen.addPreference(Preference(requireContext()).apply {
            title = getString(R.string.native_protection_custom_filters)
            summary = if (engine.customFilters().isBlank()) {
                getString(R.string.native_protection_custom_filters_message)
            } else {
                getString(R.string.native_protection_custom_filters_summary)
            }
            setOnPreferenceClickListener {
                showCustomFiltersDialog()
                true
            }
        })

        screen.addPreference(Preference(requireContext()).apply {
            title = getString(R.string.native_protection_engine)
            summary = getString(R.string.native_protection_engine_summary)
        })

        preferenceScreen = screen
    }

    private fun showSiteFilterListsDialog(host: String) {
        val global = engine.selectedListIds()
        val current = engine.siteListOverride(host)
        val selected = (current ?: global).toMutableSet()
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.native_protection_site_filter_lists)
            .setMultiChoiceItems(
                NativeProtectionEngine.FILTER_LISTS.map { it.title }.toTypedArray(),
                NativeProtectionEngine.FILTER_LISTS.map { selected.contains(it.id) }.toBooleanArray(),
            ) { _, which, checked ->
                if (checked) selected += NativeProtectionEngine.FILTER_LISTS[which].id
                else selected -= NativeProtectionEngine.FILTER_LISTS[which].id
            }
            .setNeutralButton(R.string.native_protection_use_global) {
                _, _ ->
                engine.clearSiteListOverride(host)
                findPreference<Preference>(SITE_FILTER_LISTS_KEY)?.summary = siteFilterSummary(host)
                reloadSelectedTab()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                engine.setSiteListOverride(host, selected)
                findPreference<Preference>(SITE_FILTER_LISTS_KEY)?.summary = siteFilterSummary(host)
                reloadSelectedTab()
            }
            .show()
    }

    private fun siteFilterSummary(host: String): String =
        engine.siteListOverride(host)?.let {
            getString(R.string.native_protection_site_lists_selected, it.size)
        } ?: getString(R.string.native_protection_site_lists_global)

    private fun showFilterListsDialog() {
        val lists = NativeProtectionEngine.FILTER_LISTS
        val selected = engine.selectedListIds().toMutableSet()
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.native_protection_filter_lists)
            .setMultiChoiceItems(
                lists.map { it.title }.toTypedArray(),
                lists.map { selected.contains(it.id) }.toBooleanArray(),
            ) { _, which, checked ->
                if (checked) selected += lists[which].id else selected -= lists[which].id
            }
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                engine.setSelectedListIds(selected)
                findPreference<Preference>(FILTER_LISTS_KEY)?.summary =
                    getString(R.string.native_protection_lists_selected, selected.size)
                reloadSelectedTab()
            }
            .show()
    }

    private fun showCustomFiltersDialog() {
        val editText = EditText(requireContext()).apply {
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            minLines = 10
            maxLines = 20
            setSingleLine(false)
            setHorizontallyScrolling(false)
            setText(engine.customFilters())
            setSelection(length())
        }

        AlertDialog.Builder(requireContext())
            .setTitle(R.string.native_protection_custom_filters)
            .setMessage(R.string.native_protection_custom_filters_message)
            .setView(editText)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                engine.setCustomFilters(editText.text.toString())
                reloadSelectedTab()
            }
            .show()
    }

    override fun onResume() {
        super.onResume()
        showToolbar(getString(R.string.native_protection_title))
        findPreference<Preference>(UPDATE_KEY)?.summary = refreshSummary()
    }

    private fun refreshSummary(result: Boolean? = null): String {
        result?.let {
            return if (it) {
                getString(
                    R.string.native_protection_update_applied,
                    formatRefreshTime(engine.lastRefreshSucceededAt()),
                )
            } else {
                getString(
                    R.string.native_protection_update_failed,
                    formatRefreshTime(engine.lastRefreshFailedAt()),
                )
            }
        }

        val requested = engine.lastRefreshRequestedAt()
        if (requested == 0L) {
            return getString(R.string.native_protection_update_summary)
        }

        val succeeded = engine.lastRefreshSucceededAt()
        val failed = engine.lastRefreshFailedAt()
        return when {
            failed >= requested -> getString(
                R.string.native_protection_update_failed,
                formatRefreshTime(failed),
            )
            succeeded >= requested -> getString(
                R.string.native_protection_update_applied,
                formatRefreshTime(succeeded),
            )
            else -> getString(
                R.string.native_protection_update_pending,
                formatRefreshTime(requested),
            )
        }
    }

    private fun formatRefreshTime(timestamp: Long): String =
        DateFormat.getTimeFormat(requireContext()).format(Date(timestamp))

    private fun reloadSelectedTab() {
        requireComponents.core.store.state.selectedTabId?.let { tabId ->
            requireComponents.useCases.sessionUseCases.reload.invoke(tabId)
        }
    }

    companion object {
        private const val FILTER_LISTS_KEY = "sandfox_filter_lists"
        private const val SITE_FILTER_LISTS_KEY = "sandfox_site_filter_lists"
        private const val UPDATE_KEY = "sandfox_filter_update"
    }
}
