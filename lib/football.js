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
    // Bổ sung sân/quốc gia/sức chứa cho vài ngày còn thiếu (nhẹ, tự dừng khi đủ)
    try { await enrichVenues(6); } catch (e) { console.warn('[enrichVenues]', e.message); }
    return { synced: true, count: matches.length, source };
  } catch (err) {
    console.error('[syncIfStale]', err.message);
    return { synced: false, error: err.message };
  }
}

/* --------------------------------------------------------------------
 *  Diễn biến chi tiết (cầu thủ ghi bàn, phút, thẻ phạt) qua TheSportsDB.
 *  Gói miễn phí của football-data.org KHÔNG trả các sự kiện này; TheSportsDB
 *  (key test "3") lại có timeline World Cup 2026 → dùng làm nguồn chính,
 *  KHÔNG tốn quota AI. Trả { events:[...] } hoặc null nếu không khớp trận.
 *  Định dạng event: { minute, team:'home'|'away', player, type }.
 * ------------------------------------------------------------------ */
const TSDB_KEY = process.env.THESPORTSDB_KEY || '3';
const TSDB = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}`;
const WC_LEAGUE_ID = '4429'; // FIFA World Cup trên TheSportsDB

// Cache ngắn (60s) cho các endpoint "danh sách theo ngày" (scoreboard / eventsday)
// — nhiều trận dùng chung 1 ngày nên tránh gọi lại khi tổng hợp vua phá lưới.
const _listCache = new Map();
async function cachedListJson(url) {
  const c = _listCache.get(url);
  if (c && Date.now() - c.at < 60_000) return c.j;
  const r = await fetch(url);
  const j = r.ok ? await r.json().catch(() => null) : null;
  _listCache.set(url, { at: Date.now(), j });
  return j;
}

async function tsdbJson(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

/** Tìm idEvent của trận trên TheSportsDB theo ngày + tên 2 đội (đã chuẩn hóa) */
async function findTsdbEventId(match) {
  const base = new Date(match.date_utc);
  // Thử ngày UTC và lân cận ±1 ngày (phòng lệch múi giờ)
  const dates = [0, -1, 1].map(d => {
    const x = new Date(base.getTime() + d * 86400_000);
    return x.toISOString().slice(0, 10);
  });
  const want = [normalizeTeam(match.home), normalizeTeam(match.away)].sort().join('|');

  for (const d of dates) {
    const data = await cachedListJson(`${TSDB}/eventsday.php?d=${d}&s=Soccer`);
    const events = data?.events || [];
    for (const e of events) {
      if (String(e.idLeague) !== WC_LEAGUE_ID && !/world cup/i.test(e.strLeague || '')) continue;
      const got = [normalizeTeam(e.strHomeTeam), normalizeTeam(e.strAwayTeam)].sort().join('|');
      if (got === want) return e.idEvent;
    }
  }
  return null;
}

export async function fetchMatchEventsFromTSDB(match) {
  if (!match?.home || !match?.away || !match?.date_utc) return null;

  const eventId = await findTsdbEventId(match);
  if (!eventId) return null;

  const data = await tsdbJson(`${TSDB}/lookuptimeline.php?id=${eventId}`);
  const rows = data?.timeline || [];
  if (!rows.length) return { events: [] };

  // Chuẩn hóa: đội nhà của TheSportsDB chưa chắc trùng "home" của ta → so tên
  const homeCanon = normalizeTeam(match.home);
  const events = [];
  for (const t of rows) {
    const kind = t.strTimeline || '';
    const detail = t.strTimelineDetail || '';
    let type = null;
    if (/goal/i.test(kind)) {
      type = /own/i.test(detail) ? 'own_goal' : /penalt/i.test(detail) ? 'penalty' : 'goal';
    } else if (/card/i.test(kind)) {
      type = /red/i.test(detail) ? 'red' : 'yellow';
    } else {
      continue; // bỏ qua thay người, v.v.
    }
    const team = normalizeTeam(t.strTeam) === homeCanon ? 'home' : 'away';
    const minute = t.intTime != null && t.intTime !== '' ? parseInt(t.intTime, 10) : null;
    events.push({ minute: Number.isNaN(minute) ? null : minute, team, player: t.strPlayer || '', type });
  }
  events.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
  return { events };
}

/* --------------------------------------------------------------------
 *  Diễn biến chi tiết qua ESPN (API công khai, không cần key, độ phủ tốt).
 *  Thường đầy đủ hơn TheSportsDB (có cả người ghi bàn). Trả { events:[...] }.
 * ------------------------------------------------------------------ */
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

async function espnJson(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

/** Tìm id trận trên ESPN theo ngày (±1) + tên 2 đội đã chuẩn hóa */
async function findEspnEventId(match) {
  const base = new Date(match.date_utc);
  const days = [0, -1, 1].map(d => {
    const x = new Date(base.getTime() + d * 86400_000);
    return x.toISOString().slice(0, 10).replace(/-/g, '');
  });
  const want = [normalizeTeam(match.home), normalizeTeam(match.away)].sort().join('|');

  for (const d of days) {
    const data = await cachedListJson(`${ESPN}/scoreboard?dates=${d}`);
    for (const e of (data?.events || [])) {
      const comp = e.competitions?.[0]?.competitors || [];
      const got = comp.map(c => normalizeTeam(c.team?.displayName)).sort().join('|');
      if (got === want) return e.id;
    }
  }
  return null;
}

export async function fetchMatchEventsFromESPN(match) {
  if (!match?.home || !match?.away || !match?.date_utc) return null;

  const eventId = await findEspnEventId(match);
  if (!eventId) return null;

  const data = await espnJson(`${ESPN}/summary?event=${eventId}`);
  const rows = data?.keyEvents || [];
  if (!rows.length) return { events: [] };

  const homeCanon = normalizeTeam(match.home);
  const events = [];
  for (const e of rows) {
    const tx = (e.type?.text || '').toLowerCase();
    if (/disallow|cancel|var/.test(tx)) continue;
    let type = null;
    if (e.scoringPlay || /goal/.test(tx)) {
      type = /own/.test(tx) ? 'own_goal' : /penalt/.test(tx) ? 'penalty' : 'goal';
    } else if (/red card/.test(tx)) type = 'red';
    else if (/yellow card/.test(tx)) type = 'yellow';
    else continue; // bỏ kickoff, delay, thay người, v.v.

    const disp = e.clock?.displayValue || (typeof e.clock === 'string' ? e.clock : '');
    const minute = disp ? parseInt(disp, 10) : null;
    const player = e.participants?.[0]?.athlete?.displayName
      || (e.shortText || '').replace(/\s+(Goal|Yellow Card|Red Card).*$/i, '').trim();
    const team = normalizeTeam(e.team?.displayName) === homeCanon ? 'home' : 'away';
    events.push({ minute: Number.isNaN(minute) ? null : minute, team, player, type });
  }
  events.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
  return { events };
}

/* --------------------------------------------------------------------
 *  Bổ sung SÂN VẬN ĐỘNG + QUỐC GIA TỔ CHỨC + SỨC CHỨA từ ESPN.
 *  football-data (gói free) không trả các trường này. ESPN có tên sân,
 *  thành phố, quốc gia; sức chứa lấy từ bảng cố định 16 sân WC 2026.
 * ------------------------------------------------------------------ */
const HOST_VI = { USA: 'Mỹ', 'United States': 'Mỹ', Canada: 'Canada', Mexico: 'Mexico' };
const STADIUM_CAP = {
  'MetLife Stadium': 82500, 'AT&T Stadium': 80000, 'SoFi Stadium': 70240,
  'Mercedes-Benz Stadium': 71000, 'Gillette Stadium': 65878, 'NRG Stadium': 72220,
  'Hard Rock Stadium': 65326, "Levi's Stadium": 68500, 'Lincoln Financial Field': 69176,
  'Lumen Field': 68740, 'GEHA Field at Arrowhead Stadium': 76416, 'BC Place': 54500,
  'BMO Field': 45500, 'Estadio Banorte': 87523, 'Estadio Akron': 49850, 'Estadio BBVA': 53500
};

// Bản đồ "cặp đội (đã chuẩn hóa) → venue" cho các ngày cho trước (gồm ±1 ngày)
async function espnVenueMap(dates) {
  const map = new Map();
  for (const d of dates) {
    const data = await cachedListJson(`${ESPN}/scoreboard?dates=${d.replace(/-/g, '')}`);
    for (const e of (data?.events || [])) {
      const comp = e.competitions?.[0];
      const v = comp?.venue;
      if (!v) continue;
      const key = (comp.competitors || []).map(c => normalizeTeam(c.team?.displayName)).sort().join('|');
      if (key && !map.has(key)) map.set(key, v);
    }
  }
  return map;
}

/** Điền venue/city/country/capacity cho các trận còn thiếu (xử lý tối đa maxDates ngày/lần) */
export async function enrichVenues(maxDates = 6) {
  await ensureSchema();
  const q = sql();
  const rows = await q`SELECT id, home, away, date_utc FROM matches WHERE venue = '' ORDER BY date_utc`;
  if (!rows.length) return { enriched: 0 };

  const byDate = new Map();
  for (const m of rows) {
    const d = new Date(m.date_utc).toISOString().slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(m);
  }

  let enriched = 0, processed = 0;
  for (const [d, ms] of byDate) {
    if (processed >= maxDates) break;
    processed++;
    const base = new Date(d + 'T12:00:00Z');
    const neighbor = [-1, 0, 1].map(o => new Date(base.getTime() + o * 86400_000).toISOString().slice(0, 10));
    const vmap = await espnVenueMap(neighbor);
    for (const m of ms) {
      const key = [normalizeTeam(m.home), normalizeTeam(m.away)].sort().join('|');
      const v = vmap.get(key);
      if (!v) continue;
      const country = HOST_VI[v.address?.country] || v.address?.country || '';
      const cap = STADIUM_CAP[v.fullName] ?? null;
      await q`UPDATE matches SET venue = ${v.fullName}, city = ${v.address?.city || ''},
              country = ${country}, capacity = ${cap}, updated_at = now() WHERE id = ${m.id}`;
      enriched++;
    }
  }
  return { enriched, remaining: rows.length - enriched };
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
    country: r.country,
    capacity: r.capacity,
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

/* ====================================================================
 *  VUA PHÁ LƯỚI — tổng hợp người ghi bàn từ các trận đã kết thúc.
 *  Diễn biến lấy từ ESPN/TheSportsDB (miễn phí). Bàn phản lưới KHÔNG tính.
 *  Kết quả cache trong bảng meta (~5 phút) cho nhanh.
 * ==================================================================== */
const SCORE_TYPES = ['goal', 'penalty']; // phản lưới (own_goal) không tính vua phá lưới

export async function getTopScorers(force = false) {
  await ensureSchema();
  const q = sql();

  const at = Number(await getMeta('top_scorers_at')) || 0;
  if (!force && Date.now() - at < 5 * 60_000) {
    const cached = await getMeta('top_scorers');
    if (cached) {
      return { scorers: JSON.parse(cached), updatedAt: new Date(at).toISOString(), cached: true };
    }
  }

  const matches = await q`
    SELECT * FROM matches
    WHERE status = 'Kết thúc' AND home_goals IS NOT NULL AND away_goals IS NOT NULL`;

  const tally = new Map();
  for (const m of matches) {
    const total = (Number(m.home_goals) || 0) + (Number(m.away_goals) || 0);
    if (total === 0) continue;

    // Ưu tiên dùng diễn biến đã cache (match_details) nếu đủ số bàn
    let events = null;
    const md = await q`SELECT events FROM match_details WHERE match_id = ${m.id}`;
    const goalCnt = arr => (arr || []).filter(e => ['goal', 'penalty', 'own_goal'].includes(e.type)).length;
    if (md.length && goalCnt(md[0].events) >= total) {
      events = md[0].events;
    } else {
      for (const fetcher of [fetchMatchEventsFromESPN, fetchMatchEventsFromTSDB]) {
        try {
          const r = await fetcher(m);
          if (r && r.events.length) {
            events = r.events;
            if (goalCnt(r.events) >= total) break;
          }
        } catch { /* bỏ qua, thử nguồn kế */ }
      }
    }

    for (const ev of (events || [])) {
      if (!SCORE_TYPES.includes(ev.type)) continue;
      const teamEn = normalizeTeam(ev.team === 'away' ? m.away : m.home);
      const name = ev.player || '?';
      const cur = tally.get(name) || { player: name, team: teamEn, goals: 0, pens: 0 };
      cur.goals++;
      if (ev.type === 'penalty') cur.pens++;
      tally.set(name, cur);
    }
  }

  const scorers = [...tally.values()]
    .map(s => ({
      player: s.player,
      goals: s.goals,
      pens: s.pens,
      team: s.team,
      vi: TEAM_MAP[s.team]?.vi || s.team,
      flag: TEAM_MAP[s.team]?.flag || '⚽'
    }))
    .sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player))
    .slice(0, 40);

  await setMeta('top_scorers', JSON.stringify(scorers));
  await setMeta('top_scorers_at', Date.now());
  return { scorers, updatedAt: new Date().toISOString(), cached: false };
}