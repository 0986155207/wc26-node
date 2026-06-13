/************************************************************************
 *  GET /api/data            — toàn bộ dữ liệu cho giao diện
 *  GET /api/data?refresh=1  — ép đồng bộ ngay từ nguồn (nút "Làm mới")
 *
 *  Cơ chế thời gian thực: mỗi lần được gọi, endpoint tự kiểm tra —
 *  nếu dữ liệu trong DB cũ hơn 60 giây thì đồng bộ lại từ
 *  football-data.org trước khi trả về. Frontend gọi mỗi 60 giây
 *  → người xem luôn thấy tỷ số mới mà không cần cron dày đặc.
 ************************************************************************/

import { syncIfStale, readAppData } from '../lib/football.js';
import { TEAMS } from '../lib/teams.js';

export default async function handler(req, res) {
  try {
    const force = req.query?.refresh === '1';
    const sync = await syncIfStale(force);
    const data = await readAppData();

    res.status(200).json({ ...data, teams: TEAMS, sync });
  } catch (err) {
    console.error('[api/data]', err);
    res.status(500).json({ error: err.message });
  }
}
