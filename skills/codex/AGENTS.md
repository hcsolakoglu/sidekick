# Sidekick orchestration

When delegation is useful, run `sidekick doctor ENGINE`, then `sidekick spawn ENGINE NAME --dir PATH -- "PROMPT"`. Start one background `sidekick wait NAME... --all --json` for the batch and do useful independent work. Harvest through `sidekick result NAME --json`; require terminal status and inspect `exitCode`. Use `sidekick send` for follow-ups, `adopt` for existing sessions, `tail` for live logs, and `cancel` to stop the process tree without discarding the resumable session. Never busy-poll.

Do not concurrently spawn workers with the same `--dir`; harness session discovery and workspace state can be directory-scoped, causing contention, serialization, or overlapping edits. Use a separate git worktree and `--dir` for each parallel worker. Otherwise serialize the work and continue the existing run with `sidekick send`.
