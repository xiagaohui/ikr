import { db, users, userWorkspaceFiles } from '@ikr/db'
import { eq, and } from '@ikr/db'

export const userService = {

  async findOrCreateByServiceOpenid(openid: string) {
    const existing = await db.query.users.findFirst({
      where: eq(users.wechatServiceOpenid, openid)
    })
    if (existing) return existing

    const [user] = await db.insert(users).values({
      wechatServiceOpenid: openid
    }).returning()

    // 初始化 Workspace 文件
    await initWorkspace(user.id)
    return user
  },

  async findOrCreateByUnionid(unionid: string) {
    const existing = await db.query.users.findFirst({
      where: eq(users.wechatUnionid, unionid)
    })
    if (existing) return existing

    const [user] = await db.insert(users).values({
      wechatUnionid: unionid
    }).returning()

    await initWorkspace(user.id)
    return user
  },

  async linkMiniOpenid(userId: string, miniOpenid: string, unionid?: string) {
    await db.update(users)
      .set({
        wechatMiniOpenid: miniOpenid,
        ...(unionid ? { wechatUnionid: unionid } : {})
      })
      .where(eq(users.id, userId))
  },

  async getWorkspaceFile(userId: string, filename: string): Promise<string | null> {
    const file = await db.query.userWorkspaceFiles.findFirst({
      where: and(
        eq(userWorkspaceFiles.userId, userId),
        eq(userWorkspaceFiles.filename, filename)
      )
    })
    return file?.content ?? null
  },

  async setWorkspaceFile(userId: string, filename: string, content: string) {
    await db.insert(userWorkspaceFiles)
      .values({ userId, filename, content })
      .onConflictDoUpdate({
        target: [userWorkspaceFiles.userId, userWorkspaceFiles.filename],
        set: { content, updatedAt: new Date() }
      })
  }
}

async function initWorkspace(userId: string) {
  const files = [
    {
      filename: 'USER.md',
      content: `# 用户档案\n\n（IKR 会随着你的使用逐渐了解你）`
    },
    {
      filename: 'MEMORY.md',
      content: `# 长期记忆\n\n（重要的对话信息会自动记录在这里）`
    },
    {
      filename: 'PROFILE.md',
      content: `# 认知画像\n\n（IKR 会根据你收录的内容自动推断你的背景和关注点）`
    }
  ]

  await db.insert(userWorkspaceFiles)
    .values(files.map(f => ({ userId, ...f })))
    .onConflictDoNothing()
}
