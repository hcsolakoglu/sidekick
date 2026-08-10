# Sidekick Harness Control Evidence

> Evidence gate: T1 / G1
> Captured: 2026-08-04T20:30:38+03:00
> Status: native support is versioned and conservative; unverified rows are not public capabilities.

This file records executable and documentation evidence used before implementing the typed control plane. It is not a claim that every row is supported. Rows marked `unverified` or `unsupported` must fail closed before prompt, cwd, discovery, lock, store, or worker side effects.

## Evidence sources

| Source                          | Evidence                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Devin CLI                 | `devin 3000.3.27 (0becb483)`; `devin --help`; invalid `--permission-mode` parser probe; `devin models list --format json`.                                                  |
| Devin commands documentation    | <https://docs.devin.ai/cli/reference/commands> documents `--model`, `--permission-mode`, `--sandbox`, `--resume`, `--prompt-file`, `--print`, and workspace-trust behavior. |
| Devin permissions documentation | <https://docs.devin.ai/cli/reference/permissions> documents Smart rollout, Autonomous coupling to `--sandbox`, and permission precedence.                                   |
| Local Codex CLI                 | `codex-cli 0.147.0`; `codex exec --help`; `codex exec resume --help`.                                                                                                       |
| OpenAI Codex config reference   | <https://developers.openai.com/codex/config-reference> documents `approval_policy`, `model_reasoning_effort`, and `sandbox_mode`.                                           |
| Local Hermes CLI                | `Hermes Agent v0.19.0`; `hermes --version`. Hermes per-run effort/permission behavior remains unverified for Sidekick and is not advertised by this gate.                   |
| Local Claude Code CLI           | `claude --version` → `2.1.221 (Claude Code)`; `claude --help` exits 0; native permission and model-dependent effort flags are locally evidenced.                            |

## Local probe records

### Devin parser and model catalog

```text
$ devin --version
 devin 3000.3.27 (0becb483)

$ devin --help
 --permission-mode accepts a documented help vocabulary containing auto, accept-edits, smart, and dangerous.
 --sandbox is advertised as a research-preview process sandbox.
 --model, --prompt-file, --resume, --print, and --respect-workspace-trust are present.

$ devin --permission-mode __sidekick_invalid__ --help
 error: invalid value '__sidekick_invalid__' for '--permission-mode <PERMISSION_MODE>':
 Invalid permission mode: __sidekick_invalid__. Valid options: normal (auto), accept-edits,
 dangerous (yolo, bypass), autonomous (requires --sandbox)
 EXIT=2

$ devin --sandbox --permission-mode autonomous --help
 EXIT=0

$ devin --permission-mode autonomous --help
 EXIT=0
```

The condensed help and parser error disagree about `smart` and about the visibility of `autonomous`. The parser error is the accepted-value evidence used for fail-closed behavior, while the help text is retained as a surface-drift fixture. Implementation must not emit `smart` until a version-specific non-help validation promotes it. `autonomous` is only a supported sandbox combination when the documented `--sandbox` coupling is present.

The model catalog probe returned:

```json
{
  "version": "devin 3000.3.27",
  "slug": "glm-5.2",
  "family_uid": "glm-5.2",
  "variants": [
    { "model_uid": "glm-5-2", "label": "GLM-5.2 High" },
    { "model_uid": "glm-5-2-max", "label": "GLM-5.2 Max" },
    { "model_uid": "glm-5-2-none", "label": "GLM-5.2 No Thinking" }
  ]
}
```

`glm-5.2` is a family slug. `glm-5-2` is the explicit High variant UID. No silent alias resolution is allowed.

### Codex parser and configuration evidence

```text
$ codex --version
 codex-cli 0.147.0

$ codex exec --help
 --sandbox accepts read-only, workspace-write, danger-full-access.
 -c/--config accepts key=value overrides.
 --model, --json, --output-last-message, and stdin prompt transport are present.

$ codex exec resume --help
 -c/--config, --model, --json, --output-last-message, and stdin prompt transport are present.
 --sandbox is not present on the resume command.
```

