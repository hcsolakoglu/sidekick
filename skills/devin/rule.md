# Sidekick orchestration

Use Sidekick for bounded parallel delegation. Run `sidekick doctor ENGINE`, spawn with an exact scope and verification command, start one background `sidekick wait NAME... --all --json`, then harvest `sidekick result NAME --json`. Continue with `sidekick send`; use `adopt`, `tail`, or `cancel` for existing, live, or stopped work. Check terminal status and `exitCode`; never busy-poll or let multiple workers edit the same files.

Never concurrently spawn workers with the same `--dir`: harness session discovery and workspace state can be directory-scoped, causing lock contention, serialization, or overlapping edits. For actual parallel execution, create a separate git worktree for each worker and use that worktree as `--dir`. When worktrees are unavailable or edits must share a tree, run one worker at a time and reuse its session with `sidekick send`.
