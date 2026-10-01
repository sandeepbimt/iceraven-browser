# Sandfox IronFox Base Trial

## Purpose

This branch is a **trial of the patch-based architecture** for Sandfox.

We are intentionally NOT starting from the existing Iceraven/Fenix source tree. The trial treats IronFox as an upstream patch layer over Mozilla Firefox for Android, then leaves room for a separate Sandfox patch stack.

## Source checkpoint

- IronFox repository: `ironfox-oss/IronFox`
- Trial source: `dev`
- Exact IronFox commit: `ca0c9673b328fd2b23e80293326a22610239eb47`
- Firefox version declared by that IronFox commit: 157.0
- First build target: ARM64 only

## Patch-stack architecture

```
Mozilla Firefox source
        |
        v
IronFox privacy/deblob/security patch set
        |
        +---- selected Iceraven functionality patches
        |
        +---- Sandfox native extension/MV2 patches
        |
        +---- Sandfox PWA/cold-start patches
        |
        +---- Sandfox dark-pages engine
        |
        +---- Sandfox UI/branding
        v
Sandfox APK
```

The existing `un-iceraven/base` branch is deliberately not used as the source of this trial.

## Sandfox USP constraints

### 1. MV2 / uBlock Origin
Keep WebExtension support as a first-class browser capability. Do not trade extension compatibility for privacy cleanup.

### 2. Leading dark-pages experience
This must be a browser/content rendering capability, not a heavy always-on Dark Reader-style runtime extension.

First design target:
- native `prefers-color-scheme` control;
- fast document-start dark styling;
- per-site exceptions;
- correct handling of images, video, SVG, code blocks and embedded content;
- avoid double-darkening sites that already provide dark CSS;
- avoid a large JS transformation cost on every navigation.

IronFox documentation itself notes that Dark Reader can cause severe performance problems on hardened Firefox-based browsers, so Sandfox should investigate a native Gecko/content-layer implementation instead.

### 3. Fast cold webpage and cold PWA startup
Startup performance is a product requirement, not an afterthought.

Design rules:
- keep Application.onCreate work minimal;
- do not initialise analytics/telemetry/Nimbus/crash systems that Sandfox does not need;
- lazy-load non-critical UI/features;
- keep Gecko startup path lean;
- avoid heavy page-modification JavaScript at startup;
- measure cold main launch, cold navigation start and PWA cold launch separately;
- preserve warm-start behaviour while optimising cold-start.

### 4. Future Mozilla updates
Sandfox must be rebaseable onto new Firefox releases.

Therefore:
- upstream source is fetched at a known revision;
- every Sandfox modification is a discrete patch;
- Iceraven functionality is imported selectively;
- no giant one-off fork cleanup;
- no generated/vendor copy of the whole Mozilla tree in the Sandfox repository.

## Trial stages

1. Prove the IronFox source/patch build can run in our available GitHub runner.
2. Produce a clean ARM64 APK.
3. Record disk/RAM/time measurements.
4. Freeze that as Base-0 if green.
5. Only then add selected Iceraven MV2/PWA functionality.
6. Add the Sandfox dark-pages engine as an isolated feature.
7. Add UI/branding last.

**No feature patch is allowed to be mixed into the base-build trial.**

Trial trigger checkpoint: resource-feasibility build uses one ARM64 target and no disk-backed swap.
