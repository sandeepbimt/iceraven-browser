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

        screen.addPreference(
            SwitchPreferenceCompat(requireContext()).apply {
                key = "native_protection_enabled"
                title = getString(R.string.native_protection_enabled)
                summaryOn = getString(R.string.native_protection_enabled_summary)
                summaryOff = getString(R.string.native_protection_disabled_summary)
                isChecked = engine.isGloballyEnabled()
                setOnPreferenceChangeListener { _, value ->
                    engine.setGlobalEnabled(value as Boolean)
                    true
                }
            }
        )

        val host = requireComponents.core.store.state.selectedTab?.content?.url?.let { Uri.parse(it).host }
        screen.addPreference(
            SwitchPreferenceCompat(requireContext()).apply {
                key = "native_protection_site"
                title = getString(R.string.native_protection_this_site)
                summary = host ?: getString(R.string.native_protection_no_site)
                isChecked = host?.let(engine::isEnabledForHost) ?: false
                setOnPreferenceChangeListener { _, value ->
                    host?.let { engine.setSiteEnabled(it, value as Boolean) }
                    true
                }
            }
        )

        screen.addPreference(
            MultiSelectListPreference(requireContext()).apply {
                key = "native_protection_lists"
                title = getString(R.string.native_protection_filter_lists)
                entries = NativeProtectionEngine.FILTER_LISTS.map { it.title }.toTypedArray()
                entryValues = NativeProtectionEngine.FILTER_LISTS.map { it.id }.toTypedArray()
                values = engine.selectedListIds()
                summaryProvider = Preference.SummaryProvider<MultiSelectListPreference> {
                    getString(R.string.native_protection_lists_selected, it.values.size)
                }
                setOnPreferenceChangeListener { _, newValue ->
                    engine.setSelectedListIds(newValue as Set<String>)
                    true
                }
            }
        )

        screen.addPreference(
            Preference(requireContext()).apply {
                key = "native_protection_update"
                title = getString(R.string.native_protection_update_filters)
                summary = getString(R.string.native_protection_update_summary)
                setOnPreferenceClickListener {
                    title = getString(R.string.native_protection_updating)
                    engine.updateSelectedListsAsync {
                        activity?.runOnUiThread {
                            title = getString(R.string.native_protection_update_filters)
                            summary = getString(
                                R.string.native_protection_update_result,
                                it.updated,
                                it.failed,
                                it.compiledRules,
                            )
                        }
                    }
                    true
                }
            }
        )

        screen.addPreference(
            SwitchPreferenceCompat(requireContext()).apply {
                key = "native_protection_cosmetic"
                title = getString(R.string.native_protection_cosmetic)
                summary = getString(R.string.native_protection_cosmetic_summary)
                isChecked = engine.cosmeticEnabled()
                setOnPreferenceChangeListener { _, value ->
                    engine.setCosmeticEnabled(value as Boolean)
                    true
                }
            }
        )

        screen.addPreference(
            EditTextPreference(requireContext()).apply {
                key = "native_protection_custom_filters"
                title = getString(R.string.native_protection_custom_filters)
                dialogTitle = getString(R.string.native_protection_custom_filters)
                dialogMessage = getString(R.string.native_protection_custom_filters_message)
                text = engine.customFilters()
                setOnPreferenceChangeListener { _, value ->
                    engine.setCustomFilters(value as String)
                    true
                }
                setOnBindEditTextListener { editText ->
                    editText.minLines = 10
                    editText.maxLines = 20
                    editText.isSingleLine = false
                    editText.setHorizontallyScrolling(false)
                }
            }
        )

        screen.addPreference(
            Preference(requireContext()).apply {
                key = "native_protection_stats"
                title = getString(R.string.native_protection_stats)
                summary = getString(R.string.native_protection_stats_summary, engine.blockCount())
            }
        )

        screen.addPreference(
            Preference(requireContext()).apply {
                key = "native_protection_info"
                title = getString(R.string.native_protection_info)
                summary = getString(R.string.native_protection_info_summary)
            }
        )

        preferenceScreen = screen
    }

    override fun onResume() {
        super.onResume()
        showToolbar(getString(R.string.native_protection_title))
    }
}
