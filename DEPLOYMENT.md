# Triển khai & Vận hành (Cloudflare Workers)

Tài liệu này hướng dẫn build, deploy và vận hành ứng dụng này **không phụ thuộc Lovable** —
build bằng tay (hoặc CI), deploy thẳng lên Cloudflare Workers (miễn phí, không giới hạn
bandwidth ở mức sử dụng thông thường). Database/Storage/Auth vẫn dùng Supabase như cũ,
**không có gì thay đổi, không mất dữ liệu**.

> Tóm tắt kiến trúc: Cloudflare Workers chỉ host **giao diện + server logic** (SSR,
> server functions). Toàn bộ **dữ liệu thật** (hồ sơ lô hàng, ảnh, người dùng) vẫn nằm
> trên **Supabase** — project Supabase hiện tại của bạn không đổi gì cả.

---

## 1. Việc cần làm một lần đầu tiên

### 1.1. Cài Node.js và lấy code

Cần Node.js 20+ (khuyến nghị 22+). Giải nén file zip vào một thư mục, sau đó:

```bash
cd QCSample-main
npm install
```

Lệnh này sẽ tạo lại `package-lock.json` (file lock cũ đã bị xóa vì chứa các package
riêng của Lovable không còn dùng).

### 1.2. Tạo file `.env` cho local dev

Project đã có file `.env.example` làm mẫu. Copy nó thành `.env` và điền giá trị thật
(lấy từ Supabase Dashboard → **Project Settings → API**):

```bash
cp .env.example .env
```

Điền các giá trị sau (project Supabase của bạn **giữ nguyên**, ID là `ajngesgzertptcczbhtf`
như cấu hình hiện có trong `supabase/config.toml`):

| Biến | Lấy ở đâu |
|---|---|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API → anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role key (**bí mật, không chia sẻ**) |

### 1.3. Chạy thử ở máy local

```bash
npm run dev
```

Mở `http://localhost:3000` (hoặc cổng Vite hiện trong terminal). Toàn bộ tính năng
(đăng nhập, upload ảnh, danh sách hồ sơ...) hoạt động giống hệt như trước, vì backend
vẫn là Supabase project cũ.

---

## 2. Triển khai lên Cloudflare (miễn phí)

### 2.1. Tạo tài khoản Cloudflare

Vào [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) tạo tài khoản miễn phí
nếu chưa có. Không cần thẻ tín dụng cho free tier.

### 2.2. Đăng nhập Wrangler (CLI deploy của Cloudflare)

```bash
npx wrangler login
```

Lệnh này mở trình duyệt để bạn xác thực — sau đó Wrangler nhớ phiên đăng nhập trên máy
bạn.

### 2.3. Đặt tên Worker

Mở `wrangler.jsonc` ở thư mục gốc, sửa trường `"name"` thành tên bạn muốn (sẽ trở
thành `<name>.workers.dev`):

```jsonc
{
  "name": "ten-cua-ban", // <-- sửa dòng này
  ...
}
```

### 2.4. Khai báo biến môi trường & secret trên Cloudflare

Đây là bước **quan trọng nhất** — nếu thiếu, app sẽ báo lỗi "Missing Supabase
environment variable(s)" khi chạy trên Cloudflare.

**Cách 1 — qua dashboard (đơn giản nhất):**

1. Vào **Workers & Pages** → chọn Worker của bạn (xuất hiện sau lần deploy đầu) →
   **Settings → Variables and Secrets**.
