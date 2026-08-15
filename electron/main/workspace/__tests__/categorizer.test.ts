import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CATEGORY_IDS, categorizeSkills, inferStructuralCategory, type ClassifierClient } from '../categorizer'
import { createConfigStore } from '../config'
import { createLibraryStore } from '../library-store'
import { createSkillWorkspace, type SkillWorkspace } from '../skill-workspace'

describe('inferStructuralCategory', () => {
  it('uses repo folder conventions', () => {
    expect(inferStructuralCategory({ name: 'x', repoPath: 'skills/marketing/cold-email' })?.category).toBe('marketing')
    expect(inferStructuralCategory({ name: 'x', repoPath: 'docs/pdf' })?.category).toBe('documents')
    expect(inferStructuralCategory({ name: 'x', repoPath: 'design/frontend' })?.category).toBe('design')
  })

  it('uses name-prefix families', () => {
    expect(inferStructuralCategory({ name: 'paseo-advisor' })?.category).toBe('agents')
    expect(inferStructuralCategory({ name: 'higgsfield-soul-id' })?.category).toBe('design')
    expect(inferStructuralCategory({ name: 'quickbooks-finance' })?.category).toBe('business')
  })

  it('never guesses from generic names', () => {
    expect(inferStructuralCategory({ name: 'mcp-builder' })).toBeNull()
    expect(inferStructuralCategory({ name: 'pdf', repoPath: 'skills/pdf' })).toBeNull()
  })
})

describe('categorizeSkills', () => {
  it('sends only structurally-unresolved skills to the LLM, in batches, and validates output', async () => {
    const seen: string[][] = []
    const client: ClassifierClient = {
      async classify({ skills }) {
        seen.push(skills.map((skill) => skill.name))
        return skills.map((skill) => ({
          name: skill.name,
          category: skill.name === 'weird' ? 'not-a-category' : 'dev',
          confidence: 0.8,
        }))
      },
    }
    const skills = [
      { name: 'paseo-loop', description: '' },
      ...Array.from({ length: 45 }, (_, index) => ({ name: `tool-${index}`, description: 'builds things' })),
      { name: 'weird', description: '' },
    ]
    const result = await categorizeSkills(skills, client)

    expect(result.get('paseo-loop')).toMatchObject({ category: 'agents', source: 'structural' })
    // 46 unresolved → two batches (40 + 6); paseo-loop never sent.
    expect(seen.length).toBe(2)
    expect(seen.flat()).not.toContain('paseo-loop')
    expect(result.get('tool-3')).toMatchObject({ category: 'dev', source: 'llm', confidence: 0.8 })
    // Invalid category from the model is dropped, not stored.
    expect(result.has('weird')).toBe(false)
  })

  it('returns structural results only when no client is configured', async () => {
    const result = await categorizeSkills(
      [{ name: 'scape-note', description: '' }, { name: 'mystery', description: 'unknown' }],
      null,
    )
    expect(result.get('scape-note')?.category).toBe('agents')
    expect(result.has('mystery')).toBe(false)
  })

  it('exposes every taxonomy id', () => {
    expect(CATEGORY_IDS).toContain('marketing')
    expect(CATEGORY_IDS.length).toBe(9)
  })
})

describe('workspace categorizeLibrary / setSkillCategory', () => {
  let tmp: string
  let ws: SkillWorkspace
  let calls = 0

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-cat-'))
    calls = 0
    const configPath = path.join(tmp, 'config.json')
    const configStore = createConfigStore(configPath)
    await configStore.save({
      includePersonal: true, includePlugins: false, projectRoots: [], favourites: [],
      skillRepos: [], machines: [], agents: ['claude'], anthropicApiKey: 'sk-test',
    })
    ws = createSkillWorkspace({
      homeDir: tmp,
      configStore,
      libraryStore: createLibraryStore(path.join(tmp, 'library.json')),
      classifierFactory: () => ({
        async classify({ skills }) {
          calls++
          return skills.map((skill) => ({ name: skill.name, category: 'content', confidence: 0.7 }))
        },
      }),
    })
    for (const name of ['humanizer', 'paseo-handoff', 'ga4-analytics']) {
      await ws.createSkill({ name, description: `${name} does things`, scope: 'global' })
    }
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('categorizes structural + llm and exposes results on skills', async () => {
    const result = await ws.categorizeLibrary()
    expect(result.usedLlm).toBe(true)
    expect(result.categorized).toBe(3)
    const byName = Object.fromEntries(result.workspace.skills.map((skill) => [skill.name, skill.library]))
    expect(byName['paseo-handoff']).toMatchObject({ category: 'agents', categorySource: 'structural' })
    expect(byName['ga4-analytics']).toMatchObject({ category: 'analytics', categorySource: 'structural' })
    expect(byName['humanizer']).toMatchObject({ category: 'content', categorySource: 'llm' })
    // Only the one unresolved skill went to the model.
    expect(calls).toBe(1)
  })

  it('is idempotent and never overwrites manual assignments', async () => {
    await ws.categorizeLibrary()
    const skill = (await ws.getSnapshot()).skills.find((entry) => entry.name === 'humanizer')!
    await ws.setSkillCategory(skill.id, 'marketing')

    calls = 0
    const again = await ws.categorizeLibrary({ force: true })
    // Forced re-run recategorizes the non-manual ones but leaves the manual one alone.
    expect(again.workspace.skills.find((entry) => entry.name === 'humanizer')?.library).toMatchObject({
      category: 'marketing',
      categorySource: 'manual',
    })
    // A plain (non-forced) run has nothing left to do.
    const noop = await ws.categorizeLibrary()
    expect(noop.categorized).toBe(0)
  })

  it('clears a category with null', async () => {
    await ws.categorizeLibrary()
    const skill = (await ws.getSnapshot()).skills.find((entry) => entry.name === 'humanizer')!
    const snapshot = await ws.setSkillCategory(skill.id, null)
    expect(snapshot.skills.find((entry) => entry.name === 'humanizer')?.library?.category).toBeUndefined()
  })
})