Official config reference records:

- `approval_policy`: `untrusted | on-request | never | granular`
- `model_reasoning_effort`: `minimal | low | medium | high | xhigh | max` (OpenAI reasoning docs include `max`; Sidekick value-gates these for any `--model` without a curated model allowlist; provider/model may ignore unsupported levels)
- `sandbox_mode`: `read-only | workspace-write | danger-full-access`

Therefore initial Codex sandbox uses the native `--sandbox` flag. Resume must use an exact `-c sandbox_mode=...` and, where selected, `-c approval_policy=...` fixture. A resume `--sandbox` flag is not emitted.

### Claude Code parser evidence

```text
$ claude --version
2.1.221 (Claude Code)

$ claude --help
EXIT=0
--effort accepts low, medium, high, xhigh, max.
--permission-mode accepts acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.
```

Sidekick keeps the canonical permission value `accept-edits` and maps it to the native `acceptEdits` spelling. Claude effort is exact-model per official model-config docs: supported models get their documented value sets; unresolved models fail closed on explicit effort.

## Capability evidence matrix

The registry key is `(engine, provider, model, transport, toolVersion, axis, action)`. `action` is `initial`, `adopt`, `resume`, or `fallback`. `adopt` does not start a new native worker; it validates and persists controls. `fallback` must reuse persisted controls and provenance.

