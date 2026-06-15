/************************************************************************
 *  lib/gemini.js — Gemini 2.5 Flash qua SDK @google/genai
 *  1. predictMatches()   — dự đoán tỷ số + xác suất (structured JSON)
 *  2. enrichAttendance() — Google Search grounding: sân + số khán giả
 *  3. fetchScoresViaAI() — dự phòng tra tỷ số khi không có API token
 ************************************************************************/

import { GoogleGenAI, Type } from '@google/genai';
import { sql, ensureSchema } from './db.js';
import { normalizeTeam, TEAM_MAP } from './teams.js';
import { fetchMatchEventsFromESPN, fetchMatchEventsFromTSDB } from './football.js';
import { geminiCall } from './ratelimit.js';

const MODEL = 'gemini-3.5-flash';

let _ai = null;
function ai() {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Thiếu GEMINI_API_KEY trong biến môi trường.');
    }
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

/** Trích JSON từ câu trả lời có thể kèm văn bản / ```json``` */
function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* thử cách khác */ }
  const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* bỏ */ } }
  return null;
}

/* ====================================================================
 *  1. DỰ ĐOÁN — tỷ số, số bàn thắng, xác suất thắng/hòa/thua
 * ==================================================================== */

export async function predictMatches() {
  await ensureSchema();
  const q = sql();

  // Trận trong 48 giờ tới, chưa đá, chưa có dự đoán (tối đa 12 trận/lần)
  const targets = await q`
    SELECT m.* FROM matches m
    LEFT JOIN predictions p ON p.match_id = m.id
    WHERE p.match_id IS NULL
      AND m.status = 'Sắp diễn ra'
      AND m.date_utc BETWEEN now() - interval '2 hours'
                         AND now() + interval '48 hours'
    ORDER BY m.date_utc
    LIMIT 12`;

  if (!targets.length) {
    return { count: 0, message: 'Không có trận mới nào cần dự đoán trong 48 giờ tới.' };
  }

  const standings = await computeStandingsText(q);
  const matchesText = targets
    .map(m => `${m.id} | ${m.home} vs ${m.away} | Bảng ${m.group_name} | ${m.date_utc.toISOString?.() || m.date_utc}`)
    .join('\n');

  const response = await geminiCall(() => ai().models.generateContent({
    model: MODEL,
    contents:
`Bạn là chuyên gia phân tích bóng đá World Cup 2026 (48 đội, 12 bảng, tại Mỹ - Canada - Mexico).

BẢNG XẾP HẠNG HIỆN TẠI:
${standings || '(giải mới bắt đầu, chưa có kết quả)'}

CÁC TRẬN CẦN DỰ ĐOÁN:
${matchesText}

Với MỖI trận, dự đoán: tỷ số cụ thể (homeGoals, awayGoals), xác suất phần trăm
(probHome + probDraw + probAway = 100), và một câu nhận định ngắn bằng TIẾNG VIỆT
(dưới 30 từ, nêu lý do chính). Dựa trên sức mạnh đội hình, phong độ, lịch sử đối đầu.
Giữ nguyên matchId như danh sách.`,
    config: {
      // Gemini 3.x: không chỉnh temperature/top_p/top_k — đã tối ưu cho mặc định
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            matchId:   { type: Type.STRING },
            homeGoals: { type: Type.INTEGER },
            awayGoals: { type: Type.INTEGER },
            probHome:  { type: Type.INTEGER },
            probDraw:  { type: Type.INTEGER },
            probAway:  { type: Type.INTEGER },
            comment:   { type: Type.STRING }
          },
          required: ['matchId', 'homeGoals', 'awayGoals',
                     'probHome', 'probDraw', 'probAway', 'comment']
        }
      }
    }
  }), 'predict');

  const preds = extractJson(response.text) || [];
  const valid = new Set(targets.map(m => String(m.id)));
  let count = 0;

  for (const p of preds) {
    if (!valid.has(String(p.matchId))) continue;
    await q`
      INSERT INTO predictions
        (match_id, pred_home, pred_away, prob_home, prob_draw, prob_away, comment)
      VALUES (${p.matchId}, ${p.homeGoals}, ${p.awayGoals},
              ${p.probHome}, ${p.probDraw}, ${p.probAway}, ${p.comment})
      ON CONFLICT (match_id) DO NOTHING`;
    count++;
  }

  return { count, message: `🤖 Gemini đã dự đoán ${count} trận sắp diễn ra.` };
}

