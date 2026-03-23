import { API_BASE_URL } from './config'

interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: any
}

export function request<T = any>(options: RequestOptions): Promise<T> {
  const app = getApp<IAppOption>()
  const token = app.globalData.token

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      success: (res: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T)
        } else if (res.statusCode === 401) {
          // Token 过期，重新登录
          wx.removeStorageSync('token')
          wx.removeStorageSync('userId')
          wx.reLaunch({ url: '/pages/index/index' })
          reject(new Error('Unauthorized'))
        } else {
          reject(new Error(`Request failed: ${res.statusCode}`))
        }
      },
      fail: reject
    })
  })
}
