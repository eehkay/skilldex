# SkillSync

Self-hosted skill library for coding agents. Import skills from GitHub repos,
zips, or your own folders; curate a versioned library; and syndicate it across
your machines over Tailscale SSH — with granular per-machine install, enable,
and uninstall. Drive it from the UI, or let Claude drive it through the HTTP
API and the bundled `skillsync` skill.

Skills are the shared `SKILL.md` format read by Claude Code, OpenCode, and
Codex CLI. SkillSync keeps `.claude/skills` as the canonical copy and can
maintain symlinks for other agents' directory layouts.

## The model

**Catalog → Library → Machines.**

- **Skill repos** are import sources: point SkillSync at any GitHub repo and
  every folder containing a `SKILL.md` becomes importable. "Awesome list"
  index repos are detected and unpacked into their linked repos.
- **The Library** is your curated collection. Repo imports are pinned to the
  exact commit they came from and recorded in a ledger with provenance and
  syndication targets; re-imports never overwrite your copy. Skills can also
  arrive as a **zip**, as **loose files** over the API, or be scaffolded blank.
  Search spans every scope (disabled included), and a nine-shelf categorizer
  sorts the shelf — structurally for free, with an optional LLM pass.
- **Machines** are sync targets reached over Tailscale SSH — no daemons, no
  keys. Each operation executes a single-file agent that the hub pushes and
  keeps current itself (content-addressed by sha256). Install to any subset
  of machines, globally or per project; disable or uninstall from one machine
  or everywhere. Onboarding a machine is a two-way diff: **adopt** what it
  has that the library lacks (pinned re-import when provenance is known,
  file copy otherwise), **converge** what the library has that it lacks, or
  **start clean**. Only *enabled* plugins count as installed — the marketplace
  catalog Claude Code auto-clones is not mistaken for your setup.

## Running it

### Desktop app (Electron)

```bash
npm install
npm run dev
```

### Hub (headless, browser UI)

The same workspace behind a plain HTTP server — JSON API under `/api/*`, the
React UI served as a static SPA:

```bash
npm run build:hub
npm run serve            # http://localhost:8654, data in ~/.skilldex
```

The hub can run on a VPS (see `docs/hub.md` for the Docker Compose + Tailscale
sidecar + Coolify deployment — tailnet-only by design, no public exposure) or
on a dev machine, which can then manage itself: a machine record matching the
hub's own host runs through local bash instead of SSH.

Environment: `SKILLDEX_DATA_DIR`, `SKILLDEX_PORT` (8654), `SKILLDEX_HOST`,
`SKILLDEX_LOG` (level; the hub also keeps a Logs view), and, for the LLM
categorization layer, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` (or set the
keys in Settings).

### From Claude (or any agent)

Every operation is a JSON route under `/api/*`, and three exist specifically
for agents: `GET /api/skill?name=` (where a skill lives — library and every
machine), `POST /api/import-skill-files` (upload a skill you just wrote,
no zip), and `POST /api/distribute` (push a library skill to some or all
machines). `skills/skillsync/` is a Claude Code skill that wraps them —
symlink or copy it into `~/.claude/skills` and ask things like *"is
pdf-filler on tower?"* or *"push this skill to every machine"*. Full route
table in `skills/skillsync/references/api.md`.

## Requirements for managed machines

- Reachable over [Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh)
  with an `accept` (not `check`) ACL rule, so unattended operations never
  block on a browser prompt
- Node.js ≥ 22 on the machine (the agent is a single self-contained JS file)

## Development

```bash
npm run typecheck   # tsc -b, both TS projects
npm test            # vitest — the network and SSH layers are injected, so
                    # the whole feature set tests against fakes
npm run lint        # oxlint
npm run build:hub   # renderer + hub server + agent bundle (out/)
```

Layout: `electron/main/workspace/` is the domain (scanning, library ledger,
repo catalogs, machines/agent transport, archive import, categorizer) shared
by the desktop app (`electron/`), the hub (`server/`), and the on-machine
agent (`agent/`); `src/` is the React UI; `skills/` holds skills the repo
ships. The hub and agent lean on Node built-ins by design — the HTTP server,
zip reader, and frontmatter parser are hand-rolled — so the agent stays a
single dependency-free file and the hub image stays small.

## Lineage

SkillSync began as a fork of [Skilldex](https://github.com/klubinskak/skilldex)
by Klaudia Klubińska — a local-first dashboard for browsing and organizing
agent skills — and grew the repo catalog, library/syndication, hub, and fleet
layers on top of its excellent workspace foundation. The original MIT license
and copyright are preserved in [LICENSE](LICENSE).
