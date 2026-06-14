/************************************************************************
 *  lib/ratelimit.js — Điều phối gọi Gemini để tránh vượt quota (429)
 *  - Hàng đợi toàn cục: các lệnh gọi Gemini xếp hàng, không bắn đồng thời
 *  - Giãn cách tối thiểu giữa 2 lần gọi (MIN_GAP_MS)
 *  - Tự thử lại khi gặp 429 (RESOURCE_EXHAUSTED) với thời gian chờ tăng dần
 *
 *  Lưu ý: trên môi trường serverless, biến toàn cục chỉ tồn tại trong
 *  phạm vi một instance đang "ấm". Điều này vẫn giúp giảm mạnh số lần
 *  bắn dồn trong cùng một instance — đủ cho nhu cầu của ứng dụng.
 ************************************************************************/

const MIN_GAP_MS = 1500;   // cách nhau ít nhất 1,5 giây giữa 2 lần gọi Gemini
const MAX_RETRY  = 3;      // số lần thử lại khi bị 429
const BASE_WAIT  = 4000;   // thời gian chờ cơ bản trước khi thử lại (ms)

let _chain = Promise.resolve();   // chuỗi hàng đợi
let _lastCallAt = 0;              // mốc thời gian lần gọi gần nhất

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function is429(err) {
  const s = err && (err.status || err.code);
  if (s === 429) return true;
  const msg = String(err && err.message || '');
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
      || msg.toLowerCase().includes('quota');
}

/**
 * Bọc một lệnh gọi Gemini để nó đi qua hàng đợi + tự thử lại.
 * @param {() => Promise<any>} fn  hàm thực hiện lệnh gọi Gemini
 * @param {string} label          nhãn để ghi log
 */
export function geminiCall(fn, label = 'gemini') {
  // Nối vào chuỗi: đảm bảo các lệnh chạy lần lượt, không đồng thời
  const run = _chain.then(async () => {
    // Giãn cách tối thiểu kể từ lần gọi trước
    const wait = MIN_GAP_MS - (Date.now() - _lastCallAt);
    if (wait > 0) await sleep(wait);

    let attempt = 0;
    while (true) {
      try {
        _lastCallAt = Date.now();
        return await fn();
      } catch (err) {
        if (is429(err) && attempt < MAX_RETRY) {
          attempt++;
          const back = BASE_WAIT * attempt; // 4s, 8s, 12s
          console.warn(`[ratelimit] ${label} bị 429, thử lại lần ${attempt} sau ${back}ms`);
          await sleep(back);
          continue;
        }
        throw err;
      }
    }
  });

  // Cập nhật chuỗi nhưng không để lỗi làm đứt hàng đợi cho request sau
  _chain = run.then(() => {}, () => {});
  return run;
}

/** Phân loại lỗi để trả thông báo thân thiện cho người dùng */
export function friendlyError(err) {
  if (is429(err)) {
    return 'Hạn mức AI (Gemini) tạm thời đã đầy. Vui lòng thử lại sau ít phút — '
         + 'những trận đã xem vẫn hiển thị ngay nhờ bộ nhớ đệm.';
  }
  return err && err.message ? err.message : 'Đã xảy ra lỗi.';
}