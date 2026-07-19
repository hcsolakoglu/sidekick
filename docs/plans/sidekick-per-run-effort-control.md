# Sidekick Per-Run Effort Control Implementation Plan

> **For Hermes:** Use Sidekick-backed subagent-driven development to implement this plan task by task. Give parallel workers separate git worktrees and review every result before integration.

**Goal:** Add immutable per-run reasoning-effort control to `spawn` and `adopt`, preserve it across every `send`/resume, and expose adapter capabilities through a stable machine-readable command.

**Architecture:** Add one canonical effort registry and validator shared by commands, engine adapters, status rendering, and capability discovery. Store canonical effort in schema-version-1 run metadata with `auto` as the backward-compatible default for old records. Engine adapters receive effort through `EngineContext`; only adapters with a verified per-invocation control emit harness flags.

**Tech stack:** TypeScript, Node.js `parseArgs`, existing zero-runtime-dependency command architecture, Node test runner, governed CLI surface JSON, npm package/prepack gates.

---

## Scope and invariants

- Add `--effort LEVEL` to `sidekick spawn` and `sidekick adopt`; default to `auto`.
- `auto` means omit any harness override and use that harness/session's normal default.
- Persist effort for the entire named run. Every later `sidekick send` reuses it for resume and fallback execution.
- Never silently downgrade effort, infer effort from a model name, rewrite prompts, retry at a lower effort, or mutate global harness configuration.
- Reject unsupported non-`auto` effort with exit code `2` before reading prompts, discovering adopted sessions, or creating run directories.
- Keep live remote model-catalog querying out of scope. Capabilities describe Sidekick adapter support, current platform support, and local executable availability, not provider inventories.
- Preserve existing schema version. Existing schema-version-1 metadata with no `effort` field resolves to `auto`; no migration or rewrite is required.
- Modify only `/home/mithex/projects/sidekick` during implementation. Do not modify Celestwise, global harness configuration, profiles, or installed skills.
- Implementation must not publish, commit, or push unless separately authorized at execution time.

## Target public contract

### Effort matrix

| Engine | Control       | Target accepted values                                                      | Adapter behavior                                                                                                                                                               |
| ------ | ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex  | `native`      | `auto`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | For non-`auto`, pass `-c model_reasoning_effort="<level>"` on initial and resumed invocations. Never retry with another level. Model/provider support remains model-dependent. |
| Claude | `native`      | `auto`, `low`, `medium`, `high`, `xhigh`, `max`, `ultracode`                | For non-`auto`, pass `--effort <level>` on initial and resumed invocations. Never persist the setting globally. Model/provider support remains model-dependent.                |
| Devin  | `unsupported` | `auto` only                                                                 | Reject non-`auto` with exit code `2` before run-state creation. Interactive thinking-level cycling is not a headless per-run interface.                                        |
| Hermes | `unsupported` | `auto` only                                                                 | Reject non-`auto` with exit code `2`. Never edit `config.yaml`, set global `agent.reasoning_effort`, or create temporary profiles.                                             |
| Mock   | `simulated`   | Full Sidekick vocabulary                                                    | Persist and expose effort for deterministic lifecycle and adapter tests.                                                                                                       |

### Verification checkpoint before freezing level lists

The supplied target Codex vocabulary is broader than current official Codex configuration reference, which documents `minimal | low | medium | high | xhigh` for `model_reasoning_effort`; `none` is documented for plan-mode effort, while `max` and `ultra` are not listed for this key. Before implementation, verify the installed Codex CLI accepts each proposed value through a direct `-c` override. Do not advertise a level in `capabilities` unless Sidekick intentionally accepts it and official/current CLI evidence supports that contract.

Claude's current official documentation exposes per-session `--effort` with `low`, `medium`, `high`, `xhigh`, `max`, and `ultracode`, plus `auto` for resetting to model default. `ultracode` is a Claude Code workflow setting, not a generic model effort level. Keep it Claude-specific unless a deliberate product decision expands canonical vocabulary.

