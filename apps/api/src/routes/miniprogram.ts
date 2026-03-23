import type { FastifyInstance } from 'fastify'
import { getMiniProgramSession } from '../channels/wechat.js'
import { db, users, conversations, knowledgeCards } from '@ikr/db'
import { eq, count } from '@ikr/db'
import { userService } from '../services/user.service.js'

export async function miniprogramRoutes(app: FastifyInstance) {

  // 小程序登录
  app.post('/login', async (req, reply) => {
    const { code } = req.body as { code: string }

    const wxSession = await getMiniProgramSession(code)
    if (wxSession.errcode) {
      return reply.status(400).send({ error: wxSession.errmsg })
    }

    const { openid, unionid } = wxSession

    // 通过 unionid 关联服务号用户（如果有）
    let user = unionid
      ? await db.query.users.findFirst({
          where: eq(users.wechatUnionid, unionid)
        })
      : null

    if (!user) {
      user = await userService.findOrCreateByUnionid(unionid || openid)
    }

    // 绑定小程序 openid
    await userService.linkMiniOpenid(user.id, openid, unionid)

    // 生成 JWT
    const token = app.jwt.sign({ userId: user.id }, { expiresIn: '30d' })

    return { token, userId: user.id }
  })

  // 获取用户信息（知识库概览）
  app.get('/profile', async (req) => {
    const { userId } = (req as any).user

    const countResult = await db
      .select({ value: count() })
      .from(knowledgeCards)
      .where(eq(knowledgeCards.userId, userId))
    const cardCount = countResult[0]?.value ?? 0

    const profile = await userService.getWorkspaceFile(userId, 'PROFILE.md')

    return {
      cardCount: Number(cardCount),
      profile,
      isColdStart: Number(cardCount) < 20
    }
  })
}
