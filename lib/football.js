/************************************************************************
 *  lib/football.js — Đồng bộ dữ liệu trận đấu & tính bảng xếp hạng
 *  Nguồn chính : football-data.org (gói miễn phí có World Cup)
 *  Dự phòng    : Gemini + Google Search (lib/gemini.js)
 *  Cơ chế      : "stale-while-revalidate" — chỉ gọi nguồn ngoài khi
 *                dữ liệu trong DB cũ hơn FRESH_MS (60 giây)
 ************************************************************************/

import { sql, ensureSchema, getMeta, setMeta } from './db.js';
import { normalizeTeam, TEAM_MAP } from './teams.js';
import { fetchScoresViaAI } from './gemini.js';

const FD_URL = 'https://api.football-data.org/v4/competitions/WC/matches';
const FRESH_MS = 60_000; // dữ liệu được coi là "tươi" trong 60 giây

const STATUS_VI = {
  SCHEDULED: 'Sắp diễn ra', TIMED: 'Sắp diễn ra',
  IN_PLAY: 'ĐANG ĐÁ', PAUSED: 'Nghỉ giữa hiệp',
  FINISHED: 'Kết thúc', POSTPONED: 'Hoãn',
  SUSPENDED: 'Tạm dừng', CANCELLED: 'Hủy'
};

const STAGE_VI = {
  GROUP_STAGE: 'Vòng bảng', LAST_32: 'Vòng 1/16', ROUND_OF_16: 'Vòng 1/8',
  LAST_16: 'Vòng 1/8', QUARTER_FINALS: 'Tứ kết', SEMI_FINALS: 'Bán kết',
  THIRD_PLACE: 'Tranh hạng ba', FINAL: 'Chung kết'
};

// Thứ tự các vòng knock-out (để dựng sơ đồ bracket trái → phải)
export const KNOCKOUT_ORDER = ['Vòng 1/16', 'Vòng 1/8', 'Tứ kết', 'Bán kết', 'Chung kết'];

/** Đồng bộ nếu dữ liệu đã cũ. force = true để ép cập nhật ngay. */
export async function syncIfStale(force = false) {
  await ensureSchema();
  const q = sql();
  const last = Number(await getMeta('last_sync_ms')) || 0;
  if (!force && Date.now() - last < FRESH_MS) {
    return { synced: false, reason: 'fresh' };
  }
  // Khóa mềm chống nhiều request cùng đồng bộ một lúc
  await setMeta('last_sync_ms', Date.now());

  try {
    let matches = [];
    let source = 'football-data.org';

    if (process.env.FOOTBALL_DATA_TOKEN) {
      matches = await fetchFromFootballData();
    }
    if (!matches.length) {
      source = 'Gemini + Google Search';
      matches = await fetchScoresViaAI();
    }

    if (matches.length) {
      await upsertMatches(matches);
      // Dọn dữ liệu cũ: chuẩn hóa nhãn bảng đã lưu dạng GROUP_B → B
      await q`UPDATE matches
              SET group_name = regexp_replace(group_name, '^GROUP[_ ]?', '', 'i')
              WHERE group_name ILIKE 'GROUP%'`;
      await setMeta('last_sync_source', source);
      await setMeta('last_sync_ok_ms', Date.now());
    }
    return { synced: true, count: matches.length, source };
  } catch (err) {
    console.error('[syncIfStale]', err.message);
    return { synced: false, error: err.message };
  }
}

async function fetchFromFootballData() {
  const res = await fetch(FD_URL, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN }
  });
  if (!res.ok) {
    console.error('[football-data] HTTP', res.status, (await res.text()).slice(0, 200));
    return [];
  }
  const body = await res.json();
  return (body.matches || []).map(m => ({
    id: `FD-${m.id}`,
    dateUTC: m.utcDate,
    stage: STAGE_VI[m.stage] || 'Vòng bảng',
    group: (m.group || '').replace(/^GROUP[_\s]?/i, '').replace(/^Group\s?/i, '').trim(),
    home: normalizeTeam(m.homeTeam?.name),
    away: normalizeTeam(m.awayTeam?.name),
    homeGoals: m.score?.fullTime?.home ?? null,
    awayGoals: m.score?.fullTime?.away ?? null,
    homePen: m.score?.penalties?.home ?? null,
    awayPen: m.score?.penalties?.away ?? null,
    status: STATUS_VI[m.status] || m.status,
    venue: m.venue || '',
    city: '',
    attendance: null
  }));
}

