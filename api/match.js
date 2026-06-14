/************************************************************************
 *  GET /api/match?id=<matchId> — diễn biến chi tiết một trận đấu
 *  (cầu thủ ghi bàn, phút, thẻ phạt, tóm tắt tiếng Việt — qua Gemini)
 *  Kết quả được cache trong DB để tiết kiệm credit Gemini.
 ************************************************************************/

import { getMatchDetails } from '../lib/gemini.js';

export default async function handler(req, res) {
  const id = req.query?.id;
  if (!id) {
    res.status(400).json({ error: 'Thiếu tham số id.' });
    return;
  }
  try {
    const details = await getMatchDetails(String(id));
    res.status(200).json(details);
  } catch (err) {
    console.error('[api/match]', err);
    res.status(500).json({ error: err.message });
  }
}