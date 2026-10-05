/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components

import android.content.Context
import android.content.res.Configuration
import androidx.core.content.ContextCompat
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import mozilla.components.browser.domains.autocomplete.BaseDomainAutocompleteProvider
import mozilla.components.browser.domains.autocomplete.ShippedDomainsProvider
import mozilla.components.browser.engine.gecko.GeckoEngine
import mozilla.components.browser.engine.gecko.fetch.GeckoViewFetchClient
import mozilla.components.browser.engine.gecko.permission.GeckoSitePermissionsStorage
import mozilla.components.browser.engine.gecko.util.EngineDownloadDelegate
import mozilla.components.browser.icons.BrowserIcons
import mozilla.components.browser.session.storage.SessionStorage
import mozilla.components.browser.state.engine.EngineMiddleware
import mozilla.components.browser.state.engine.middleware.SessionPrioritizationMiddleware
import mozilla.components.browser.state.engine.middleware.TranslationsMiddleware
import mozilla.components.browser.state.selector.findTabOrCustomTab
import mozilla.components.browser.state.state.BrowserState
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.browser.storage.sync.PlacesBookmarksStorage
import mozilla.components.browser.storage.sync.PlacesHistoryStorage
import mozilla.components.browser.storage.sync.RemoteTabsStorage
import mozilla.components.browser.thumbnails.ThumbnailsMiddleware
import mozilla.components.browser.thumbnails.storage.ThumbnailStorage
import mozilla.components.concept.base.crash.CrashReporting
import mozilla.components.concept.engine.DefaultSettings
import mozilla.components.concept.engine.Engine
import mozilla.components.concept.engine.fission.WebContentIsolationStrategy
import mozilla.components.concept.engine.mediaquery.PreferredColorScheme
import mozilla.components.concept.fetch.Client
import mozilla.components.feature.awesomebar.provider.SessionAutocompleteProvider
import mozilla.components.feature.customtabs.store.CustomTabsServiceStore
import mozilla.components.feature.downloads.DefaultFileSizeFormatter
import mozilla.components.feature.downloads.DownloadEstimator
import mozilla.components.feature.downloads.DownloadMiddleware
import mozilla.components.feature.downloads.FileSizeFormatter
import mozilla.components.feature.fxsuggest.facts.FxSuggestFactsMiddleware
import mozilla.components.feature.logins.exceptions.LoginExceptionStorage
import mozilla.components.feature.media.MediaSessionFeature
import mozilla.components.feature.media.middleware.LastMediaAccessMiddleware
import mozilla.components.feature.media.middleware.RecordingDevicesMiddleware
import mozilla.components.feature.prompts.PromptMiddleware
import mozilla.components.feature.prompts.file.FileUploadsDirCleaner
import mozilla.components.feature.prompts.file.FileUploadsDirCleanerMiddleware
import mozilla.components.feature.protection.dashboard.ProtectionsDashboardMiddleware
import mozilla.components.feature.protection.dashboard.ProtectionsStorage
import mozilla.components.feature.pwa.ManifestStorage
import mozilla.components.feature.pwa.WebAppShortcutManager
import mozilla.components.feature.readerview.ReaderViewMiddleware
import mozilla.components.feature.recentlyclosed.RecentlyClosedMiddleware
import mozilla.components.feature.recentlyclosed.RecentlyClosedTabsStorage
import mozilla.components.feature.search.SearchApplicationName
import mozilla.components.feature.search.SearchDeviceType
import mozilla.components.feature.search.SearchUpdateChannel
import mozilla.components.feature.search.middleware.AdsTelemetryMiddleware
import mozilla.components.feature.search.middleware.SearchExtraParams
import mozilla.components.feature.search.middleware.SearchMiddleware
import mozilla.components.feature.search.region.RegionMiddleware
import mozilla.components.feature.search.storage.SearchEngineSelectorConfig
import mozilla.components.feature.search.telemetry.SerpTelemetryRepository
import mozilla.components.feature.search.telemetry.ads.AdsTelemetry
import mozilla.components.feature.search.telemetry.incontent.InContentTelemetry
import mozilla.components.feature.session.HistoryDelegate
import mozilla.components.feature.session.middleware.LastAccessMiddleware
import mozilla.components.feature.session.middleware.undo.UndoMiddleware
import mozilla.components.feature.sitepermissions.OnDiskSitePermissionsStorage
import mozilla.components.feature.summarize.settings.SummarizationSettings
import mozilla.components.feature.top.sites.DefaultTopSitesStorage
import mozilla.components.feature.top.sites.PinnedSiteStorage
import mozilla.components.feature.webcompat.WebCompatFeature
import mozilla.components.feature.webnotifications.WebNotificationFeature
import mozilla.components.lib.ai.controls.AIFeatureBlockStorage
import mozilla.components.lib.ai.controls.dataStore
import mozilla.components.lib.dataprotect.SecureAbove22Preferences
import mozilla.components.service.digitalassetlinks.RelationChecker
import mozilla.components.service.digitalassetlinks.local.StatementApi
import mozilla.components.service.digitalassetlinks.local.StatementRelationChecker
import mozilla.components.service.location.LocationService
import mozilla.components.service.location.MozillaLocationService
import mozilla.components.service.mars.MacTopSitesProvider
import mozilla.components.service.mars.MacTopSitesRequestConfig
import mozilla.components.service.mars.MacTopSitesUpdater
import mozilla.components.service.mars.NEW_TAB_TILE_1_PLACEMENT_KEY
import mozilla.components.service.mars.NEW_TAB_TILE_2_PLACEMENT_KEY
import mozilla.components.service.merino.manifest.MerinoManifestProvider
import mozilla.components.service.pocket.ContentRecommendationsRequestConfig
import mozilla.components.service.pocket.PocketStoriesConfig
import mozilla.components.service.pocket.PocketStoriesService
import mozilla.components.service.pocket.mars.api.MarsSpocsRequestConfig
import mozilla.components.service.pocket.mars.api.NEW_TAB_SPOCS_PLACEMENT_KEY
import mozilla.components.service.pocket.mars.api.Placement as MarsSpocsPlacement
import mozilla.components.service.sync.autofill.AutofillCreditCardsAddressesStorage
import mozilla.components.service.sync.logins.SyncableLoginsStorage
import mozilla.components.support.base.worker.Frequency
import mozilla.components.support.ktx.android.content.appVersionName
import mozilla.components.support.ktx.android.content.res.readJSONObject
import mozilla.components.support.locale.LocaleManager
import mozilla.components.support.utils.DateTimeProvider
import mozilla.components.support.utils.DefaultDateTimeProvider
import mozilla.components.support.utils.DefaultDownloadFileUtils
import mozilla.components.support.utils.RunWhenReadyQueue
import org.mozilla.fenix.AppRequestInterceptor
import org.mozilla.fenix.BuildConfig
import org.mozilla.fenix.Config
import org.mozilla.fenix.IntentReceiverActivity
import org.mozilla.fenix.R
import org.mozilla.fenix.ReleaseChannel
import org.mozilla.fenix.browser.desktopmode.DefaultDesktopModeRepository
import org.mozilla.fenix.browser.desktopmode.DesktopModeMiddleware
import org.mozilla.fenix.components.search.ApplicationSearchMiddleware
import org.mozilla.fenix.components.search.SearchMigration
import org.mozilla.fenix.components.search.SearchWidgetMiddleware
import org.mozilla.fenix.darkmode.SandfoxDarkEngine
import org.mozilla.fenix.darkmode.SandfoxDarkPages
import org.mozilla.fenix.downloads.DownloadService
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.ext.isLargeWindow
import org.mozilla.fenix.gecko.GeckoProvider
import org.mozilla.fenix.historymetadata.DefaultHistoryMetadataService
import org.mozilla.fenix.historymetadata.HistoryMetadataMiddleware
import org.mozilla.fenix.historymetadata.HistoryMetadataService
import org.mozilla.fenix.longfox.LongFoxFeature
import org.mozilla.fenix.media.MediaSessionService
import org.mozilla.fenix.nimbus.FxNimbus
import org.mozilla.fenix.perf.StrictModeManager
import org.mozilla.fenix.perf.lazyMonitored
import org.mozilla.fenix.settings.advanced.getSelectedLocale
import org.mozilla.fenix.settings.downloads.DownloadLocationManager
import org.mozilla.fenix.share.DefaultSentFromFirefoxManager
import org.mozilla.fenix.share.DefaultSentFromStorage
import org.mozilla.fenix.share.SaveToPDFMiddleware
import org.mozilla.fenix.summarization.FenixSummarizationSettingsBinding
import org.mozilla.fenix.summarization.eligibility.DefaultSummarizationEligibilityChecker
import org.mozilla.fenix.summarization.eligibility.SummarizationEligibilityChecker
import org.mozilla.fenix.summarization.onboarding.FenixSummarizationFeatureConfiguration
import org.mozilla.fenix.summarization.onboarding.SummarizationFeatureDiscoveryConfiguration
import org.mozilla.fenix.tabgroups.storage.redux.middleware.TabGroupMiddleware
import org.mozilla.fenix.tabgroups.storage.repository.DefaultTabGroupRepository
import org.mozilla.fenix.telemetry.TelemetryMiddleware
import org.mozilla.fenix.translations.TranslationsEnabledSettings
import org.mozilla.fenix.utils.Settings.DeleteDownloadBehavior
import org.mozilla.fenix.utils.getUndoDelay
import org.mozilla.geckoview.GeckoRuntime