async function computeStandingsText(q) {
  const rows = await q`
    SELECT group_name, home, away, home_goals, away_goals FROM matches
    WHERE stage = 'Vòng bảng' AND status IN ('Kết thúc', 'ĐANG ĐÁ', 'Nghỉ giữa hiệp')
      AND home_goals IS NOT NULL AND away_goals IS NOT NULL`;
  const t = {};
  const touch = (name, g) => (t[name] ??= { g, p: 0, pts: 0, gd: 0 });
  for (const m of rows) {
    const h = touch(m.home, m.group_name), a = touch(m.away, m.group_name);
    h.p++; a.p++;
    h.gd += m.home_goals - m.away_goals;
    a.gd += m.away_goals - m.home_goals;
    if (m.home_goals > m.away_goals) h.pts += 3;
    else if (m.home_goals < m.away_goals) a.pts += 3;
    else { h.pts++; a.pts++; }
  }
  return Object.entries(t)
    .sort(([, x], [, y]) => x.g.localeCompare(y.g) || y.pts - x.pts || y.gd - x.gd)
    .map(([name, s]) => `Bảng ${s.g} | ${name}: ${s.p} trận, ${s.pts} điểm, hiệu số ${s.gd}`)
    .join('\n');
}

/* ====================================================================
 *  2. SỐ KHÁN GIẢ & SÂN — Google Search grounding
 * ==================================================================== */

export async function enrichAttendance() {
  await ensureSchema();
  const q = sql();

  const targets = await q`
    SELECT id, home, away, date_utc FROM matches
    WHERE status = 'Kết thúc' AND (attendance IS NULL OR venue = '')
    ORDER BY date_utc DESC
    LIMIT 8`;

  if (!targets.length) {
    return { count: 0, message: 'Tất cả trận đã có đủ thông tin sân & khán giả.' };
  }

  const listText = targets
    .map(t => `${t.id} | ${t.home} vs ${t.away} | ${new Date(t.date_utc).toISOString().slice(0, 10)}`)
    .join('\n');

  const response = await geminiCall(() => ai().models.generateContent({
    model: MODEL,
    contents:
`Hãy dùng Google Search tìm thông tin chính thức các trận World Cup 2026 sau:
${listText}

Với mỗi trận, tìm: tên sân vận động (venue), thành phố (city), và số khán giả
chính thức đến sân (attendance, số nguyên).
CHỈ trả về JSON array, không thêm chữ nào khác, định dạng:
[{"matchId":"...","venue":"...","city":"...","attendance":72000}]
Nếu không tìm thấy khán giả thì để attendance = null.`,
    config: {
      tools: [{ googleSearch: {} }] // không dùng cùng responseSchema → tự parse JSON
    }
  }), 'attendance');

  const results = extractJson(response.text) || [];
  const valid = new Set(targets.map(t => String(t.id)));
  let count = 0;

  for (const r of results) {
    if (!valid.has(String(r.matchId))) continue;
    await q`
      UPDATE matches SET
        venue      = COALESCE(NULLIF(${r.venue || ''}, ''), venue),
        city       = COALESCE(NULLIF(${r.city || ''}, ''), city),
        attendance = COALESCE(${r.attendance ?? null}, attendance),
        updated_at = now()
      WHERE id = ${r.matchId}`;
    count++;
  }

  return { count, message: `👥 Đã bổ sung sân & khán giả cho ${count} trận.` };
}

/* ====================================================================
 *  4. CHI TIẾT TRẬN ĐẤU — diễn biến, cầu thủ ghi bàn, phút (Google Search)
 *     Có cache trong DB: trận đã kết thúc lấy 1 lần; trận đang đá làm
 *     mới sau 60 giây.
 * ==================================================================== */