If verification narrows either list, update this table, tests, README, capability output, and every skill together. Never let implementation and public capability metadata disagree.

### `capabilities` command

Add:

```text
sidekick capabilities [ENGINE ...] [--json]
```

JSON output schema version 1:

```json
{
  "schemaVersion": 1,
  "platform": "linux",
  "results": [
    {
      "engine": "codex",
      "installed": true,
      "control": "native",
      "available": true,
      "levels": ["auto", "minimal", "low", "medium", "high", "xhigh"],
      "modelDependent": true,
      "detail": "Per-invocation model_reasoning_effort override"
    }
  ]
}
```

Definitions:

- `installed`: Sidekick resolves the configured engine command locally.
- `available`: engine is installed and not unsupported on current platform.
- `control`: `native | unsupported | simulated`.
- `levels`: canonical values Sidekick accepts for this adapter, always including `auto`.
- `modelDependent`: a syntactically accepted native level can still be rejected by selected model/provider.
- `detail`: short stable human explanation, not raw provider inventory.

Behavior:

- Return `0` even when selected engines are unavailable or missing.
- Return `2` for any unknown engine name.
- Keep stdout pure JSON under `--json`; diagnostics belong in returned fields, not stderr.
- Human output must include engine, installed, available, control, levels, and detail.

### Lifecycle output changes

- `spawn --json` acknowledgement adds canonical `effort`.
- `adopt --json` acknowledgement adds canonical `effort`.
- `status --json` adds `effort` to every run.
- Human `status` adds an `EFFORT` column.
- `command.json` records exact Codex/Claude effort arguments for every initial and resumed turn.
- `send` accepts no effort override; effort is immutable after run creation.

## Source evidence

- Codex configuration reference: <https://learn.chatgpt.com/docs/config-file/config-reference>
- Claude model and effort configuration: <https://code.claude.com/docs/en/model-config>
- Devin models and interactive thinking levels: <https://docs.devin.ai/cli/models>
- Hermes configuration and global reasoning effort: <https://github.com/nousresearch/hermes-agent/blob/main/website/docs/user-guide/configuration.md>

These references establish adapter-level control boundaries. They do not prove remote model availability.

---

## Task 1: Freeze canonical effort vocabulary and capability registry

**Objective:** Create one source of truth for effort validation and adapter capability metadata.

**Files:**

- Create: `src/core/effort.ts`
- Create: `test/unit/effort.test.js`
- Modify if needed after CLI verification: `docs/plans/sidekick-per-run-effort-control.md`

**Steps:**

1. Add failing tests for canonicalization: missing/empty input becomes `auto`; known values remain unchanged; unknown values throw `CliError` exit code `2`.
2. Add failing tests for engine support: Devin/Hermes reject non-`auto`; Codex/Claude expose only verified native levels; Mock exposes full canonical vocabulary.
3. Verify proposed Codex and Claude values against current CLI/docs before hard-coding lists.
4. Implement `EffortLevel`, `EffortControl`, `EffortCapability`, `canonicalEffort`, `effortCapability`, and `validateEffort` without runtime dependencies.
5. Run `npm run build` and `node --test test/unit/effort.test.js`.

**Acceptance:** All command and adapter code can consume one registry; no duplicate effort arrays exist elsewhere.

## Task 2: Persist effort in schema-version-1 run metadata

**Objective:** Make effort immutable and automatically reusable across turns while preserving old runs.

**Files:**

- Modify: `src/core/run-store.ts`
- Modify: `src/core/engines/types.ts`
- Modify: `src/core/run-service.ts`
- Modify: `test/unit/run-store.test.js`
- Modify: `test/integration/lifecycle.test.js`

**Steps:**

