/**
 * Skill categorization — three signal layers, best-first.
 *
 *  1. Structural (free, high precision): the folder a skill was imported
 *     from in its repo, and name-prefix families (`paseo-*`, `higgsfield-*`)
 *     that group themselves.
 *  2. LLM (Claude): name + description → one category from a fixed taxonomy
 *     plus a confidence, batched many-per-call so a whole library costs
 *     cents. Only skills without a category get classified.
 *  3. Manual: user edits win and are never overwritten by a re-run.
 *
 * Categories are a fixed list on purpose — a free-form classifier invents
 * dozens of near-duplicate labels, and the point is nine shelves, not sixty.
 * The Anthropic client is injected so tests drive the module with a fake.
 */

import type { SkillCategory } from './types'

export const CATEGORIES: ReadonlyArray<{ id: SkillCategory; label: string; hint: string }> = [
  { id: 'marketing', label: 'Marketing & Growth', hint: 'SEO, ads, email, launches, positioning, conversion, referrals' },
  { id: 'content', label: 'Content & Writing', hint: 'copywriting, editing, blogs, social posts, publishing, humanizing text' },
  { id: 'analytics', label: 'Analytics & Data', hint: 'metrics, dashboards, GA4, stats, data pipelines, reporting on numbers' },
  { id: 'design', label: 'Design & Media', hint: 'UI/frontend design, images, video, generative media, visual assets' },
  { id: 'dev', label: 'Dev Tooling', hint: 'code review, testing, deployment, infra, CLIs, building software and MCP servers' },
  { id: 'agents', label: 'Agent Orchestration', hint: 'delegation, handoffs, advisors, loops, notes/tables/playbooks for agent workflows' },
  { id: 'business', label: 'Business Ops', hint: 'CRM/task tools, invoicing, orders, finance, client management, daily planning' },
  { id: 'documents', label: 'Documents & Files', hint: 'PDF, DOCX, spreadsheets, slides, file conversion and extraction' },
  { id: 'research', label: 'Research & Knowledge', hint: 'web research, competitor analysis, scraping, note systems, knowledge bases' },
]

export const CATEGORY_IDS = CATEGORIES.map((category) => category.id)

/** Where a category assignment came from, in ascending trust order. */
export type CategorySource = 'llm' | 'structural' | 'manual'

export type CategoryAssignment = {
  category: SkillCategory
  confidence: number
  source: CategorySource
}

/**
 * Structural inference from repo path and name prefix. Returns null when
 * nothing structural applies — never guesses from description words (that
 * is exactly the low-precision path this module exists to avoid).
 */
export function inferStructuralCategory(skill: {
  name: string
  repoPath?: string
}): CategoryAssignment | null {
  const dir = (skill.repoPath ?? '').toLowerCase()
  const name = skill.name.toLowerCase()

  // Repo folder conventions seen across the tracked catalogs.
  const folderRules: Array<[RegExp, SkillCategory]> = [
    [/(^|\/)(marketing|growth|seo|ads?)(\/|$)/, 'marketing'],
    [/(^|\/)(content|writing|copy)(\/|$)/, 'content'],
    [/(^|\/)(analytics|data)(\/|$)/, 'analytics'],
    [/(^|\/)(design|media|frontend|ui)(\/|$)/, 'design'],
    [/(^|\/)(dev|devtools|engineering|coding|infra|deploy)(\/|$)/, 'dev'],
    [/(^|\/)(agents?|orchestration)(\/|$)/, 'agents'],
    [/(^|\/)(business|ops|finance)(\/|$)/, 'business'],
    [/(^|\/)(documents?|docs?|office|files?)(\/|$)/, 'documents'],
    [/(^|\/)(research|knowledge)(\/|$)/, 'research'],
  ]
  for (const [pattern, category] of folderRules) {
    if (pattern.test(dir)) return { category, confidence: 0.85, source: 'structural' }
  }

  // Name-prefix families that unambiguously group themselves.
  const prefixRules: Array<[RegExp, SkillCategory]> = [
    [/^(paseo|scape)(-|$)/, 'agents'],
    [/^higgsfield(-|$)/, 'design'],
    [/^obsidian(-|$)/, 'research'],
    [/^quickbooks(-|$)/, 'business'],
    [/^ga4(-|$)/, 'analytics'],
  ]
  for (const [pattern, category] of prefixRules) {
    if (pattern.test(name)) return { category, confidence: 0.9, source: 'structural' }
  }
  return null
}

/** The subset of the Anthropic client this module needs; injected for tests. */
export type ClassifierClient = {
  classify(input: { skills: Array<{ name: string; description: string }> }): Promise<
    Array<{ name: string; category: string; confidence: number }>
  >
}

const BATCH_SIZE = 40

/**
 * Classify skills that have no assignment yet. Structural first; anything
 * left is batched to the LLM. Returns assignments keyed by skill name.
 */
