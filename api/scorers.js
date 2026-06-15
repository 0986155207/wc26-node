/************************************************************************
 *  GET /api/scorers            — bảng vua phá lưới (tổng hợp người ghi bàn)
 *  GET /api/scorers?refresh=1  — ép tính lại ngay (bỏ qua cache 5 phút)
 *
 *  Dữ liệu diễn biến lấy từ ESPN / TheSportsDB (miễn phí), bàn phản lưới
 *  không được tính. Kết quả cache trong DB nên các lần gọi sau rất nhanh.
 ************************************************************************/

import { getTopScorers } from '../lib/football.js';

export default async function handler(req, res) {
  try {
    const force = req.query?.refresh === '1';
    const data = await getTopScorers(force);
    res.status(200).json(data);
  } catch (err) {
    console.error('[api/scorers]', err);
    res.status(500).json({ error: err.message });
  }
}
