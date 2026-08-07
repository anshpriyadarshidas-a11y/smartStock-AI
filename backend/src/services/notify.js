const config = require('../config');
const { getStore } = require('../db/db');

/**
 * Notification service.
 *
 * Always records a notification row (drives the dashboard bell feed) and logs
 * the event. When Telegram / SMTP credentials are configured, it also pushes
 * the alert out-of-band; otherwise it degrades gracefully to logging only.
 */
async function send({ type, message, payload = {}, via = [] }) {
  const store = getStore();
  const row = {
    type,
    message,
    read: false,
    createdAt: new Date().toISOString(),
    ...payload,
  };
  await store.insert('notifications', row);
  console.log(`[notify] ${type}: ${message}`);

  const channels = via.length > 0 ? via : ['log', 'telegram'];
  if (channels.includes('telegram') && config.telegram.botToken && config.telegram.chatId) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: config.telegram.chatId, text: message }),
        }
      );
      if (!res.ok) console.warn('[notify] telegram send failed:', res.status);
    } catch (err) {
      console.warn('[notify] telegram unavailable:', err.message);
    }
  }

  if (channels.includes('email') && config.smtp.host && config.smtp.user && config.smtp.pass) {
    console.warn('[notify] SMTP delivery not wired up (no nodemailer); message logged only.');
  }

  return row;
}

module.exports = { send };