export async function categorizeSkills(
  skills: Array<{ name: string; description: string; repoPath?: string }>,
  client: ClassifierClient | null,
): Promise<Map<string, CategoryAssignment>> {
  const result = new Map<string, CategoryAssignment>()
  const remaining: typeof skills = []
  for (const skill of skills) {
    const structural = inferStructuralCategory(skill)
    if (structural) result.set(skill.name, structural)
    else remaining.push(skill)
  }
  if (!client || remaining.length === 0) return result

  for (let start = 0; start < remaining.length; start += BATCH_SIZE) {
    const batch = remaining.slice(start, start + BATCH_SIZE)
    const answers = await client.classify({
      skills: batch.map(({ name, description }) => ({ name, description })),
    })
    for (const answer of answers) {
      if (!CATEGORY_IDS.includes(answer.category as SkillCategory)) continue
      result.set(answer.name, {
        category: answer.category as SkillCategory,
        confidence: Math.max(0, Math.min(1, answer.confidence)),
        source: 'llm',
      })
    }
  }
  return result
}

/** Build the real classifier on top of the Anthropic SDK. */
export function createAnthropicClassifier(apiKey: string): ClassifierClient {
  // Lazy-required so the desktop app and hub start fine without the SDK
  // resolving until a key is actually configured.
  return {
    async classify({ skills }) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey })
      const taxonomy = CATEGORIES.map((category) => `- ${category.id}: ${category.label} — ${category.hint}`).join('\n')
      const listing = skills
        .map((skill, index) => `${index + 1}. name: ${skill.name}\n   description: ${skill.description || '(none)'}`)
        .join('\n')

      const response = await client.messages.create({
        model: 'claude-opus-5',
        max_tokens: 4096,
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                assignments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      category: { type: 'string', enum: [...CATEGORY_IDS] },
                      confidence: { type: 'number' },
                    },
                    required: ['name', 'category', 'confidence'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['assignments'],
              additionalProperties: false,
            },
          },
        },
        system:
          'You categorize coding-agent skills into a fixed taxonomy. Each skill has a name and a description written to tell an agent when to use it. Assign exactly one category per skill from the taxonomy — the best single fit for what the skill is primarily for — and a confidence from 0 to 1. Prefer the category a person browsing a library would look under. Return every skill you were given, in any order, using its exact name.',
        messages: [
          {
            role: 'user',
            content: `Taxonomy:\n${taxonomy}\n\nSkills:\n${listing}`,
          },
        ],
      })

      if (response.stop_reason === 'refusal') return []
      const text = response.content.find((block) => block.type === 'text')
      if (!text || text.type !== 'text') return []
      const parsed = JSON.parse(text.text) as {
        assignments: Array<{ name: string; category: string; confidence: number }>
      }
      return parsed.assignments
    },
  }
}

/**
 * OpenRouter classifier — OpenAI-style chat completions over plain fetch, no
 * new dependency. Structured output support varies by routed model, so the
 * prompt asks for JSON and every category is validated against the taxonomy
 * before it can reach the ledger.
 */
export function createOpenRouterClassifier(apiKey: string, model = 'anthropic/claude-haiku-4.5'): ClassifierClient {
  return {
    async classify({ skills }) {
      const taxonomy = CATEGORIES.map((category) => `- ${category.id}: ${category.label} — ${category.hint}`).join('\n')
      const listing = skills
        .map((skill, index) => `${index + 1}. name: ${skill.name}\n   description: ${skill.description || '(none)'}`)
        .join('\n')

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/eehkay/skillsync',
          'X-Title': 'SkillSync',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You categorize coding-agent skills into a fixed taxonomy. Each skill has a name and a description written to tell an agent when to use it. Assign exactly one category per skill from the taxonomy — the best single fit for what the skill is primarily for — and a confidence from 0 to 1. Prefer the category a person browsing a library would look under. Respond with ONLY a JSON object of the shape {"assignments":[{"name":string,"category":string,"confidence":number}]}, including every skill given, using each exact name. Category must be one of the taxonomy ids.',
            },
            { role: 'user', content: `Taxonomy:\n${taxonomy}\n\nSkills:\n${listing}` },
          ],
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`OpenRouter ${response.status}: ${detail.slice(0, 200) || response.statusText}`)
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = data.choices?.[0]?.message?.content ?? ''
      // Some models wrap JSON in fences despite json_object; strip defensively.
      const raw = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(raw) as { assignments?: Array<{ name: string; category: string; confidence: number }> }
      return Array.isArray(parsed.assignments) ? parsed.assignments : []
    },
  }
}

export type ClassifierProvider = 'anthropic' | 'openrouter'

/** Build the configured classifier, or null when no key is available. */
export function createClassifierFromConfig(config: {
  categorizerProvider?: ClassifierProvider
  anthropicApiKey?: string
  openRouterApiKey?: string
  openRouterModel?: string
}): ClassifierClient | null {
  // Explicit provider wins; otherwise infer from whichever key is present
  // (config first, then environment).
  const provider =
    config.categorizerProvider ??
    (config.openRouterApiKey || process.env.OPENROUTER_API_KEY ? 'openrouter' : 'anthropic')
  if (provider === 'openrouter') {
    const key = config.openRouterApiKey || process.env.OPENROUTER_API_KEY
    return key ? createOpenRouterClassifier(key, config.openRouterModel || undefined) : null
  }
  const key = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY
  return key ? createAnthropicClassifier(key) : null
}
