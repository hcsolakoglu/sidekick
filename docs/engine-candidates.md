# Engine Candidates for `sidekick`

Research date: 2026-07-18. All flag/star/contributor/commit claims are verified
against primary sources (official repo README, in-repo CLI argument-parser
source, or official docs pages) fetched on the research date. URLs are cited per
candidate. No blog-hype sources were used.

## What an engine must provide (recap of the sidekick contract)

From `src/core/engines/types.ts` and the existing adapters (`codex.ts`,
`devin.ts`, `claude.ts`, `hermes.ts`), a candidate engine must support:

1. **Headless one-shot invocation** — a non-interactive CLI mode that accepts a
   prompt (argv or stdin) and exits when the turn completes.
2. **Programmatic session RESUME with context** *(hard requirement)* — a CLI
   flag that takes a session/thread ID and continues that exact conversation
   non-interactively. The adapter round-trips the ID through
   `EngineContext.session` → `EngineResult.session`. **If a candidate has no
   ID-accepting resume flag, it is disqualified regardless of popularity.**
3. **Observable completion** — exit code, an output file (`-o file`), and/or a
   JSON/JSONL event stream on stdout that the `parse()` step can scan for the
   session ID and final message.
4. **Cross-OS** — Linux, macOS, and native Windows (PowerShell), matching the
   existing engine matrix in `README.md`.

## Rubric

Each criterion scored 0–5. Weighted total out of **60**.

| Criterion | Weight | Notes |
| --- | --- | --- |
| Resume capability | ×3 | 0 → disqualified. 5 = documented `--resume <id>` (or equivalent) verified in arg-parser/docs. |
| Headless quality | ×2 | Structured JSON/stream output + documented exit codes score 5. |
| Cross-OS | ×2 | Native Windows (not WSL-only) + macOS + Linux scores 5. |
| Health/maintenance | ×2 | Backing org, commits in last 90 days, release cadence, open-issue ratio. |
| Popularity | ×1 | GitHub stars (organic shape, contributor count). |
| Auth flexibility | ×1 | Subscription/OAuth free tier + API key scores 5; API-key-only (per-token cost) scores 2–3. |
| Integration effort | ×1 | 5 = near-identical to an existing adapter (Codex/Claude pattern); 1 = bespoke. |

## Ranked table

| Rank | Candidate | Weighted /60 | Resume×3 | Headless×2 | Cross-OS×2 | Health×2 | Pop×1 | Auth×1 | Integ×1 | Verdict |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | **Gemini CLI** | **60** | 15 | 10 | 10 | 10 | 5 | 5 | 5 | Add now |
| 2 | **Qwen Code** | **59** | 15 | 10 | 10 | 10 | 4 | 4 | 5 | Add now |
| 3 | **Goose** | **58** | 15 | 10 | 10 | 10 | 5 | 4 | 4 | Add now |
| 3 | **Cline CLI** | **58** | 15 | 10 | 10 | 10 | 5 | 4 | 4 | Add now |
| 3 | **Copilot CLI** | **58** | 15 | 10 | 10 | 10 | 4 | 5 | 4 | Add now |
| 6 | **Crush** | **56** | 15 | 10 | 10 | 10 | 4 | 3 | 4 | Add now |
| 7 | **OpenCode** | **55** | 15 | 10 | 8 | 10 | 5 | 3 | 4 | Add now |
| 7 | **Pi** | **55** | 15 | 10 | 8 | 10 | 5 | 3 | 4 | Add now |
| 9 | Aider | 41 | 6 | 8 | 10 | 8 | 5 | 2 | 2 | Watch |
| 10 | Continue CLI | 35 | 6 | 8 | 8 | 4 | 4 | 3 | 2 | Disqualified |
| 11 | Plandex | 33 | 9 | 6 | 8 | 2 | 4 | 2 | 2 | Watch |
| 12 | OpenHands | 29 | 0 | 4 | 6 | 10 | 5 | 3 | 1 | Disqualified |
| 13 | Cursor CLI | 23 | 0 | 2 | 6 | 6 | 4 | 4 | 1 | Disqualified |
| — | Amp (Sourcegraph) | — | — | — | — | — | — | — | — | Disqualified (unverifiable) |

