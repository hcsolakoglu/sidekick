# sidekick

`sidekick` is a dependency-free Node.js CLI for running persistent local agent sessions in the background. It supports Codex, Devin, Claude, Hermes, and a deterministic mock engine for testing. Runs survive the terminal that launched them and keep an inspectable, file-based history.

## Install

Node.js 20 or newer is required; Node.js 22 is recommended.

```sh
npm install --global @hcsolakoglu/sidekick
sidekick --version
```

For development, clone the repository and run `npm ci && npm run build && npm link`.

### Install the agent skill

The npm package includes harness-specific instructions for the four directly supported engines. Install them after installing Sidekick:

```sh
sidekick skill install codex
sidekick skill install claude-code
sidekick skill install devin
sidekick skill install hermes
```

Install only the harness you use. Sidekick refuses to overwrite a different standalone skill unless you explicitly pass `--force`.

For Codex, Claude Code, Cursor, Gemini CLI, GitHub Copilot, Devin, Hermes, and other compatible coding harnesses, Vercel's open [`skills` CLI](https://github.com/vercel-labs/skills) can discover and install the portable skill directly from this repository:

```sh
npx skills add hcsolakoglu/sidekick --skill sidekick
```

That command installs at project scope by default and interactively selects detected harnesses. To make Sidekick guidance available globally to every harness that supports global skill installation, without prompts:

```sh
npx skills add hcsolakoglu/sidekick \
  --skill sidekick \
  -g \
  --agent '*' \
  -y
```

The default symlink mode keeps one canonical skill and links supported harness directories to it, avoiding independent duplicate copies. Do not add `--copy` unless symlinks are unavailable. Verify discovery with `npx skills list -g`. Invoke the installed skill explicitly with a prompt such as:

```text
Use $sidekick to delegate a bounded repository audit, wait without busy-polling, and verify the result.
```

#### Copy-paste setup prompt for an AI coding agent

```text
Install and verify Sidekick for all coding-agent harnesses on this machine that support global skill installation. First check that Node.js 20 or newer and npm are available. If sidekick is missing or outdated, run npm install --global @hcsolakoglu/sidekick; do not use sudo and do not change my npm prefix or other npm configuration. Run sidekick --version and sidekick doctor --json. Install one canonical portable skill globally and symlink every globally supported harness to it with: npx skills add hcsolakoglu/sidekick --skill sidekick -g --agent '*' -y. Report project-only harnesses that skip global installation, but do not create manual copies and do not use --copy. Verify installations with npx skills list -g and confirm the harness links resolve to the same canonical Sidekick skill. Then run a deterministic smoke lifecycle with the bundled mock engine using a unique run name: spawn it, wait for completion, inspect the JSON result, and clean only that completed smoke run. Never expose credentials or environment secrets. If permissions, network access, symlink support, or an unsupported harness blocks setup, stop and report the exact failure plus the safest manual command. Report the Sidekick version, doctor results, canonical skill location, linked and skipped harnesses, smoke result, and any remaining action.
```

## Quick start

```sh
sidekick spawn codex review-api --dir ./my-project -- "Review the API error handling"
sidekick wait review-api
sidekick result review-api
sidekick send review-api -- "Now propose the smallest safe patch"
```

Use the `mock` engine to exercise the complete lifecycle without installing an agent CLI:

```sh
sidekick spawn mock demo -- "hello"
sidekick wait demo --json
```

## Commands

```text
sidekick spawn ENGINE NAME [--dir PATH] [--model MODEL] [--mode MODE] [--on-complete CMD] [--json] -- PROMPT
sidekick send NAME [--force] [--json] -- PROMPT
sidekick wait [NAME ...] [--all] [--timeout SECONDS] [--quiet] [--json]
sidekick adopt ENGINE NAME --session ID [--dir PATH] [--model MODEL] [--mode MODE] [--json]
sidekick tail NAME [-n LINES]
sidekick status [--all] [--limit N] [--running] [--json]
sidekick result NAME [--json]
sidekick clean [NAME ...] [--older-than DUR] [--keep-last N] [--dry-run] [--json]
sidekick migrate [NAME ...] [--apply] [--dry-run] [--quarantine] [--restore] [--json]
sidekick cancel NAME [--json]
sidekick doctor [ENGINE ...] [--json]
sidekick skill install HARNESS [--force] [--json]
```