| Engine              | Axis / value                                                                          | Action          | Evidence status                  | Native mechanism or rejection                                                                | Evidence boundary                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------- | --------------- | -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Devin 3000.3.27     | `model` explicit model UID                                                            | initial/resume  | `native`                         | `--model MODEL`; `--resume SESSION` for resume                                               | Exact model UID is required; catalog availability is separate from flag support.                                          |
| Devin 3000.3.27     | `model=glm-5-2`                                                                       | initial/resume  | `native`                         | `--model glm-5-2`                                                                            | Explicit High variant; family slug is not silently rewritten.                                                             |
| Devin 3000.3.27     | `permission=normal`                                                                   | initial/resume  | `native`                         | Canonical `normal` maps to native `--permission-mode auto`                                   | Parser alias evidence: `normal (auto)`.                                                                                   |
| Devin 3000.3.27     | `permission=accept-edits`                                                             | initial/resume  | `native`                         | `--permission-mode accept-edits`                                                             | Accepted by documented surface and parser vocabulary.                                                                     |
| Devin 3000.3.27     | `permission=dangerous`                                                                | initial/resume  | `native`                         | `--permission-mode dangerous`                                                                | Parser aliases `yolo` and `bypass` are not used as canonical output.                                                      |
| Devin 3000.3.27     | `permission=smart`                                                                    | initial/resume  | `unverified`                     | Preflight exit 2; never emit `--permission-mode smart`                                       | Help advertises it, parser accepted-value error omits it. Requires a version-specific non-help promotion probe.           |
| Devin 3000.3.27     | `sandbox=true, permission=autonomous`                                                 | initial/resume  | `native` pending runtime fixture | `--sandbox --permission-mode autonomous`                                                     | Official docs and help probe accept coupling; actual harmless print-mode probe remains a required implementation fixture. |
| Devin 3000.3.27     | `sandbox=true, permission!=autonomous`                                                | initial/resume  | `unsupported`                    | Exit 2; never emit partial argv                                                              | Official docs describe Autonomous as the sandbox permission mode.                                                         |
| Devin 3000.3.27     | `sandbox=false, permission=autonomous`                                                | initial/resume  | `unsupported`                    | Exit 2; never emit autonomous without sandbox                                                | Coupling is a documented runtime requirement; help-only parsing cannot prove execution semantics.                         |
| Devin 3000.3.27     | `workspaceTrust=true                                                                  | false`          | initial/resume                   | `native`                                                                                     | `--respect-workspace-trust true                                                                                           | false`                 | Exact boolean form is documented. |
| Devin 3000.3.27     | `effort`                                                                              | initial/resume  | `unsupported`                    | No independent `--effort`; explicit model variants are reported as `model-variant`           | `glm-5-2-max` is a model variant, not an implicit effort conversion.                                                      |
| Devin 3000.3.27     | any control                                                                           | adopt           | `unverified`                     | Validate and persist before adopted-session completion; no native worker invocation          | Adapter reuse must be covered by T7 before public promotion.                                                              |
| Devin 3000.3.27     | any control                                                                           | fallback        | `unverified`                     | Reuse persisted immutable controls; version/provenance mismatch exits 2                      | No engine/provider/model/transport substitution.                                                                          |
| Codex 0.147.0       | `sandbox=read-only                                                                    | workspace-write | danger-full-access`              | initial                                                                                      | `native`                                                                                                                  | `exec --sandbox VALUE` | Local subcommand help.            |
| Codex 0.147.0       | `sandbox=...`                                                                         | resume          | `native` pending exact fixture   | `exec resume -c sandbox_mode=VALUE`                                                          | Resume help accepts `-c`; exact argv fixture is required before promotion.                                                |
| Codex 0.147.0       | `approval_policy`                                                                     | initial/resume  | `native` pending exact fixture   | `-c approval_policy=VALUE`                                                                   | Official config reference plus local `-c` parser surface.                                                                 |
| Codex 0.147.0       | `effort=minimal                                                                       | low             | medium                           | high                                                                                         | xhigh                                                                                                                     | max`                   | initial/resume                    | `native` value-gated | `-c model_reasoning_effort=VALUE` for any `--model` | No curated model allowlist; provider/model may ignore unsupported levels. OpenAI reasoning docs include `max`. |
| Codex 0.147.0       | resume `--sandbox`                                                                    | resume          | `unsupported`                    | Exit 2 / no flag emission                                                                    | Local `codex exec resume --help` omits `--sandbox`.                                                                       |
| Hermes 0.19.0       | `model`                                                                               | initial/resume  | `native`                         | `--model MODEL`; resume `--resume SESSION`                                                   | Local adapter and CLI surface.                                                                                            |
| Hermes 0.19.0       | effort/permission/sandbox                                                             | initial/resume  | `unverified`                     | No public per-run native flag in current Sidekick adapter; explicit non-auto request exits 2 | Global Hermes config is not silently treated as per-run immutable control.                                                |
| Claude Code 2.1.221 | permission (`accept-edits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`) | all             | `native`                         | `--permission-mode` with canonical `accept-edits` mapped to `acceptEdits`                    | Local `claude --help`; adapter argv fixtures.                                                                             |
| Claude Code 2.1.221 | effort (`low`, `medium`, `high`, `xhigh`, `max`)                                      | all             | `native`, model-dependent        | `--effort VALUE`; unresolved model support exits 2                                           | Local `claude --help`; selected model evidence remains required.                                                          |
| Mock                | registry-defined controls                                                             | all             | `simulated`                      | Deterministic argv/output round-trip                                                         | Simulation is not native evidence.                                                                                        |

## Proceed / stop decisions

- T1 evidence gate passes for implementing the typed schema, registry, fail-closed validation, and adapter fixtures.
- T1 does **not** authorize advertising unverified Devin Smart, unsupported Devin effort flags, unproven Hermes non-auto controls, or unresolved model-dependent Claude effort.
- T1 now authorizes Claude Code 2.1.221 permission native support and the model-dependent `--effort` value surface; selected-model promotion remains a separate evidence decision.
- T2 must preserve exact source provenance and `toolVersion` in capability records.
- T5/T7 must add the missing harmless Devin print-mode coupling fixture and Codex resume `-c` fixture before changing capability status from pending/unverified to native.
- Any failed or ambiguous native probe remains `unverified` and returns exit 2 for explicit requests.