> Contributor counts via the GitHub contributors API are capped at the first
> 100-item page; entries shown as "≥100" are at least that large. "Commits/90d"
> is capped at 600 (6 pages) where the value reads "600+".

## Recommended to add now (high-confidence fits)

All eight below have a **verified `--resume <id>` (or `--session <id>` /
`--session-id <id>` / `--id <id>`) flag**, a **headless mode with structured
output**, and **native cross-OS distribution**. They map directly onto the
existing `Engine` adapter pattern.

**Top tier (closest to the Codex/Claude adapter shape + subscription/auth
flexibility):**

1. **Gemini CLI** — `gemini -p "..." --output-format stream-json`, resume via
   `--resume <id>` / `-r "latest"` / `-r 5`. Stream-JSON emits an `init` event
   with the session ID; exit codes 0/1/42/53. Apache-2.0, Google-backed, 106k
   stars, weekly stable+preview releases. Auth: Google OAuth free tier
   (60 req/min, 1000/day) **or** Gemini API key **or** Vertex AI.
2. **Qwen Code** — `qwen -p "..." --output-format stream-json`, resume via
   `--resume <id>` and `--continue`. Fork of Gemini CLI → near-clone adapter.
   Apache-2.0, Alibaba/QwenLM-backed, 26k stars. Auth: DashScope/Qwen API key
   + OAuth; free tier.
3. **Goose** — `goose run --resume --session-id <id> --output-format stream-json
   "..."` (or `--resume --name <name>`). Apache-2.0, Block-backed, 51k stars,
   native Windows PowerShell install. Auth: Tetrate free tier + API keys.
4. **Cline CLI** — `cline --id <session-id> --json "..."` (explicit
   "Resume an existing session by ID"); `--yolo`/`--zen` headless, NDJSON
   stream. Apache-2.0, Cline Inc, 64.7k stars, native macOS/Linux/Windows
   arm64+x64 binaries. Auth: OAuth providers (`cline`, `openai-codex`, `oca`) +
   API keys.
5. **Copilot CLI** — `copilot -p "..." --resume --session-id <id> --stream`
   (also `--name`, `--continue`, `--autopilot`). GitHub-backed, 11k stars (the
   repo ships only the installer/README/changelog; the binary is closed-source
   and updated on its own cadence — see changelog). Auth: Copilot Free/Pro
   subscription **or** bring-your-own-key.

**Second tier (clean fit; API-key-only auth or slightly more adapter work):**

6. **Crush** — `crush run --session <id> "..."` / `crush run --continue "..."`,
   non-interactive, streams to stdout. Go + goreleaser → native Windows/macOS/
   Linux binaries. Charm-backed, 26.6k stars. License NOASSERTION (see
   `LICENSE.md`). Auth: API keys, multi-provider (per-token).
7. **OpenCode** — `opencode run --session <id> "..."` / `--continue` / `--fork`,
   `--format`/`--file`, non-interactive default, streams events. MIT, SST-backed,
   187k stars (highest star count of any candidate). Auth: API keys only
   (per-token). Cross-OS via npm/Bun; Windows works but TUI/Bun-on-Windows is
   the rougher path (cross-OS scored 4).
8. **Pi** — `pi --print --resume --session-id <id> --mode json "..."` (also
   `--session`, `--fork`, `--continue`/`-c`). MIT, earendil-works, **72k stars
   in ~11 months** (created 2025-08) — extraordinary growth, 600+ commits/90d.
   Auth: API keys only (per-token). Cross-OS via npm/Bun (scored 4). Younger
   project than the others; verify release stability before relying on it.

## Watch later

- **Aider** (47.5k stars, Apache-2.0, Aider-AI) — Has headless (`--message` /
  `--message-file`, `--yes-always`, `--stream`) and a *partial* resume via
  `--restore-chat-history`, but that flag is a **boolean that restores only the
  last conversation in the current cwd** — it takes **no session ID**, so
  sidekick cannot round-trip an arbitrary session through `EngineContext.session`.
  Only 17 commits on the default branch in the last 90 days (lower velocity than
  peers). **Does not meet the hard requirement as written.** Re-evaluate if Aider
  adds ID-based resume.
