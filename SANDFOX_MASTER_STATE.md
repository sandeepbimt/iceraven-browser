# SANDFOX MASTER STATE

> Persistent engineering memory for the SANDFOX Android browser project.
> Source of truth for project decisions, proven facts, failures, lessons, and next justified actions.
> Updated: 2026-10-04

## 1. Mission

SANDFOX is a future-ready Android browser derived from the Mozilla/Firefox ecosystem.

Primary goals, in priority order:
1. Fastest practical cold launch for browser, webpages, and PWAs, including with uBlock/adblocking enabled.
2. Best-in-class dark-webpage experience: correct CSS/media/SVG/canvas/code/embedded content, no double-darkening, per-site exceptions, low overhead.
3. First-class PWA support: reliable installation, standalone behavior, correct navigation, fast cold/warm launch, process-death recovery, and custom icon selection during every new PWA creation.
4. Lowest practical unnecessary telemetry while preserving security, compatibility, and stability.
5. Maintainable architecture that can follow Mozilla/Firefox upstream without a fragile deep fork.

## 2. DIRTFT Rules

Understand -> Minimal Change -> Test -> Learn -> Preserve -> Proceed.

- One failure -> one justified fix -> one validation run.
- Inspect actual logs before changing code.
- Never repeat a known failed command, path, dependency assumption, workflow mistake, or architectural assumption unless new evidence contradicts it.
- No speculative commits.
- Inspect the complete diff before committing.
- Do not create trigger-only commits.
- Avoid overlapping CI runs.
- Treat GitHub CI minutes, RAM, disk, artifacts, bandwidth, and concurrency as limited.
- Optimize information gained per CI run, not number of runs.
- If a test cannot reveal WHY a failure happened, do not run it.
- Progressive proof: BUILD -> INSTALL -> LAUNCH -> WEBPAGE -> MEASURE -> UBLOCK -> PWA -> DARK PAGES -> PERFORMANCE -> UI -> BRANDING.

## 3. Current Repository / Checkpoint

Repository: sandeepbimt/iceraven-browser

Current adblock development branch:
- Branch: sandfox/adblock-brave-ublock-v1
- Current tested commit: 9d9b9a276ffec1b778d37196727ff4098dbdf382
- Commit: Optimize Brave-backed cosmetic filtering
- CI: #142
- CI #142 status: GREEN
- CI #142 was physically tested by the user.
- CI #142 is the current working adblock checkpoint.

Historical clean-base information:
- Earlier accepted clean base: CI #127
- CI #127 commit: 847f6a3d7025161391db98ca4c1be65df7ee0ba5
- CI #127 was the base for the V1 adblock work.
- CI #142 is not yet a final SANDFOX clean base because a cold-start blocking bug remains.

Project-memory branch:
- Branch: sandfox/project-memory
- Created from CI #142 commit.
- This branch is documentation-only and is intended to avoid consuming browser CI for memory updates.

## 4. Current Adblocking Architecture

Target architecture:
Mozilla/Firefox upstream
-> privacy/security layer
-> Gecko ContentClassifierService
-> Brave adblock-rust where practically exposed
-> SANDFOX native protection/profile layer
-> Android UI

Core principle:
- One authoritative network filtering engine/profile architecture.
- Do not create a second duplicate network interception engine.
- uBlock-style filter sources should feed the native filtering architecture.
- My Filters must actually participate in filtering.
- Global ON/OFF and per-site protection must affect real native behavior, not UI-only state.

Current implementation:
- Native network filtering is configured through Gecko ContentClassifier/test_block preferences.
- NativeProtectionEngine configures:
  - privacy.trackingprotection.content.protection.enabled
  - privacy.trackingprotection.content.protection.engines
  - privacy.trackingprotection.content.protection.engines.pbmode
  - privacy.trackingprotection.content.protection.test_list_urls
