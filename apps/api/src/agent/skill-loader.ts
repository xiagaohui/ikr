import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, '../../../../skills')

export interface SkillMeta {
  name: string
  description: string
  location: string
  always?: boolean
  priority?: 'high' | 'normal' | 'low'
}

// 加载所有内置 Skill 的元数据（延迟加载，只注入索引）
export function loadSkillIndex(): SkillMeta[] {
  const skillDirs = [
    'answer-advisor',
    'deep-thinking',
    'content-classifier',
    'knowledge-retrieval',
    'source-finder',
    'profile-builder'
  ]

  return skillDirs
    .map(dir => {
      const skillPath = join(SKILLS_DIR, dir, 'SKILL.md')
      if (!existsSync(skillPath)) return null

      const content = readFileSync(skillPath, 'utf-8')
      const meta = parseSkillFrontmatter(content)

      return {
        name: meta.name || dir,
        description: meta.description || '',
        location: skillPath,
        always: meta['ikr.always'] === 'true',
        priority: meta['ikr.priority'] as 'high' | 'normal' | 'low' || 'normal'
      }
    })
    .filter(Boolean) as SkillMeta[]
}

// 读取 Skill 详细内容（模型按需调用）
export function readSkillContent(location: string): string {
  if (!existsSync(location)) return ''
  return readFileSync(location, 'utf-8')
}

// 生成注入 System Prompt 的 XML 索引
export function buildSkillsXml(skills: SkillMeta[]): string {
  const items = skills.map(s =>
    `  <skill>\n` +
    `    <name>${s.name}</name>\n` +
    `    <description>${s.description}</description>\n` +
    `    <location>${s.location}</location>\n` +
    `  </skill>`
  ).join('\n')

  return `<available_skills>\n${items}\n</available_skills>`
}

function parseSkillFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const [key, ...valueParts] = line.split(':')
    if (key && valueParts.length) {
      meta[key.trim()] = valueParts.join(':').trim()
    }
  }
  return meta
}
