# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Versioned harness control evidence, immutable `RunMeta.controls`, fail-closed native preflight, and `capabilities --json` reporting.
- Separate `--effort`, `--permission`, `--sandbox`, `--workspace-trust`, `--provider`, and `--transport` inputs for spawn/adopt; `send` remains control-immutable.
- Bounded `status` history with active-run visibility, `--all`, `--limit`, `--running`, recency ordering, and truncation metadata.
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

- Legacy `--mode` is validated as a compatibility projection; requested/applied/effective control observations preserve native argv/config provenance and runtime tool-version evidence.
- Codex `--effort` is value-gated for any model (`minimal|low|medium|high|xhigh|max`) without a curated model allowlist; `max` is accepted and forwarded via `-c model_reasoning_effort`.
- Hermes per-run `--effort` remains unverified/fail-closed: oneshot has no public native effort flag, and Sidekick does not rewrite global Hermes config to simulate one.
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

## [0.1.0] - 2026-07-18

### Added

- Persistent orchestration across Codex, Devin, Claude, Hermes, and mock engines.
- Detached spawn, session resume, transcript fallback, adoption, event-driven waiting, tailing, status, result, and safe cleanup commands.
- Portable file locks, atomic state writes, worker liveness repair, JSON output, and force resend.
- Cross-platform tests and release automation.

[Unreleased]: https://github.com/hcsolakoglu/sidekick/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hcsolakoglu/sidekick/releases/tag/v0.1.0
