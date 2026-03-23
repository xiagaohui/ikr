import { API_BASE_URL } from './utils/config'

App<IAppOption>({
  globalData: {
    token: '',
    userId: '',
    apiBase: API_BASE_URL,
  },

  onLaunch() {
    const token = wx.getStorageSync('token')
    const userId = wx.getStorageSync('userId')
    if (token && userId) {
      this.globalData.token = token
      this.globalData.userId = userId
    } else {
      this.login()
    }
  },

  login() {
    wx.login({
      success: (res) => {
        wx.request({
          url: `${API_BASE_URL}/miniprogram/login`,
          method: 'POST',
          data: { code: res.code },
          success: (loginRes: any) => {
            const { token, userId } = loginRes.data
            this.globalData.token = token
            this.globalData.userId = userId
            wx.setStorageSync('token', token)
            wx.setStorageSync('userId', userId)
          },
          fail: () => {
            wx.showToast({ title: '登录失败，请重试', icon: 'none' })
          }
        })
      }
    })
  }
})