2. Thêm các biến dạng **Text** (không cần mã hoá vì không nhạy cảm — publishable key
   được thiết kế để public):
   - `SUPABASE_URL`
   - `VITE_SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Thêm 1 biến dạng **Secret** (mã hoá, không hiển thị lại sau khi lưu):
   - `SUPABASE_SERVICE_ROLE_KEY` — **bắt buộc** cho các chức năng quản trị (xem/xoá
     người dùng, đổi mật khẩu...) trong trang Cài Đặt.
4. Bấm **Deploy** để áp dụng.

**Cách 2 — qua dòng lệnh (cho CI/CD hoặc nhanh hơn):**

```bash
# Các biến không nhạy cảm — set trực tiếp trong wrangler.jsonc dưới khoá "vars",
# hoặc dùng lệnh dưới để set qua CLI (sẽ lưu local rồi đẩy khi deploy):
npx wrangler secret put SUPABASE_URL
npx wrangler secret put VITE_SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put VITE_SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Mỗi lệnh sẽ hỏi bạn dán giá trị (không hiện ra màn hình khi gõ/dán).

> Lưu ý: dù dùng `wrangler secret put` cho mọi biến (kể cả publishable key) cũng không
> sao — `secret` chỉ khác `vars` ở việc giá trị không hiển thị lại trong dashboard, bản
> chất Worker code đọc cả hai loại giống nhau qua `process.env`.

### 2.5. Build và deploy

```bash
npm run deploy
```

Lệnh này chạy `vite build` (build ra `.output/`) rồi `wrangler deploy` (đẩy lên
Cloudflare). Sau khi xong, terminal in ra URL dạng
`https://ten-cua-ban.workers.dev` — đây là địa chỉ app của bạn.

### 2.6. (Tuỳ chọn) Gắn domain riêng

Trong dashboard Worker → **Settings → Domains & Routes → Add → Custom domain**, nhập
domain bạn đã quản lý trên Cloudflare (hoặc trỏ DNS domain ngoài về Cloudflare trước).

---

## 3. Triển khai tự động khi push code lên GitHub (khuyến nghị)

Để không cần chạy `npm run deploy` bằng tay mỗi lần sửa code:

1. Đẩy code lên 1 repository GitHub (private hoặc public đều được, miễn phí).
2. Trong Cloudflare dashboard: **Workers & Pages → Create → Workers → Import a
   repository** (hoặc tương tự, tuỳ phiên bản UI hiện tại của Cloudflare — giao diện
   này có thể thay đổi, tìm mục "Connect to Git" nếu không thấy đúng tên).
3. Chọn repo, nhánh (thường là `main`).
4. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
5. Thêm toàn bộ biến môi trường/secret như bước 2.4 trong phần cấu hình của project
   này trên Cloudflare (không phải trên GitHub).
6. Từ giờ, mỗi lần push lên nhánh `main`, Cloudflare tự build và deploy.

---

## 4. Những gì đã thay đổi so với bản Lovable (và vì sao an toàn)

| Trước (Lovable) | Sau (tự host) | Ảnh hưởng |
|---|---|---|
| `@lovable.dev/vite-tanstack-config` đóng gói cấu hình Vite | `vite.config.ts` viết rõ từng plugin (`nitro`, `tanstackStart`, Tailwind, tsconfig-paths) | Không — cùng plugin, chỉ tường minh hơn |
| Build target Cloudflare ẩn trong config Lovable | `nitro({ preset: "cloudflare_module" })` tường minh trong `vite.config.ts` | Không — đây chính là target mà bản Lovable đã dùng |
| Nút "Continue with Google" gọi `@lovable.dev/cloud-auth-js` | Gọi trực tiếp `supabase.auth.signInWithOAuth({ provider: "google" })` | Không — cùng kết quả, chuẩn Supabase (xem mục 5 nếu Google login chưa từng được cấu hình) |
| Báo lỗi thiếu env nhắc "Connect Supabase in Lovable Cloud" | Báo lỗi nhắc đặt biến môi trường trực tiếp | Không — chỉ đổi nội dung thông báo |
| Build/deploy qua giao diện Lovable | `npm run deploy` hoặc Cloudflare Git integration | Không — cùng kết quả cuối (Cloudflare Workers), chỉ đổi người bấm nút |
| **Database / Storage / Auth (Supabase)** | **Không đổi gì** | Không có rủi ro — đây là phần dữ liệu thật, vẫn ở project Supabase `ajngesgzertptcczbhtf` |

