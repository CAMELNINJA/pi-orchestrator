# Pi Orchestrator Workflow

A Pi package for an orchestrator delegation workflow with built-in researcher/implementor/design agents, user-defined custom agents, per-agent on/off with a dynamic orchestrator prompt, an editable orchestrator prompt, and live per-role team status tracking.

Published npm package: `@redentor_dev/pi-orchestrator`.

It provides:

- `delegate_researcher` for read-only codebase research and context gathering (read, grep, find and ls only; no shell).
- `delegate_implementor` for implementation and targeted validation.
- `delegate_design` for design/UI/UX review-and-fix passes after UI-affecting work.
- Custom agents: any `~/.pi/agent/agents/<name>.md` becomes a `delegate_<name>` tool; scaffold one with `/team add <name>`.
- `review_diff` for git status plus combined diff review.
- Per-agent enable/disable with a dynamic orchestrator system prompt that only describes the agents that are actually on.
- An editable orchestrator prompt (`/team prompt`) that overrides the optimized bundled default; revert anytime with `/team prompt reset`.
- `/team` for a persistent settings panel: grouped per-role enabled/provider/model/thinking/execution mode, orchestrator prompt mode, master on/off, status widget on/off, detail level, and footer mode.
- `/team show | on | off | reset | minimal | default | detailed | enable | disable | add | remove | prompt` for quick text control.

## Install

From npm:

```bash
pi install npm:@redentor_dev/pi-orchestrator
```

## Commands

- `/team` — open the team settings panel.
- `/team show` — summarize current team settings.
- `/team on` / `/team off` — enable or disable orchestration.
- `/team enable <agent>` / `/team disable <agent>` — turn a single agent on or off.
- `/team add <name>` — scaffold a custom agent at `~/.pi/agent/agents/<name>.md` and register `delegate_<name>`.
- `/team remove <name>` — remove a custom agent (the file is kept as `<name>.md.bak`; built-ins can only be disabled).
- `/team prompt` — create an editable orchestrator prompt copy at `~/.pi/agent/prompts/orchestrator.md`.
- `/team prompt reset` — revert to the bundled default prompt (your copy is kept as `orchestrator.md.bak`).
- `/team reset` — reset live status totals.
- `/team rex on` / `/team rex off` — show or hide live Rex panes for delegations.
- `/team minimal|default|detailed` — set the live status widget detail level.

Disabling with `/team off` deactivates the delegate/review tools and stops orchestrator system-prompt injection until re-enabled. The state persists as `enabled` in `~/.pi/agent/orchestrator-config.json`.

## Per-agent on/off and the dynamic prompt