1. Add failing metadata round-trip tests for explicit effort and old metadata without the field.
2. Add optional `effort?: EffortLevel` to `RunMeta`; new records always write canonical effort.
3. Add a single helper that resolves missing legacy metadata to `auto` without rewriting files.
4. Add `effort` to `EngineContext` and populate it from resolved run metadata in `executeWorker`.
5. Prove `send`/resume and sessionless fallback both retain initial effort.
6. Run focused run-store and lifecycle tests.

**Acceptance:** Existing runs load as `auto`; new runs persist effort once; subsequent turns cannot change it.

## Task 3: Validate `spawn --effort` before side effects

**Objective:** Add effort to new runs while preserving validation order and pure JSON behavior.

**Files:**

- Modify: `src/commands/spawn.ts`
- Modify: `test/integration/lifecycle.test.js`
- Modify: CLI usage tests containing spawn acknowledgements

**Steps:**

1. Add `effort` to spawn option parsing with default `auto`.
2. Validate engine and effort immediately after required positionals, before `promptFrom`, `directory`, locks, or `store.create`.
3. Persist canonical effort in run metadata.
4. Add effort to JSON acknowledgement.
5. Test invalid levels and unsupported engine/effort combinations with a fresh `SIDEKICK_HOME`; assert exit `2`, no prompt read, and no named run directory.
6. Test default acknowledgement and metadata as `auto`.

**Acceptance:** Invalid effort has zero run-state side effects and deterministic exit semantics.

## Task 4: Validate `adopt --effort` before discovery

**Objective:** Apply identical immutable effort semantics to adopted sessions.

**Files:**

- Modify: `src/commands/adopt.ts`
- Modify: `test/integration/lifecycle.test.js`

**Steps:**

1. Add `effort` parsing with default `auto`.
2. Validate effort before `directory` and `validateAdoptedSession`.
3. Persist canonical effort and include it in JSON acknowledgement.
4. Test that invalid/unsupported effort returns `2` before session discovery or run creation.
5. Test adopted run status reports the same effort after a later `send`.

**Acceptance:** Adopt and spawn share validation, persistence, and acknowledgement behavior.

## Task 5: Apply effort in native and simulated adapters

**Objective:** Emit exact per-invocation controls only for supported adapters.

**Files:**

- Modify: `src/core/engines/codex.ts`
- Modify: `src/core/engines/claude.ts`
- Modify: `src/core/engines/mock.ts`
- Modify: `src/core/engines/mock-runner.ts`
- Modify: `test/unit/engines.test.js`
- Modify: lifecycle tests that inspect `command.json`

**Steps:**

1. Add failing adapter tests for `auto` omission and non-`auto` argument placement.
2. Codex: add `-c`, `model_reasoning_effort="<level>"` identically to initial and resume argv.
3. Claude: add `--effort <level>` identically to initial and resume argv.
4. Mock: transport effort to mock runner and expose it deterministically in output/command evidence.
5. Confirm Devin/Hermes receive no effort argument because command validation rejects non-`auto` before execution.
6. Assert `command.json` preserves requested native values verbatim.
7. Do not catch harness rejection or retry at a lower level.

**Acceptance:** Initial and resumed native invocations are identical with respect to effort; `auto` produces no override.

## Task 6: Add `capabilities` discovery

**Objective:** Provide stable agent-readable adapter and local-availability discovery.

**Files:**

- Create: `src/commands/capabilities.ts`
- Modify: `src/commands/doctor.ts` or extract a shared engine-command resolver
- Modify: `src/cli.ts`
- Create: `test/unit/capabilities.test.js`
- Modify: `test/integration/lifecycle.test.js` for CLI JSON purity

**Steps:**

1. Add failing tests for all engines, selected engines, missing executable, unsupported platform, unknown engine, human output, and JSON schema.
2. Reuse existing command override and resolution logic; do not run remote model queries.
3. Return result entries for missing executables and exit `0`.
4. Reject unknown names with exit `2` before printing partial output.
5. Register command and add help usage.
6. Verify JSON stdout parses exactly with empty stderr.

**Acceptance:** Agents can decide whether a requested non-`auto` effort is locally available without probing a run.

