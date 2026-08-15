import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanPluginSkills } from '../filesystem-source'

let home: string

async function writeSkill(dir: string, name: string) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`)
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-plugins-'))
  const mkt = path.join(home, '.claude', 'plugins', 'marketplaces', 'official')
  await writeSkill(path.join(mkt, 'plugins', 'alpha', 'skills', 'alpha-skill'), 'alpha-skill')
  await writeSkill(path.join(mkt, 'plugins', 'beta-dir', 'skills', 'beta-skill'), 'beta-skill')
  await writeSkill(path.join(mkt, 'external_plugins', 'gamma', 'skills', 'gamma-skill'), 'gamma-skill')
  await writeSkill(path.join(mkt, 'plugins', 'delta', 'skills', 'delta-skill'), 'delta-skill')
  // beta's manifest name differs from its folder.
  await fs.mkdir(path.join(mkt, '.claude-plugin'), { recursive: true })
  await fs.writeFile(
    path.join(mkt, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'official', plugins: [{ name: 'beta', source: './plugins/beta-dir' }] }),
  )
})

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

async function names(): Promise<string[]> {
  return (await scanPluginSkills(home)).skills.map((skill) => skill.name).sort()
}

describe('scanPluginSkills', () => {
  it('reports nothing when no plugin is enabled — the marketplace clone is only a catalog', async () => {
    expect(await names()).toEqual([])
  })

  it('surfaces skills for plugins enabled in settings, matching by folder or manifest name', async () => {
    await fs.writeFile(
      path.join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'alpha@official': true, 'beta@official': true, 'delta@official': false } }),
    )
    expect(await names()).toEqual(['alpha-skill', 'beta-skill'])
  })

  it('treats installed plugins as enabled unless switched off, with settings.local.json overriding', async () => {
    await fs.writeFile(
      path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'gamma@official': [{ scope: 'user' }], 'delta@official': [{ scope: 'user' }] } }),
    )
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'delta@official': true } }))
    await fs.writeFile(path.join(home, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'delta@official': false } }))
    expect(await names()).toEqual(['gamma-skill'])
  })
})
