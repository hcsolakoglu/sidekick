---
name: sidekick
description: Orchestrate persistent Codex, Devin, Claude Code, Hermes, or mock workers with the sidekick CLI. Use for delegated work that should run concurrently, survive the parent turn, resume by session, or be cancelled and harvested reliably.
---

# Sidekick orchestration

1. Run `sidekick doctor ENGINE` before first use on a machine.
2. Inspect `sidekick capabilities ENGINE --model MODEL --json` before choosing model, provider, transport, effort, permission, sandbox, or workspace trust.
3. Delegate a bounded task with `sidekick spawn ENGINE NAME --dir PATH -- "PROMPT"`. Use unique, stable names and separate control flags only when the evidence matrix marks them native.
4. Start one background `sidekick wait NAME... --all --json` process for the batch. Continue useful parent work while it waits; do not start polling loops.
5. Harvest with `sidekick result NAME --json`. Check both `status` and `exitCode` before trusting `output`.
6. Continue the same harness session with `sidekick send NAME -- "FOLLOW-UP"`.

Use `sidekick adopt ENGINE NAME --session ID --dir PATH` for an existing session. Use `sidekick tail NAME` for live output and `sidekick cancel NAME` to stop the full process tree while keeping the session resumable. Use `send --force` only when replacing an active turn.

Sidekick persists `requested`, `applied`, and `effective` control observations. An argv flag does not prove provider-reported effective state. Unsupported, malformed, model-dependent-unverified, or runtime-version-mismatched explicit values fail closed with exit 2. Codex effort is value-gated (`minimal|low|medium|high|xhigh|max`) for any model. Claude effort is exact-model; inspect capabilities before requesting it. Hermes has no public per-run effort flag. Devin family slug `glm-5.2` and variant UID `glm-5-2` are distinct and are never silently aliased; do not use `--mode high` as effort.

Choose an engine by task and local availability: use Codex or Claude for focused repository work, Devin for broad autonomous implementation, Hermes for general tool-rich work, and mock only for deterministic workflow tests. Split independent tasks; keep tightly coupled edits with one worker. Give every delegate an exact scope, constraints, verification command, and expected response.

Do not concurrently spawn workers with the same `--dir`: harness session discovery and workspace state can be directory-scoped, causing contention, accidental serialization, or overlapping edits. For real parallelism, create a separate git worktree for each worker and pass its path through `--dir`. If the tasks must share one working tree, serialize them and reuse the existing run with `sidekick send`.

Prompt transport is handled by Sidekick: Codex and Claude use stdin, Devin uses `--prompt-file`, and Hermes currently uses argv. Hermes prompts near 32 KB are unsafe on native Windows; prefer WSL or another engine there. See `sidekick doctor hermes`.
