# Sidekick Harness Control Evidence

> Evidence gate: T1 / G1
> Captured: 2026-08-04T20:30:38+03:00
> Refreshed: 2026-11-10 against the installed harness versions. The refresh used `--version`, `--help`, invalid-value parser probes, and installed-package inspection only; no live model prompt was sent.
> Status: native support is versioned and conservative; unverified rows are not public capabilities.

This file records executable and documentation evidence used before implementing the typed control plane. It is not a claim that every row is supported. Rows marked `unverified` or `unsupported` must fail closed before prompt, cwd, discovery, lock, store, or worker side effects.

## Evidence sources

| Source                          | Evidence                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Devin CLI                 | `devin 3000.12.32 (1126aba4a596)`; `devin --help`; invalid `--permission-mode` parser probe now lists `smart`. The model catalog was last recorded on 3000.11.205 and was not re-run in the 2026-11-10 refresh. |
| Devin commands documentation    | <https://docs.devin.ai/cli/reference/commands> documents `--model`, `--permission-mode`, `--sandbox`, `--resume`, `--prompt-file`, `--print`, and workspace-trust behavior.                                     |
| Devin permissions documentation | <https://docs.devin.ai/cli/reference/permissions> documents Smart rollout, Autonomous coupling to `--sandbox`, and permission precedence.                                                                       |
| Local Codex CLI                 | `codex-cli 0.167.0`; `codex exec --help`; `codex exec resume --help`; installed binary event names `thread.started`, `item.completed`, `agent_message`, `thread_id`.                                            |
| OpenAI Codex config reference   | <https://developers.openai.com/codex/config-reference> documents `approval_policy`, `model_reasoning_effort`, and `sandbox_mode`.                                                                               |
| Local Hermes CLI                | `Hermes Agent v0.22.5`; `hermes --version`; `hermes --help` documents the per-run `--reasoning LEVEL` surface for `-z/--oneshot` and `--tui`, plus `--model`, `--resume`, and `--pass-session-id`.              |
| Local Claude Code CLI           | `claude --version` → `2.1.321 (Claude Code)`; `claude --help` exits 0; invalid-value probes confirm the permission and effort vocabularies.                                                                     |
| Local Command Code CLI          | `commandcode 1.88.5`; `commandcode --help`; installed bundle stop reasons and NDJSON event names.                                                                                                               |

## Local probe records

### Devin parser and model catalog

```text
$ devin --version
 devin 3000.12.32 (1126aba4a596)

$ devin --help
 --permission-mode accepts a documented help vocabulary containing auto, accept-edits, smart, and dangerous.
 --sandbox is advertised as a research-preview process sandbox.
 --model, --prompt-file, --resume, --print, and --respect-workspace-trust are present.

$ devin --permission-mode __sidekick_invalid__ --help
 error: invalid value '__sidekick_invalid__' for '--permission-mode <PERMISSION_MODE>':
 Invalid permission mode: __sidekick_invalid__. Valid options: normal (auto), accept-edits,
 smart, dangerous (yolo, bypass), autonomous (requires --sandbox)
 EXIT=2

$ devin --sandbox --permission-mode autonomous --help
 EXIT=0

$ devin --permission-mode autonomous --help
 EXIT=0
```

The 3000.12.32 parser error now lists `smart`, so the parser-accepted vocabulary contains `normal`, `accept-edits`, `smart`, `dangerous`, and `autonomous`. `smart` was previously excluded only because the 3000.11.205 parser error omitted it; the same version-specific probe now promotes it. `autonomous` remains a supported combination only with the documented `--sandbox` coupling. Live execution of `smart` was not re-run (no live model calls), so provider-side acceptance is unverified.

The model catalog last observed on 3000.11.205 returned `glm-5.2` as the family slug and `glm-5-2` as the explicit High variant UID. The catalog probe was not re-run in this refresh. No silent alias resolution is allowed.

### Codex parser and configuration evidence

```text
$ codex --version
 codex-cli 0.167.0

$ codex exec --help
 --sandbox accepts read-only, workspace-write, danger-full-access.
 -c/--config accepts key=value overrides.
 --model, --json, --output-last-message, --skip-git-repo-check, and stdin prompt transport are present.

$ codex exec resume --help
 -c/--config, --model, --json, --output-last-message, --skip-git-repo-check, and stdin prompt transport are present.
 --sandbox is not present on the resume command.
```

The installed 0.167.0 binary still emits the JSONL event names the adapter parses: `thread.started` (with `thread_id`), `item.completed`, and `agent_message`.

Official config reference records:

