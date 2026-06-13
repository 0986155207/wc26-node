/************************************************************************
 *  GET /api/daily — Cron hằng ngày (Vercel gọi 23:00 UTC = 6:00 sáng VN)
 *  1. Đồng bộ kết quả mới nhất
 *  2. Gemini dự đoán các trận trong 48 giờ tới
 *  3. Gemini tra Google Search bổ sung sân & số khán giả trận đã đá
 *
 *  Bảo mật: Vercel Cron tự gửi header "Authorization: Bearer <CRON_SECRET>".
 *  Có thể gọi tay để kiểm tra:
 *  curl -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/daily
 ************************************************************************/

import { syncIfStale } from '../lib/football.js';
import { predictMatches, enrichAttendance } from '../lib/gemini.js';

export default async function handler(req, res) {
  const auth = req.headers?.authorization || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const report = { sync: null, predictions: null, attendance: null };

  try { report.sync = await syncIfStale(true); }
  catch (e) { report.sync = { error: e.message }; }

  try { report.predictions = await predictMatches(); }
  catch (e) { report.predictions = { error: e.message }; }

  try { report.attendance = await enrichAttendance(); }
  catch (e) { report.attendance = { error: e.message }; }

  console.log('[api/daily]', JSON.stringify(report));
  res.status(200).json(report);
}
