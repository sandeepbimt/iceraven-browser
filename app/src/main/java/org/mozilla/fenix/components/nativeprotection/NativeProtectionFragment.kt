/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.net.Uri
import android.os.Bundle
import androidx.preference.EditTextPreference
import androidx.preference.MultiSelectListPreference
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
                true
            }
        })

        val selectedTabId = requireComponents.core.store.state.selectedTabId
        val selectedTab = selectedTabId?.let { id ->
            requireComponents.core.store.state.tabs.firstOrNull { it.id == id }
                ?: requireComponents.core.store.state.customTabs.firstOrNull { it.id == id }
        }
        val host = selectedTab?.content?.url?.let { Uri.parse(it).host }
        val trackingProtectionUseCases = requireComponents.useCases.trackingProtectionUseCases

        screen.addPreference(SwitchPreferenceCompat(requireContext()).apply {
            title = getString(R.string.native_protection_this_site)
            summary = host ?: getString(R.string.native_protection_no_site)
            isEnabled = selectedTabId != null && host != null
            isChecked = true
            selectedTabId?.let { tabId ->
                trackingProtectionUseCases.containsException(tabId) { excluded ->
                    activity?.runOnUiThread { isChecked = !excluded }
                }
            }
            setOnPreferenceChangeListener { _, value ->
                selectedTabId?.let { tabId ->
                    if (value as Boolean) {
                        trackingProtectionUseCases.removeException(tabId)
                    } else {
                        trackingProtectionUseCases.addException(tabId)
                    }
                }
                true
            }
        })

        screen.addPreference(MultiSelectListPreference(requireContext()).apply {
            title = getString(R.string.native_protection_filter_lists)
            entries = NativeProtectionEngine.FILTER_LISTS.map { it.title }.toTypedArray()
            entryValues = NativeProtectionEngine.FILTER_LISTS.map { it.id }.toTypedArray()
            values = engine.selectedListIds()
            summaryProvider = Preference.SummaryProvider<MultiSelectListPreference> {
                getString(R.string.native_protection_lists_selected, it.values.size)
            }
            setOnPreferenceChangeListener { _, value ->
                engine.setSelectedListIds((value as? Set<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet())
                true
            }
        })

        screen.addPreference(Preference(requireContext()).apply {
            title = getString(R.string.native_protection_update_filters)
            summary = getString(R.string.native_protection_update_summary)
            setOnPreferenceClickListener {
                title = getString(R.string.native_protection_updating)
                engine.refreshFilters()
                title = getString(R.string.native_protection_update_filters)
                summary = getString(R.string.native_protection_update_started)
                true
            }
        })

        screen.addPreference(EditTextPreference(requireContext()).apply {
            title = getString(R.string.native_protection_custom_filters)
            dialogTitle = getString(R.string.native_protection_custom_filters)
            dialogMessage = getString(R.string.native_protection_custom_filters_message)
            text = engine.customFilters()
            setOnPreferenceChangeListener { _, value ->
                engine.setCustomFilters(value as String)
                summary = getString(R.string.native_protection_custom_filters_summary)
                true
            }
            setOnBindEditTextListener { editText ->
                editText.minLines = 10
                editText.maxLines = 20
                editText.isSingleLine = false
                editText.setHorizontallyScrolling(false)
            }
        })

        screen.addPreference(Preference(requireContext()).apply {
            title = getString(R.string.native_protection_engine)
            summary = getString(R.string.native_protection_engine_summary)
        })

        preferenceScreen = screen
    }

    override fun onResume() {
        super.onResume()
        showToolbar(getString(R.string.native_protection_title))
    }
}
