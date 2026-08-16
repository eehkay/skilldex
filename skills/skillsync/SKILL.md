---
name: skillsync
description: Talk to the SkillSync hub (Skilldex) over its HTTP API to manage agent skills across the fleet — check whether a skill is installed and where, import or upload a skill (a folder you just wrote, or a zip), distribute a library skill to machines, enable/disable/remove skills, browse skill repos, and see what each machine has. Use when the user mentions the hub, "SkillSync", "Skilldex", asks whether a skill is loaded/installed on a machine, wants to push/sync a skill to tower/dev/mini, upload a skill they made, or asks what skills a machine has. Trigger: /skillsync
---

# SkillSync hub

The hub is the desktop app's skill workspace behind plain HTTP, published on
the tailnet only (no auth — tailnet membership is the front door). Every
call is `curl` + JSON. Errors come back as `400 {"error": "message"}` —
relay the message; it is written for humans.

## Where the hub is

```bash
HUB="${SKILLSYNC_HUB:-http://skillsync.taila7ae3.ts.net:8654}"
curl -sf "$HUB/api/config" >/dev/null || echo "hub unreachable — are you on the tailnet?"
```

Set `SKILLSYNC_HUB` to point at another instance (e.g. a dev hub on
`http://arch-dev.taila7ae3.ts.net:8654`). Machines are managed by the hub over
Tailscale SSH; the hub's own library is what gets distributed.

## Vocabulary

- **Library** — the hub's global skills (`~/.claude/skills` on the hub). Only
  library skills can be distributed. Skills imported from a tracked GitHub repo
  are *repo-backed* (pinned sha; machines pull from GitHub); hand-authored or
  uploaded ones are *file-backed* (the hub pushes their files).
- **Machine** — a fleet box (`tower`, `dev`, `mini`, …) the hub reaches by SSH.
- **skillId** — a skill's canonical path on whichever host owns it. Look ids up
  by name with `GET /api/skill`; never guess them.
- **scope** — `global` (`~/.claude/skills`) or `project` (needs `projectName`).

## Common tasks

Full route list with payloads: [references/api.md](references/api.md).

**Is skill X installed, and where?**
```bash
curl -s "$HUB/api/skill?name=pdf-filler" | jq '{library: [.library[] | {id, enabled, displayPath, targets: .library.targets}], machines}'
```
`library` = hub copies (0–n); `machines[]` = `{machine, present, skill?, error?}`.
Add `&machines=0` to skip the SSH round-trips when only the library matters.

**Upload a skill I just wrote (no zip needed).**
```bash
# From a folder: send every file, paths relative to the skill root.
build_files() { (cd "$1" && find . -type f -not -path '*/.git/*' | sed 's|^\./||' | while read -r f; do jq -n --arg p "$f" --arg b "$(base64 -w0 "$f")" '{path:$p, base64:$b}'; done | jq -s .); }
curl -s -X POST "$HUB/api/import-skill-files" -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson files "$(build_files ./my-skill)" '{input:{scope:"global", files:$files}}')" | jq '{dirName, path}'
```
Add `"replace": true` inside `input` to overwrite an existing copy (refused for
symlinked skills). `"name"` overrides the folder name. Small text-only skills
can send `content` instead of `base64`.

**Import a zip.** `POST /api/import-skill-archive` with
`{input:{fileName, data:<base64 zip>, scope}}`; the folder holding `SKILL.md`
becomes the skill.

**Distribute a library skill to machines.**
```bash
curl -s -X POST "$HUB/api/distribute" -H 'Content-Type: application/json' \
  -d '{"name":"pdf-filler"}' | jq .results          # all machines
  # -d '{"name":"pdf-filler","machines":["tower","dev"]}'
  # -d '{"name":"pdf-filler","replace":true}'         # re-push an updated version
```
Per machine: `installed`, `replaced`, `present` (already there, untouched) or
`failed` + error. Global scope only.

**What does machine Y have? Is it drifted?**
```bash
curl -s "$HUB/api/machines" | jq '.[] | {machine: .machine.name, error, skills: [.snapshot.skills[]? | select(.sourceKind=="Personal") | .name]}'
curl -s "$HUB/api/machine-diff?name=tower" | jq '{onlyOnMachine: [.onlyOnMachine[].name], onlyInLibrary: [.onlyInLibrary[].name], inSync}'
```
`POST /api/converge-machine {name}` installs everything the library has that
the machine lacks; `POST /api/adopt-from-machine {name, ids:[…]}` pulls
machine-only skills into the library.

**Enable / disable / remove.** Library skill: `POST /api/set-skill-enabled
{input:{skillId, enabled, target:"local"|"everywhere"}}`; on one machine:
`POST /api/machine-skill-op {name, op:"enable"|"disable"|"remove", id}` using
the machine's own `skill.id` from the lookup.

## Rules of thumb

- Look up ids by name first; report `displayPath` and machine names back to
  the user rather than raw ids.
- Distribution and machine ops open SSH sessions — expect a few seconds per
  machine and say so if a call is slow. A machine that is asleep shows up as
  `error` in lookups; that is not a hub fault.
- `replace` (both import and distribute) deletes before writing. Confirm with
  the user before replacing something they did not just author.
- Never point this at a public URL; the hub is tailnet-only by design.
