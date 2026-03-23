import { request } from '../../utils/request'

interface RecentItem {
  id: string
  title: string
  primaryType: string
  createdAt: string
  cardCount?: number
}

interface ProfileData {
  cardCount: number
  isColdStart: boolean
}

Page({
  data: {
    query: '',
    recentItems: [] as RecentItem[],
    cardCount: 0,
    isColdStart: true,
    loading: false,
  },

  onLoad() {
    this.loadProfile()
    this.loadRecentItems()
  },

  onShow() {
    // 每次显示时刷新（可能有新内容收录）
    this.loadRecentItems()
  },

  async loadProfile() {
    try {
      const data = await request<ProfileData>({ url: '/miniprogram/profile' })
      this.setData({
        cardCount: data.cardCount,
        isColdStart: data.isColdStart,
      })
    } catch (e) {
      // 静默失败
    }
  },

  async loadRecentItems() {
    try {
      const data = await request<{ items: RecentItem[] }>({ url: '/api/items' })
      this.setData({ recentItems: data.items.slice(0, 5) })
    } catch (e) {
      // 静默失败
    }
  },

  onQueryInput(e: any) {
    this.setData({ query: e.detail.value })
  },

  async onSubmit() {
    const query = this.data.query.trim()
    if (!query) return

    // 检查登录状态
    const app = getApp<IAppOption>()
    if (!app.globalData.token || !app.globalData.userId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      app.login()
      return
    }

    this.setData({ loading: true })

    try {
      // 创建对话并跳转
      const data = await request<{ conversation: { id: string } }>({
        url: '/api/conversations',
        method: 'POST',
        data: { userId: app.globalData.userId, channel: 'wechat_miniprogram' }
      })

      wx.navigateTo({
        url: `/pages/chat/chat?conversationId=${data.conversation.id}&initialQuery=${encodeURIComponent(query)}`
      })
      this.setData({ query: '' })
    } catch (e) {
      wx.showToast({ title: '发送失败，请重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onItemTap(e: any) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/library/library?itemId=${id}` })
  },

  onViewLibrary() {
    wx.switchTab({ url: '/pages/library/library' })
  },

  // 格式化时间
  formatTime(dateStr: string): string {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / 3600000)
    if (hours < 1) return '刚刚'
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}天前`
    return `${date.getMonth() + 1}/${date.getDate()}`
  },

  typeLabel(type: string): string {
    const map: Record<string, string> = {
      argument: '观点', operation: '方法', fact: '数据', narrative: '案例'
    }
    return map[type] || type
  }
})