- `spawn` creates a named run and starts a detached worker. Names match `[A-Za-z0-9][A-Za-z0-9._-]{0,79}`.
- `send` resumes the recorded session. If an engine exposed no session ID, it sends a transcript fallback. Active runs reject follow-ups unless `--force` stops the current worker first.
- `wait` uses filesystem events with periodic liveness checks. It returns after the first selected run unless `--all` is supplied. With no names, it selects all currently running runs.
- `adopt` records an existing engine session without starting it.
- `tail` follows the current output using Node filesystem APIs on every supported OS.
- `status` shows every running run plus the 20 newest terminal runs by default. Use `--limit N` to change the terminal history window, `--running` for active runs only, or `--all` for complete managed history. JSON includes top-level `total`, `shown`, `truncated`, and `skipped`; each returned run includes its own `updatedAt` value.
- `clean` deletes readable terminal runs and skips running, unknown, legacy, or unreadable state. Use `--dry-run` before deletion; it reports `wouldRemove` without removing anything. Retain recent runs with `--older-than 7d` and/or `--keep-last 10`.
- `migrate` previews legacy run-state conversion by default. Use `--apply` to atomically add validated v1 metadata without deleting or rewriting existing session, prompt, output, or turn files. Use `--quarantine` with `--apply` to move unsupported legacy directories out of `runs/` without deleting them; quarantine paths are reported for recovery. Use `migrate NAME --restore --apply` to move one quarantined directory back, with collision and ambiguity checks. `--apply` and `--dry-run` are mutually exclusive.
- `cancel` terminates the worker process tree, records `cancelled`, and preserves the engine session for a later `send`.
- `doctor` reports the current OS support level, safe executable resolution, and state location for each engine. Pass engine names to narrow the check. It exits 1 if a selected engine is missing or unsupported.
- `skill install` installs bundled instructions for `claude-code`, `codex`, `devin`, or `hermes`. Existing standalone files are not overwritten unless `--force` is supplied.

Run `sidekick --help` for the compact command reference.

## Examples

Prompts are argv values, never shell-interpolated by sidekick. `--` makes a prompt beginning with a dash unambiguous:

```sh
sidekick spawn claude migration --model sonnet --mode accept-edits -- "Inspect only; do not edit"
sidekick spawn devin frontend --dir "C:\Work Files\app" -- "Run the UI tests"
sidekick wait migration frontend --all --timeout 900 --quiet
sidekick status --json
sidekick status --limit 10 --running
sidekick status --all --json
sidekick clean --dry-run --older-than 7d --keep-last 10 --json
sidekick clean --older-than 7d --keep-last 10
sidekick skill install claude-code
```

For concurrent workers, use a different working directory for each run. Harness session discovery and workspace state can be directory-scoped, so workers sharing the same `--dir` may contend, serialize, or overwrite each other's edits. Use separate git worktrees for real parallelism. If workers must share one working tree, serialize the tasks and continue the existing run with `sidekick send`.

When standard input is not a terminal and `CI` is not `true`, a prompt may come from stdin:

```sh
printf '%s\n' 'Summarize this repository' | sidekick spawn codex summary
```

## Configuration

Precedence is **command flag > environment variable > built-in default**. `--dir` defaults to the current directory. Engine model and permission-mode defaults are passed through as documented by each engine; Devin defaults to model `glm-5.2` and permission mode `auto`.

State lives under `SIDEKICK_HOME`, or `~/.sidekick` by default:

```text
runs/NAME/
  meta.json  out.log  status  exit  session  pid
  run-1/
    prompt  command.json  raw.log  stderr.log  out.log  status  exit  session
locks/
```

Writes that define state are atomic. Run mutations use portable lock directories, process-identity checks, and stale-lock recovery. Engine stdout is appended live, then normalized on completion. `SIDEKICK_MAX_LOG_MB` bounds each log.

## Engine and operating-system support

This matrix reflects the upstream documentation reviewed on 2026-07-18. “Native” means the engine can run directly from PowerShell/Windows Terminal rather than only inside WSL.