## Task 7: Surface effort in status and acknowledgements

**Objective:** Make persisted effort visible in all promised lifecycle surfaces.

**Files:**

- Modify: `src/commands/status.ts`
- Modify: `src/commands/spawn.ts`
- Modify: `src/commands/adopt.ts`
- Modify: `test/integration/lifecycle.test.js`
- Update snapshots/expected tables as applicable

**Steps:**

1. Add failing JSON tests for spawn, adopt, and status effort fields.
2. Add `effort` to `StatusJson` using legacy-safe resolution.
3. Add human `EFFORT` column without removing existing columns.
4. Verify `send` does not accept `--effort` and run effort remains immutable.
5. Test old metadata without effort renders `auto`.

**Acceptance:** Human and machine output agree on canonical effort for old and new runs.

## Task 8: Synchronize governed public surface and documentation

**Objective:** Keep CLI governance, public docs, changelog, and installed guidance consistent.

**Files:**

- Modify: `docs/cli-surface.json`
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `skills/AGENTS.md`
- Modify: `skills/claude-code/SKILL.md`
- Modify: `skills/codex/AGENTS.md`
- Modify: `skills/devin/rule.md`
- Modify: `skills/hermes/SKILL.md`
- Modify: relevant governance/snapshot tests

**Steps:**

1. Raise governed command count from 11 to 12 by adding `capabilities`.
2. Add `--effort` to governed `spawn` and `adopt` flags.
3. Document effort matrix, `auto`, persistence, capability schema, model-dependent rejection, and examples.
4. Require every skill variant to run `sidekick capabilities ENGINE --json` before requesting non-`auto` effort.
5. Keep public language harness-agnostic; do not mention a user's private preferred models or orchestration policy.
6. Run surface drift tests and verify help snapshot.

**Acceptance:** No public surface or skill contradicts runtime behavior.

## Task 9: Full compatibility and packaging verification

**Objective:** Prove feature correctness and package hygiene without publishing.

**Commands:**

```text
npm run lint
npm run typecheck
npm run format:check
npm test
npm run surface:check
npm run prepack
npm pack --dry-run
npm run smoke:mock
```

**Steps:**

1. Run focused tests after each task, then full commands once source is stable.
2. Deliberately inspect tarball contents; include only `dist/`, `bin/`, `README.md`, `LICENSE`, approved public docs, and installable skills.
3. Confirm `docs/plans/` and internal engine-candidate research are excluded from published package unless explicitly approved.
4. Run packed-install smoke on Linux, macOS, and Windows Node 20/22/24 CI.
5. Confirm no implementation step changed global harness config, Celestwise, or installed user skills.
6. Record any model/provider rejection as external model compatibility evidence, not a reason to silently downgrade.

**Acceptance:** All local and CI gates pass; package contents are intentional; no publish occurs.

## Explicit non-goals

- Remote provider/model inventory or live model-catalog APIs.
- Per-message effort changes through `send`.
- Prompt-based effort emulation.
- Global Codex, Claude, Devin, or Hermes configuration changes.
- Temporary Hermes profiles.
- Automatic fallback or downgrade.
- Migration that rewrites schema-version-1 run metadata.
- Publishing, tagging, committing, or pushing without separate approval at implementation time.

## Definition of done

- `spawn` and `adopt` accept validated `--effort`, defaulting to `auto`.
- Effort persists and is reused for every later turn.
- Unsupported engines reject non-`auto` before side effects.
- Codex and Claude apply verified per-invocation controls on spawn and resume.
- Capabilities schema version 1 is stable, pure JSON, and exits according to contract.
- Old runs resolve to `auto` without migration.
- Status and acknowledgements expose effort.
- Governed CLI surface contains 12 commands and synchronized flags.
- README, changelog, and all skill variants match implementation.
- Focused, full, cross-platform, package, and mock smoke checks pass.
- No silent downgrade, global mutation, Celestwise change, or publish occurs.
