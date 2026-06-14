# ⚽ WORLD CUP 2026 LIVE — Node.js + Vercel

Ứng dụng theo dõi World Cup 2026 (Mỹ · Canada · Mexico, 11/6 – 19/7/2026):
lịch thi đấu mỗi ngày, tỷ số trực tiếp, 12 bảng đấu, sân vận động, số khán giả,
dự đoán AI (Gemini 2.5 Flash) và bảng xếp hạng tự động — tối ưu cho iPhone.

**Stack:** Node.js (ESM) · Vercel Serverless Functions · Neon PostgreSQL · `@google/genai` (Gemini 3.5 Flash)

---

## 📁 Cấu trúc dự án

```
wc26-node/
├── api/
│   ├── data.js        GET  /api/data        — toàn bộ dữ liệu (tự đồng bộ khi cũ > 60s)
│   ├── predict.js     POST /api/predict     — Gemini dự đoán trận sắp tới
│   └── daily.js       GET  /api/daily       — cron 6h sáng VN (sync + dự đoán + khán giả)
├── lib/
│   ├── teams.js       48 đội / 12 bảng + chuẩn hóa tên đội
│   ├── db.js          Kết nối Neon + tự tạo bảng
│   ├── football.js    Đồng bộ football-data.org + tính BXH
│   └── gemini.js      Dự đoán, tra khán giả, dự phòng tỷ số (gemini-3.5-flash)
├── public/
│   └── index.html     Giao diện mobile-first (gọi REST API)
├── package.json
├── vercel.json        Cron + cache headers
└── .env.example       Mẫu biến môi trường
```

---

## 🚀 Triển khai (10 phút)

### Bước 1 — Tạo database Neon (miễn phí)
1. Đăng ký tại https://console.neon.tech → tạo project (chọn region **Singapore** cho gần VN)
2. Vào **Connection Details** → chọn **Pooled connection** → copy chuỗi `postgresql://...`
   > ⚠️ Phải dùng bản **-pooler** thì serverless mới chạy ổn. Bảng sẽ tự tạo lần chạy đầu.

### Bước 2 — Lấy API key
| Key | Lấy ở đâu | Bắt buộc |
|---|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | ✅ (cho dự đoán & khán giả) |
| `FOOTBALL_DATA_TOKEN` | https://www.football-data.org/client/register | ◻️ Nên có (gói Free có World Cup). Bỏ trống thì dùng Gemini dự phòng |

### Bước 3 — Đẩy code lên GitHub
```bash
cd wc26-node
git init
git add .
git commit -m "World Cup 2026 Live"
git branch -M main
git remote add origin https://github.com/<tài-khoản>/wc26-node.git
git push -u origin main
```

### Bước 4 — Deploy lên Vercel
1. Vào https://vercel.com → **Add New → Project** → chọn repo `wc26-node`
2. Mục **Environment Variables**, thêm 4 biến (xem `.env.example`):
   `DATABASE_URL`, `GEMINI_API_KEY`, `FOOTBALL_DATA_TOKEN`, `CRON_SECRET`
3. Bấm **Deploy** → chờ ~30 giây → có link `https://wc26-node.vercel.app`

### Bước 5 — Nạp dữ liệu lần đầu
Mở `https://<domain>/api/data?refresh=1` một lần để kéo lịch + tỷ số về DB.
(Sau đó frontend tự làm mới, không cần làm lại.)

### Bước 6 — Cài lên iPhone như app thật
1. Mở link bằng **Safari**
2. Nút **Chia sẻ** → **"Thêm vào MH chính"**
3. Biểu tượng ⚽ xuất hiện — mở lên dùng toàn màn hình, tự cập nhật mỗi 60 giây.

---

## ⚙️ Phát triển ở máy (tùy chọn)

```bash
npm install
npm i -g vercel
cp .env.example .env     # điền các key vào .env
vercel dev               # chạy thử tại http://localhost:3000
```

---

## 🔔 Thông báo đẩy (Web Push)

App gửi 3 loại thông báo: **lịch đấu mỗi sáng**, **nhắc trước giờ bóng lăn 30 phút**, **kết quả sau trận**.