- Current engine selector uses test_block.
- Selected list URLs are joined and My Filters can be represented as a data:text/plain URL.
- Updates are scheduled through WorkManager.
- Current cosmetic implementation is a separate WebExtension fallback, not native Brave CosmeticFilterCache.

## 5. Required Filter Universe

The master adblock specification requires these 21 sources:
1. uBlock Filters
2. uBlock Privacy
3. uBlock Unbreak
4. EasyList
5. EasyPrivacy
6. AdGuard Generic
7. AdGuard Mobile
8. Fanboy Cookie
9. AdGuard Cookies
10. uBlock Cookie
11. Fanboy Social
12. AdGuard Social
13. Fanboy Thirdparty Social
14. Fanboy AI Suggestions
15. uBlock Annoyances
16. AdGuard Annoyances
17. EasyList Chat
18. EasyList Newsletters
19. EasyList Notifications
20. EasyList Annoyances
21. My Filters

Requirements:
- My Filters must actually feed the filtering engine.
- Per-site profile selections must eventually alter native filtering behavior.
- Last-known-good data must survive update failures.
- Engine updates should ideally follow candidate -> background compile -> validate -> atomic swap.
- Stale asynchronous builds must not replace newer generations.
- Per-site profiles should be lazy/bounded/hashed/cached.
- No synchronous parsing of millions of filters on startup.

## 6. CI #142 — What Changed

Branch: sandfox/adblock-brave-ublock-v1
Commit: 9d9b9a276ffec1b778d37196727ff4098dbdf382
CI: #142
Result: GREEN
Physical test: YES

Changes:
1. background.js:
   - cosmetic filter-list refresh is backgrounded.
   - native Gecko network filtering remains authoritative.
   - cosmetic cache refresh no longer blocks first page startup.
2. cosmetic.js:
   - generic selectors are indexed by simple class/id.
   - page classes/IDs are collected.
   - generic cosmetic rules are injected only when relevant keys exist or a generic hint applies.
   - bounded MutationObserver handles dynamic additions.
   - maximum bounded work is used instead of scanning every selector for every mutation.
3. workflow:
   - branch sandfox/adblock-brave-ublock-v1 was added to CI.

Why:
- Improve cosmetic efficiency and reduce startup impact while preserving the native network engine.

Important limitation:
- This is still a JavaScript cosmetic approximation.
- It is NOT Brave's native CosmeticFilterCache.

## 7. CI #142 Physical Test Result / Current Bug

Observed on India Today:
- While Sandfox is already running, network adblocking can block the advertisement.
- After Sandfox is completely killed and then cold-started, a restored/reloaded India Today page can show an actual advertisement even though the adblocking toggle remains ON.
- Large empty/grey advertisement areas can also remain after the creative is blocked.

Critical interpretation:
- The primary confirmed problem is COLD-START activation/lifecycle.
- Do NOT currently assume that missing filter lists are the cause.
- Do NOT respond to this bug by randomly adding more filter lists or cosmetic selectors.
- Empty ad-box cleanup is a separate cosmetic problem and should be addressed after reliable cold-start network blocking is proven.

## 8. Cold-Start Investigation — Proven Facts

FenixApplication startup sequence was inspected:
- setupEarlyMain() accesses components.core.engine.
- NativeProtectionEngine.initialize() is called immediately after that.
- initialize() applies Gecko BrowserPreferencesRuntime preferences asynchronously.
- WebExtension support and cosmetic installation occur later.

This creates a strong hypothesis:
- Native classifier configuration may be arriving too late relative to Gecko runtime construction / first restored navigation.

Important: this is a hypothesis, not yet the final proven root cause.

### GeckoView startup configuration finding

Mozilla GeckoView supports GeckoRuntimeSettings.Builder.configFilePath().
- The configuration can contain Gecko preferences.
- GeckoRuntime.create() reads the configuration before/while constructing the runtime.
- YAML-style prefs are supported.
- This mechanism can force configuration reading in release builds.

