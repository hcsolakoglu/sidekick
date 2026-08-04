---
name: sidekick
description: Orchestrate persistent local agent workers with Sidekick
version: 1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [agents, orchestration]
    category: automation
---

# Sidekick

## Procedure

1. Run `sidekick doctor ENGINE`.
2. Inspect `sidekick capabilities ENGINE --model MODEL --json` before choosing a model-dependent control.
3. Run `sidekick spawn ENGINE NAME --dir PATH -- "PROMPT"` with a bounded scope and verification. Use separate control flags only when native evidence marks them supported.
4. Start one background `sidekick wait NAME... --all --json` for the batch; continue independent work.
5. Harvest `sidekick result NAME --json` and check terminal status plus `exitCode`.
6. Continue with `sidekick send NAME -- "FOLLOW-UP"`; persisted controls are immutable and send accepts no control overrides.

Use `adopt` for an existing session, `tail` for live output, and `cancel` for a resumable full-tree stop. Avoid overlapping file ownership and busy polling.

Sidekick records separate `requested`, `applied`, and `effective` observations. An argv flag alone is not effective-provider evidence. Unsupported, malformed, model-dependent-unverified, or runtime-version-mismatched explicit values fail closed with exit 2. Devin family slug `glm-5.2` and variant UID `glm-5-2` are not silently aliased; `--mode high` is not an effort setting.

Hermes oneshot currently has no public per-run `--effort` flag. Global Hermes `agent.reasoning_effort` config is outside Sidekick's per-run control plane and is not rewritten by Sidekick. Explicit Hermes non-auto `--effort` fails closed until a native per-run surface exists. For high-effort reviews prefer Codex/Claude with native effort flags.

Do not concurrently spawn workers with the same `--dir`: harness session discovery and workspace state can be directory-scoped, causing contention, serialization, or overlapping edits. Use a separate git worktree and `--dir` for each parallel worker. Otherwise serialize the work and continue the existing run with `sidekick send`.

Hermes prompts near 32 KB are unsafe on native Windows because Hermes oneshot accepts argv only; use WSL or another engine.
