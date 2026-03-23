import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

// 不需要 JWT 的路由前缀
const PUBLIC_ROUTES = [
  '/wechat/',
  '/miniprogram/login',
  '/health',
  '/dev/',
  '/web/',
  '/',
]

export function setupAuth(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url

    // 公开路由跳过验证
    if (PUBLIC_ROUTES.some(prefix => url.startsWith(prefix))) return

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    try {
      const payload = await req.jwtVerify() as { userId: string }
      ;(req as any).userId = payload.userId
    } catch {
      return reply.status(401).send({ error: 'Invalid token' })
    }
  })
}