Therefore:
- configFilePath is a legitimate candidate for seeding adblock/content-classifier preferences before runtime creation.
- It must NOT be implemented blindly.
- Exact Sandfox GeckoView version and ContentClassifier startup semantics must be checked first.
- Exact test_block/test_list_urls initialization behavior must be established before CI #143.

## 9. Brave adblock-rust / Cosmetic Findings

Research established:
- Brave adblock-rust has a native CosmeticFilterCache inside the Engine.
- Network and cosmetic filters can be compiled into the same filter-set architecture.
- url_cosmetic_resources(url) provides URL-specific cosmetic resources.
- hidden_class_id_selectors(classes, ids, exceptions) provides keyed selectors based on page classes/IDs.
- Brave's Android/browser integration uses those native results rather than dumping every generic selector into a page.
- uBlock Origin similarly distinguishes ordinary CSS cosmetics, generic cosmetics, URL/domain-specific cosmetics, exceptions, and procedural/action operators.

Therefore best-in-class cosmetic direction:
- Prefer native CosmeticFilterCache if the embedded architecture exposes it.
- If it cannot be exposed without an unjustified Gecko source fork, approximate the same architecture rather than injecting huge generic CSS sets.
- Use class/id keyed lookup.
- Handle URL-specific rules and exceptions.
- Handle dynamic DOM changes with bounded work.
- Procedural/action filters should be used only where safely implementable.
- Network blocking takes priority over cosmetic hiding.
- Do not delete every empty div or use broad destructive DOM cleanup.

## 10. Existing Cosmetic WebExtension

Current assets:
- app/src/main/assets/sandfox_cosmetics/manifest.json
- background.js
- cosmetic.js

Behavior:
- downloads/caches selected lists
- refreshes approximately every 24h
- parses supported ## and #@# style rules
- rejects unsupported/high-risk procedural forms
- applies generic and domain-specific rules
- supports custom filters
- uses a bounded MutationObserver
- creates a Sandfox cosmetic stylesheet

Known limitation:
- It is a fallback approximation, not native Brave CosmeticFilterCache.
- It must not become a second full network-blocking engine.

## 11. Planned Adblock Roadmap

V1 — Fast Native Foundation
- native network blocking
- uBlock-style filter universe
- My Filters
- efficient basic cosmetics
- startup performance

V2 — Best-in-Class Cosmetics
- stronger uBlock cosmetic syntax
- exceptions
- iframe handling
- SPA/lazy/dynamic handling
- anti-adblock handling
- procedural/action support where justified
- closer architecture to native CosmeticFilterCache

V3 — True Profile Engine
- real native per-site profiles
- candidate FilterSet
- background compilation
- validation
- atomic swap
- generation numbers
- profile hashing/cache

V4 — Complete Adblock System
- filter status/metadata
- robust My Filters
- import/export
- diagnostics
- lifecycle/control hardening

V5 — Production / Performance
- browser cold/warm launch
- webpage cold/warm launch
- PWA cold/warm launch
- uBlock/filter-load overhead
- CPU/RAM
- scrolling
- compatibility
- regression testing

## 12. Architecture Constraints / Proven Repository Facts

- android-components is a gitlink.
- The current repo does not contain a local GeckoView/Firefox source tree.
- android-components/components/browser/engine-gecko/build.gradle normally uses a prebuilt GeckoView Maven dependency unless a local :geckoview exists.
- Current CI does not build a full local Mozilla Gecko source tree.
- Therefore direct modification of Gecko native ContentClassifier/CosmeticFilterCache APIs would require a larger source-build architecture and must not be casually introduced.
- Prefer the smallest maintainable integration point compatible with the current embedded GeckoView.
- Do not return to endlessly cleaning the old Iceraven tree.

## 13. Important Failed/Rejected Approaches

