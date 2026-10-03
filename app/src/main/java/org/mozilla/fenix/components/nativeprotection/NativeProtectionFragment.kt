/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.nativeprotection

import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
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
                    if (value as Boolean) trackingProtectionUseCases.removeException(tabId)
                    else trackingProtectionUseCases.addException(tabId)
                }
                true
            }
        })

        screen.addPreference(Preference(requireContext()).apply {
            key = FILTER_LISTS_KEY
            title = getString(R.string.native_protection_filter_lists)
            summary = getString(R.string.native_protection_lists_selected, engine.selectedListIds().size)
            setOnPreferenceClickListener {
                showFilterListsDialog()
                true
            }
        })

        screen.addPreference(Preference(requireContext()).apply {
            title = getString(R.string.native_protection_update_filters)
            summary = getString(R.string.native_protection_update_summary)
            setOnPreferenceClickListener {
                engine.refreshFilters()
                summary = getString(R.string.native_protection_update_started)
                true
            }
        })

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
            }
            .show()
    }

    override fun onResume() {
        super.onResume()
        showToolbar(getString(R.string.native_protection_title))
    }

    companion object {
        private const val FILTER_LISTS_KEY = "sandfox_filter_lists"
    }
}