- **Plandex** (15.5k stars, MIT, plandex-ai) — Resume-by-plan-name is possible
  (`plandex cd <name>` then `plandex tell -f prompt.txt` / `plandex continue`),
  but it is a **two-step flow** (no single `--resume <id>` flag), **requires a
  local Plandex server**, and the project is **stale**: 0 commits in the last 90
  days, last push 2025-10-03, last CLI release `cli/v2.2.1` on 2025-07-16. Watch
  only if maintenance resumes and a single-flag resume is added.

## Disqualified (no resume / no headless / unverifiable)

| Candidate | Reason |
| --- | --- |
| **Continue CLI** | `cn -p "..." --format json` headless exists, and `cn --resume` resumes the last session **for this terminal**, but `--resume` **takes no session ID** — only "resume last". `cn ls --json` lists sessions but there is no documented `--resume <id>` flag. Fails the hard requirement. Additionally the `continuedev/continue` repo is marked **read-only / no longer actively maintained** ("final 2.0.0 release"); only 21 commits in 90d. |
| **OpenHands** | Server + web-UI first (docker-compose, `openhands-ui`, `app_server`). No terminal-CLI headless mode with session-resume-by-ID; a code search for `headless resume` in the repo returned nothing. Architecture does not match the sidekick engine model (detached local CLI worker). |
| **Cursor CLI** | `getcursor/cursor` is the **editor application** (33k stars, `language: null`, 31 contributors, last push 2025-05-12). No public headless `cursor-agent` CLI with session resume exists in the repo. The cloud "cursor-agent" is not a locally-resumable CLI harness. |
| **Amp (Sourcegraph)** | `sourcegraph/amp` and `sourcegraph/cody` both return HTTP 404 on the GitHub API. Amp is distributed as a **closed-source signed binary** from sourcegraph.com with no public repo or CLI reference. The hard requirement (resume-by-ID) **cannot be verified from primary sources**, so it is disqualified under this rubric's no-hype rule. Re-evaluate if Sourcegraph publishes a public CLI reference documenting `--resume <id>`. |

## Per-candidate evidence

### Gemini CLI — `google-gemini/gemini-cli`
- Stars 106,057 · forks 14,277 · contributors ≥100 · license Apache-2.0 ·
  426 commits in last 90d · pushed 2026-07-18.
- Headless: `-p`/`--prompt` forces non-interactive (also auto-triggered in
  non-TTY). `--output-format text|json|stream-json`. Exit codes 0/1/42/53.
  Source: `docs/cli/headless.md`, `docs/cli/cli-reference.md`.
- Resume: `--resume`/`-r "<session-id>"`, `-r "latest"`, `-r 5` (index).
  Source: `docs/cli/cli-reference.md` lines 15–17, 65.
- Checkpointing (`/restore`) is a separate file-state rewind feature, not the
  resume surface — do not confuse the two.
- Cross-OS: npm, Homebrew, MacPorts, Anaconda. Windows via npm.
- Auth: Google OAuth (free tier 60 req/min, 1000/day), Gemini API key, Vertex AI.
- Evidence: https://github.com/google-gemini/gemini-cli ,
  https://www.geminicli.com/docs/cli/cli-reference ,
  https://www.geminicli.com/docs/cli/headless ,
  https://www.geminicli.com/docs/cli/checkpointing

### Qwen Code — `QwenLM/qwen-code`
- Stars 26,093 · forks 2,666 · contributors ≥100 · license Apache-2.0 ·
  600+ commits in last 90d · pushed 2026-07-18.
- Fork of Gemini CLI; inherits `-p`, `--output-format json|stream-json`,
  `--resume <id>`, `--continue`. Stream events carry `session_id`.
  Source: `docs/users/features/headless.md` (lines 44–59, 122–182).
- Sessions are project-scoped JSONL under `~/.qwen/projects/<sanitized-cwd>/chats`.
- Auth: Qwen/DashScope API key + OAuth; free tier available.
- Evidence: https://github.com/QwenLM/qwen-code ,
  https://qwenlm.github.io/qwen-code-docs/en/users/features/headless

