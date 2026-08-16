import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigStore } from '../config'
import { createLibraryStore } from '../library-store'
import { findOriginCandidates } from '../origin-finder'
import type { FetchLike, RepoScan } from '../repo-catalog'
import { createSkillWorkspace, type SkillWorkspace } from '../skill-workspace'

const SLUG = 'acme/skills'
const API = `https://api.github.com/repos/${SLUG}`
const SHA1 = '1111111111111111111111111111111111111111'
const SHA2 = '2222222222222222222222222222222222222222'
const TDD_V1 = '---\nname: tdd\ndescription: TDD\n---\nv1 body\n'
const TDD_V2 = '---\nname: tdd\ndescription: TDD\n---\nv2 body — improved\n'

/** A fake GitHub whose HEAD can be advanced from SHA1 to SHA2 mid-test. */
function fakeGitHub() {
  const state = { head: SHA1, tddChanged: true }
  const tree = { truncated: false, tree: [
    { path: 'skills/tdd', type: 'tree' }, { path: 'skills/tdd/SKILL.md', type: 'blob' },
    { path: 'skills/other', type: 'tree' }, { path: 'skills/other/SKILL.md', type: 'blob' },
  ] }
  const impl: FetchLike = async (url) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => String(body), arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer as ArrayBuffer })
    const nf = { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    if (url === API) return ok({ default_branch: 'main' })
    if (url === `${API}/commits/main`) return ok({ sha: state.head })
    if (url.startsWith(`${API}/git/trees/`)) return ok(tree)
    if (url.startsWith(`${API}/compare/`)) {
      const files = state.tddChanged ? [{ filename: 'skills/tdd/SKILL.md' }, { filename: 'README.md' }] : [{ filename: 'README.md' }]
      return ok({ files })
    }
    const raw = `https://raw.githubusercontent.com/${SLUG}/`
    if (url.startsWith(raw)) {
      const rest = url.slice(raw.length)
      const [ref, ...p] = rest.split('/'); const file = p.join('/')
      if (file === 'skills/tdd/SKILL.md') return ok(ref === SHA2 ? TDD_V2 : TDD_V1)
      if (file === 'skills/other/SKILL.md') return ok('---\nname: other\ndescription: Other\n---\n')
      return nf
    }
    return nf
  }
  return { impl, state }
}

describe('findOriginCandidates', () => {
  let tmp: string
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-origin-')) })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  async function scanOf(fetchImpl: FetchLike): Promise<RepoScan> {
    const { fetchRepoCatalog } = await import('../repo-catalog')
    return fetchRepoCatalog({ slug: SLUG }, fetchImpl)
  }

  it('ranks exact > likely > name-only by SKILL.md content', async () => {
    const gh = fakeGitHub()
    const scan = await scanOf(gh.impl)
    // exact: identical SKILL.md
    const exact = path.join(tmp, 'tdd'); await fs.mkdir(exact); await fs.writeFile(path.join(exact, 'SKILL.md'), TDD_V1)
    const r1 = await findOriginCandidates(exact, [scan], gh.impl)
    expect(r1[0]).toMatchObject({ repo: SLUG, path: 'skills/tdd', confidence: 'exact' })
    // likely: same frontmatter, edited body
    await fs.writeFile(path.join(exact, 'SKILL.md'), TDD_V1 + '\nmy local notes\n')
    const r2 = await findOriginCandidates(exact, [scan], gh.impl)
    expect(r2[0].confidence).toBe('likely')
    // name-only: same folder name, different frontmatter entirely
    await fs.writeFile(path.join(exact, 'SKILL.md'), '---\nname: tdd\ndescription: something else\n---\n')
    const r3 = await findOriginCandidates(exact, [scan], gh.impl)
    expect(r3[0].confidence).toBe('name-only')
    // no candidate for an unrelated name
    const none = path.join(tmp, 'mystery'); await fs.mkdir(none); await fs.writeFile(path.join(none, 'SKILL.md'), '---\nname: mystery\n---\n')
    expect(await findOriginCandidates(none, [scan], gh.impl)).toEqual([])
  })
})

describe('checkUpdates / applyUpdates / linkOrigin', () => {
  let tmp: string
  let ws: SkillWorkspace
  let gh: ReturnType<typeof fakeGitHub>

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-updates-'))
    gh = fakeGitHub()
    ws = createSkillWorkspace({
      homeDir: tmp,
      configStore: createConfigStore(path.join(tmp, 'config.json')),
      libraryStore: createLibraryStore(path.join(tmp, 'library.json')),
      fetchImpl: gh.impl,
    })
    await ws.addSkillRepo(SLUG)
    await ws.installRepoSkill({ repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
  })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it('reports no update when the repo has not moved', async () => {
    const result = await ws.checkUpdates()
    expect(result.checked).toBe(1)
    expect(result.updates).toEqual([])
  })

  it('reports no update when the repo moved but the skill folder did not change', async () => {
    gh.state.head = SHA2
    gh.state.tddChanged = false
    const result = await ws.checkUpdates()
    expect(result.updates).toEqual([])
  })

  it('detects a changed skill folder and applies the update atomically, re-pinning', async () => {
    gh.state.head = SHA2
    const check = await ws.checkUpdates()
    expect(check.updates).toHaveLength(1)
    expect(check.updates[0]).toMatchObject({ dirName: 'tdd', fromRef: SHA1, toRef: SHA2, changedFiles: ['SKILL.md'] })

    const applied = await ws.applyUpdates()
    expect(applied.updated).toEqual(['tdd'])
    expect(applied.failed).toEqual({})
    expect(await fs.readFile(path.join(tmp, '.claude', 'skills', 'tdd', 'SKILL.md'), 'utf8')).toBe(TDD_V2)
    const meta = applied.workspace.skills.find((s) => s.name === 'tdd')?.library
    expect(meta?.ref).toBe(SHA2)
    // Nothing left in staging/backup.
    const entries = await fs.readdir(path.join(tmp, '.claude', 'skills'))
    expect(entries.filter((e) => e.startsWith('.tdd.'))).toEqual([])
    // Idempotent: nothing to update afterwards.
    expect((await ws.checkUpdates()).updates).toEqual([])
  })

  it('linkOrigin pins an orphaned skill so it becomes updatable', async () => {
    // Hand-author an unpinned skill that matches the repo's 'other'.
    await ws.createSkill({ name: 'other', description: 'Other', scope: 'global' })
    const other = (await ws.getSnapshot()).skills.find((s) => s.name === 'other')!
    expect(other.library?.repo ?? '').toBe('')
    const candidates = await ws.findOrigin(other.id)
    expect(candidates[0]).toMatchObject({ repo: SLUG, path: 'skills/other' })
    const snapshot = await ws.linkOrigin(other.id, { repo: SLUG, path: 'skills/other', ref: SHA1 })
    expect(snapshot.skills.find((s) => s.name === 'other')?.library).toMatchObject({ repo: SLUG, path: 'skills/other', ref: SHA1 })
    // Now counted among pinned skills.
    expect((await ws.checkUpdates()).checked).toBe(2)
  })
})
