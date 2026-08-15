import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncAgentLinks } from '../agent-links'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-agents-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function writeSkill(name: string, root = path.join(tmp, '.claude', 'skills')): Promise<string> {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  return dir
}

const codexDir = () => path.join(tmp, '.codex', 'skills')

describe('syncAgentLinks', () => {
  it('links every enabled skill into the codex directory', async () => {
    await writeSkill('tdd')
    await writeSkill('pdf-filler')

    const errors = await syncAgentLinks([tmp], ['claude', 'codex'])
    expect(errors).toEqual([])

    const link = path.join(codexDir(), 'tdd')
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
    // Relative link that resolves to the canonical copy.
    expect(await fs.readlink(link)).toBe(path.join('..', '..', '.claude', 'skills', 'tdd'))
    expect(await fs.readFile(path.join(link, 'SKILL.md'), 'utf8')).toContain('tdd')
    expect((await fs.readdir(codexDir())).sort()).toEqual(['pdf-filler', 'tdd'])
  })

  it('drops links for disabled or removed skills, ignores foreign entries', async () => {
    await writeSkill('tdd')
    await writeSkill('gone')
    await syncAgentLinks([tmp], ['claude', 'codex'])

    // One skill disabled (moved under .disabled), one deleted entirely; plus
    // a real directory the user created in .codex/skills themselves.
    const root = path.join(tmp, '.claude', 'skills')
    await fs.mkdir(path.join(root, '.disabled'), { recursive: true })
    await fs.rename(path.join(root, 'tdd'), path.join(root, '.disabled', 'tdd'))
    await fs.rm(path.join(root, 'gone'), { recursive: true })
    await writeSkill('handmade', codexDir())

    await syncAgentLinks([tmp], ['claude', 'codex'])
    expect((await fs.readdir(codexDir())).sort()).toEqual(['handmade'])
  })

  it('cleans up its links when codex is toggled off, leaving foreign entries', async () => {
    await writeSkill('tdd')
    await syncAgentLinks([tmp], ['claude', 'codex'])
    await writeSkill('handmade', codexDir())

    await syncAgentLinks([tmp], ['claude'])
    expect((await fs.readdir(codexDir())).sort()).toEqual(['handmade'])
  })

  it('handles project bases alongside home', async () => {
    const project = path.join(tmp, 'proj')
    await writeSkill('proj-skill', path.join(project, '.claude', 'skills'))

    await syncAgentLinks([tmp, project], ['claude', 'codex'])
    const link = path.join(project, '.codex', 'skills', 'proj-skill')
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
    expect(await fs.readFile(path.join(link, 'SKILL.md'), 'utf8')).toContain('proj-skill')
  })

  it('never clobbers a real directory shadowing a canonical skill name', async () => {
    await writeSkill('tdd')
    await writeSkill('tdd', codexDir()) // user's own real folder with same name

    const errors = await syncAgentLinks([tmp], ['claude', 'codex'])
    expect(errors).toEqual([])
    expect((await fs.lstat(path.join(codexDir(), 'tdd'))).isSymbolicLink()).toBe(false)
  })
})
