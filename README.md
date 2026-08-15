# SkillSync

Self-hosted skill library for coding agents. Import skills from GitHub repos,
curate a versioned library, and syndicate them across your machines over
Tailscale SSH — with granular per-machine install, enable, and uninstall.

Skills are the shared `SKILL.md` format read by Claude Code, OpenCode, and
Codex CLI. SkillSync keeps `.claude/skills` as the canonical copy and can
maintain symlinks for other agents' directory layouts.

## The model

**Catalog → Library → Machines.**

- **Skill repos** are import sources: point SkillSync at any GitHub repo and
  every folder containing a `SKILL.md` becomes importable. "Awesome list"
  index repos are detected and unpacked into their linked repos.
- **The Library** is your curated collection. Imports are pinned to the exact
  commit they came from and recorded in a ledger with provenance and
  syndication targets. Re-imports never overwrite your copy.
- **Machines** are sync targets reached over Tailscale SSH — no daemons, no
  keys. Each operation executes a single-file agent that the hub pushes and
  keeps current itself (content-addressed by sha256). Install to any subset
  of machines, globally or per project; disable or uninstall from one machine
  or everywhere.

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
```

## Lineage

SkillSync began as a fork of [Skilldex](https://github.com/klubinskak/skilldex)
by Klaudia Klubińska — a local-first dashboard for browsing and organizing
agent skills — and grew the repo catalog, library/syndication, hub, and fleet
layers on top of its excellent workspace foundation. The original MIT license
and copyright are preserved in [LICENSE](LICENSE).
