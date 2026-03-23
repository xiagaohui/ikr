import { checkEnv } from './lib/startup-check.js'
checkEnv()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import sensible from '@fastify/sensible'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { setupAuth } from './lib/auth.js'
import { initDatabase } from './lib/db-init.js'
import { wechatRoutes } from './routes/wechat.js'
import { itemsRoutes } from './routes/items.js'
import { conversationsRoutes } from './routes/conversations.js'
import { miniprogramRoutes } from './routes/miniprogram.js'
import { devRoutes } from './routes/dev.js'

// 在同一进程启动 Workers（Render 免费套餐只有一个服务）
import './workers/index.js'

const app = Fastify({ logger: true })

// 注册 text/xml 内容类型解析器（微信消息使用 XML 格式）
app.addContentTypeParser('text/xml', { parseAs: 'string' }, (req, body, done) => {
  done(null, body)
})

// 插件
await app.register(cors, { origin: true })
await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-in-prod' })
await app.register(sensible)

// 初始化数据库（生产环境自动建表）
await initDatabase()

// 静态文件（Web 界面）
const __dirname = dirname(fileURLToPath(import.meta.url))
await app.register(fastifyStatic, {
  root: join(__dirname, '../../../apps/web'),
  prefix: '/web/',
})
app.get('/', async (req, reply) => reply.redirect('/web/index.html'))

// JWT 认证中间件
setupAuth(app)

// 路由
await app.register(wechatRoutes, { prefix: '/wechat' })
await app.register(devRoutes)
await app.register(itemsRoutes, { prefix: '/api/items' })
await app.register(conversationsRoutes, { prefix: '/api/conversations' })
await app.register(miniprogramRoutes, { prefix: '/miniprogram' })

// 健康检查
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// 启动
const port = Number(process.env.PORT) || 3000
await app.listen({ port, host: '0.0.0.0' })
console.log(`IKR API running on port ${port}`)
