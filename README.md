# sidekick

`sidekick` is a dependency-free Node.js CLI for running persistent local agent sessions in the background. It supports Codex, Devin, Claude, Hermes, and a deterministic mock engine for testing. Runs survive the terminal that launched them and keep an inspectable, file-based history.

## Install

Node.js 20 or newer is required; Node.js 22 is recommended.

```sh
npm install --global @hcsolakoglu/sidekick
sidekick --version
```

For development, clone the repository and run `npm ci && npm run build && npm link`.

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
sidekick spawn ENGINE NAME [--dir PATH] [--model MODEL] [--mode MODE] -- PROMPT
sidekick send NAME [--force] -- PROMPT
sidekick wait [NAME ...] [--all] [--timeout SECONDS] [--quiet] [--json]
sidekick adopt ENGINE NAME --session ID [--dir PATH] [--model MODEL] [--mode MODE]
sidekick tail NAME [-n LINES]
sidekick status [--json]
sidekick result NAME [--json]
sidekick clean [NAME ...]
```

- `spawn` creates a named run and starts a detached worker. Names match `[A-Za-z0-9][A-Za-z0-9._-]{0,79}`.
- `send` resumes the recorded session. If an engine exposed no session ID, it sends a transcript fallback. Active runs reject follow-ups unless `--force` stops the current worker first.
- `wait` uses filesystem events with periodic liveness checks. It returns after the first selected run unless `--all` is supplied. With no names, it selects all currently running runs.
- `adopt` records an existing engine session without starting it.
- `tail` follows the current output using Node filesystem APIs on every supported OS.
- `status` lists all runs; `result` prints one run's current output.
- `clean` deletes terminal runs and skips running ones. With no names, it considers every run.

Run `sidekick --help` for the compact command reference.

## Examples

Prompts are argv values, never shell-interpolated by sidekick. `--` makes a prompt beginning with a dash unambiguous:

```sh
sidekick spawn claude migration --model sonnet --mode accept-edits -- "Inspect only; do not edit"
sidekick spawn devin frontend --dir "C:\Work Files\app" -- "Run the UI tests"
sidekick wait migration frontend --all --timeout 900 --quiet
sidekick status --json
sidekick clean migration frontend
```

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

Writes that define state are atomic. Run mutations use portable lock directories and stale-lock recovery.

## Environment variables

| Variable                     | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `SIDEKICK_HOME`              | Override the state directory.                                   |
| `SIDEKICK_ENGINE_CODEX_CMD`  | Override the Codex executable, optionally with fixed arguments. |
| `SIDEKICK_ENGINE_DEVIN_CMD`  | Override the Devin executable.                                  |
| `SIDEKICK_ENGINE_CLAUDE_CMD` | Override the Claude executable.                                 |
| `SIDEKICK_ENGINE_HERMES_CMD` | Override the Hermes executable.                                 |
| `NO_COLOR`                   | Disable color. Machine-readable output never uses color.        |
| `FORCE_COLOR`                | Force color when set to a value other than `0`.                 |
| `CI=true`                    | Disable prompts and color.                                      |

Quoted paths are supported in command overrides, including Windows paths. Overrides are tokenized into argv arrays and are never executed through a shell.

## Exit codes

| Code | Meaning                                                                                       |
| ---: | --------------------------------------------------------------------------------------------- |
|    0 | Command succeeded. An agent's own nonzero result remains available in status/result metadata. |
|    1 | Unexpected internal CLI error.                                                                |
|    2 | Invalid command, option, name, or other usage error.                                          |
|  124 | `wait` reached its timeout.                                                                   |
|  130 | Interrupted with Ctrl+C.                                                                      |

## JSON output

`status --json` emits one object with a `runs` array. `result --json` emits `{name,status,exitCode,session,output}`. `wait --json` emits one JSON object per completed run (JSON Lines when `--all` selects multiple runs). JSON is written to stdout without ANSI color; diagnostics go to stderr.

## Troubleshooting

- **Executable not found:** install the engine CLI or set its `SIDEKICK_ENGINE_<NAME>_CMD` override. The run completes with exit code 127 in its metadata.
- **Run is still running:** inspect it with `tail` or `status`; use `send --force` only when replacing the active work is intentional.
- **Worker died:** `status` and `wait` repair the state to `died` with exit `-1` when the detached worker vanishes before completion.
- **No running runs:** pass explicit names to `wait`, or start a run first.
- **Stale state:** inspect the plain files under `SIDEKICK_HOME`; remove terminal runs with `clean`.

## Security

Prompts can contain sensitive information and are stored on disk. State files are created with owner-only permissions where the platform supports POSIX modes. Sidekick does not use `sh -c`, interpolate shell commands, or send prompts anywhere except the selected local engine CLI. Command overrides are trusted configuration and may execute arbitrary local programs. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Contributing

Run `npm ci`, `npm run build`, and `npm test` before submitting changes. The full required check is `npm run prepack`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Hasan Can Solakoğlu. See [LICENSE](LICENSE).
