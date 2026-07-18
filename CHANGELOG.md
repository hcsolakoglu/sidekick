# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `sidekick doctor` engine installation, operating-system support, executable-resolution, and state-path diagnostics.
- Cross-platform command-resolver and native Windows process-handling tests.
- Identity-safe worker liveness, `cancel`, completion hooks, retention cleanup, bounded live logs, per-engine concurrency caps, and JSON lifecycle commands.
- Cross-harness Sidekick skill pack and `sidekick skill install`.
- Canonical contributor governance, an executable mock lifecycle smoke check, CLI surface drift enforcement, and weekly harness compatibility monitoring.

### Changed

- Windows npm command shims are unwrapped to native or JavaScript entry points without shell interpolation.
- Force resend terminates complete process trees on Windows and detached process groups on POSIX.
- Atomic state replacement retries transient Windows filesystem sharing violations.
- Engine state discovery honors Codex, Claude Code, and Hermes home overrides.
- Codex and Claude prompts use stdin, Devin uses prompt files, and verified harness limits are documented.
- CI enforces formatting and validates the packed mock roundtrip result.

## [0.1.0] - 2026-07-18

### Added

- Persistent orchestration across Codex, Devin, Claude, Hermes, and mock engines.
- Detached spawn, session resume, transcript fallback, adoption, event-driven waiting, tailing, status, result, and safe cleanup commands.
- Portable file locks, atomic state writes, worker liveness repair, JSON output, and force resend.
- Cross-platform tests and release automation.

[Unreleased]: https://github.com/hcsolakoglu/sidekick/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hcsolakoglu/sidekick/releases/tag/v0.1.0