- `approval_policy`: `untrusted | on-request | never | granular`
- `model_reasoning_effort`: `minimal | low | medium | high | xhigh | max` (OpenAI reasoning docs include `max`; Sidekick value-gates these for any `--model` without a curated model allowlist; provider/model may ignore unsupported levels)
- `sandbox_mode`: `read-only | workspace-write | danger-full-access`

Therefore initial Codex sandbox uses the native `--sandbox` flag. Resume must use an exact `-c sandbox_mode=...` and, where selected, `-c approval_policy=...` fixture; `test/unit/engines.test.js` now asserts that argv. A resume `--sandbox` flag is not emitted.

### Claude Code parser evidence

```text
$ claude --version
2.1.321 (Claude Code)

$ claude --help
EXIT=0
--effort accepts low, medium, high, xhigh, max.
--permission-mode accepts acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.

$ claude --effort __sidekick_invalid__ --help
Warning: Unknown --effort value '__sidekick_invalid__' — ignoring it and using the default effort.
Valid values: low, medium, high, xhigh, max.
```

Sidekick keeps the canonical permission value `accept-edits` and maps it to the native `acceptEdits` spelling. An unknown effort value is now a warning that falls back to the default rather than a hard error, so the value gate stays important: an unsupported level must fail closed instead of silently running at the default. Claude effort is exact-model per official model-config docs: supported models get their documented value sets; unresolved models fail closed on explicit effort.

### Hermes parser evidence

```text
$ hermes --version
Hermes Agent v0.22.5 (2026.9.24) · stable · local bf0203a794a0

$ hermes --help
  -z, --oneshot PROMPT
  -m, --model MODEL
  --reasoning LEVEL   Reasoning effort for this invocation: none, minimal, low,
                      medium, high, xhigh, max, or ultra. Overrides
                      agent.reasoning_effort in config.yaml for this run only.
  --resume, -r SESSION
  --pass-session-id
```

`--reasoning` is the native per-run effort surface for `-z/--oneshot` and `--tui`, so Hermes effort is no longer limited to global config. `--pass-session-id` only embeds the session ID in the agent's system prompt; the oneshot path writes the response to stdout and no `SESSION_ID=` line, so session capture relies on the `state.db` discovery path (or `hermes sessions list`).

## Capability evidence matrix

The registry key is `(engine, provider, model, transport, toolVersion, axis, action)`. `action` is `initial`, `adopt`, `resume`, or `fallback`. `adopt` does not start a new native worker; it validates and persists controls. `fallback` must reuse persisted controls and provenance.

