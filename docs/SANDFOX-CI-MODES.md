# SANDFOX CI Modes and Run Labels

Status: design decision / implementation plan  
Current build baseline: CircleCI pipeline #162, commit `1c3b248`  
Fast-stage-exit validation: pipeline for commit `2b254b9` completed with Stage 1 taking about 27m 12s and Stages 2–5 about 1s each.

## Goals

- Keep a reliable full Chromium build path.
- Add a separate, faster path for SANDFOX changes that do not require a full Chromium rebuild.
- Make the expected cost of every run obvious from its CircleCI name.
- Never claim a run is lightweight if it actually falls back to a full build.
- Preserve the DIRTFT rule: inspect logs, make the smallest justified change, validate once, and preserve known-good checkpoints.

## Required CI labels

Every SANDFOX CI workflow/job name must include one of these identifiers:

- `SF-LITE` — lightweight/incremental build. Expected to take minutes, not hours, when compatible build state is available.
- `SF-FULL` — full Chromium build. May take substantially longer; uses the checkpointed five-stage Siso/BuildBuddy workflow.
- `SF-VERIFY` — validation-only checks that do not require Chromium compilation.

Use names such as:

- `SF-LITE: Browser UI change`
- `SF-FULL: Chromium/GN/toolchain change`
- `SF-VERIFY: CI configuration validation`

The label must reflect the path actually selected, not merely the intended path. If a light run cannot safely reuse build state and falls back, log `SF-LITE -> SF-FULL FALLBACK` and make the actual full-build mode visible in the CircleCI job/workflow name where possible.

## Mode 1 — SF-FULL

Keep the current five-stage checkpointed Siso/BuildBuddy pipeline as the full-build path.

Use it for changes that require broad native recompilation or invalidate the existing build state, including:

- Chromium revision or Afterbird source revision changes.
- GN arguments, toolchain, compiler configuration, or major generated build-rule changes.
- Dependency configuration changes.
- Native changes when their dependency closure cannot safely be built incrementally.
- Missing, stale, incompatible, or failed checkpoint recovery.

Preserve pinned inputs and the known-good build state. Do not remove dependency sync, Chromium hooks, journal recovery, or checkpoint validation without evidence that the replacement is safe.

## Mode 2 — SF-LITE

Design a separate incremental path for eligible SANDFOX changes.

Desired behavior:

1. Classify the changed files and build impact.
2. Restore a compatible build state and use the pinned source/dependency baseline.
3. Avoid repeating Chromium checkout, Android dependency sync, and Chromium hooks when a validated reusable source/dependency workspace or snapshot is available.
4. Rebuild only affected targets and required dependants using Siso/Ninja's incremental graph.
5. Package a fresh APK containing the change.
6. Verify APK archive integrity, record SHA-256 and size, and publish the APK artifact.
7. Fall back to `SF-FULL` when state is missing or incompatible, or when the change invalidates the build graph.

Candidate lightweight changes include browser UI resources, strings, icons, Kotlin/Java browser code, and Android resources, subject to actual target dependencies. Do not assume all such changes are cheap without inspecting the build graph.

Do not classify GN/toolchain/Chromium revision changes as lightweight by default.

## Mode 3 — SF-VERIFY

Use for configuration, metadata, documentation, and other checks that can be validated without compiling Chromium. Keep it separate from APK-producing workflows unless a specific integration test requires an APK.

## Existing verified behavior

- Clean full-build baseline: pipeline #162, commit `1c3b248`, all five stages green, `ChromePublic.apk` artifact produced.
- The bounded Siso build step uses `no_output_timeout: 50m`, preventing CircleCI's previous 10-minute no-output limit from interrupting a quiet build.
- A later successful run for commit `2b254b9` showed Stage 1 around 27 minutes and Stages 2–5 around one second each after APK completion. This validates the later-stage fast-exit behavior for that run; it does not yet validate the separate SF-LITE incremental build.
- The early-exit path must only trigger from a completion marker written after APK ZIP integrity validation. Missing or invalid completion state must continue through the normal build path.

## Implementation order

1. Preserve the current full-build workflow as the rollback baseline.
2. Keep the verified-APK fast exit for later stages.
3. Audit checkpoint contents, source/dependency availability, and build fingerprints offline.
4. Implement SF-LITE as a separate path rather than weakening SF-FULL.
5. Validate with one representative small SANDFOX change; prove the changed code/resource is present in the resulting APK.
6. Record elapsed time, restored state, rebuilt action counts, cache hits, APK SHA-256/size, and fallback behavior.
7. Only after evidence supports it, expand the list of changes eligible for SF-LITE.

## Acceptance criteria

- Run name visibly contains `SF-LITE`, `SF-FULL`, or `SF-VERIFY`.
- Actual selected mode is recorded in the first log lines and agrees with the run label.
- SF-LITE reuses compatible state and builds a fresh APK containing the change.
- SF-LITE fails safely or falls back when compatibility cannot be proven.
- SF-FULL remains able to recover from checkpoints and complete an APK build.
- A verified APK causes later stages to exit successfully with minimal overhead.
- No unrelated modifications are bundled into CI fixes.
