import { describe, expect, it } from 'vitest'
import { searchSkills } from './search'
import type { Skill } from './skills'

function skill(name: string, extra: Partial<Skill> = {}): Skill {
  return {
    id: name,
    name,
    description: '',
    summary: '',
    source: `~/.claude/skills/${name}`,
    displayPath: `~/.claude/skills/${name}`,
    realPath: `/home/x/.claude/skills/${name}`,
    sourceKind: 'Personal',
    scope: 'global',
    enabled: true,
    isFavourite: false,
    projects: [],
    fileCount: 1,
    mono: 'XX',
    iconBg: '',
    iconFg: '',
    ...extra,
  } as Skill
}

const LIBRARY = [
  skill('pdf-form-filler', { summary: 'Fill PDF forms from JSON.' }),
  skill('analytics', { summary: 'Reports on pdf downloads and traffic.' }),
  skill('pdf', { summary: 'Split and merge PDFs.' }),
  skill('deploy', { summary: 'Ship to Coolify.', projects: ['acme-site'] }),
]

describe('searchSkills', () => {
  it('returns everything for an empty query', () => {
    expect(searchSkills(LIBRARY, '  ')).toBe(LIBRARY)
  })

  it('ranks exact, prefix, then substring name matches ahead of description hits', () => {
    expect(searchSkills(LIBRARY, 'PDF').map((s) => s.name)).toEqual(['pdf', 'pdf-form-filler', 'analytics'])
  })

  it('requires every term to match somewhere', () => {
    expect(searchSkills(LIBRARY, 'pdf forms').map((s) => s.name)).toEqual(['pdf-form-filler'])
    expect(searchSkills(LIBRARY, 'pdf nope')).toEqual([])
  })

  it('matches project names, source kind, and paths', () => {
    expect(searchSkills(LIBRARY, 'acme').map((s) => s.name)).toEqual(['deploy'])
    expect(searchSkills(LIBRARY, 'personal').length).toBe(4)
    expect(searchSkills(LIBRARY, '.claude/skills/dep').map((s) => s.name)).toEqual(['deploy'])
  })
})
