# Skilldex Hub (`skilldex serve`)

The hub is the desktop app's `SkillWorkspace` behind a plain HTTP server:
JSON API under `/api/*`, the same React UI served as a static SPA. One
codebase, second entrypoint — not a separate product.

There is deliberately **no auth layer**: the compose file publishes the hub
only onto the tailnet through a tailscale sidecar, so tailnet membership is
the front door. Never attach a public domain to this app.

## Run locally

```bash
npm run build:hub
npm run serve            # http://localhost:8654, data in ~/.skilldex
```

Environment: `SKILLDEX_DATA_DIR` (config + hub library, default `~/.skilldex`),
`SKILLDEX_PORT` (default 8654), `SKILLDEX_HOST` (default 0.0.0.0),
`SKILLDEX_STATIC_DIR` (defaults to the renderer build next to the bundle).

## API for agents

Every workspace operation is a JSON route under `/api/*` (see
`server/router.ts`). Three routes exist specifically so a Claude session on
any tailnet machine can drive the hub without the UI:

- `GET /api/skill?name=<name>` — where a skill lives: library copies plus
  per-machine presence (returns the ids the other routes need).
- `POST /api/import-skill-files` — upload a skill as loose files
  (`{input:{files:[{path, content|base64}], scope, replace?}}`), no zip.
- `POST /api/distribute` — push a library skill to some or all machines
  (`{name, machines?, replace?}`); repo-backed skills are pulled pinned,
  file-backed ones are pushed.

The `skillsync` skill in `skills/skillsync/` wraps these for Claude Code, with
the full route/payload table in `skills/skillsync/references/api.md`.

## Deploy on Coolify

1. New resource → Docker Compose, pointing at this repo/branch
   (`docker-compose.yml` at the root).
2. Set `TS_AUTHKEY` in the app's environment. Generate the key in the
   Tailscale admin console; store it in Doppler
   (`delmar-shared/dev_personal`) and paste it into Coolify from there.
   Prefer a **tagged** key (e.g. `tag:skilldex-hub`) with an ACL SSH rule
   scoped to the machines the hub may manage; an untagged user key also
   works with the default `member → self` SSH rule but grants broader
   reach and expires with the node key.
3. Do **not** configure a public domain / FQDN for the app.
4. Deploy. The hub appears on the tailnet as `skilldex-hub`; the sidecar's
   `serve.json` publishes it at `https://skilldex-hub.<tailnet>.ts.net`
   with tailscale-managed certs. (Edit `deploy/serve.json` if your tailnet
   domain differs.)

Data (config.json, the hub's own skill library under `home/`) persists in
the `hub-data` volume; tailscale node state persists in `tailscale-state`,
so redeploys keep the same node identity.
