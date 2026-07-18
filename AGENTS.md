# Sidekick contribution contract

Use this file as the canonical rule list for AI agents and humans. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the human review process.

## Repository map

- Enter through `bin/sidekick.js`; keep it a thin executable wrapper around `dist/cli.js`.
- Parse arguments and map errors in `src/cli.ts`.
- Implement public behavior in `src/commands/`.
- Keep state, lifecycle, process, and adapter logic in `src/core/`.
- Keep engine argv builders in `src/core/engines/`.
- Add `node:test` coverage under `test/unit/`, `test/integration/`, or `test/snapshots/`.
- Maintain user documentation in `README.md` and `docs/`; maintain harness instructions in `skills/`.

## Hard rules

- Keep zero runtime dependencies. Justify any exception explicitly in the PR before adding it.
- Spawn executables with argv arrays and `shell: false`. Never construct shell command strings.
- Preserve Linux, macOS, and Windows behavior. Do not add POSIX-only APIs or assumptions; use `node:path` for paths.
- Update `--help`, `README.md`, every affected file under `skills/`, `CHANGELOG.md`, and `docs/cli-surface.json` in the same PR as a CLI-surface change.
- Add `node:test` coverage for every behavior change.
- Use conventional commit subjects.
- Do not call `process.exit()` or assign `process.exitCode` outside the CLI error boundary in `src/cli.ts`.
- Keep `--json` stdout as pure JSON or JSON Lines. Send diagnostics and progress to stderr.

## Verification contract

Run every command before claiming completion:

```text
npm run prepack
npm run surface:check
npm pack --dry-run
npm run smoke:mock
```

Review the pack listing deliberately. It may contain only the files selected by `package.json`; keep `dist/`, `bin/`, `README.md`, `LICENSE`, installable `skills/`, and published `docs/`, but exclude internal research notes such as `engine-candidates.md`.

## Security

- Never print prompt contents, tokens, credentials, environment secrets, or auth state to logs.
- Do not add dependencies that run install scripts.
- Keep GitHub workflow permissions least-privilege; grant write permissions only to the job that needs them.
- Treat engine command overrides and completion hooks as trusted local code without weakening argv isolation.

## Dogfooding

- Use the `mock` engine for automated tests and lifecycle smoke checks.
- Do not require credentials, network access, or real harness installations in the test suite.
