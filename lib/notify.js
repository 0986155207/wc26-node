/************************************************************************
 *  lib/notify.js — Quyết định và gửi 3 loại thông báo đẩy
 *    1. daily   — lịch đấu trong ngày (gửi 1 lần mỗi sáng ~7h VN)
 *    2. kickoff — nhắc trước giờ bóng lăn 30 phút (mỗi trận 1 lần)
 *    3. result  — kết quả sau khi trận kết thúc (mỗi trận 1 lần)
 *
 *  Hàm runNotifications() được gọi định kỳ bởi cron (/api/daily).
 ************************************************************************/

import { sql, ensureSchema } from './db.js';
import { TEAM_MAP } from './teams.js';
import { sendToAll } from './push.js';

const TZ = 'Asia/Ho_Chi_Minh';

const viName = (en) => (TEAM_MAP[en] && TEAM_MAP[en].vi) || en;
const flag = (en) => (TEAM_MAP[en] && TEAM_MAP[en].flag) || '';
const vnDateKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });   // yyyy-mm-dd
const vnTime = (d) => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const hourVN = () => Number(new Date().toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: TZ }));

export async function runNotifications() {
  await ensureSchema();
  const report = {};
  try { report.daily   = await notifyDaily(); }   catch (e) { report.daily   = { error: e.message }; }
  try { report.kickoff = await notifyKickoff(); } catch (e) { report.kickoff = { error: e.message }; }
  try { report.result  = await notifyResults(); } catch (e) { report.result  = { error: e.message }; }
  return report;
}

/* ---------- 1. Lịch đấu trong ngày (mỗi sáng ~7h VN) ---------- */
async function notifyDaily() {
  const h = hourVN();
  if (h < 7 || h >= 9) return { skipped: 'ngoài khung 7-9h' }; // chỉ gửi buổi sáng

  const today = vnDateKey(new Date());
  const rows = await sql()`
    SELECT * FROM matches
    WHERE home <> '' AND away <> ''
    ORDER BY date_utc`;
  const todays = rows.filter(m => vnDateKey(m.date_utc) === today);
  if (!todays.length) return { skipped: 'hôm nay không có trận' };

  const lines = todays.slice(0, 6).map(m =>
    `${vnTime(m.date_utc)} ${viName(m.home)} - ${viName(m.away)}`);
  const more = todays.length > 6 ? ` (+${todays.length - 6} trận nữa)` : '';

  return sendToAll({
    title: `⚽ Hôm nay có ${todays.length} trận World Cup`,
    body: lines.join('\n') + more,
    url: '/',
    tag: 'daily-' + today
  }, 'daily', 'daily-' + today);
}

/* ---------- 2. Nhắc trước giờ bóng lăn 30 phút ---------- */
async function notifyKickoff() {
  const now = Date.now();
  const rows = await sql()`
    SELECT * FROM matches
    WHERE home <> '' AND away <> '' AND status = 'Sắp diễn ra'
      AND date_utc BETWEEN now() AND now() + interval '35 minutes'`;
  let total = { sent: 0 };
  for (const m of rows) {
    const mins = Math.round((new Date(m.date_utc).getTime() - now) / 60000);
    if (mins > 32) continue; // chỉ nhắc khi còn ~30 phút
    const r = await sendToAll({
      title: `⏰ Sắp đá: ${viName(m.home)} vs ${viName(m.away)}`,
      body: `${flag(m.home)} ${viName(m.home)} - ${viName(m.away)} ${flag(m.away)} bắt đầu lúc ${vnTime(m.date_utc)} (còn ~${mins} phút)`,
      url: '/',
      tag: 'kickoff-' + m.id
    }, 'kickoff', 'kickoff-' + m.id);
    total.sent += r.sent || 0;
  }
  return total;
}

/* ---------- 3. Kết quả sau khi trận kết thúc ---------- */
async function notifyResults() {
  const rows = await sql()`
    SELECT * FROM matches
    WHERE home <> '' AND away <> '' AND status = 'Kết thúc'
      AND updated_at > now() - interval '3 hours'
      AND home_goals IS NOT NULL AND away_goals IS NOT NULL`;
  let total = { sent: 0 };
  for (const m of rows) {
    let score = `${m.home_goals} - ${m.away_goals}`;
    if (m.home_pen != null && m.away_pen != null) score += ` (pen ${m.home_pen}-${m.away_pen})`;
    const r = await sendToAll({
      title: `🏁 Kết thúc: ${viName(m.home)} ${m.home_goals}-${m.away_goals} ${viName(m.away)}`,
      body: `${flag(m.home)} ${viName(m.home)} ${score} ${viName(m.away)} ${flag(m.away)}. Chạm để xem diễn biến.`,
      url: '/',
      tag: 'result-' + m.id
    }, 'result', 'result-' + m.id);
    total.sent += r.sent || 0;
  }
  return total;
}