const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

module.exports = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  mongoUri: process.env.MONGO_URI || '',
  mongoDbName: process.env.MONGO_DB_NAME || 'smartstock',
  aiServiceUrl: process.env.AI_SERVICE_URL || '',
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'SmartStock AI <no-reply@smartstock.local>',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  trendApiUrl: process.env.TREND_API_URL || '',
  newsApiKey: process.env.NEWS_API_KEY || '',
  googleTrendsUrl: process.env.GOOGLE_TRENDS_URL || '',
};