### Speculative startup edit
An uncommitted attempt was made to:
- add prepareGeckoStartupConfig()
- write startup YAML
- call it before GeckoRuntime.create()
- wire configFilePath
- expand cosmetic parsing

It was stopped before commit because the exact lifecycle and version semantics had not yet been sufficiently verified.

Lesson:
- The idea is technically plausible, but implementation must follow evidence.
- Never convert a plausible mechanism directly into a CI run.

### Cosmetic-only response to cold-start failure
Rejected:
- adding more CSS selectors
- adding more filter lists without evidence
- treating grey ad boxes as the primary failure

Lesson:
- Cold-start network activation must be proven first.

## 14. Current Blocker

Primary blocker:
**Reliable native adblocking on cold launch.**

Exact acceptance test:
1. Completely kill Sandfox.
2. Cold launch Sandfox.
3. Restore/reload India Today.
4. Protection toggle remains ON.
5. Actual advertisement must remain blocked.
6. Repeat after process death to verify lifecycle reliability.

Only after this passes should empty ad-box cosmetic cleanup become the next focused issue.

## 15. Current Next Single Justified Action

Do NOT create CI #143 yet.

First:
1. Determine exact GeckoView version/dependency used by Sandfox.
2. Inspect the corresponding Gecko ContentClassifier/test_block preference startup lifecycle.
3. Establish when test_list_urls and engine selection are read.
4. Determine whether asynchronous BrowserPreferencesRuntime configuration after engine construction is too late.
5. Determine whether configFilePath can seed the exact required preferences before GeckoRuntime creation.
6. Confirm filter/cache persistence behavior across process death.
7. Then make ONE minimal cold-start fix.
8. Inspect the complete diff.
9. Run ONE CI.
10. Repeat the exact India Today cold-launch test.

## 16. Clean Base Policy

A clean base is not merely a green CI.
It must be:
- buildable
- installable
- launchable
- physically tested
- behaviorally acceptable for the current milestone
- free of known unresolved regressions relevant to the milestone

CI #142 is GREEN and physically tested, but not yet accepted as the final adblock clean base because cold-start blocking remains unresolved.

## 17. CI Memory Table

| CI | Commit | Base | Status | Physical test | Key lesson |
|---|---|---|---|---|---|
| #127 | 847f6a3d | prior clean base | accepted base for adblock work | yes/context | native protection foundation |
| #142 | 9d9b9a27 | #127 | GREEN | yes | cosmetic efficiency improved; cold-start network activation still fails |

Do not invent CI numbers or claim a run was tested unless evidence exists.

## 18. Permanent Save Rule

Update SANDFOX project memory when:
- an important learning is discovered
- important analysis/conclusion is completed
- a bug is discovered
- a root cause is established
- a fix is implemented/validated
- a CI is created/completed/failed/tested/accepted
- an architecture decision/rejection occurs
- requirements change
- a clean base changes
- next direction materially changes
- an important performance/security/PWA/dark-page/adblock finding occurs
- a failure teaches a reusable lesson
- user explicitly says: **update md**

The explicit command "update md" means immediately synchronize the persistent master state and create a dated checkpoint save when appropriate.

## 19. Resume Instruction

When starting a new SANDFOX conversation:
1. Read SANDFOX_MASTER_STATE.md.
2. Read the newest save under saves/.
3. Verify current Git branch/commit before making changes.
4. Treat proven facts and rejected approaches as established unless new evidence contradicts them.
5. Continue from the stated current blocker and next single justified action.
6. Do not restart old investigations merely because the chat is new.

## 20. Current Resume Hook

**Continue SANDFOX from project memory.**

Current task:
Fix the confirmed cold-start native adblocking failure without wasting a CI run.

Current branch:
sandfox/adblock-brave-ublock-v1

Current commit:
9d9b9a276ffec1b778d37196727ff4098dbdf382

Last validated CI:
#142 GREEN

Next action:
Verify exact GeckoView + ContentClassifier startup lifecycle before making the smallest justified fix.