Toàn bộ giao diện, tính năng, dữ liệu, và trải nghiệm người dùng giữ nguyên 100%. Phần
duy nhất thay đổi là **ai/cái gì chạy lệnh build & deploy** — trước là nền tảng
Lovable, giờ là chính bạn (hoặc Cloudflare Git integration) chạy trực tiếp.

---

## 5. Lưu ý quan trọng về nút "Continue with Google"

Nút này gọi `supabase.auth.signInWithOAuth({ provider: "google" })` — đây hoạt động
**chỉ khi** Google đã được bật như một OAuth provider trong Supabase project của bạn
(**Authentication → Providers → Google** trên Supabase Dashboard, cần Client ID/Secret
từ Google Cloud Console). Nếu trước đây nút này hoạt động qua Lovable, rất có thể
Lovable đã tự cấu hình provider này giùm bạn trong Supabase — sau khi đổi nền tảng,
**kiểm tra lại** mục đó trên Supabase Dashboard; nếu Google provider chưa được bật,
bật nó lên (miễn phí, không cần đổi gì khác trong code) để nút tiếp tục hoạt động.
Đăng nhập bằng email/mật khẩu (mặc định, mục "Quick Register"...) **không bị ảnh
hưởng** bởi việc này, vẫn hoạt động bình thường ngay cả khi bạn chưa kiểm tra mục này.

---

## 6. Khắc phục sự cố thường gặp

**"Missing Supabase environment variable(s)" khi mở app trên Cloudflare**
→ Chưa khai báo đủ biến ở bước 2.4. Vào Settings → Variables and Secrets kiểm tra lại
cho đủ cả 5 biến (kể cả `VITE_` và không có `VITE_`).

**Trang quản trị (xoá người dùng, đổi mật khẩu) báo lỗi "Forbidden" hoặc 500**
→ Thiếu `SUPABASE_SERVICE_ROLE_KEY`, hoặc tài khoản đăng nhập chưa có role `admin`
(role này được quản lý trong bảng `user_roles` trên Supabase — không liên quan tới
việc đổi nền tảng).

**`wrangler deploy` báo lỗi không tìm thấy `.output`**
→ Quên build trước khi deploy. Luôn dùng `npm run deploy` (đã gộp cả 2 bước) thay vì
chạy `wrangler deploy` đơn lẻ.

**Muốn xem log lỗi thực tế khi app đang chạy trên Cloudflare**
→ Vào Worker trong dashboard → tab **Logs** (cần bật **Observability** — đã được bật
sẵn trong `wrangler.jsonc` của project này), hoặc chạy `npx wrangler tail` từ máy bạn
để xem log theo thời gian thực.

**Muốn quay lại preview giống Lovable trước khi deploy thật**
→ Chạy `npm run dev` (giống cũ) để xem trên máy, hoặc `npx wrangler dev` để giả lập
chính xác runtime Cloudflare Workers ngay trên máy bạn trước khi deploy.

---

## 7. Chi phí

Ở mức sử dụng của một ứng dụng nội bộ/vừa phải, toàn bộ phần hạ tầng dưới đây có chi
phí **0 đồng**:

- **Cloudflare Workers (Free)**: 100.000 request/ngày, bandwidth không giới hạn.
- **Supabase (Free)**: 500MB database, 1GB file storage, 50.000 monthly active users
  — kiểm tra lại hạn mức hiện tại trên Supabase Dashboard vì các mốc này có thể thay
  đổi theo thời gian.

Nếu trong tương lai lượng dữ liệu/người dùng vượt ngưỡng free tier của Supabase (ví
dụ nhiều ảnh hơn 1GB), bạn chỉ cần nâng cấp **riêng phần Supabase** — không liên quan
gì đến việc đã rời Lovable hay đang ở Cloudflare.
