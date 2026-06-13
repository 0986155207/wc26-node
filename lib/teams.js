/************************************************************************
 *  lib/teams.js — 12 bảng đấu chính thức World Cup 2026 (48 đội)
 ************************************************************************/

export const TEAMS = [
  // { group, en (khớp API), vi, flag }
  { group: 'A', en: 'Mexico',                 vi: 'Mexico',               flag: '🇲🇽' },
  { group: 'A', en: 'South Africa',           vi: 'Nam Phi',              flag: '🇿🇦' },
  { group: 'A', en: 'Korea Republic',         vi: 'Hàn Quốc',             flag: '🇰🇷' },
  { group: 'A', en: 'Czechia',                vi: 'CH Séc',               flag: '🇨🇿' },

  { group: 'B', en: 'Canada',                 vi: 'Canada',               flag: '🇨🇦' },
  { group: 'B', en: 'Bosnia and Herzegovina', vi: 'Bosnia & Herzegovina', flag: '🇧🇦' },
  { group: 'B', en: 'Qatar',                  vi: 'Qatar',                flag: '🇶🇦' },
  { group: 'B', en: 'Switzerland',            vi: 'Thụy Sĩ',              flag: '🇨🇭' },

  { group: 'C', en: 'Brazil',                 vi: 'Brazil',               flag: '🇧🇷' },
  { group: 'C', en: 'Morocco',                vi: 'Morocco',              flag: '🇲🇦' },
  { group: 'C', en: 'Haiti',                  vi: 'Haiti',                flag: '🇭🇹' },
  { group: 'C', en: 'Scotland',               vi: 'Scotland',             flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },

  { group: 'D', en: 'USA',                    vi: 'Mỹ',                   flag: '🇺🇸' },
  { group: 'D', en: 'Paraguay',               vi: 'Paraguay',             flag: '🇵🇾' },
  { group: 'D', en: 'Türkiye',                vi: 'Thổ Nhĩ Kỳ',           flag: '🇹🇷' },
  { group: 'D', en: 'Australia',              vi: 'Úc',                   flag: '🇦🇺' },

  { group: 'E', en: 'Germany',                vi: 'Đức',                  flag: '🇩🇪' },
  { group: 'E', en: 'Curaçao',                vi: 'Curaçao',              flag: '🇨🇼' },
  { group: 'E', en: 'Ivory Coast',            vi: 'Bờ Biển Ngà',          flag: '🇨🇮' },
  { group: 'E', en: 'Ecuador',                vi: 'Ecuador',              flag: '🇪🇨' },

  { group: 'F', en: 'Netherlands',            vi: 'Hà Lan',               flag: '🇳🇱' },
  { group: 'F', en: 'Japan',                  vi: 'Nhật Bản',             flag: '🇯🇵' },
  { group: 'F', en: 'Sweden',                 vi: 'Thụy Điển',            flag: '🇸🇪' },
  { group: 'F', en: 'Tunisia',                vi: 'Tunisia',              flag: '🇹🇳' },

  { group: 'G', en: 'Belgium',                vi: 'Bỉ',                   flag: '🇧🇪' },
  { group: 'G', en: 'Egypt',                  vi: 'Ai Cập',               flag: '🇪🇬' },
  { group: 'G', en: 'Iran',                   vi: 'Iran',                 flag: '🇮🇷' },
  { group: 'G', en: 'New Zealand',            vi: 'New Zealand',          flag: '🇳🇿' },

  { group: 'H', en: 'Spain',                  vi: 'Tây Ban Nha',          flag: '🇪🇸' },
  { group: 'H', en: 'Cape Verde',             vi: 'Cape Verde',           flag: '🇨🇻' },
  { group: 'H', en: 'Saudi Arabia',           vi: 'Ả Rập Xê Út',          flag: '🇸🇦' },
  { group: 'H', en: 'Uruguay',                vi: 'Uruguay',              flag: '🇺🇾' },

  { group: 'I', en: 'France',                 vi: 'Pháp',                 flag: '🇫🇷' },
  { group: 'I', en: 'Senegal',                vi: 'Senegal',              flag: '🇸🇳' },
  { group: 'I', en: 'Iraq',                   vi: 'Iraq',                 flag: '🇮🇶' },
  { group: 'I', en: 'Norway',                 vi: 'Na Uy',                flag: '🇳🇴' },

  { group: 'J', en: 'Argentina',              vi: 'Argentina',            flag: '🇦🇷' },
  { group: 'J', en: 'Algeria',                vi: 'Algeria',              flag: '🇩🇿' },
  { group: 'J', en: 'Austria',                vi: 'Áo',                   flag: '🇦🇹' },
  { group: 'J', en: 'Jordan',                 vi: 'Jordan',               flag: '🇯🇴' },

  { group: 'K', en: 'Portugal',               vi: 'Bồ Đào Nha',           flag: '🇵🇹' },
  { group: 'K', en: 'DR Congo',               vi: 'CHDC Congo',           flag: '🇨🇩' },
  { group: 'K', en: 'Uzbekistan',             vi: 'Uzbekistan',           flag: '🇺🇿' },
  { group: 'K', en: 'Colombia',               vi: 'Colombia',             flag: '🇨🇴' },

  { group: 'L', en: 'England',                vi: 'Anh',                  flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { group: 'L', en: 'Croatia',                vi: 'Croatia',              flag: '🇭🇷' },
  { group: 'L', en: 'Ghana',                  vi: 'Ghana',                flag: '🇬🇭' },
  { group: 'L', en: 'Panama',                 vi: 'Panama',               flag: '🇵🇦' }
];

/** Tên biến thể từ các nguồn dữ liệu → tên chuẩn */
const ALIASES = {
  'south korea': 'korea republic',
  'korea, republic of': 'korea republic',
  'czech republic': 'czechia',
  'united states': 'usa',
  'united states of america': 'usa',
  'turkey': 'türkiye',
  'turkiye': 'türkiye',
  "cote d'ivoire": 'ivory coast',
  "côte d'ivoire": 'ivory coast',
  'cabo verde': 'cape verde',
  'congo dr': 'dr congo',
  'democratic republic of the congo': 'dr congo',
  'curacao': 'curaçao',
  'bosnia-herzegovina': 'bosnia and herzegovina',
  'ir iran': 'iran',
  'kingdom of saudi arabia': 'saudi arabia'
};

const BY_LOWER = new Map(TEAMS.map(t => [t.en.toLowerCase(), t]));

/** Chuẩn hóa tên đội từ nguồn ngoài về đúng chính tả trong danh sách 48 đội */
export function normalizeTeam(name) {
  if (!name) return '';
  const key = String(name).toLowerCase().trim();
  const std = ALIASES[key] || key;
  const found = BY_LOWER.get(std);
  return found ? found.en : name;
}

/** Map tra cứu nhanh: en → { group, vi, flag } */
export const TEAM_MAP = Object.fromEntries(
  TEAMS.map(t => [t.en, { group: t.group, vi: t.vi, flag: t.flag }])
);
