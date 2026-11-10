# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Command Code engine (`commandcode`) with headless `--print`/`--output-format json` NDJSON parsing, session resume, adoption, and status/tail/wait/result/cancel parity.
- Hermes per-run effort through the native `--reasoning` flag, value-gated to `none|minimal|low|medium|high|xhigh|max|ultra`.
- Command Code control evidence: value-gated `--effort`, permission modes with `--yolo`, `--max-turns`, `--add-dir`, and `--tools-all`, plus `sidekick skill install commandcode`.
- `permission_denied` and `max_turns` result mapping for Command Code; a policy denial is recorded as run exit code `126` with the denied tool and shell command instead of a false success.
- Versioned harness control evidence, immutable `RunMeta.controls`, fail-closed native preflight, and `capabilities --json` reporting.
- Separate `--effort`, `--permission`, `--sandbox`, `--workspace-trust`, `--provider`, and `--transport` inputs for spawn/adopt; `send` remains control-immutable.
- Bounded `status` history with active-run visibility, `--all`, `--limit`, `--running`, recency ordering, and truncation metadata.
- `status`, `clean`, and `wait --all` accept `--engine` and canonical `--dir` filters; JSON output reports the applied filters and status totals.
- Summary-only state scans that avoid loading full `out.log` files for status, retention, concurrency, and unnamed wait discovery.
- Safe `clean --dry-run` planning with explicit `wouldRemove` output and diagnostics for legacy or unreadable state directories.
- Explicit legacy run-state migration with dry-run-by-default planning, atomic metadata conversion, non-destructive quarantine, and collision-safe restore.
- `sidekick doctor` engine installation, operating-system support, executable-resolution, and state-path diagnostics.
- Cross-platform command-resolver and native Windows process-handling tests.
- Identity-safe worker liveness, `cancel`, completion hooks, retention cleanup, bounded live logs, per-engine concurrency caps, and JSON lifecycle commands.
- Cross-harness Sidekick skill pack and `sidekick skill install`.
- Portable skill metadata plus universal `npx skills` installation and agent-setup guidance.
- Canonical contributor governance, an executable mock lifecycle smoke check, CLI surface drift enforcement, and weekly harness compatibility monitoring.

### Changed

- Command Code evidence covers `commandcode 1.88.5` and patch releases of that release line, matching the self-update policy for Codex and Devin.
- `spawn` and `adopt` accept `--max-turns`, repeatable `--add-dir`, and `--tools-all`; engines without those native surfaces fail closed with exit code 2.
- Refreshed control evidence to `codex-cli 0.167.0`, `devin 3000.12.32`, `claude 2.1.321`, and `hermes 0.22.5`; Command Code stays at `commandcode 1.88.5`. The refresh used `--version`, `--help`, invalid-value parser probes, and installed-package inspection only; no live model prompt was sent.
- Devin `smart` is now advertised and emitted as `--permission-mode smart` because the 3000.12.x parser accepted-value error lists it; older evidence versions still fail closed.
- Codex runs record the spawn-time `CODEX_HOME`, so `send` resumes reuse the same account home even from another shell; engines that exit without reading stdin (for example on an auth failure) record their exit code and stderr instead of crashing the worker with EPIPE.
- `sidekick tail` prints finished runs and exits when a followed run completes instead of waiting forever.
- Codex resume turns pass `--skip-git-repo-check` like initial turns, so resuming in a non-git directory no longer fails.
- Devin session discovery accepts numeric `last_activity_at` values (epoch seconds) from Devin 3000.11 and newer.
- Refreshed Codex control evidence to `codex-cli 0.147.0` after verifying the local initial and resume CLI surfaces; explicit effort and sandbox controls no longer fail closed solely because the evidence table is stale.
- Legacy `--mode` is validated as a compatibility projection; requested/applied/effective control observations preserve native argv/config provenance and runtime tool-version evidence.
- Codex `--effort` is value-gated for any model (`minimal|low|medium|high|xhigh|max`) without a curated model allowlist; `max` is accepted and forwarded via `-c model_reasoning_effort`.
- Hermes per-run effort uses the native `--reasoning` flag; Sidekick never rewrites global Hermes `agent.reasoning_effort` config.
- Spawn/adopt controls are preflighted before prompt/cwd/discovery/store side effects; Codex resume uses config overrides rather than unsupported resume flags.
- Status and retention scans now report skipped legacy or unreadable run directories instead of silently hiding them; only readable terminal records are eligible for cleanup.
- Worker completion and dead-worker repair now serialize terminal state publication through per-run locks.
- Engine concurrency accounting now uses live process identity probes without mutating run state while holding the capacity lock; status, wait, and clean remain the repair paths.
- Windows npm command shims are unwrapped to native or JavaScript entry points without shell interpolation.
- Force resend terminates complete process trees on Windows and detached process groups on POSIX.
- Atomic state replacement retries transient Windows filesystem sharing violations.
- Engine state discovery honors Codex, Claude Code, and Hermes home overrides.
- Codex and Claude prompts use stdin, Devin uses prompt files, and verified harness limits are documented.
- CI enforces formatting and validates the packed mock roundtrip result.
- Published package contents exclude internal engine-candidate research while retaining public CLI and harness documentation.
- Skill guidance prevents same-directory workers from contending or overlapping by requiring separate worktrees or serialized session reuse.
- Dev toolchain upgraded to ESLint 10, TypeScript 6.0, typescript-eslint 8.71, and Prettier 3.9; `tsconfig.json` pins `types: ["node"]` for TypeScript 6's opt-in `@types` resolution.
- Test files run concurrently with per-file isolated state, and the integration suite is split into focused files (full-suite runtime drops from about 18 s to about 7 s); `SIDEKICK_TEST_CONCURRENCY=1` restores serial execution.

## [0.1.0] - 2026-07-18

### Added

- Persistent orchestration across Codex, Devin, Claude, Hermes, and mock engines.
- Detached spawn, session resume, transcript fallback, adoption, event-driven waiting, tailing, status, result, and safe cleanup commands.
- Portable file locks, atomic state writes, worker liveness repair, JSON output, and force resend.
- Cross-platform tests and release automation.

[Unreleased]: https://github.com/hcsolakoglu/sidekick/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hcsolakoglu/sidekick/releases/tag/v0.1.0
