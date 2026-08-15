import type { Skill } from './skills'

/**
 * Library search. Every whitespace-separated term must match somewhere in the
 * skill (AND), case-insensitively; results rank name hits first — exact, then
 * prefix, then substring — so typing a skill's name surfaces it at the top
 * even when the same word appears in a dozen descriptions.
 */
export function searchSkills(skills: Skill[], query: string): Skill[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return skills

  const scored: Array<{ skill: Skill; score: number }> = []
  for (const skill of skills) {
    const name = skill.name.toLowerCase()
    const haystack = [
      skill.name,
      skill.summary,
      skill.source,
      skill.sourceKind,
      skill.origin?.label ?? '',
      skill.library?.repo ?? '',
      ...skill.projects,
    ]
      .join(' ')
      .toLowerCase()

    if (!terms.every((term) => haystack.includes(term))) continue

    // Best name match across terms decides the tier; ties fall back to A–Z.
    let score = 0
    for (const term of terms) {
      if (name === term) score = Math.max(score, 3)
      else if (name.startsWith(term)) score = Math.max(score, 2)
      else if (name.includes(term)) score = Math.max(score, 1)
    }
    scored.push({ skill, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .map((entry) => entry.skill)
}