### Cấu hình (1 lần)
1. Tạo cặp khóa VAPID ở máy: `npx web-push generate-vapid-keys`
2. Thêm 3 biến môi trường trên Vercel (xem `.env.example`):
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` → rồi **Redeploy**

### ⚠️ Quan trọng với iPhone (quy định của Apple)
- Web Push trên iOS **chỉ hoạt động khi app đã "Thêm vào MH chính"** và mở **từ biểu tượng ⚽** (không phải tab Safari)
- Người dùng phải **bấm nút "Bật"** trong app (không thể tự bật) → app tự hiện hướng dẫn phù hợp
- Yêu cầu iOS 16.4 trở lên

### Lịch gửi thông báo
- **Cron Vercel** (`vercel.json`, gói Hobby chỉ cho 1 lần/ngày): chạy **0:00 UTC = 7h sáng VN** → gửi lịch đấu trong ngày + chạy Gemini buổi sáng.
- **Nhắc giờ bóng lăn & kết quả** cần kiểm tra thường xuyên hơn → dùng **cron ngoài miễn phí**:
  1. Đăng ký https://cron-job.org (miễn phí)
  2. Tạo job gọi `https://<domain>/api/daily` **mỗi 15 phút**
  3. Thêm Header: `Authorization: Bearer <CRON_SECRET>` (đúng giá trị `CRON_SECRET` đã đặt trên Vercel)
  > Endpoint `/api/daily` tự nhận biết: việc nặng (Gemini) chỉ chạy 1 lần buổi sáng,
  > còn đồng bộ tỷ số + gửi thông báo nhắc giờ/kết quả chạy mỗi lần được gọi (đã chống trùng).

## 🔄 Cơ chế "thời gian thực"

- **Không cần cron dày**: mỗi lần `/api/data` được gọi, server kiểm tra mốc `last_sync_ms`.
  Nếu dữ liệu cũ hơn **60 giây** thì tự đồng bộ lại từ football-data.org rồi mới trả về
  (kiểu *stale-while-revalidate*). Frontend gọi mỗi 60 giây → tỷ số luôn mới.
- **BXH "sống"**: tính lại mỗi request từ kết quả trong DB, gồm cả trận đang đá.
- **Cron 1 lần/ngày** (`vercel.json`): 23:00 UTC = **6h sáng VN** chạy `/api/daily`:
  đồng bộ + Gemini dự đoán 48h tới + tra Google Search bổ sung sân & khán giả.
  > Gói Vercel Hobby chỉ cho **1 cron/ngày** — thiết kế này đã tránh giới hạn đó.

## 🧠 Ghi chú kỹ thuật

- **`@google/genai` v2.8.0**: dùng `ai.models.generateContent({ model: 'gemini-3.5-flash', ... })`.
  Dự đoán dùng `responseSchema` (JSON có cấu trúc); tra khán giả dùng `tools:[{googleSearch:{}}]`
  rồi tự parse JSON. **Lưu ý Gemini 3.x**: không đặt `temperature`/`top_p`/`top_k` trong config
  — model đã tối ưu cho giá trị mặc định, đặt vào có thể giảm chất lượng suy luận.
- **Neon serverless driver** (`@neondatabase/serverless`): chạy trên Vercel Functions qua HTTP,
  không giữ kết nối TCP — hợp với môi trường serverless.
- **Chuẩn hóa tên đội** (`lib/teams.js`): khớp "South Korea"→"Korea Republic",
  "USA"/"United States", "Türkiye"/"Turkey"… để ghép đúng cờ và BXH.

## 🛠️ Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Không thấy trận nào | Mở `/api/data?refresh=1`; kiểm tra `DATABASE_URL` (phải là **pooler**) và `FOOTBALL_DATA_TOKEN` |
| Lỗi 500 ở `/api/data` | Xem **Vercel → Logs**; thường do thiếu/sai `DATABASE_URL` |
| Dự đoán báo lỗi | Kiểm tra `GEMINI_API_KEY`; gói free giới hạn lượt/phút, chờ 1 phút |
| Cron không chạy | Vercel chỉ kích hoạt cron ở môi trường **Production**; kiểm tra `CRON_SECRET` khớp |

---

> 💡 Bước mở rộng gợi ý: thêm `/api/zalo-webhook` để mỗi 6h sáng đẩy lịch đấu trong ngày
> vào Zalo OA — ghép thẳng vào hệ sinh thái số KP25.