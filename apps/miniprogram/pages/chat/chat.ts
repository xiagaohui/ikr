import { request } from '../../utils/request'

interface Message {
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

interface ConversationMode {
  mode: 'decision' | 'deep_thinking'
}

Page({
  data: {
    conversationId: '',
    messages: [] as Message[],
    inputText: '',
    loading: false,
    mode: 'decision' as 'decision' | 'deep_thinking',
    scrollToId: '',
  },

  onLoad(options: any) {
    const { conversationId, initialQuery } = options
    this.setData({ conversationId })

    // 加载历史消息
    this.loadHistory()

    // 如果有初始问题，直接发送
    if (initialQuery) {
      const query = decodeURIComponent(initialQuery)
      this.setData({ inputText: query })
      // 延迟一帧确保页面渲染完成
      setTimeout(() => this.sendMessage(), 100)
    }
  },

  async loadHistory() {
    try {
      const data = await request<{ messages: Message[] }>({
        url: `/api/conversations/${this.data.conversationId}/messages`
      })
      if (data.messages.length > 0) {
        this.setData({ messages: data.messages })
        this.scrollToBottom()
      }
    } catch (e) {
      // 新对话，无历史
    }
  },

  onInputChange(e: any) {
    this.setData({ inputText: e.detail.value })
  },

  async sendMessage() {
    const content = this.data.inputText.trim()
    if (!content || this.data.loading) return

    const app = getApp<IAppOption>()

    // 立即显示用户消息
    const userMsg: Message = { role: 'user', content }
    this.setData({
      messages: [...this.data.messages, userMsg],
      inputText: '',
      loading: true,
    })
    this.scrollToBottom()

    // 添加 loading 占位
    const loadingMsg: Message = { role: 'assistant', content: '...' }
    this.setData({ messages: [...this.data.messages, loadingMsg] })

    try {
      const data = await request<{ message: string; mode: string }>({
        url: `/api/conversations/${this.data.conversationId}/messages`,
        method: 'POST',
        data: {
          userId: app.globalData.userId,
          content,
        }
      })

      // 替换 loading 占位为真实回答
      const msgs = [...this.data.messages]
      msgs[msgs.length - 1] = { role: 'assistant', content: data.message }
      this.setData({
        messages: msgs,
        mode: data.mode as any,
        loading: false,
      })
      this.scrollToBottom()

    } catch (e) {
      const msgs = [...this.data.messages]
      msgs[msgs.length - 1] = {
        role: 'assistant',
        content: '抱歉，处理出错了，请稍后重试。'
      }
      this.setData({ messages: msgs, loading: false })
    }
  },

  // 切换到深度思考模式
  onSwitchToDeepThinking() {
    this.setData({ inputText: '深入' })
    this.sendMessage()
  },

  // 退出深度思考模式
  onExitDeepThinking() {
    this.setData({ inputText: '退出' })
    this.sendMessage()
  },

  scrollToBottom() {
    const id = `msg-${this.data.messages.length - 1}`
    this.setData({ scrollToId: id })
  },

  // 格式化消息内容（处理换行）
  formatContent(content: string): string {
    return content
  },

  onKeyboardHeightChange(e: any) {
    // 键盘弹出时滚动到底部
    if (e.detail.height > 0) {
      this.scrollToBottom()
    }
  }
})
