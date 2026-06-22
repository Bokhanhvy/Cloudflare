# Hướng dẫn chi tiết: Đưa code lên GitHub → Deploy lên Cloudflare

Hướng dẫn này dành cho người **chưa từng làm việc này bao giờ**, đi từng bước một,
không bỏ qua bước nào. Làm theo đúng thứ tự từ trên xuống.

> Việc một lần duy nhất. Sau khi xong, mỗi lần bạn sửa code và đẩy lên GitHub,
> Cloudflare sẽ **tự động** build và deploy lại — không cần làm lại các bước này.

---

## PHẦN A — Đưa code lên GitHub

### A.1. Tạo tài khoản GitHub (nếu chưa có)

1. Vào [github.com/signup](https://github.com/signup).
2. Điền email, mật khẩu, tên đăng nhập (username) — đây sẽ là tên hiển thị trong địa
   chỉ repository của bạn, ví dụ `github.com/ten-cua-ban/...`.
3. Xác minh email theo hướng dẫn GitHub gửi tới hộp thư của bạn.

### A.2. Tạo một repository (kho chứa code) mới

1. Sau khi đăng nhập, bấm dấu **+** ở góc trên bên phải → **New repository**.
2. Điền:
   - **Repository name**: ví dụ `qc-sample-shipment-tracking` (có thể đặt tên khác,
     không bắt buộc giống tên Worker ở Phần B — nhưng để dễ nhớ thì nên đặt giống).
   - **Visibility**: chọn **Private** (khuyến nghị — code của bạn không công khai cho
     người lạ xem) hoặc **Public** đều dùng được cho Cloudflare miễn phí.
   - **Không** tick "Add a README file" (vì code bạn upload lên đã có sẵn mọi file).
3. Bấm **Create repository**.
4. GitHub sẽ hiện một trang hướng dẫn với nhiều dòng lệnh — **giữ trang này mở**,
   bạn sẽ cần địa chỉ repository hiện ở đó (dạng
   `https://github.com/ten-cua-ban/ten-repo.git`).

### A.3. Cài Git trên máy bạn (nếu chưa có)

- **Windows**: tải và cài [git-scm.com/download/win](https://git-scm.com/download/win)
  (chọn mặc định mọi bước trong lúc cài).
- **macOS**: mở Terminal, gõ `git --version` — nếu chưa có, máy sẽ tự gợi ý cài.
- **Linux**: `sudo apt install git` (Ubuntu/Debian) hoặc tương đương.

Kiểm tra đã cài thành công bằng cách mở Terminal (macOS/Linux) hoặc Git Bash/PowerShell
(Windows) và gõ:

```bash
git --version
```

Nếu hiện ra số phiên bản (ví dụ `git version 2.43.0`) là đã cài xong.

### A.4. Cấu hình Git lần đầu (chỉ cần làm 1 lần trên máy)

```bash
git config --global user.name "Tên của bạn"
git config --global user.email "email-dang-ky-github@example.com"
```

### A.5. Giải nén code và đẩy lên GitHub

1. Giải nén file `QCSample-main-updated.zip` vào một thư mục, ví dụ Desktop.
2. Mở Terminal/Git Bash, di chuyển vào thư mục đó:

   ```bash
   cd Desktop/QCSample-main
   ```

3. Khởi tạo Git trong thư mục này và đẩy code lên:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/ten-cua-ban/ten-repo.git
   git push -u origin main
   ```

   Thay `https://github.com/ten-cua-ban/ten-repo.git` bằng đúng địa chỉ repository
   bạn thấy ở bước A.2.4. Lần đầu push, Git có thể mở trình duyệt để bạn xác thực
   đăng nhập GitHub — làm theo hướng dẫn trên màn hình.

4. Sau khi `git push` chạy xong không báo lỗi, refresh trang GitHub (bước A.2) — bạn
   sẽ thấy toàn bộ file code đã xuất hiện trên đó.

> **Lưu ý quan trọng**: file `.env` (chứa khoá Supabase thật) **sẽ không** được đẩy
> lên GitHub — đây là chủ ý, vì file `.gitignore` đã loại trừ nó để bảo vệ bí mật.
> Bạn sẽ khai báo lại các khoá này trực tiếp trên Cloudflare ở Phần B.4 dưới đây.

---

## PHẦN B — Deploy lên Cloudflare

### B.1. Tạo tài khoản Cloudflare (nếu chưa có)

1. Vào [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. Điền email, mật khẩu, xác minh email.
3. Không cần thẻ tín dụng cho các bước dưới đây (toàn bộ nằm trong free tier).

### B.2. Bắt đầu tạo Worker từ repository GitHub

1. Đăng nhập [dash.cloudflare.com](https://dash.cloudflare.com).
2. Ở menu bên trái, tìm và bấm **Workers & Pages**.
3. Bấm nút **Create application** (hoặc **Create** nếu giao diện rút gọn).
4. Tìm mục **Import a repository**, bấm **Get started** (hoặc **Connect to Git**, tuỳ
   phiên bản giao diện hiện tại của Cloudflare).

### B.3. Kết nối GitHub và chọn repository

1. Nếu đây là lần đầu, Cloudflare sẽ yêu cầu **Connect GitHub account** — bấm vào,
   một cửa sổ popup của GitHub hiện ra hỏi quyền truy cập.
2. Chọn **Only select repositories** rồi chọn đúng repository bạn vừa tạo ở Phần A
   (hoặc chọn **All repositories** nếu muốn đơn giản hơn) → bấm **Install & Authorize**.
3. Quay lại Cloudflare, danh sách repository hiện ra — chọn đúng repo bạn vừa đẩy code
   lên (ví dụ `qc-sample-shipment-tracking`) → bấm **Begin setup** (hoặc nút tương tự).

### B.4. Cấu hình project — đây là bước quan trọng nhất

Vì project đã có sẵn file `wrangler.jsonc`, Cloudflare sẽ đọc file này để tự điền sẵn
tên Worker (`qc-sample-shipment-tracking` — đúng giá trị trong trường `"name"`) — bạn
**không cần tự đặt tên**, chỉ cần kiểm tra lại các trường sau khớp đúng:

| Trường | Giá trị cần có | Vì sao |
|---|---|---|
| **Project/Worker name** | `qc-sample-shipment-tracking` (tự điền sẵn từ `wrangler.jsonc`) | Tên này **phải khớp chính xác** với trường `"name"` trong `wrangler.jsonc` — nếu bạn sửa 1 trong 2 nơi, build sẽ báo lỗi "Worker name does not match". Nếu Cloudflare hiện tên khác (ví dụ tự ghép thêm số ngẫu nhiên), sửa lại ô này cho khớp với `wrangler.jsonc`, hoặc sửa `wrangler.jsonc` cho khớp với tên Cloudflare gợi ý — chọn 1 trong 2 cách, miễn 2 nơi giống nhau. |
| **Production branch** | `main` | Nhánh Git mà mỗi lần bạn push code, Cloudflare sẽ tự build lại |
| **Root directory** | `/` (để trống hoặc dấu gạch chéo) | Code nằm ngay ở gốc repository, không nằm trong thư mục con |
| **Build command** | `npm run build` | Lệnh build ra file tĩnh + server bundle |
| **Deploy command** | `npx wrangler deploy` | Lệnh đẩy bundle đã build lên Cloudflare Workers |

> Vì project đã có sẵn file `wrangler.jsonc`, Cloudflare **sẽ không** tự tạo Pull
> Request cấu hình hộ bạn (autoconfig chỉ chạy khi thiếu file này) — đúng ý đồ, vì
> cấu hình đã được chuẩn bị sẵn, không cần Cloudflare đoán framework.

Sau khi điền xong, **đừng bấm Save and Deploy ngay** — chuyển sang bước B.5 để thêm
biến môi trường trước, nếu không app sẽ deploy thành công nhưng chạy bị lỗi do thiếu
khoá Supabase.

### B.5. Khai báo biến môi trường & secret (bắt buộc)

Trong cùng màn hình cấu hình (hoặc tìm mục **Environment variables and secrets** /
**Variables & Secrets** nếu nó nằm ở bước riêng), thêm từng biến sau:

**Loại Text (không mã hoá — an toàn vì đây là khoá công khai):**

| Tên biến | Giá trị |
|---|---|
| `SUPABASE_URL` | URL project Supabase của bạn (Project Settings → API → Project URL) |
| `VITE_SUPABASE_URL` | Giống giá trị trên |
| `SUPABASE_PUBLISHABLE_KEY` | anon/publishable key (Project Settings → API) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Giống giá trị trên |

**Loại Secret (mã hoá — không hiển thị lại sau khi lưu):**

| Tên biến | Giá trị |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (Project Settings → API — **giữ kín, không chia sẻ**) |

Cách thêm: bấm **Add variable**, gõ tên biến vào ô **Variable name**, dán giá trị vào
ô **Value**, chọn loại **Text** hoặc **Secret** tương ứng theo bảng trên, lặp lại cho
đủ 5 biến.

> Nếu bạn không thấy bước này trong lúc tạo project, không sao — bạn vẫn có thể thêm
> sau ở Phần B.7 (Settings → Variables and Secrets) rồi bấm deploy lại.

### B.6. Bấm Save and Deploy

Bấm nút **Save and Deploy**. Cloudflare sẽ:

1. Clone code từ GitHub repository của bạn.
2. Chạy `npm install` rồi `npm run build`.
3. Chạy `npx wrangler deploy` để đẩy lên hạ tầng Cloudflare.

Quá trình này thường mất 1–3 phút. Bạn sẽ thấy log build chạy theo thời gian thực
trên màn hình.

### B.7. Nếu build lỗi hoặc bạn thêm env var sau khi đã deploy

1. Vào **Workers & Pages** → chọn Worker của bạn.
2. Tab **Settings** → **Variables and Secrets** → **Edit** → thêm/sửa biến còn thiếu
   → **Deploy** (nút này nằm cuối form, áp dụng thay đổi và tự build lại).
3. Để xem log lỗi chi tiết: tab **Logs** (cần có ít nhất 1 lần truy cập sau khi
   deploy để log xuất hiện), hoặc bấm vào lượt build bị lỗi trong tab **Deployments**
   để xem chi tiết từng dòng log build.

### B.8. Mở app của bạn

Sau khi deploy thành công, Cloudflare hiện đường dẫn dạng:

```
https://qc-sample-shipment-tracking.<tên-tài-khoản-của-bạn>.workers.dev
```

Bấm vào đó (hoặc copy dán vào trình duyệt) — đây chính là địa chỉ app của bạn, hoạt
động giống 100% như khi còn dùng Lovable, vì toàn bộ dữ liệu vẫn nằm trên Supabase
project cũ.

---

## PHẦN C — Từ giờ về sau: cập nhật code

Mỗi khi bạn (hoặc Claude/Claude Code) sửa code và muốn đưa thay đổi lên app thật, chỉ
cần lặp lại 3 lệnh sau trong thư mục project trên máy bạn:

```bash
git add .
git commit -m "Mô tả ngắn về thay đổi"
git push
```

Ngay sau khi `git push` chạy xong, Cloudflare **tự động** phát hiện commit mới, tự
build và tự deploy lại — bạn không cần quay lại dashboard Cloudflare làm gì thêm (trừ
khi cần thêm/sửa biến môi trường mới).

Theo dõi tiến trình: vào **Workers & Pages** → chọn Worker → tab **Deployments**, mỗi
lần push sẽ xuất hiện 1 dòng mới ở đây, kèm trạng thái (đang build / thành công / lỗi).

---

## PHẦN D — Câu hỏi thường gặp

**Tôi không có kiến thức về dòng lệnh (terminal), có cách nào khác không?**
→ Có — GitHub Desktop ([desktop.github.com](https://desktop.github.com)) cho phép
đẩy code lên GitHub bằng giao diện kéo-thả, không cần gõ lệnh `git`. Cài app này,
đăng nhập GitHub, chọn **Add → Add Existing Repository** rồi chọn thư mục code đã
giải nén, sau đó dùng nút **Publish repository** / **Push origin** trên giao diện.
Phần B (Cloudflare) vẫn làm như hướng dẫn trên, không đổi gì.

**Build báo lỗi "Worker name does not match"**
→ Tên bạn điền ở ô **Project name / Worker name** (bước B.4) không khớp với trường
`"name"` trong file `wrangler.jsonc`. Sửa lại 1 trong 2 cho khớp nhau, rồi deploy lại.

**Build báo lỗi liên quan "Missing Supabase environment variable"**
→ Quay lại bước B.5/B.7, kiểm tra đã thêm đủ cả 5 biến, đúng tên (phân biệt hoa/thường,
không có khoảng trắng dư).

**Tôi muốn đổi sang domain riêng của tôi (không dùng `*.workers.dev`)**
→ Sau khi deploy thành công lần đầu: **Workers & Pages** → chọn Worker → **Settings**
→ **Domains & Routes** → **Add** → **Custom domain**, nhập domain bạn đã hoặc sẽ quản
lý DNS qua Cloudflare.

**Tôi lỡ đẩy file `.env` (có khoá thật) lên GitHub, phải làm sao?**
→ Vào Supabase Dashboard → Project Settings → API → bấm **Reset** cho cả anon key và
service_role key để tạo khoá mới (khoá cũ bị lộ sẽ vô hiệu), sau đó cập nhật lại các
biến môi trường trên Cloudflare (bước B.5/B.7) với khoá mới. Việc này không ảnh hưởng
dữ liệu, chỉ đổi "chìa khoá" truy cập.
