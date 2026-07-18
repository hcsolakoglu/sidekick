# Sidekick orchestration

Use Sidekick for bounded parallel delegation. Run `sidekick doctor ENGINE`, spawn with an exact scope and verification command, start one background `sidekick wait NAME... --all --json`, then harvest `sidekick result NAME --json`. Continue with `sidekick send`; use `adopt`, `tail`, or `cancel` for existing, live, or stopped work. Check terminal status and `exitCode`; never busy-poll or let multiple workers edit the same files.
