import { client, MODELS } from '@ikr/ai'

export interface FetchResult {
  title: string
  content: string
  source: string
}

export async function fetchUrlContent(url: string): Promise<FetchResult> {
  const hostname = new URL(url).hostname

  // 微信公众号特殊处理（需要服务号接入）
  if (hostname.includes('mp.weixin.qq.com')) {
    throw new Error('WECHAT_ARTICLE')
  }

  // 抓取页面原始内容
  const rawHtml = await fetchRawHtml(url)

  // 用 AI 从原始 HTML 中精准提取正文
  const result = await extractWithAI(rawHtml, url)

  return {
    title: result.title,
    content: result.content,
    source: hostname,
  }
}

// ── 抓取原始 HTML ────────────────────────────────────────
async function fetchRawHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const html = await response.text()

  // 去掉 script/style 标签减少噪音，保留文本内容
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')       // 去掉所有 HTML 标签
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')           // 合并空白
    .trim()
    .slice(0, 15000)                // 截取前 15000 字符送给 AI

  if (cleaned.length < 100) throw new Error('CONTENT_TOO_SHORT')

  return cleaned
}

// ── AI 精准提取正文 ──────────────────────────────────────
async function extractWithAI(
  rawText: string,
  url: string
): Promise<{ title: string; content: string }> {

  const response = await client.chat.completions.create({
    model: MODELS.fast,
    max_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: `你是网页正文提取专家。从网页文本中精准识别并提取文章正文。

规则：
1. 只保留文章实际正文（标题、段落、小标题、列表）
2. 去掉：导航菜单、广告、推荐阅读、评论、版权声明、作者简介、关注提示、网站介绍等
3. 保持原文段落结构，不改写内容
4. 输出严格的 JSON，包含两个字段：
   - title: 文章标题（字符串）
   - content: 正文内容（字符串，保留换行）`
      },
      {
        role: 'user',
        content: `网页来源：${url}\n\n以下是网页原始文本，请提取正文：\n\n${rawText}`
      }
    ]
  })

  const raw = response.choices[0]?.message?.content || ''
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)

  try {
    const parsed = JSON.parse(jsonMatch?.[0] || text)
    const content = (parsed.content || '').trim()
    if (content.length < 100) throw new Error('CONTENT_TOO_SHORT')
    return {
      title: (parsed.title || '').trim().slice(0, 200),
      content: content.slice(0, 10000)
    }
  } catch {
    if (rawText.length < 100) throw new Error('CONTENT_TOO_SHORT')
    // AI 解析失败，退回原始文本
    return { title: '', content: rawText.slice(0, 10000) }
  }
}
