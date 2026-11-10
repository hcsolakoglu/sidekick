# Harness interaction limits

Research and live checks were performed on 2026-07-18; the Command Code row was added on 2026-11-10 against the installed 1.88.5 CLI. Sidekick switches prompt transport only when the harness exposes a documented, non-interactive mechanism.

## Verified transport matrix

| Engine                | Sidekick transport          | 99,941-byte live test                    | Practical limit and caveats                                                                                                                                                                                                                                                              |
| --------------------- | --------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI 0.164.0     | stdin to `codex exec ... -` | Exit 0; exact sentinel returned          | Sidekick adds no transport cap. Codex explicitly reads `-` or an omitted prompt from stdin. The selected model’s context window, account authentication, and service rate limits still apply.                                                                                            |
| Devin CLI 3000.11.205 | `--prompt-file`             | Exit 0; exact sentinel returned          | Sidekick adds no transport cap. The file avoids argv ceilings. Sessions/listing are cwd-sensitive, so Sidekick always starts Devin with the recorded directory. Authentication, model context, and service limits still apply.                                                           |
| Claude Code 2.1.214   | stdin to `claude --print`   | Exit 0; exact sentinel returned          | Sidekick adds no transport cap. `--print` accepts piped text; direct resume by session ID works for print-mode sessions. Sessions remain associated with a project directory. Authentication, model context, and service limits still apply.                                             |
| Command Code 1.88.5   | `--print=<PROMPT>` argv     | Not measured                             | `-p`/`--print` takes its query as an optional argv value; Sidekick emits the single-token `--print=…` form so a prompt starting with `-` stays a prompt. OS argv limits apply: keep prompts below 24 KiB on native Windows. Model context, account limits, and the turn cap still apply. |
| Hermes 0.18.2         | `--oneshot PROMPT` argv     | Exit 0; exact sentinel returned on Linux | Upstream exposes neither stdin nor a prompt-file option for oneshot. Linux accepted the measured prompt, but OS argv limits apply. Native Windows limits a process command line to 32,767 characters, so Sidekick recommends staying below 24 KiB there or using WSL/another engine.     |

The evidence run used the same ASCII prompt for all four installed harnesses and required the exact response `SIDEKICK_LARGE_PROMPT_OK`. All four Sidekick records reached `status=done`, `exitCode=0`. This proves the tested versions and host, not every provider/model combination.

## Session and cwd behavior

- Codex resumes an explicit thread with `codex exec resume SESSION -`; Sidekick records the thread ID emitted by JSONL events and supplies the recorded cwd.
- Devin’s `list` surface and session discovery are scoped to the current directory. Sidekick uses a prompt file and the run’s exact cwd, including Windows paths.
- Claude Code stores CLI transcripts under `~/.claude/projects/` (or `CLAUDE_CONFIG_DIR`) and associates sessions with project directories. Print-mode sessions do not appear in the picker but remain resumable by ID.
- Command Code stores one transcript per session under `~/.commandcode/projects/<cwd-slug>/<session>.jsonl` and resumes with `--resume SESSION`. Sidekick validates adoption against that path and always launches from the recorded cwd.
- Hermes stores sessions under `HERMES_HOME` (normally `~/.hermes`) and `--resume` normally restores the session’s recorded cwd. Sidekick still launches it from the recorded run directory.

## Command Code headless permissions

Command Code print mode cannot show a permission prompt. Two mechanisms end or constrain a run, and both are easy to misread as success:

- Without `--yolo`, a built-in gate blocks `edit_file`, `write_file`, `shell_command`, `monitor_command`, and `kill_shell`; the model receives an error telling it to use `--yolo`.
- With `--yolo`, the user’s `ask` rules in `~/.commandcode/settings.json` still apply. A matching call is denied, the run stops with `stopReason: "permission_denied"`, and the process exits 0.

Sidekick never edits those settings. It maps `permission_denied` to run `exitCode` 126 and appends the denied tool name and its one-line shell command to the run output, so a dispatcher can tell a policy stop apart from a normal `end_turn`. A `--max-turns` cap-hit keeps the CLI’s exit code 8. Other non-`end_turn` stop reasons are recorded in the output text with the CLI’s own code.

## Sources

- [Codex CLI reference](https://developers.openai.com/codex/cli/reference) and [official Codex repository/install methods](https://github.com/openai/codex)
- [Devin CLI skills and supported locations](https://docs.devin.ai/product-guides/skills); prompt and cwd behavior were additionally verified against `devin --help`, `devin rules paths`, and `devin skills paths` from 3000.1.27 (transport re-verified on 3000.11.205 with the 99,941-byte test)
- [Claude Code setup and Windows/WSL support](https://code.claude.com/docs/en/setup), [session behavior and storage](https://code.claude.com/docs/en/sessions), and [skills locations](https://code.claude.com/docs/en/slash-commands)
- [Command Code documentation](https://commandcode.ai/docs); flags and stop reasons were additionally verified against `commandcode --help`, `commandcode --list-models`, and the installed 1.88.5 CLI bundle on 2026-11-10
- [Hermes top-level parser](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/_parser.py), [native Windows beta guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/windows-native.md), and [skills system](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [Windows `CreateProcessW` command-line limit](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
