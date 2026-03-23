// 启动前检查必要的环境变量
const REQUIRED_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'ZHIPU_API_KEY',
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'WECHAT_TOKEN',
]

const OPTIONAL_VARS = [
  'MINIPROGRAM_APP_ID',
  'MINIPROGRAM_APP_SECRET',
  'JWT_SECRET',
]

export function checkEnv() {
  const missing = REQUIRED_VARS.filter(v => !process.env[v])

  if (missing.length > 0) {
    console.error('❌ 缺少必要的环境变量：')
    missing.forEach(v => console.error(`   - ${v}`))
    console.error('\n请参考 .env.example 配置环境变量')
    process.exit(1)
  }

  const missingOptional = OPTIONAL_VARS.filter(v => !process.env[v])
  if (missingOptional.length > 0) {
    console.warn('⚠️  以下可选环境变量未配置（部分功能可能不可用）：')
    missingOptional.forEach(v => console.warn(`   - ${v}`))
  }

  console.log('✅ 环境变量检查通过')
}
