import { request } from '../../utils/request'

interface KnowledgeItem {
  id: string
  title: string
  url: string
  primaryType: string
  status: string
  summary: {
    points: string[]
    concepts: Array<{ term: string; definition: string }>
    logic: string
  } | null
  createdAt: string
}

interface KnowledgeCard {
  id: string
  content: string
  cardType: string
  typeMetadata: any
  isTimely: boolean
}

Page({
  data: {
    items: [] as KnowledgeItem[],
    selectedItem: null as KnowledgeItem | null,
    selectedCards: [] as KnowledgeCard[],
    searchQuery: '',
    loading: false,
    showDetail: false,
    typeLabels: {
      argument: '观点', operation: '方法', fact: '数据', narrative: '案例'
    } as Record<string, string>,
  },

  onLoad(options: any) {
    this.loadItems()
    // 如果从首页带了 itemId，直接展开
    if (options.itemId) {
      setTimeout(() => this.openItem(options.itemId), 500)
    }
  },

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    this.setData({ loading: true })
    try {
      const data = await request<{ items: KnowledgeItem[] }>({ url: '/api/items' })
      this.setData({ items: data.items })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onSearchInput(e: any) {
    this.setData({ searchQuery: e.detail.value })
  },

  get filteredItems(): KnowledgeItem[] {
    const q = this.data.searchQuery.toLowerCase()
    if (!q) return this.data.items
    return this.data.items.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      item.summary?.points?.some(p => p.toLowerCase().includes(q))
    )
  },

  async onItemTap(e: any) {
    const { id } = e.currentTarget.dataset
    await this.openItem(id)
  },

  async openItem(id: string) {
    try {
      const data = await request<{ item: KnowledgeItem; cards: KnowledgeCard[] }>({
        url: `/api/items/${id}`
      })
      this.setData({
        selectedItem: data.item,
        selectedCards: data.cards,
        showDetail: true,
      })
    } catch (e) {
      wx.showToast({ title: '加载详情失败', icon: 'none' })
    }
  },

  onCloseDetail() {
    this.setData({ showDetail: false, selectedItem: null, selectedCards: [] })
  },

  // 基于这篇文章提问
  onAskAboutItem() {
    if (!this.data.selectedItem) return
    wx.navigateTo({
      url: `/pages/chat/chat?conversationId=new&initialQuery=${encodeURIComponent(
        `关于《${this.data.selectedItem.title}》，`
      )}`
    })
  },

  formatTime(dateStr: string): string {
    const date = new Date(dateStr)
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  },

  typeLabel(type: string): string {
    return (this.data.typeLabels as any)[type] || type
  }
})