/** Component group for all core browser functionality. */
@Suppress("LargeClass")
class Core(
    private val context: Context,
    private val crashReporter: CrashReporting,
    strictMode: StrictModeManager,
    visualCompletenessQueue: RunWhenReadyQueue,
) {
    /** The browser engine component initialized based on the build configuration (see build variants). */
    val engine: Engine by lazyMonitored {
        val defaultSettings =
            DefaultSettings(
                requestInterceptor = requestInterceptor,
                remoteDebuggingEnabled = context.components.settings.isRemoteDebuggingEnabled,
                testingModeEnabled = false,
                trackingProtectionPolicy = trackingProtectionPolicyFactory.createTrackingProtectionPolicy(),
                historyTrackingDelegate = HistoryDelegate(lazyHistoryStorage),
                preferredColorScheme = getPreferredColorScheme(),
                automaticFontSizeAdjustment = context.components.settings.shouldUseAutoSize,
                fontInflationEnabled = context.components.settings.shouldUseAutoSize,
                suspendMediaWhenInactive = false,
                forceUserScalableContent = context.components.settings.forceEnableZoom,
                loginAutofillEnabled = context.components.settings.shouldAutofillLogins,
                enterpriseRootsEnabled = context.components.settings.allowThirdPartyRootCerts,
                clearColor =
                    ContextCompat.getColor(
                        context,
                        R.color.fx_mobile_surface,
                    ),
                httpsOnlyMode = context.components.settings.getHttpsOnlyMode(),
                dohSettingsMode = context.components.settings.getDohSettingsMode(),
                dohProviderUrl = context.components.settings.dohProviderUrl,
                dohDefaultProviderUrl = context.components.settings.dohDefaultProviderUrl,
                dohExceptionsList = context.components.settings.dohExceptionsList.toList(),
                globalPrivacyControlEnabled = context.components.settings.shouldEnableGlobalPrivacyControl,
                fdlibmMathEnabled = FxNimbus.features.fingerprintingProtection.value().fdlibmMath,
                emailTrackerBlockingPrivateBrowsing = true,
                userCharacteristicPingCurrentVersion = FxNimbus.features.userCharacteristics.value().currentVersion,
                getDesktopMode = {
                    store.state.desktopMode
                },
                webContentIsolationStrategy = WebContentIsolationStrategy.fromValue(1),
                fetchPriorityEnabled = true,
                parallelMarkingEnabled = FxNimbus.features.javascript.value().parallelMarkingEnabled,
                certificateTransparencyMode = FxNimbus.features.pki.value().certificateTransparencyMode,
                postQuantumKeyExchangeEnabled = FxNimbus.features.pqcrypto.value().postQuantumKeyExchangeEnabled,
                dohAutoselectEnabled = FxNimbus.features.doh.value().autoselectEnabled,
                bannedPorts = FxNimbus.features.networkingBannedPorts.value().bannedPortList,
                lnaBlockingEnabled = context.components.settings.isLnaBlockingEnabled,
                lnaFeatureEnabled = context.components.settings.isLnaFeatureEnabled,
                lnaTrackerBlockingEnabled = context.components.settings.isLnaTrackerBlockingEnabled,
                crliteChannel = FxNimbus.features.pki.value().crliteChannel,
                downloadDelegate =
                    EngineDownloadDelegate(
                        context = context,
                        downloadLocation = {
                            DownloadLocationManager(context.components.settings, context.contentResolver)
                                .defaultLocation
                        },
                    ),
                useContentBlockingDatabase = true,
            )

        // Apply fingerprinting protection overrides if the feature is enabled in Nimbus
        if (FxNimbus.features.fingerprintingProtection.value().enabled) {
            defaultSettings.fingerprintingProtectionOverrides =
                FxNimbus.features.fingerprintingProtection.value().overrides
            defaultSettings.fingerprintingProtection = FxNimbus.features.fingerprintingProtection.value().enabledNormal
            defaultSettings.fingerprintingProtectionPrivateBrowsing =
                FxNimbus.features.fingerprintingProtection.value().enabledPrivate
        }

        if (FxNimbus.features.baselineFpp.value().featEnabled) {
            defaultSettings.baselineFingerprintingProtection = FxNimbus.features.baselineFpp.value().enabled
            defaultSettings.baselineFingerprintingProtectionOverrides = FxNimbus.features.baselineFpp.value().overrides
        }

        // Apply third-party cookie blocking settings if the Nimbus feature is
        // enabled.
        if (FxNimbus.features.thirdPartyCookieBlocking.value().enabled) {
            defaultSettings.cookieBehaviorOptInPartitioning =
                FxNimbus.features.thirdPartyCookieBlocking.value().enabledNormal
            defaultSettings.cookieBehaviorOptInPartitioningPBM =
                FxNimbus.features.thirdPartyCookieBlocking.value().enabledPrivate
        }

        // Apply Safe Browsing V5 settings if the Nimbus feature is enabled.
        if (FxNimbus.features.safeBrowsingV5.value().featureEnabled) {
            defaultSettings.safeBrowsingV5Enabled = FxNimbus.features.safeBrowsingV5.value().enableV5
        }

        // Apply Safe Browsing Real-Time settings if the Nimbus feature is enabled.
        with(FxNimbus.features.safeBrowsingRealTime.value()) {
            if (featureEnabled) {
                defaultSettings.safeBrowsingGlobalCacheEnabled = globalCacheEnabled
                defaultSettings.safeBrowsingRealTimeEnabled = realTimeEnabled
                defaultSettings.safeBrowsingRealTimeSimulationEnabled = simulationEnabled
                defaultSettings.safeBrowsingRealTimeSimulationHitProbability = simulationHitProbability
                defaultSettings.safeBrowsingRealTimeSimulationCacheTTLSec = simulationCacheTtlSec
                defaultSettings.safeBrowsingRealTimeSimulationNegativeCacheEnabled = simulationNegativeCacheEnabled
                defaultSettings.safeBrowsingRealTimeSimulationNegativeCacheTTLSec = simulationNegativeCacheTtlSec
            }
        }

        GeckoEngine(
                context = context,
                defaultSettings = defaultSettings,
                runtime = geckoRuntime,
            )
            .also {
                WebCompatFeature.install(it)
                SandfoxDarkEngine.install(context, geckoRuntime)
            }
    }

    /**
     * Passed to [engine] to intercept requests for app links, and various features triggered by page load requests.
     *
     * NB: This does not need to be lazy as it is initialized with the engine on startup.
     */
    val requestInterceptor =
        AppRequestInterceptor(
            context = context,
            isPrivateForSession = { session ->
                store.state.findTabOrCustomTab(session)?.content?.private ?: true
            },
        )

    /** [Client] implementation to be used for code depending on `concept-fetch`` */
    val client: Client by lazyMonitored {
        GeckoViewFetchClient(
            context,
            geckoRuntime,
        )
    }

    val fileUploadsDirCleaner: FileUploadsDirCleaner by lazyMonitored {
        FileUploadsDirCleaner { context.cacheDir }
    }

    val geckoRuntime: GeckoRuntime by lazyMonitored {
        GeckoProvider.getOrCreateRuntime(
            context,
            lazyAutofillStorage,
            lazyPasswordsStorage,
            trackingProtectionPolicyFactory.createTrackingProtectionPolicy(),
        )
    }

    val geckoSitePermissionsStorage by lazyMonitored {
        GeckoSitePermissionsStorage(geckoRuntime, OnDiskSitePermissionsStorage(context))
    }

    val sessionStorage: SessionStorage by lazyMonitored {
        SessionStorage(context, engine, crashReporter)
    }

    private val locationService: LocationService by lazyMonitored {
        if (BuildConfig.MLS_TOKEN.isEmpty()) {
            LocationService.default()
        } else {
            MozillaLocationService(context, client, BuildConfig.MLS_TOKEN)
        }
    }

    /** The [BrowserStore] holds the global [BrowserState]. */
    val store by lazyMonitored {
        val searchExtraParamsNimbus = FxNimbus.features.searchExtraParams.value()
        val searchExtraParams =
            searchExtraParamsNimbus
                .takeIf { it.enabled }
                ?.run {
                    SearchExtraParams(
                        searchEngine,
                        featureEnabler.keys.firstOrNull(),
                        featureEnabler.values.firstOrNull(),
                        channelId.keys.first(),
                        channelId.values.first(),
                    )
                }

        val middlewareList =
            listOf(
                ProfileMarkerMiddleware(markerName = "BrowserStore", profiler = engine.profiler),
                LogMiddleware(tag = "BrowserStore", shouldIncludeDetailedData = { Config.channel.isDebug }),
                LastAccessMiddleware(),
                RecentlyClosedMiddleware(recentlyClosedTabsStorage, RECENTLY_CLOSED_MAX),
                DownloadMiddleware(
                    applicationContext = context,
                    downloadServiceClass = DownloadService::class.java,
                    deleteFileFromStorage = {
                        context.components.settings.deleteDownloadBehavior == DeleteDownloadBehavior.DELETE_FROM_DEVICE
                    },
                    downloadFileUtils =
                        DefaultDownloadFileUtils(
                            context = context.applicationContext,
                            downloadLocation = {
                                DownloadLocationManager(
                                        context.components.settings,
                                        context.contentResolver,
                                    )
                                    .defaultLocation
                            },
                        ),
                ),
                ReaderViewMiddleware(),
                TelemetryMiddleware(context, context.components.settings, metrics, crashReporter),
                ThumbnailsMiddleware(thumbnailStorage),
                UndoMiddleware(context.components.settings.getUndoDelay()),
                RegionMiddleware(context, locationService),
                SearchMiddleware(
                    context = context,
                    additionalBundledSearchEngineIds = listOf("reddit", "youtube"),
                    migration = SearchMigration(context),
                    searchExtraParams = searchExtraParams,
                    searchEngineSelectorConfig = getSearchEngineSelectorConfig(),
                ),
                RecordingDevicesMiddleware(context, context.components.notificationsDelegate),
                PromptMiddleware(),
                AdsTelemetryMiddleware(adsTelemetry),
                LastMediaAccessMiddleware(),
                HistoryMetadataMiddleware(historyMetadataService),
                ProtectionsDashboardMiddleware(protectionsStorage),
                SessionPrioritizationMiddleware(),
                SaveToPDFMiddleware(context),
                FxSuggestFactsMiddleware(),
                FileUploadsDirCleanerMiddleware(fileUploadsDirCleaner),
                DesktopModeMiddleware(repository = DefaultDesktopModeRepository(context = context)),
                ApplicationSearchMiddleware(context),
                SearchWidgetMiddleware(context),
                // We are disabling automatically initializing translations so that we can control when
                // we start this process. For details, see:
                // https://bugzilla.mozilla.org/show_bug.cgi?id=1958042
                TranslationsMiddleware(
                    engine = engine,
                    scope = MainScope(),
                    automaticallyInitialize = false,
                    isTranslationsEnabled = {
                        TranslationsEnabledSettings.dataStore(context).isEnabled.first()
                    },
                ),
                AboutHomeMiddleware(homepageTitle = context.getString(R.string.tab_tray_homepage_tab)),
                BrowserVisualCompletenessMiddleware(visualCompletenessQueue),
                TabGroupMiddleware(tabGroupRepository = tabGroupRepository),
            )

        BrowserStore(
                middleware =
                    middlewareList +
                        EngineMiddleware.create(
                            engine,
                            // We are disabling automatic suspending of engine sessions under memory pressure.
                            // Instead we solely rely on GeckoView and the Android system to reclaim memory
                            // when needed. For details, see:
                            // https://bugzilla.mozilla.org/show_bug.cgi?id=1752594
                            // https://github.com/mozilla-mobile/fenix/issues/12731
                            // https://github.com/mozilla-mobile/android-components/issues/11300
                            // https://github.com/mozilla-mobile/android-components/issues/11653
                            trimMemoryAutomatically = false,
                        )
            )
            .apply {
                // Install the "icons" WebExtension to automatically load icons for every visited website.
                icons.install(engine, this)

                CoroutineScope(Dispatchers.Main).launch {
                    val readJson = { context.assets.readJSONObject("search/search_telemetry_v2.json") }
                    val providerList =
                        withContext(Dispatchers.IO) {
                            SerpTelemetryRepository(
                                    readJson = readJson,
                                    collectionName = COLLECTION_NAME,
                                    remoteSettingsService = context.components.remoteSettingsService.value,
                                )
                                .updateProviderList()
                        }
                    // Install the "ads" WebExtension to get the links in an partner page.
                    adsTelemetry.install(engine, this@apply, providerList)
                    // Install the "cookies" WebExtension and tracks user interaction with SERPs.
                    searchTelemetry.install(engine, this@apply, providerList)
                }

                WebNotificationFeature(
                    context,
                    engine,
                    icons,
                    R.drawable.ic_status_logo,
                    permissionStorage.permissionsStorage,
                    IntentReceiverActivity::class.java,
                    notificationsDelegate = context.components.notificationsDelegate,
                )

                MediaSessionFeature(context, MediaSessionService::class.java, this).start()
            }
    }

    /** The [CustomTabsServiceStore] holds global custom tabs related data. */
    val customTabsStore by lazyMonitored { CustomTabsServiceStore() }

    /** [FileSizeFormatter] used to format the size of the file items. */
    val fileSizeFormatter: FileSizeFormatter by lazyMonitored { DefaultFileSizeFormatter(context.applicationContext) }

    /** [DateTimeProvider] used to provide date and time information. */
    val dateTimeProvider: DateTimeProvider by lazyMonitored { DefaultDateTimeProvider() }

    /** [DateTimeProvider] used to provide date and time information. */
    val downloadEstimator: DownloadEstimator by lazyMonitored { DownloadEstimator(dateTimeProvider = dateTimeProvider) }

    /** The [RelationChecker] checks Digital Asset Links relationships for Trusted Web Activities. */
    val relationChecker: RelationChecker by lazyMonitored {
        StatementRelationChecker(StatementApi(client))
    }

    /** The [HistoryMetadataService] is used to record history metadata. */
    val historyMetadataService: HistoryMetadataService by lazyMonitored {
        DefaultHistoryMetadataService(storage = historyStorage)
    }

    /** The [ProtectionsStorage] is used to store tracker blocking statistics. */
    val protectionsStorage: ProtectionsStorage by lazyMonitored {
        ProtectionsStorage(context)
    }

    val merinoManifestProvider by lazyMonitored {
        MerinoManifestProvider(context.assets)
    }

    /** Icons component for loading, caching and processing website icons. */
    val icons by lazyMonitored {
        BrowserIcons(
            context = context,
            httpClient = client,
            manifestProvider = merinoManifestProvider,
        )
    }

    val metrics by lazyMonitored {
        context.components.analytics.metrics
    }

    val adsTelemetry by lazyMonitored {
        AdsTelemetry()
    }

    val searchTelemetry by lazyMonitored {
        InContentTelemetry()