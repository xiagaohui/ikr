import crypto from 'crypto'
import { parseStringPromise } from 'xml2js'

const WECHAT_TOKEN = process.env.WECHAT_TOKEN || ''
const WECHAT_APP_ID = process.env.WECHAT_APP_ID || ''
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || ''

// ─── 签名验证 ─────────────────────────────────────────────
export function verifySignature(
  signature: string, timestamp: string, nonce: string
): boolean {
  const arr = [WECHAT_TOKEN, timestamp, nonce].sort()
  const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex')
  return hash === signature
}

// ─── XML 解析 ─────────────────────────────────────────────
export async function parseWechatXml(xml: string): Promise<WechatMessage> {
  const result = await parseStringPromise(xml, { explicitArray: false })
  const msg = result.xml
  return {
    toUserName: msg.ToUserName,
    fromUserName: msg.FromUserName,
    createTime: Number(msg.CreateTime),
    msgType: msg.MsgType,
    content: msg.Content,
    msgId: msg.MsgId,
    // Link 类型
    title: msg.Title,
    description: msg.Description,
    url: msg.Url,
    // Event 类型
    event: msg.Event,
  }
}

// ─── 构建回复 XML ─────────────────────────────────────────
export function buildTextReply(toUser: string, fromUser: string, content: string): string {
  const time = Math.floor(Date.now() / 1000)
  // 防止 CDATA 注入：转义 ]]> 序列
  const safeContent = content.replace(/]]>/g, ']]]]><![CDATA[>')
  return `<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${time}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${safeContent}]]></Content>
</xml>`
}

// ─── 客服消息推送（异步，解决 5 秒限制）──────────────────
export async function sendCustomerServiceMessage(
  openid: string, content: string
): Promise<void> {
  const token = await getAccessToken()
  const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: openid,
      msgtype: 'text',
      text: { content }
    })
  })
}

// ─── Access Token 管理（带缓存）──────────────────────────
let accessTokenCache: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (accessTokenCache && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}`
  const res = await fetch(url)
  const data = await res.json() as { access_token: string; expires_in: number }

  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000  // 提前 5 分钟刷新
  }

  return data.access_token
}

// ─── 通过 code 获取 unionid（小程序登录）────────────────
export async function getMiniProgramSession(code: string) {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${process.env.MINIPROGRAM_APP_ID}&secret=${process.env.MINIPROGRAM_APP_SECRET}&js_code=${code}&grant_type=authorization_code`
  const res = await fetch(url)
  return res.json() as Promise<{
    openid: string
    session_key: string
    unionid?: string
    errcode?: number
    errmsg?: string
  }>
}

export interface WechatMessage {
  toUserName: string
  fromUserName: string
  createTime: number
  msgType: 'text' | 'link' | 'event' | string
  content?: string
  msgId?: string
  title?: string
  description?: string
  url?: string
  event?: 'subscribe' | 'unsubscribe' | string
}