// Tóm tắt tiếng Việt tự dựng từ diễn biến thật (không cần AI) — dùng khi đã có
// dữ liệu từ football-data.org hoặc khi Gemini quá tải.
function autoSummary(m, events) {
  // Không nhắc lại tỷ số (đã có ở phần đầu popup) để tránh lệch khi đang đá.
  const viName = en => (TEAM_MAP[en]?.vi || en);
  const live = m.status !== 'Kết thúc';
  const total = (Number(m.home_goals) || 0) + (Number(m.away_goals) || 0);
  const goals = (events || []).filter(e => ['goal', 'penalty', 'own_goal'].includes(e.type));

  if (goals.length) {
    const tag = t => (t === 'penalty' ? ' (pen)' : t === 'own_goal' ? ' (phản lưới)' : '');
    const list = goals.map(g => {
      const team = viName(g.team === 'away' ? m.away : m.home);
      const min = g.minute != null ? ` ${g.minute}'` : '';
      return `${g.player || '?'}${min} — ${team}${tag(g.type)}`;
    }).join('; ');
    return `Người ghi bàn: ${list}.`;
  }
  if (total === 0) {
    return live ? 'Trận đang diễn ra — chưa có bàn thắng.'
                : 'Hai đội hòa nhau, không có bàn thắng.';
  }
  // Có bàn thắng nhưng nguồn dữ liệu chưa ghi nhận tên người ghi
  return live ? 'Trận đang diễn ra — đang cập nhật người ghi bàn.'
              : 'Chưa lấy được tên cầu thủ ghi bàn cho trận này (sẽ cập nhật khi có dữ liệu).';
}

// Tra cứu diễn biến qua Gemini + Google Search (dự phòng khi football-data
// không có chi tiết). Trả { events, summary }; ném lỗi nếu Gemini quá tải.
async function geminiMatchSearch(m) {
  const dateStr = new Date(m.date_utc).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const scoreStr = (m.home_goals ?? '?') + '-' + (m.away_goals ?? '?');

  const response = await geminiCall(() => ai().models.generateContent({
    model: MODEL,
    contents:
`Hãy dùng Google Search tìm diễn biến chính của trận World Cup 2026:
${m.home} ${scoreStr} ${m.away} (ngày ${dateStr}${m.venue ? ', sân ' + m.venue : ''}).

Tìm các sự kiện: bàn thắng (ai ghi, phút thứ mấy, đội nào), phản lưới, phạt đền,
thẻ vàng, thẻ đỏ. Sau đó viết một đoạn tóm tắt diễn biến NGẮN bằng TIẾNG VIỆT
(2-4 câu, nêu các thời điểm bước ngoặt).

CHỈ trả về JSON thuần, không thêm chữ nào khác, định dạng:
{
  "events": [
    {"minute": 23, "team": "home", "player": "Tên cầu thủ", "type": "goal"}
  ],
  "summary": "Tóm tắt tiếng Việt..."
}

Quy ước:
- "team": "home" cho ${m.home}, "away" cho ${m.away}.
- "type": một trong "goal" (bàn thường), "penalty" (phạt đền),
  "own_goal" (phản lưới), "yellow" (thẻ vàng), "red" (thẻ đỏ).
- "minute": số nguyên (phút). Sắp xếp events theo phút tăng dần.
- Nếu KHÔNG tìm thấy dữ liệu đáng tin cậy, để "events": [] và ghi rõ trong "summary"
  rằng chưa có thông tin chi tiết. TUYỆT ĐỐI không bịa tên cầu thủ.`,
    config: { tools: [{ googleSearch: {} }] }
  }), 'match-details');

  const parsed = extractJson(response.text) || {};
  return {
    events: Array.isArray(parsed.events) ? parsed.events : [],
    summary: parsed.summary || ''
  };
}