### Goose — `block/goose`
- Stars 51,260 · forks 5,614 · contributors ≥100 · license Apache-2.0 ·
  600+ commits in last 90d · pushed 2026-07-18.
- Headless: `goose run` (non-interactive), `--output-format text|json|stream-json`,
  `--quiet` (response-only). Source: `crates/goose-cli/src/cli.rs`
  (`OutputOptions`, `--output-format` with `PossibleValuesParser`).
- Resume: `--resume` + `--session-id <id>` (e.g. `20250921_143022`), or
  `--resume --name <name>`. Source: `crates/goose-cli/src/cli.rs` lines 80–103
  (`--session-id`: "Specify a session ID to resume. Requires --resume.").
- Cross-OS: Rust; native Windows PowerShell install, macOS, Linux
  (`documentation/docs/quickstart.md`).
- Auth: Tetrate browser auth (free tier) + API keys. Backed by Block.
- Evidence: https://github.com/block/goose ,
  https://github.com/block/goose/blob/main/crates/goose-cli/src/cli.rs

### Cline CLI — `cline/cline` (`apps/cli`)
- Stars 64,767 · forks 6,928 · contributors ≥100 · license Apache-2.0 ·
  600+ commits in last 90d · pushed 2026-07-18.
- Headless: one-shot `cline "prompt"`, `--json` NDJSON stream, `--yolo`
  (no approval prompts), `--zen` (background hub session, CLI exits).
  Source: `apps/cli/README.md` ("Headless mode for CI/CD").
- Resume: `--id <session-id>` — "Resume an existing session by ID".
  Source: `apps/cli/src/commands/program.ts` line 43.
- Cross-OS: platform binaries for macOS/Linux/Windows on arm64 + x64
  (`apps/cli/README.md`).
- Auth: OAuth providers (`cline`, `openai-codex`, `oca`) + API keys
  (`-k/--key`). OAuth providers fail fast in non-interactive mode if no saved
  credentials (no hidden browser flow) — good for sidekick.
- Evidence: https://github.com/cline/cline ,
  https://github.com/cline/cline/tree/main/apps/cli ,
  https://github.com/cline/cline/blob/main/apps/cli/src/commands/program.ts