| Engine      | Linux     | macOS     | Native Windows | WSL                               | Install and session behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------- | --------- | -------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI   | Supported | Supported | Supported      | Supported                         | Standalone installers are available for macOS/Linux and PowerShell; npm and Homebrew are also documented. `codex exec resume` is the same non-interactive resume surface across platforms. State defaults to `CODEX_HOME` or `~/.codex`; on native Windows, `~` is `%USERPROFILE%`. See the [Codex CLI](https://developers.openai.com/codex/cli), [Windows sandbox](https://developers.openai.com/codex/windows), [CLI reference](https://developers.openai.com/codex/cli/reference), and [configuration reference](https://developers.openai.com/codex/config-reference).                                                                                                                                                                                                                                                                                                          |
| Devin CLI   | Supported | Supported | Supported      | Supported                         | Official installers cover macOS/Linux/WSL, Homebrew, native Windows x64/ARM64, and PowerShell. `--resume`, `--prompt-file`, and `--print` are documented; `devin list` and resume are scoped to the current directory, so sidekick always supplies the exact `cwd`, including Windows paths as an argv-free process option. User config is `%APPDATA%\devin\config.json` on Windows and `~/.config/devin/config.json` elsewhere; runtime data/logs use `%APPDATA%\devin\cli` or `~/.local/share/devin/cli`. Native Windows sandbox mode is unavailable, but sidekick does not enable it. See [Devin CLI quickstart](https://docs.devin.ai/cli), [commands](https://docs.devin.ai/cli/reference/commands), [configuration](https://docs.devin.ai/cli/reference/configuration/config-file), and [terminal compatibility](https://docs.devin.ai/cli/reference/terminal-compatibility). |
| Claude Code | Supported | Supported | Supported      | Supported                         | Native installers, WinGet, Homebrew, Linux packages, and npm are supported. Current npm packages install a native per-platform binary, not a Node entry point. `claude -p --resume` is documented and uses the same session semantics across supported platforms. User state is `~/.claude` and resolves to `%USERPROFILE%\.claude` on Windows. Native Windows works with PowerShell or optional Git Bash; sandboxing requires WSL2. See [advanced setup](https://code.claude.com/docs/en/setup), [CLI reference](https://code.claude.com/docs/en/cli-reference), and [settings](https://code.claude.com/docs/en/settings).                                                                                                                                                                                                                                                         |
| Hermes      | Supported | Supported | Early beta     | Supported, recommended on Windows | The official installer provisions Python and a `hermes` launcher. Native Windows uses PowerShell and `%LOCALAPPDATA%\hermes`; WSL/Linux/macOS use `~/.hermes` unless `HERMES_HOME` is set. Sessions are stored in `state.db`. Native Windows explicitly remains early beta, with WSL2 recommended for the most tested path. See [installation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/installation.md), [native Windows guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/windows-native.md), and [sessions](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md).                                                                                                                                                                                          |

Run `sidekick doctor --json` in deployment images rather than assuming an engine is usable merely because a same-named file exists on `PATH`.

Prompt transport, the measured 99,941-byte real-harness checks, session scoping, cwd sensitivity, and auth/rate caveats are recorded in [docs/harness-limits.md](docs/harness-limits.md).

### Windows process handling

Node documents that `.cmd` and `.bat` files cannot be executed directly without a command shell. Sidekick therefore resolves native executables directly and unwraps recognized npm `.cmd` shims to their JavaScript or native entry point. It rejects unrecognized batch shims; prompts are never sent through `cmd.exe`, `sh -c`, or shell-string interpolation. See the [Node child-process documentation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows).

Detached workers use `detached`, `unref`, file-backed stdio, and `windowsHide`. Force resend and `cancel` terminate the detached process group on POSIX. On Windows they invoke `taskkill.exe /PID PID /T /F` as a direct executable with an argv array, matching Microsoft’s documented [`/T` child-tree behavior](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill). Before liveness repair or termination, Sidekick checks both the PID and stored launch identity, preventing PID reuse from targeting an unrelated process. Atomic state replacement retries transient Windows sharing violations without deleting the previously committed state file.

## Environment variables

| Variable                           | Purpose                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `SIDEKICK_HOME`                    | Override the state directory.                                   |
| `SIDEKICK_ENGINE_CODEX_CMD`        | Override the Codex executable, optionally with fixed arguments. |
| `SIDEKICK_ENGINE_DEVIN_CMD`        | Override the Devin executable.                                  |
| `SIDEKICK_ENGINE_CLAUDE_CMD`       | Override the Claude executable.                                 |
| `SIDEKICK_ENGINE_HERMES_CMD`       | Override the Hermes executable.                                 |
| `SIDEKICK_ON_COMPLETE`             | Completion command, tokenized to argv and run without a shell.  |
| `SIDEKICK_MAX_LOG_MB`              | Per-log cap in MiB; defaults to `10`.                           |
| `SIDEKICK_MAX_CONCURRENT_<ENGINE>` | Maximum running turns for one engine.                           |
| `NO_COLOR`                         | Disable color. Machine-readable output never uses color.        |
| `FORCE_COLOR`                      | Force color when set to a value other than `0`.                 |
| `CI=true`                          | Disable prompts and color.                                      |

Quoted paths are supported in command overrides, including Windows paths. Overrides are tokenized into argv arrays and are never executed through a shell.

## Exit codes

| Code | Meaning                                                                                       |
| ---: | --------------------------------------------------------------------------------------------- |
|    0 | Command succeeded. An agent's own nonzero result remains available in status/result metadata. |
|    1 | Internal or operational failure (including a concurrency limit).                              |
|    2 | Invalid command, option, name, or other usage error.                                          |
|  124 | `wait` reached its timeout.                                                                   |
|  130 | Interrupted with Ctrl+C.                                                                      |

## JSON output

`status --json` emits one object with a `runs` array. `result --json` emits `{name,status,exitCode,session,output}`. `wait --json` emits one JSON object per completed run (JSON Lines when `--all` selects multiple runs). `spawn`, `send`, `adopt`, `cancel`, and `clean` also accept `--json`. JSON is written to stdout without ANSI color; diagnostics go to stderr.

## Troubleshooting

- **Executable not found:** install the engine CLI or set its `SIDEKICK_ENGINE_<NAME>_CMD` override. The run completes with exit code 127 in its metadata.
- **Unsafe `.cmd` shim:** install the engine’s current native distribution or point its command override at a native `.exe` or JavaScript entry. Sidekick intentionally refuses opaque batch wrappers because their arguments would be reparsed by `cmd.exe`.
- **Platform uncertainty:** run `sidekick doctor ENGINE --json`. Hermes on native Windows is reported as beta; genuinely unsupported platforms are reported before a run is started.
- **Run is still running:** inspect it with `tail` or `status`; use `send --force` only when replacing the active work is intentional.
- **Completion hook failed:** the run result is unchanged; inspect `run-N/hook.log`. Hooks receive `SIDEKICK_RUN_NAME`, `SIDEKICK_RUN_STATUS`, `SIDEKICK_RUN_EXIT_CODE`, and `SIDEKICK_RUN_SESSION`.
- **Hermes large prompt on native Windows:** Hermes oneshot currently accepts its prompt through argv. Keep it below 24 KiB, use WSL, or choose another engine.
- **Worker died:** `status` and `wait` repair the state to `died` with exit `-1` when the detached worker vanishes before completion.
- **No running runs:** pass explicit names to `wait`, or start a run first.
- **Stale state:** inspect the plain files under `SIDEKICK_HOME`; remove terminal runs with `clean`.

## Security

Prompts can contain sensitive information and are stored on disk. State files are created with owner-only permissions where the platform supports POSIX modes. Sidekick does not use `sh -c`, interpolate shell commands, or send prompts anywhere except the selected local engine CLI. Command overrides are trusted configuration and may execute arbitrary local programs. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Contributing

Run `npm ci`, then follow the canonical verification and portability contract in [AGENTS.md](AGENTS.md). Human review and submission steps are in [CONTRIBUTING.md](CONTRIBUTING.md). The weekly compatibility watch compares the official release sources recorded in [docs/tested-versions.json](docs/tested-versions.json) and probes every adapter-dependent flag.

## License

MIT © Hasan Can Solakoğlu. See [LICENSE](LICENSE).