export async function getMatchDetails(matchId) {
  await ensureSchema();
  const q = sql();

  const rows = await q`SELECT * FROM matches WHERE id = ${matchId}`;
  if (!rows.length) throw new Error('Không tìm thấy trận đấu.');
  const m = rows[0];

  const live = ['ĐANG ĐÁ', 'Nghỉ giữa hiệp'].includes(m.status);
  const done = m.status === 'Kết thúc';
  if (!live && !done) {
    return { matchId, summary: 'Trận đấu chưa diễn ra.', events: [], status: m.status };
  }

  // Kiểm tra cache
  const cached = await q`SELECT * FROM match_details WHERE match_id = ${matchId}`;
  if (cached.length) {
    const ageMs = Date.now() - new Date(cached[0].generated_at).getTime();
    // Trận đã xong → cache vĩnh viễn; trận đang đá → cache 60 giây
    if (done || ageMs < 60_000) {
      return {
        matchId,
        summary: cached[0].summary,
        events: cached[0].events,
        status: cached[0].status,
        cached: true
      };
    }
  }

  const hasGoals = arr => arr.some(e => ['goal', 'penalty', 'own_goal'].includes(e.type));
  const totalGoals = (Number(m.home_goals) || 0) + (Number(m.away_goals) || 0);

  // 1) Diễn biến THẬT từ các nguồn miễn phí (không tốn quota AI), thử lần lượt
  //    ESPN → TheSportsDB. Dừng ngay khi có bộ đủ người ghi bàn (hoặc trận 0-0);
  //    nếu chưa nguồn nào đủ, giữ bộ có nhiều sự kiện nhất (vd chỉ có thẻ phạt).
  let events = [];
  for (const [name, fetcher] of [['ESPN', fetchMatchEventsFromESPN], ['TheSportsDB', fetchMatchEventsFromTSDB]]) {
    try {
      const r = await fetcher(m);
      if (r && r.events.length) {
        if (totalGoals === 0 || hasGoals(r.events)) { events = r.events; break; }
        if (r.events.length > events.length) events = r.events;
      }
    } catch (e) {
      console.warn(`[match-details] ${name} lỗi:`, e.message);
    }
  }

  // 2) Tóm tắt. Đã có đủ người ghi bàn (hoặc trận 0-0) → dựng ngay, khỏi cần AI.
  //    Thiếu người ghi bàn → nhờ Gemini tra cứu, nhưng vẫn giữ sự kiện TheSportsDB
  //    (vd thẻ phạt) nếu Gemini không trả được.
  let summary;
  if (events.length && (totalGoals === 0 || hasGoals(events))) {
    summary = autoSummary(m, events);
  } else {
    try {
      const r = await geminiMatchSearch(m);
      if (r.events && r.events.length) events = r.events;
      summary = r.summary || autoSummary(m, events);
    } catch (e) {
      console.warn('[match-details] Gemini lỗi, dùng tóm tắt tối giản:', e.message);
      summary = autoSummary(m, events);
    }
  }

  // Chỉ cache khi đã có đủ thông tin (tránh "khóa" lúc thiếu người ghi bàn để
  // lần sau còn thử lại khi nguồn dữ liệu / quota hồi phục).
  const complete = totalGoals === 0 || hasGoals(events);
  if (complete) {
    await q`
      INSERT INTO match_details (match_id, summary, events, status, generated_at)
      VALUES (${matchId}, ${summary}, ${JSON.stringify(events)}::jsonb, ${m.status}, now())
      ON CONFLICT (match_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        events  = EXCLUDED.events,
        status  = EXCLUDED.status,
        generated_at = now()`;
  }

  return { matchId, summary, events, status: m.status, cached: false };
}

/* ====================================================================
 *  5. DỰ PHÒNG — tra tỷ số qua Gemini khi không có FOOTBALL_DATA_TOKEN
 * ==================================================================== */

export async function fetchScoresViaAI() {
  const today = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  const response = await geminiCall(() => ai().models.generateContent({
    model: MODEL,
    contents:
`Hãy dùng Google Search tìm TẤT CẢ các trận World Cup 2026 diễn ra hôm nay
và hôm qua (hôm nay là ${today}, giờ Việt Nam), gồm cả trận đang đá.

CHỈ trả về JSON array, không thêm chữ nào khác, định dạng mỗi trận:
[{"home":"Mexico","away":"South Africa","homeGoals":2,"awayGoals":1,
"status":"FINISHED","group":"A","dateUTC":"2026-06-11T19:00:00Z",
"venue":"Estadio Azteca","city":"Mexico City","attendance":87000}]

Quy ước: status là một trong SCHEDULED / IN_PLAY / FINISHED.
Tên đội bằng tiếng Anh. Trận chưa đá thì homeGoals, awayGoals = null.`,
    config: { tools: [{ googleSearch: {} }] }
  }), 'fallback-scores');

  const list = extractJson(response.text) || [];
  return list.map(m => {
    const home = normalizeTeam(m.home);
    const away = normalizeTeam(m.away);
    return {
      id: `AI-${String(m.dateUTC || '').slice(0, 10)}-${home.replace(/\s/g, '')}-${away.replace(/\s/g, '')}`,
      dateUTC: m.dateUTC || new Date().toISOString(),
      stage: 'Vòng bảng',
      group: m.group || '',
      home, away,
      homeGoals: m.homeGoals ?? null,
      awayGoals: m.awayGoals ?? null,
      status: { SCHEDULED: 'Sắp diễn ra', IN_PLAY: 'ĐANG ĐÁ', FINISHED: 'Kết thúc' }[m.status] || 'Sắp diễn ra',
      venue: m.venue || '',
      city: m.city || '',
      attendance: m.attendance ?? null
    };
  });
}