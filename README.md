# HoSoTroGiang – Cổng hồ sơ nhân sự

Web app cho trợ giảng / nhân viên part-time **đăng nhập bằng email cá nhân** (mã OTP gửi qua email), quét QR CCCD, khai thông tin, tải giấy tờ và nộp hồ sơ. Nhân sự duyệt hồ sơ trên cùng app.
Dữ liệu ghi thẳng vào 2 sheet sẵn có `ThongTinNhanVien` / `ThongTinCaNhan`, nên **AppSheet hiện tại vẫn dùng song song bình thường**.

- Node.js 20+ / Express, gọi Google Sheets API và Google Drive API bằng **service account**
- Giao diện là trang web tĩnh (`public/`), tối ưu cho điện thoại. Thư viện quét QR được phục vụ từ chính máy chủ, không phụ thuộc CDN.
- Không cần database: Google Sheet chính là nơi lưu dữ liệu

```
public/            giao diện (index.html, app.js, styles.css)
server.js          máy chủ + định tuyến API
src/config.js      cấu hình, danh sách trường của form (sửa tại đây)
src/logic.js       nghiệp vụ: đăng nhập, nộp, duyệt, yêu cầu chỉnh sửa
src/store.js       đọc/ghi Google Sheets theo tên cột
src/files.js       tải file lên Drive, xem file có kiểm tra quyền
src/mail.js        email OTP và thông báo
scripts/setup.js   tạo sheet WA_* và kiểm tra cấu hình
test/              kiểm thử với Google API giả lập
```

---

## 1. Chuẩn bị Google Cloud (làm 1 lần, khoảng 15 phút)

1. Vào <https://console.cloud.google.com> bằng tài khoản `@kdi.edu.vn`, rồi **tạo project** mới (ví dụ `hoso-trogiang`).
2. Mở **APIs & Services → Library** và bật **Google Sheets API** cùng **Google Drive API**.
3. Mở **IAM & Admin → Service Accounts → Create service account** (đặt tên ví dụ `hoso-app`). Không cần cấp vai trò nào.
4. Vào service account vừa tạo, chọn **Keys → Add key → Create new key → JSON**. File JSON sẽ được tải về. **Giữ bí mật file này.**
   > Nếu bị báo *"Service account key creation is disabled"*, quản trị viên Google Cloud của tổ chức cần tắt chính sách `iam.disableServiceAccountKeyCreation` cho project này.
5. **Chia sẻ file Google Sheet** cho email service account (dạng `hoso-app@hoso-trogiang.iam.gserviceaccount.com`) với quyền **Người chỉnh sửa**.
6. **Thư mục lưu file**: service account không có dung lượng Drive riêng, nên thư mục phải nằm trong **Bộ nhớ dùng chung (Shared drive)**.
   - Google Drive → *Bộ nhớ dùng chung* → tạo mới (ví dụ `HoSo NhanVien`) → **Quản lý thành viên** → thêm email service account với vai trò **Người quản lý nội dung**. Thêm cả nhóm Nhân sự.
   - Tạo thư mục bên trong, mở thư mục ra và sao chép ID trên thanh địa chỉ (`drive.google.com/drive/folders/<ID>`).

## 2. Email gửi mã OTP (SMTP)

Cách đơn giản là dùng một tài khoản Google Workspace, ví dụ `hr@kdi.edu.vn`:
1. Bật **Xác minh 2 bước** cho tài khoản.
2. Vào <https://myaccount.google.com/apppasswords> và tạo **Mật khẩu ứng dụng**.
3. Điền `SMTP_USER=hr@kdi.edu.vn` và `SMTP_PASS=<mật khẩu ứng dụng 16 ký tự>`.

Giới hạn khoảng 2.000 email/ngày. Bạn cũng có thể dùng SendGrid, Amazon SES… bằng cách đổi `SMTP_HOST/PORT`.

## 3. Chạy thử trên máy

```bash
git clone https://github.com/appsheet2-pixel/HoSoTroGiang.git
cd HoSoTroGiang
npm install
cp .env.example .env          # rồi điền các giá trị
npm run setup                 # tạo sheet WA_*, thêm ADMIN, kiểm tra Sheet/Drive/SMTP
npm start                     # mở http://localhost:8080
```

`GOOGLE_SERVICE_ACCOUNT_JSON`: dán nội dung file JSON thành **một dòng**. Có thể mã hóa base64 để tránh lỗi ký tự:
`base64 -w0 key.json` (Linux), hoặc `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))` (PowerShell).

## 4. Đưa lên Internet

Máy chủ cần chạy **đúng 1 instance**, vì mã OTP và khóa ghi dữ liệu được giữ trong bộ nhớ.

**Cách A – Render.com (dễ nhất, tự cập nhật mỗi khi đẩy code lên GitHub)**
1. Vào <https://render.com>, đăng nhập bằng GitHub, chọn **New → Blueprint** rồi chọn repo này (file `render.yaml` có sẵn).
2. Điền các biến môi trường như trong `.env`.
3. Gói *Starter* khoảng $7/tháng và chạy liên tục. Gói *Free* cũng dùng được nhưng máy chủ tự ngủ sau 15 phút không có ai dùng, lần mở đầu tiên phải chờ khoảng 1 phút.
4. Vào **Settings → Custom domain** để gắn tên miền riêng, ví dụ `hoso.kdi.edu.vn`.