### Copilot CLI — `github/copilot-cli`
- Stars 10,978 · forks 1,791 · contributors 21 · license NOASSERTION (see
  `LICENSE.md`) · 37 commits in last 90d on the *installer repo* · pushed
  2026-07-17. (The binary itself is closed-source and shipped on its own
  cadence; the repo's `changelog.md` shows frequent product updates.)
- Headless: `-p`/`--prompt` for programmatic use; `--stream` on/off; `--autopilot`
  for autonomous completion; approval flags (`--allow-all`/`--yolo`-style) enable
  headless operation. Source: official docs "About Copilot CLI" + `changelog.md`.
- Resume: `--resume`, `--session-id <id>`, `--name <name>`, `--continue`
  (mutually exclusive: changelog "Reject --continue when used with --resume",
  "Show an error when --name is used with --session-id for an existing session",
  "Resume synced sessions by name").
- Cross-OS: GitHub-backed installer; native macOS/Linux/Windows.
- Auth: Copilot Free/Pro subscription **or** bring-your-own-key.
- Evidence: https://github.com/github/copilot-cli ,
  https://github.com/github/copilot-cli/blob/main/changelog.md ,
  https://docs.github.com/copilot/concepts/agents/copilot-cli/about-copilot-cli

### Crush — `charmbracelet/crush`
- Stars 26,621 · forks 2,027 · contributors ≥100 · license NOASSERTION (see
  `LICENSE.md`) · 600+ commits in last 90d · pushed 2026-07-18.
- Headless: `crush run [prompt...]` — "Run a single non-interactive prompt"
  (stdin accepted); streams to stdout; `-q`/`--quiet`, `-v`/`--verbose`.
  Source: `internal/cmd/run.go` lines 35–62.
- Resume: `--session <id>`/`-s` ("Continue a previous session by ID") and
  `--continue`/`-C` ("Continue the most recent session"), mutually exclusive.
  Source: `internal/cmd/run.go` lines 58–62, 159–161.
- Cross-OS: Go + goreleaser; `internal/cmd/root_windows.go`,
  `server_windows.go` confirm native Windows builds.
- Auth: API keys, multi-provider (per-token). Backed by Charm.
- Evidence: https://github.com/charmbracelet/crush ,
  https://github.com/charmbracelet/crush/blob/main/internal/cmd/run.go

### OpenCode — `sst/opencode`
- Stars 187,189 · forks 23,502 · contributors ≥100 · license MIT ·
  600+ commits in last 90d · pushed 2026-07-18. (Highest star count of any
  candidate.)
- Headless: `opencode run` is non-interactive by default — "sends a single
  prompt, streams events to stdout, and exits when the session goes idle";
  `--format`, `--file`. Source: `packages/opencode/src/cli/cmd/run.ts`
  lines 6–16, 174–180.
- Resume: `--continue` (last session), `--session <id>` ("session id to
  continue"), `--fork`. Source: `packages/opencode/src/cli/cmd/run.ts`
  lines 147–160.
- Cross-OS: npm (`opencode-ai`) / Bun. Windows works via npm but the TUI +
  Bun-on-Windows path is the rougher surface (cross-OS scored 4).
- Auth: API keys only (bring your own; per-token cost). Backed by SST.
- Evidence: https://github.com/sst/opencode ,
  https://github.com/sst/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts

### Pi — `earendil-works/pi`
- Stars 72,372 · forks 8,936 · contributors ≥100 · license MIT ·
  600+ commits in last 90d · pushed 2026-07-17 · created 2025-08-09
  (~72k stars in ~11 months — verify organic shape before relying on it).
- Headless: `--print`, `--mode text|json|rpc`, `--export`.
  Source: `packages/coding-agent/src/cli/args.ts` (Args type + parseArgs).
- Resume: `--resume`/`-r`, `--continue`/`-c`, `--session <name>`,
  `--session-id <id>`, `--fork <id>`, `--name`.
  Source: `packages/coding-agent/src/cli/args.ts` lines 19–28, 83–86.
- Cross-OS: npm/Bun (scored 4 — Bun-on-Windows maturity).
- Auth: API keys only (per-token). Backed by earendil-works (indie).
- Evidence: https://github.com/earendil-works/pi ,
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts

### Aider — `Aider-AI/aider` (Watch)
- Stars 47,492 · forks 4,742 · contributors ≥100 · license Apache-2.0 ·
  17 commits in last 90d on default branch · pushed 2026-05-22.
- Headless: `--message`/`--message-file`, `--yes-always`, `--stream`.
  Source: `aider/args.py` lines 290, 639, 648, 760; `aider/main.py` lines
  1126–1142.
- Resume: `--restore-chat-history` is a **boolean** ("Restore the previous chat
  history messages") — restores the **last** conversation in the current cwd
  from `.aider.chat.history.md`. **No session-ID flag exists.** Fails the hard
  requirement (no ID to round-trip through `EngineContext.session`).
- Auth: API keys only (per-token).
- Evidence: https://github.com/Aider-AI/aider ,
  https://github.com/Aider-AI/aider/blob/main/aider/args.py ,
  https://aider.chat/docs/usage/headless.html

### Continue CLI — `continuedev/continue` (`extensions/cli`) (Disqualified)
- Stars 34,959 · forks 5,072 · contributors ≥100 · license Apache-2.0 ·
  21 commits in last 90d · last commit 2026-06-19.
- Headless: `cn -p "..." --format json`; `FORCE_NO_TTY` for automation.
  Source: `extensions/cli/README.md`.
- Resume: `cn --resume` **takes no argument** — "Resume the last session for
  this terminal". `cn ls --json` lists sessions but there is **no
  `--resume <id>` flag**. Fails the hard requirement.
- The repo README states it is **"no longer actively maintained and is
  read-only for all users"** with a "final 2.0.0 release".
- Evidence: https://github.com/continuedev/continue ,
  https://github.com/continuedev/continue/blob/main/extensions/cli/README.md

### Plandex — `plandex-ai/plandex` (Watch)
- Stars 15,535 · forks 1,164 · contributors 22 · license MIT ·
  **0 commits in last 90d** · last push 2025-10-03 · last release
  `cli/v2.2.1` 2025-07-16.
- Headless: `plandex tell -f prompt.txt` / `plandex tell "..."` (with `--stop`
  for single response); `plandex continue`. Source: `docs/docs/cli-reference.md`
  lines 295–345.
- Resume: plan-name-based via `plandex cd <name>` (sets current plan) then
  `tell`/`continue` — **two-step, no single `--resume <id>` flag**. Requires a
  local Plandex **server**. Stale project.
- Evidence: https://github.com/plandex-ai/plandex ,
  https://github.com/plandex-ai/plandex/blob/main/docs/docs/cli-reference.md

### OpenHands — `All-Hands-AI/OpenHands` (Disqualified)
- Stars 81,203 · forks 10,379 · contributors ≥100 · license NOASSERTION ·
  600+ commits in last 90d · pushed 2026-07-18. (Very healthy project, but
  wrong shape for sidekick.)
- Architecture is server + web UI first (`docker-compose.yml`, `openhands-ui`,
  `openhands/app_server`). No terminal-CLI headless mode with
  session-resume-by-ID; repo code search for `headless resume` returned no
  matches. Does not match the detached-local-CLI-worker engine model.
- Evidence: https://github.com/All-Hands-AI/OpenHands

### Cursor CLI — `getcursor/cursor` (Disqualified)
- Stars 33,049 · forks 2,269 · contributors 31 · last push 2025-05-12.
- The repo is the **Cursor editor application** (`language: null`, no CLI
  harness source). No public headless `cursor-agent` CLI with session resume.
- Evidence: https://github.com/getcursor/cursor

### Amp (Sourcegraph) (Disqualified — unverifiable)
- `sourcegraph/amp` and `sourcegraph/cody` both return HTTP 404 on the GitHub
  API (no public repo). Amp is a closed-source signed binary distributed from
  sourcegraph.com. The resume-by-ID hard requirement **cannot be verified from
  primary sources**, so it is disqualified under this rubric's no-hype rule.
- Re-evaluate if Sourcegraph publishes a public CLI reference documenting
  `--resume <id>`.

## Discovery sweep

A GitHub repo search (`gh search repos "coding agent cli" --sort stars` and
`"agent cli terminal"`) on 2026-07-18 surfaced one genuinely high-traction
candidate not in the original list:

- **Pi (`earendil-works/pi`)** — 72,372 stars, MIT, verified fit (see above).
  Added to the ranked table.

All other search results were either low-traction (<1.5k stars: `cc-safety-net`,
`pi_agent_rust`, `OpenContext`, `mini-kode`, `clawcode`, `sekrun`, `KimiX`,
`tallow`, etc.), or were tooling/wrappers around existing agents
(`harness`, `crewplane`, `agentic-code-reviewer`, `ai-agents-notifier`) rather
than primary engine harnesses. None met the bar to add beyond Pi.

## Suggested implementation order

1. **Gemini CLI** and **Qwen Code** first — Qwen Code is a fork of Gemini CLI,
   so a single adapter shape covers both; both emit stream-JSON with the session
   ID in an `init`/`session_start` event, mirroring the Codex adapter almost
   exactly.
2. **Goose** — `--resume --session-id` + `--output-format stream-json` maps
   cleanly onto the existing pattern; native Windows is already documented.
3. **Cline CLI** — `--id <session-id>` + `--json` NDJSON; native binaries
   already exist for all three OSes.
4. **Copilot CLI** — `-p --resume --session-id --stream`; subscription auth is
   a differentiator. Note the binary is closed-source, so `doctor` checks must
   rely on `--help`/exit-code probing rather than repo inspection.
5. **Crush**, **OpenCode**, **Pi** — same adapter shape; API-key-only auth is
   the main user-facing caveat to document.

Each new engine requires extending the `EngineName` union in
`src/core/engines/types.ts`, registering it in `src/core/engines/index.ts`,
adding a `SIDEKICK_ENGINE_<NAME>_CMD` override env var, and a one-file adapter
under `src/core/engines/` — matching the existing `codex.ts`/`devin.ts` pattern.
