# SkillSync hub API reference

Base: `$SKILLSYNC_HUB` (default `http://skillsync.taila7ae3.ts.net:8654`).
JSON in, JSON out. Reads are `GET` with query params; mutations are `POST`
with a JSON body. Errors: `400 {"error": "..."}`. Bodies up to 48 MB.

Most mutations return the fresh workspace snapshot (`{skills, projects,
sources, errors, scannedAt, homeDir}`); machine ops return that machine's
`{machine, snapshot, error?}`.

## Skill record (what `skills[]` entries look like)

| field | meaning |
|---|---|
| `id` | canonical path — use as `skillId` / `id` in calls |
| `name`, `description` | from SKILL.md frontmatter |
| `sourceKind` | `Personal` (library/global), `Plugin`, `Project` |
| `enabled` | disabled skills live under `.disabled/` |
| `displayPath` | e.g. `~/.claude/skills/tdd` |
| `projects[]` | project names referencing it (Project skills) |
| `origin` | upstream provenance if the manifest records it |
| `library` | `{repo, path, ref, targets:[{machine, scope, projectName?}], adoptedFrom?}` for library-managed skills |

## Agent-facing routes (start here)

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/skill?name=<name>[&machines=0]` | name, folder, or id | `{name, library:[SkillRecord], machines:[{machine, present, skill?, error?}]}` |
| `POST /api/import-skill-files` | `{input:{files:[{path, content?, base64?}], scope, projectName?, name?, replace?}}` | `{dirName, path, workspace}` |
| `POST /api/import-skill-archive` | `{input:{fileName, data:<base64 zip>, scope, projectName?}}` | workspace |
| `POST /api/distribute` | `{name?|skillId?, machines?:[…], replace?}` | `{dirName, results:{<machine>:{status, error?}}, workspace}` — status ∈ installed/replaced/present/failed |

`import-skill-files` accepts either flat paths (`SKILL.md`, `scripts/x.py`) or
one wrapping folder (`my-skill/SKILL.md`). Exactly one `SKILL.md` at the
shallowest depth. Junk (`__MACOSX`, `.DS_Store`) is dropped; `..` paths are
refused. Folder name = `name` → SKILL.md frontmatter `name` → wrapping folder.

## Library

| Route | Body / query | Notes |
|---|---|---|
| `GET /api/snapshot` | — | whole hub library |
| `GET /api/config` | — | `{includePersonal, includePlugins, projectRoots, favourites, skillRepos, machines, agents}` |
| `POST /api/configure-sources` | `{config}` | full config replace |
| `GET /api/skill-readme?id=` | | rendered SKILL.md text |
| `GET /api/skill-files?id=` | | `[{relativePath, sizeBytes}]` |
| `POST /api/enable-skill` / `disable-skill` / `remove-skill` | `{id}` | local copy only; plugin skills refused |
| `POST /api/set-skill-enabled` | `{input:{skillId, enabled, target:"local"\|"everywhere"\|{machine, scope, projectName?}}}` | syndicated skills toggle everywhere |
| `POST /api/toggle-favourite` | `{id}` | |
| `POST /api/create-skill` | `{input:{name, description, scope, projectName?}}` | scaffold blank SKILL.md |
| `POST /api/set-skill-category` | `{id, category\|null}` | |
| `POST /api/categorize-library` | `{}` | LLM categorisation run (needs provider key on hub) |

## Skill repos (GitHub catalogs)

| Route | Body | Notes |
|---|---|---|
| `GET /api/repos` | — | `[{slug, url, ref, skills:[{id, name, description, path, fileCount, webUrl}], linkedRepos, truncated, error?}]` |
| `POST /api/add-repo` | `{input:"owner/repo"}` | also accepts URLs |
| `POST /api/remove-repo` / `refresh-repo` | `{slug}` | |
| `POST /api/install-repo-skill` | `{input:{repo, skillId, scope, projectName?}}` | into hub library (pinned sha) |

## Machines

| Route | Body / query | Notes |
|---|---|---|
| `GET /api/machines` | — | every machine's `{machine:{name,host,user}, snapshot, error?}` (live SSH scan) |
| `POST /api/add-machine` | `{machine:{name, host, user}}` | pings before saving |
| `POST /api/update-machine` | `{name, machine:{name, host, user}}` | rename keeps syndication targets |
| `POST /api/remove-machine` | `{name}` | forget only; skills untouched |
| `POST /api/refresh-machine` | `{name}` | one machine's snapshot |
| `GET /api/machine-diff?name=` | | `{onlyOnMachine, onlyInLibrary, inSync, error?}` |
| `POST /api/converge-machine` | `{name, dirNames?}` | install library-only skills onto the machine → `{installed, failed, machine, workspace}` |
| `POST /api/clear-machine` | `{name, dirNames?}` | remove machine-only skills |
| `POST /api/adopt-from-machine` | `{name, ids:[machine skill ids]}` | pull into library → `{adopted, failed, workspace}` |
| `POST /api/machine-install` | `{name, input:{repo, skillId, scope, projectName?}}` | catalog skill → machine (via library) |
| `POST /api/set-syndication` | `{input:{skillId, machine, enabled, scope, projectName?}}` | repo-backed library skills only; prefer `/api/distribute` |
| `POST /api/machine-skill-op` | `{name, op:"enable"\|"disable"\|"remove", id}` | `id` = machine-side skill id |

## Misc

| Route | Notes |
|---|---|
| `GET /api/logs?limit=200` | recent structured hub log lines |
| `POST /api/validate-directory` `{path}` | does this absolute path exist on the hub |