**Cách B – Google Cloud Run (cùng hệ sinh thái Google, có hạn mức miễn phí)**
```bash
gcloud run deploy hosotrogiang --source . --region asia-southeast1 \
  --allow-unauthenticated --max-instances 1 \
  --set-env-vars "SPREADSHEET_ID=...,UPLOAD_FOLDER_ID=...,SMTP_USER=...,APP_URL=..." \
  --set-secrets "GOOGLE_SERVICE_ACCOUNT_JSON=hoso-sa-key:latest,SESSION_SECRET=hoso-secret:latest,SMTP_PASS=hoso-smtp:latest"
```

**Cách C – Máy chủ riêng / VPS**: dùng `docker build -t hoso . && docker run -p 8080:8080 --env-file .env hoso`, đặt sau Nginx có HTTPS.

> Phải chạy qua **HTTPS** thì điện thoại mới cho mở camera quét QR trực tiếp. Render và Cloud Run có sẵn HTTPS.

## 5. Phân quyền Nhân sự – sheet `WA_PhanQuyen`

| Email | HoTen | VaiTro | PhamVi | NhanThongBao | KichHoat |
|---|---|---|---|---|---|
| hr@kdi.edu.vn | Quản trị viên | ADMIN | *(trống = tất cả)* | TRUE | TRUE |
| nv.q1@gmail.com | HR Quận 1 | HR | CN Quận 1, CN Quận 3 | TRUE | TRUE |

- **PhamVi** liệt kê các giá trị cột `DonVi/ChiNhanh`. Để trống thì xem được toàn bộ nhân viên.
- Quyền được kiểm tra lại ở **mỗi lần thao tác**: đổi `KichHoat` thành FALSE là người đó mất quyền ngay.

## 6. Quy trình

```
Nhân sự thêm NV (trên app hoặc AppSheet, bắt buộc có EmailCaNhan)
  → NV đăng nhập bằng email cá nhân + mã OTP
  → Quét QR CCCD, điền thông tin, tải giấy tờ (có Lưu nháp)
  → Nộp ───► Nhân sự kiểm tra (vàng = thông tin thay đổi), tick "Đã nhận"
               ├─ Duyệt & lưu → ghi vào ThongTinCaNhan, gửi email cho NV
               └─ Trả lại kèm ghi chú → NV sửa → nộp lại
Đã duyệt: NV gửi "Yêu cầu chỉnh sửa" → Nhân sự chấp nhận (mở cho NV sửa) / từ chối / sửa trực tiếp
```

## 7. Cách ghi dữ liệu (an toàn với AppSheet)

- Đọc và ghi **theo tên cột**, nên thứ tự cột không quan trọng. Chỉ ghi đúng các ô cần thiết và **bỏ qua ô chứa công thức**.
- Giữ nguyên số 0 ở đầu (CCCD, số điện thoại, số tài khoản) và chặn việc chèn công thức (`=…`) từ dữ liệu nhập.
- Khi duyệt, app ghi vào `ThongTinCaNhan`: các trường nhân viên khai, `MaNhanVien, HoVaTen, Ten, TrangThaiLV, BU1, BU2, Tuoi`, các cột `Nhan…`, `TrangThai`, cùng `NgayTao/NguoiTao/NgayCapNhat/NguoiCapNhat`.
- File lưu **link Google Drive**. Muốn AppSheet hiển thị ảnh như file tải lên từ AppSheet thì đặt `APPSHEET_PATH_PREFIX` (xem `.env.example`).
- Xem file trong app phải đi qua máy chủ, có kiểm tra quyền: nhân viên chỉ xem được file của mình, nhân sự chỉ xem được file trong phạm vi quản lý. Không cần chia sẻ thư mục Drive công khai.

## 8. Tùy biến

- **Trường trên form**: sửa mảng `FIELDS` trong `src/config.js`. `key` phải trùng tên cột trong `ThongTinCaNhan`. Các giá trị `options` nên trùng giá trị Enum trong AppSheet.
- **Trường khi thêm nhân viên**: sửa `NV_FIELDS`.

## 9. Kiểm thử

```bash
npm test          # toàn bộ nghiệp vụ với Google API giả lập
npm run test:ui   # giao diện trên Chromium (cần: npm i -D playwright && npx playwright install chromium)
```

## Lưu ý

- **Hạn mức Google Sheets API**: khoảng 60 lần đọc/phút cho mỗi service account. App gom mỗi thao tác thành 1–2 lần gọi và lưu tạm 15 giây, nên đủ cho vài chục người dùng cùng lúc.
- **Dữ liệu cá nhân** (Nghị định 13/2023/NĐ-CP): khi nộp hồ sơ, nhân viên phải đồng ý xử lý dữ liệu. Giữ file khóa service account và `.env` bí mật, **không commit lên GitHub** (đã có sẵn trong `.gitignore`).
