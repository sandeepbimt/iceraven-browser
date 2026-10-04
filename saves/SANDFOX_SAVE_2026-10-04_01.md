# SANDFOX SAVE — 2026-10-04 — 01

## Checkpoint

### Repository
sandeepbimt/iceraven-browser

### Adblock branch
sandfox/adblock-brave-ublock-v1

### Current tested commit
9d9b9a276ffec1b778d37196727ff4098dbdf382

### CI
#142 — GREEN

### Physical test
YES

## What CI #142 proved

- Native/network adblocking can work while Sandfox is already running.
- Cosmetic filtering was made more efficient by class/id-keyed lookup and bounded mutation handling.
- Cosmetic refresh was moved off the critical first-page path.

## Confirmed remaining bug

Cold-start adblocking is unreliable.

Exact scenario:
1. Completely kill Sandfox.
2. Cold-launch Sandfox.
3. Restore/reload India Today.
4. Protection remains ON.
5. An actual advertisement can appear.

This is different from the in-session behavior and points to startup/lifecycle activation rather than simply missing filter rules.

## Important interpretation

Do NOT:
- randomly add more filter lists
- randomly add cosmetic selectors
- treat grey advertisement boxes as the primary bug
- create CI #143 without first establishing the cause

## Strong startup hypothesis

FenixApplication accesses components.core.engine before NativeProtectionEngine.initialize() applies Gecko BrowserPreferencesRuntime preferences asynchronously.

Potential consequence:
- ContentClassifier/test_block may not be configured early enough for the first restored navigation after process death.

This remains a hypothesis until the exact GeckoView/content-classifier lifecycle is verified.

## Research findings

### GeckoView
GeckoView supports GeckoRuntimeSettings.Builder.configFilePath(), which can provide Gecko preferences before/at runtime construction.

Decision:
- This is a legitimate candidate for cold-start configuration.
- It must be validated against the exact GeckoView version and ContentClassifier semantics before implementation.

### Brave
Brave adblock-rust has native CosmeticFilterCache capabilities including:
- URL-specific cosmetic resources
- class/id keyed selector lookup
- native network + cosmetic filter-set architecture

### uBlock
uBlock cosmetic filtering uses:
- normal CSS cosmetics
- generic cosmetics
- domain/URL-specific rules
- exceptions
- procedural/action operators where needed

Conclusion:
- Best-in-class Sandfox cosmetics should move toward keyed/native behavior, not giant generic CSS injection.
- Current JS cosmetic layer remains a fallback until native exposure is proven practical.

## Uncommitted speculative work

A speculative startup-config implementation was attempted but NOT committed and NOT used to create a CI.

Lesson:
A technically plausible mechanism is not sufficient evidence for a CI. Verify the exact runtime/version/lifecycle first.

## Next action

1. Verify exact Sandfox GeckoView dependency/version.
2. Inspect ContentClassifier/test_block startup behavior for that version.
3. Determine whether async preference application after engine construction is too late.
4. Validate configFilePath as a startup mechanism for the exact required prefs.
5. Make ONE minimal fix.
6. Inspect full diff.
7. Run ONE CI.
8. Repeat the exact cold-launch India Today test.

## DIRTFT lesson

**One failure -> one justified fix -> one validation run.**

Do not spend another CI run proving a hypothesis that can be checked through source inspection first.