Each agent has an **Enabled** toggle in the `/team` panel (persisted as `enabled: true|false` in that agent's frontmatter). Disabling an agent deactivates its `delegate_<name>` tool and rebuilds the orchestrator system prompt for the next turn: guidance blocks for that agent are stripped, and an explicit "disabled agents" note tells the orchestrator not to route work there.

The bundled prompt marks agent-specific guidance with `<!-- agent:<name> --> … <!-- /agent:<name> -->` blocks. If you customize the prompt, keep those markers to retain per-agent stripping; enabled custom agents are additionally listed in an auto-generated roster section.

## Custom agents

`/team add my-agent` scaffolds `~/.pi/agent/agents/my-agent.md` with safe read-only defaults. Edit its frontmatter (`provider`, `model`, `thinking`, `execution`, `tools`, `enabled`, `description`) and body prompt to shape the agent; the `description` is what the orchestrator sees when deciding to delegate. The agent appears in `/team` alongside the built-ins and gets its own `delegate_my-agent` tool and status-widget row.

## Orchestrator prompt customization

By default the optimized bundled prompt (`prompts/orchestrator.md` in the package) is injected. `/team prompt` (or setting **Prompt** to `custom` in the panel) copies it to `~/.pi/agent/prompts/orchestrator.md`, which then takes precedence and can be edited freely — changes apply on the next turn. `/team prompt reset` reverts to the bundled default without deleting your copy. A legacy `~/.pi/agent/APPEND_SYSTEM.md` still suppresses injection entirely.

## Status & footer

The live per-role status widget supports `minimal`, `default`, and `detailed` views. The status line shows `● team` when active and `○ team off` when disabled.

When the status widget is on, the built-in Pi footer is replaced by a directory-only line showing cwd, git branch, session name, and team indicator. This is configurable in the panel's **Footer** setting (`replaceFooter` in `~/.pi/agent/orchestrator-config.json`).

## Rex panes

When Pi runs inside a [Rex](https://www.superlogical.com/rex) terminal (`REX_SESSION` and `REX_BLOCK` are set), every delegation opens a background pane beside Pi's, labelled with the agent's name. The pane follows a readable log of the delegation: the task brief, each tool call (`→`), failed tool calls (`✗`), the agent's messages, and a final `■ done` or `■ failed` line. Focus stays on Pi.

- Panes stack in one column to the right of Pi. Parallel delegations each get their own pane.
- When an agent is delegated to again, its finished pane is replaced. Resumed sessions show their earlier history too.
- Panes close when Pi exits. `/team rex off` turns them off and closes them; the setting is `rexPanes` in `~/.pi/agent/orchestrator-config.json`.
- Logs are kept at `~/.pi/agent/subagent-sessions/rex/<session id>.log`, readable only by you.
- The `rex` command must be on `PATH`. Outside Rex, or if `rex` fails, delegations run exactly as before.

## Reliability

Delegation session resume resolves the exact subagent session file, so resuming works across different cwds. If a resume target is missing, the result is clearly flagged: `⚠ resume miss — started fresh`.

## Important migration note

If you currently run the local copy from `~/.pi/agent`, remove these before enabling this package to avoid duplicate tools and duplicate prompt injection:

- `~/.pi/agent/extensions/orchestrator-workflow.ts`
- `~/.pi/agent/APPEND_SYSTEM.md`

The package ships bundled default agents, but `/team` always writes user overrides to `~/.pi/agent/agents/`. Those user files take precedence over bundled defaults.

## Auth requirements

Configure auth for each provider used by the orchestrator or subagents. Use `/login <provider>` for OAuth-backed providers, or set the provider's required API key environment variable for API-key providers before starting Pi.

## Security and releases

Subagents run without asking for confirmation, so the extension limits what they can reach:

- **Read-only researcher.** The researcher has `read,grep,find,ls` and no `bash`; its "read-only" status no longer depends on the prompt alone. A custom agent whose frontmatter lists no `tools` also gets only these four, not every tool. Give an agent `bash` only if it needs it, and avoid pairing `bash` with work that reads untrusted content (other people's repositories, issues, web pages).
- **Filtered environment.** Subagents do not inherit variables that look like credentials (names containing `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `ACCESS_KEY`, `AUTH`, and similar), nor `SSH_AUTH_SOCK`, `KUBECONFIG`, `DOCKER_CONFIG`, `NETRC` or the `REX_*` variables. Provider keys ending in `_API_KEY` are kept. To pass another variable, for example for AWS Bedrock, list it in `subagentEnvAllow` in `~/.pi/agent/orchestrator-config.json`: `{ "subagentEnvAllow": ["AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"] }`.
- **Confined working directory.** The `cwd` of `delegate_*` and `review_diff` must resolve, after symlinks, to the project directory or a folder inside it.
- **No secrets in reviews.** `review_diff` lists untracked files such as `.env`, `*.pem`, `*.key` or `id_rsa` but does not include their contents.
- **Private transcripts.** `~/.pi/agent/subagent-sessions/` is created with mode `0700`.

These measures reduce, but do not remove, the risk of prompt injection: an agent with `bash` can still run any command as you. Run Pi in a container or a separate user account for untrusted code.

Releases:

- The package does not include local Pi state, auth files, npm tokens, or `node_modules`.
- npm publishing is configured for the public registry with public package access.
- GitHub Actions publishes `v*` tags via npm Trusted Publishing (OIDC) with provenance. Actions are pinned to commit SHAs.
- Maintainers: configure npm Trusted Publisher for GitHub Actions with repo `redentordev/pi-orchestrator`, workflow `publish.yml`, environment `npm-publish`.
