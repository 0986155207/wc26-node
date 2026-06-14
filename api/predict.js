/************************************************************************
 *  POST /api/predict — Gemini dự đoán các trận trong 48 giờ tới
 *  (tỷ số, số bàn thắng, xác suất thắng/hòa/thua, nhận định tiếng Việt)
 ************************************************************************/

import { syncIfStale } from '../lib/football.js';
import { predictMatches } from '../lib/gemini.js';
import { friendlyError } from '../lib/ratelimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Chỉ chấp nhận POST.' });
    return;
  }
  try {
    await syncIfStale(); // đảm bảo lịch mới nhất trước khi dự đoán
    const result = await predictMatches();
    res.status(200).json(result);
  } catch (err) {
    console.error('[api/predict]', err);
    res.status(500).json({ error: friendlyError(err) });
  }
}