/// <reference path="./wx/index.d.ts" />

interface IAppOption {
  globalData: {
    token: string
    userId: string
    apiBase: string
  }
  login(): void
}