| Engine              | Axis / value                                                                          | Action          | Evidence status                  | Native mechanism or rejection                                                       | Evidence boundary                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------- | --------------- | -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Devin 3000.12.32    | `model` explicit model UID                                                            | initial/resume  | `native`                         | `--model MODEL`; `--resume SESSION` for resume                                      | Exact model UID is required; catalog availability is separate from flag support.                                          |
| Devin 3000.12.32    | `model=glm-5-2`                                                                       | initial/resume  | `native`                         | `--model glm-5-2`                                                                   | Explicit High variant; family slug is not silently rewritten.                                                             |
| Devin 3000.12.32    | `permission=normal`                                                                   | initial/resume  | `native`                         | Canonical `normal` maps to native `--permission-mode auto`                          | Parser alias evidence: `normal (auto)`.                                                                                   |
| Devin 3000.12.32    | `permission=accept-edits`                                                             | initial/resume  | `native`                         | `--permission-mode accept-edits`                                                    | Accepted by documented surface and parser vocabulary.                                                                     |
| Devin 3000.12.32    | `permission=dangerous`                                                                | initial/resume  | `native`                         | `--permission-mode dangerous`                                                       | Parser aliases `yolo` and `bypass` are not used as canonical output.                                                      |
| Devin 3000.12.32    | `permission=smart`                                                                    | initial/resume  | `native`                         | `--permission-mode smart`                                                           | 3000.12.32 parser accepted-value error lists `smart`; live provider-side execution is not re-verified.                    |
| Devin 3000.12.32    | `sandbox=true, permission=autonomous`                                                 | initial/resume  | `native` pending runtime fixture | `--sandbox --permission-mode autonomous`                                            | Official docs and help probe accept coupling; actual harmless print-mode probe remains a required implementation fixture. |
| Devin 3000.12.32    | `sandbox=true, permission!=autonomous`                                                | initial/resume  | `unsupported`                    | Exit 2; never emit partial argv                                                     | Official docs describe Autonomous as the sandbox permission mode.                                                         |
| Devin 3000.12.32    | `sandbox=false, permission=autonomous`                                                | initial/resume  | `unsupported`                    | Exit 2; never emit autonomous without sandbox                                       | Coupling is a documented runtime requirement; help-only parsing cannot prove execution semantics.                         |
| Devin 3000.12.32    | `workspaceTrust=true                                                                  | false`          | initial/resume                   | `native`                                                                            | `--respect-workspace-trust true                                                                                           | false`                 | Exact boolean form is documented. |
| Devin 3000.12.32    | `effort`                                                                              | initial/resume  | `unsupported`                    | No independent `--effort`; explicit model variants are reported as `model-variant`  | `glm-5-2-max` is a model variant, not an implicit effort conversion.                                                      |
| Devin 3000.12.32    | any control                                                                           | adopt           | `unverified`                     | Validate and persist before adopted-session completion; no native worker invocation | Adapter reuse must be covered by T7 before public promotion.                                                              |
| Devin 3000.12.32    | any control                                                                           | fallback        | `unverified`                     | Reuse persisted immutable controls; version/provenance mismatch exits 2             | No engine/provider/model/transport substitution.                                                                          |
| Codex 0.167.0       | `sandbox=read-only                                                                    | workspace-write | danger-full-access`              | initial                                                                             | `native`                                                                                                                  | `exec --sandbox VALUE` | Local subcommand help.            |
| Codex 0.167.0       | `sandbox=...`                                                                         | resume          | `native`                         | `exec resume -c sandbox_mode=VALUE`                                                 | Resume help accepts `-c`; argv asserted in `test/unit/engines.test.js`.                                                   |
| Codex 0.167.0       | `approval_policy`                                                                     | initial/resume  | `native`                         | `-c approval_policy=VALUE`                                                          | Official config reference, local `-c` parser surface, and the resume argv test.                                           |
| Codex 0.167.0       | `effort=minimal                                                                       | low             | medium                           | high                                                                                | xhigh                                                                                                                     | max`                   | initial/resume                    | `native` value-gated | `-c model_reasoning_effort=VALUE` for any `--model` | No curated model allowlist; provider/model may ignore unsupported levels. OpenAI reasoning docs include `max`. |
| Codex 0.167.0       | resume `--sandbox`                                                                    | resume          | `unsupported`                    | Exit 2 / no flag emission                                                           | Local `codex exec resume --help` omits `--sandbox`.                                                                       |
| Hermes 0.22.5       | `model`                                                                               | initial/resume  | `native`                         | `--model MODEL`; resume `--resume SESSION`                                          | Local adapter and CLI surface.                                                                                            |
| Hermes 0.22.5       | `effort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`)        | initial/resume  | `native`                         | `--reasoning LEVEL` for `-z/--oneshot` and `--tui`                                  | `hermes --help` plus the installed parser; provider/model may ignore unsupported levels.                                  |
| Hermes 0.22.5       | `permission` / `sandbox`                                                              | initial/resume  | `unverified`                     | No public per-run native flag; explicit request exits 2                             | Global Hermes config is not silently treated as per-run immutable control.                                                |
| Claude Code 2.1.321 | permission (`accept-edits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`) | all             | `native`                         | `--permission-mode` with canonical `accept-edits` mapped to `acceptEdits`           | Local `claude --help`; adapter argv fixtures.                                                                             |
| Claude Code 2.1.321 | effort (`low`, `medium`, `high`, `xhigh`, `max`)                                      | all             | `native`, model-dependent        | `--effort VALUE`; unresolved model support exits 2                                  | Local `claude --help`; selected model evidence remains required.                                                          |
| Mock                | registry-defined controls                                                             | all             | `simulated`                      | Deterministic argv/output round-trip                                                | Simulation is not native evidence.                                                                                        |

## Proceed / stop decisions

- T1 evidence gate passes for implementing the typed schema, registry, fail-closed validation, and adapter fixtures.
- T1 does **not** authorize advertising unsupported Devin effort flags, unproven Hermes permission/sandbox controls, or unresolved model-dependent Claude effort.
- T1 now authorizes Claude Code 2.1.321 permission native support and the model-dependent `--effort` value surface; selected-model promotion remains a separate evidence decision.
- T2 must preserve exact source provenance and `toolVersion` in capability records.
- The 2026-11-10 refresh promotes Devin `smart` from the version-specific parser probe and Hermes `--reasoning` from the documented per-run surface. The harmless Devin `--sandbox --permission-mode autonomous` print-mode fixture is still missing; that row stays pending.
- Any failed or ambiguous native probe remains `unverified` and returns exit 2 for explicit requests.