/** Upsert — giữ lại venue/city/attendance đã được Gemini bổ sung trước đó */
async function upsertMatches(matches) {
  const q = sql();
  for (const m of matches) {
    // Vòng bảng phải có đủ 2 đội. Vòng knock-out cho phép chưa có đội (TBD)
    // để dựng sẵn khung sơ đồ bracket; khi FIFA chốt đội sẽ tự điền vào.
    const isGroup = m.stage === 'Vòng bảng';
    if (isGroup && (!m.home || !m.away)) continue;
    await q`
      INSERT INTO matches
        (id, date_utc, stage, group_name, home, away,
         home_goals, away_goals, home_pen, away_pen, status, venue, city, attendance, updated_at)
      VALUES
        (${m.id}, ${m.dateUTC}, ${m.stage}, ${m.group}, ${m.home || ''}, ${m.away || ''},
         ${m.homeGoals}, ${m.awayGoals}, ${m.homePen ?? null}, ${m.awayPen ?? null},
         ${m.status}, ${m.venue}, ${m.city}, ${m.attendance}, now())
      ON CONFLICT (id) DO UPDATE SET
        date_utc   = EXCLUDED.date_utc,
        stage      = EXCLUDED.stage,
        group_name = EXCLUDED.group_name,
        home       = COALESCE(NULLIF(EXCLUDED.home, ''), matches.home),
        away       = COALESCE(NULLIF(EXCLUDED.away, ''), matches.away),
        home_goals = COALESCE(EXCLUDED.home_goals, matches.home_goals),
        away_goals = COALESCE(EXCLUDED.away_goals, matches.away_goals),
        home_pen   = COALESCE(EXCLUDED.home_pen, matches.home_pen),
        away_pen   = COALESCE(EXCLUDED.away_pen, matches.away_pen),
        status     = EXCLUDED.status,
        venue      = COALESCE(NULLIF(EXCLUDED.venue, ''), matches.venue),
        city       = COALESCE(NULLIF(EXCLUDED.city,  ''), matches.city),
        attendance = COALESCE(EXCLUDED.attendance, matches.attendance),
        updated_at = now()`;
  }
}

/** Tính BXH 12 bảng từ kết quả (gồm cả trận đang đá để BXH "sống") */
export function computeStandings(matches) {
  const table = {};
  // Khởi tạo đủ 48 đội để bảng nào cũng hiển thị
  for (const [en, info] of Object.entries(TEAM_MAP)) {
    table[en] = { group: info.group, team: en, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  }

  for (const m of matches) {
    const liveOrDone = ['Kết thúc', 'ĐANG ĐÁ', 'Nghỉ giữa hiệp'].includes(m.status);
    if (!liveOrDone || m.stage !== 'Vòng bảng') continue;
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const h = table[m.home], a = table[m.away];
    if (!h || !a) continue;

    h.p++; a.p++;
    h.gf += m.homeGoals; h.ga += m.awayGoals;
    a.gf += m.awayGoals; a.ga += m.homeGoals;
    if (m.homeGoals > m.awayGoals)      { h.w++; a.l++; }
    else if (m.homeGoals < m.awayGoals) { a.w++; h.l++; }
    else                                { h.d++; a.d++; }
  }

  const groups = {};
  for (const t of Object.values(table)) {
    (groups[t.group] ??= []).push(t);
  }

  const out = [];
  for (const g of Object.keys(groups).sort()) {
    groups[g]
      .sort((x, y) =>
        (y.w * 3 + y.d) - (x.w * 3 + x.d) ||
        (y.gf - y.ga) - (x.gf - x.ga) ||
        y.gf - x.gf ||
        x.team.localeCompare(y.team))
      .forEach((t, i) => out.push({
        group: g, pos: i + 1, team: t.team,
        p: t.p, w: t.w, d: t.d, l: t.l,
        gf: t.gf, ga: t.ga, gd: t.gf - t.ga, pts: t.w * 3 + t.d
      }));
  }
  return out;
}

/** Đọc toàn bộ dữ liệu cho frontend */
export async function readAppData() {
  await ensureSchema();
  const q = sql();

  const [matchRows, predRows, lastOk, source] = await Promise.all([
    q`SELECT * FROM matches ORDER BY date_utc`,
    q`SELECT * FROM predictions ORDER BY created_at DESC`,
    getMeta('last_sync_ok_ms'),
    getMeta('last_sync_source')
  ]);

  const matches = matchRows.map(r => ({
    id: r.id,
    dateUTC: new Date(r.date_utc).toISOString(),
    stage: r.stage,
    group: r.group_name,
    home: r.home,
    away: r.away,
    homeGoals: r.home_goals,
    awayGoals: r.away_goals,
    homePen: r.home_pen,
    awayPen: r.away_pen,
    status: r.status,
    venue: r.venue,
    city: r.city,
    attendance: r.attendance
  }));

  const predictions = predRows.map(r => ({
    matchId: r.match_id,
    predHome: r.pred_home,
    predAway: r.pred_away,
    probHome: r.prob_home,
    probDraw: r.prob_draw,
    probAway: r.prob_away,
    comment: r.comment,
    createdAt: new Date(r.created_at).toISOString()
  }));

  return {
    generatedAt: new Date().toISOString(),
    lastSyncAt: lastOk ? new Date(Number(lastOk)).toISOString() : null,
    source: source || null,
    matches,
    standings: computeStandings(matches),
    predictions
  };
}