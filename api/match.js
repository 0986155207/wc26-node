/************************************************************************
 *  GET /api/match?id=<matchId> — diễn biến chi tiết một trận đấu
 *  (cầu thủ ghi bàn, phút, thẻ phạt, tóm tắt tiếng Việt — qua Gemini)
 *  Kết quả được cache trong DB để tiết kiệm credit Gemini.
 ************************************************************************/

import { getMatchDetails } from '../lib/gemini.js';
import { friendlyError } from '../lib/ratelimit.js';

export default async function handler(req, res) {
  const id = req.query?.id;
  if (!id) {
    res.status(400).json({ error: 'Thiếu tham số id.' });
    return;
  }
  // Chẩn đoán tạm: xem football-data trả về gì (chỉ tên trường + số lượng, không lộ token)
  if (req.query?.debug === '1' && String(id).startsWith('FD-')) {
    try {
      const r = await fetch(`https://api.football-data.org/v4/matches/${String(id).slice(3)}`, {
        headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN || '' }
      });
      const body = await r.json().catch(() => ({}));
      res.status(200).json({
        httpStatus: r.status,
        topKeys: Object.keys(body),
        goals: Array.isArray(body.goals) ? body.goals.length : (body.goals === undefined ? 'undefined' : typeof body.goals),
        bookings: Array.isArray(body.bookings) ? body.bookings.length : typeof body.bookings,
        score: body.score?.fullTime,
        sampleGoal: (body.goals || [])[0] || null
      });
    } catch (e) {
      res.status(200).json({ debugError: e.message });
    }
    return;
  }
  try {
    const details = await getMatchDetails(String(id));
    res.status(200).json(details);
  } catch (err) {
    console.error('[api/match]', err);
    res.status(500).json({ error: friendlyError(err) });
  }
}