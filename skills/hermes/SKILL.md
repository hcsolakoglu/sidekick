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
2. Run `sidekick spawn ENGINE NAME --dir PATH -- "PROMPT"` with a bounded scope and verification.
3. Start one background `sidekick wait NAME... --all --json` for the batch; continue independent work.
4. Harvest `sidekick result NAME --json` and check terminal status plus `exitCode`.
5. Continue with `sidekick send NAME -- "FOLLOW-UP"`.

Use `adopt` for an existing session, `tail` for live output, and `cancel` for a resumable full-tree stop. Avoid overlapping file ownership and busy polling. Hermes prompts near 32 KB are unsafe on native Windows because Hermes oneshot accepts argv only; use WSL or another engine.
