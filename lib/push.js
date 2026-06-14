/************************************************************************
 *  lib/push.js — Web Push (thông báo đẩy) cho PWA trên iPhone/Android
 *  - Lưu subscription của từng thiết bị vào DB
 *  - Gửi thông báo qua giao thức Web Push (VAPID)
 *  - Chống gửi trùng bằng bảng push_sent
 *
 *  Cần 3 biến môi trường:
 *    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (tạo bằng: npx web-push generate-vapid-keys)
 *    VAPID_SUBJECT  (ví dụ: mailto:ban@example.com)
 ************************************************************************/

import { sql, ensureSchema } from './db.js';

// Nạp web-push theo kiểu "lazy" để việc thiếu/lỗi gói không làm sập
// cả module (vd: endpoint lấy khóa & đăng ký vốn không cần web-push).
let _webpush = null;
async function getWebPush() {
  if (!_webpush) {
    _webpush = (await import('web-push')).default;
  }
  return _webpush;
}

let _configured = false;
async function configure() {
  if (_configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  const webpush = await getWebPush();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@worldcup26.app',
    pub, priv
  );
  _configured = true;
  return true;
}

export function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

/** Lưu / cập nhật subscription của một thiết bị */
export async function saveSubscription(sub, prefs) {
  await ensureSchema();
  if (!sub || !sub.endpoint) throw new Error('Subscription không hợp lệ.');
  const p = prefs || { daily: true, kickoff: true, result: true };
  await sql()`
    INSERT INTO push_subs (endpoint, sub, prefs)
    VALUES (${sub.endpoint}, ${JSON.stringify(sub)}::jsonb, ${JSON.stringify(p)}::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET sub = EXCLUDED.sub, prefs = EXCLUDED.prefs`;
}

export async function removeSubscription(endpoint) {
  await ensureSchema();
  await sql()`DELETE FROM push_subs WHERE endpoint = ${endpoint}`;
}

/** Đã từng gửi thông báo với "key" này chưa? (chống trùng) */
async function alreadySent(key) {
  const rows = await sql()`SELECT 1 FROM push_sent WHERE key = ${key}`;
  return rows.length > 0;
}
async function markSent(key) {
  await sql()`INSERT INTO push_sent (key) VALUES (${key}) ON CONFLICT (key) DO NOTHING`;
}

/**
 * Gửi một thông báo tới tất cả thiết bị đã bật loại (prefKey) tương ứng.
 * payload: { title, body, url, tag }
 * dedupeKey: nếu truyền, sẽ bỏ qua nếu đã gửi key này rồi.
 */
export async function sendToAll(payload, prefKey, dedupeKey) {
  await ensureSchema();
  if (!(await configure())) {
    console.warn('[push] Chưa cấu hình VAPID keys — bỏ qua gửi.');
    return { sent: 0, skipped: 'no-vapid' };
  }
  const webpush = await getWebPush();
  if (dedupeKey && await alreadySent(dedupeKey)) {
    return { sent: 0, skipped: 'already-sent' };
  }

  const subs = await sql()`SELECT endpoint, sub, prefs FROM push_subs`;
  const data = JSON.stringify(payload);
  let sent = 0, removed = 0;

  for (const row of subs) {
    // Tôn trọng tùy chọn bật/tắt của người dùng
    if (prefKey && row.prefs && row.prefs[prefKey] === false) continue;
    try {
      await webpush.sendNotification(row.sub, data);
      sent++;
    } catch (err) {
      // 404/410 = subscription đã hết hạn → xóa
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sql()`DELETE FROM push_subs WHERE endpoint = ${row.endpoint}`;
        removed++;
      } else {
        console.error('[push] gửi lỗi:', err.statusCode, err.body || err.message);
      }
    }
  }

  if (dedupeKey) await markSent(dedupeKey);
  return { sent, removed };
}