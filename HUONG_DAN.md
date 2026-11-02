# Cổng hồ sơ nhân sự – Hướng dẫn cài đặt

Web app cho trợ giảng / nhân viên part-time **đăng nhập bằng email cá nhân** (mã OTP gửi qua email, không cần tài khoản domain công ty), quét QR CCCD, khai thông tin, tải giấy tờ và nộp hồ sơ. Nhân sự duyệt hồ sơ trên cùng app. Dữ liệu ghi thẳng vào 2 sheet sẵn có là `ThongTinNhanVien` và `ThongTinCaNhan`, nên AppSheet hiện tại vẫn dùng song song bình thường.

## 1. Cài đặt (khoảng 10 phút)

1. Mở file Google Sheet đang chứa 2 bảng `ThongTinNhanVien` và `ThongTinCaNhan`.
   **Nên đăng nhập bằng một tài khoản Nhân sự dùng chung** (ví dụ `hr@...`), không dùng tài khoản cá nhân, vì app chạy dưới quyền của tài khoản này.
2. Vào **Tiện ích mở rộng → Apps Script**.
3. Tạo các file và dán nội dung tương ứng:
   - File script (+ → Tập lệnh): `Config`, `Code`, `Auth`, `Sheets`, `Profile`, `Files`, `Mail`, `Setup` (dán nội dung các file `.gs`)
   - File HTML (+ → HTML): `Index`, `Styles`, `App`
   - Bật **Cài đặt dự án → Hiển thị tệp kê khai "appsscript.json"**, rồi dán nội dung `appsscript.json`.
4. Mở `Config.gs` và chỉnh lại nếu cần (tên app, danh sách trạng thái nghỉ việc, các lựa chọn Giới tính, Trình độ… sao cho **trùng giá trị Enum trong AppSheet**).
5. Chọn hàm **`setup`**, bấm **Chạy**, rồi cấp quyền. Xem kết quả ở *Nhật ký thực thi*:
   - Tạo 4 sheet: `WA_HoSo`, `WA_YeuCauSua`, `WA_PhanQuyen`, `WA_NhatKy`
   - Thêm tài khoản của bạn làm ADMIN
   - Tạo thư mục Drive `HoSoNhanVien_WebApp` để lưu file (**hãy chia sẻ thư mục này cho nhóm Nhân sự**)
   - Kiểm tra 2 sheet dữ liệu có đủ cột chưa
6. **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**
   - Thực thi với tư cách: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
   - Sao chép URL `/exec` rồi gửi cho nhân viên (có thể rút gọn link hoặc tạo mã QR).

> Nếu không thấy lựa chọn "Bất kỳ ai", quản trị viên Google Workspace cần cho phép chia sẻ ra ngoài tổ chức (Admin console → Drive và Tài liệu → Cài đặt chia sẻ).
> Mỗi lần sửa code: **Triển khai → Quản lý triển khai → ✏️ → Phiên bản: Phiên bản mới**. Cách này giữ nguyên URL cũ.

## 2. Phân quyền Nhân sự – sheet `WA_PhanQuyen`

| Email | HoTen | VaiTro | PhamVi | NhanThongBao | KichHoat |
|---|---|---|---|---|---|
| hr@kdi.edu.vn | Quản trị viên | ADMIN | *(trống = tất cả)* | TRUE | TRUE |
| nv.q1@gmail.com | HR Quận 1 | HR | CN Quận 1, CN Quận 3 | TRUE | TRUE |

- **PhamVi**: các giá trị cột `DonVi/ChiNhanh`, cách nhau bằng dấu phẩy. Để trống thì xem được toàn bộ nhân viên.
- **NhanThongBao** = TRUE: người này nhận email khi có hồ sơ mới hoặc yêu cầu chỉnh sửa.
- Tài khoản nhân sự cũng đăng nhập bằng OTP, và dùng được email cá nhân.

## 3. Quy trình

```
Nhân sự thêm NV (app hoặc AppSheet, bắt buộc có EmailCaNhan)
   → NV đăng nhập bằng email cá nhân + OTP
   → Quét QR CCCD, điền thông tin, tải giấy tờ (có Lưu nháp)
   → Nộp hồ sơ ─────────────► Nhân sự kiểm tra (vàng = thông tin thay đổi), tick "Đã nhận"
                                 ├─ Duyệt & lưu → ghi vào ThongTinCaNhan, email báo NV
                                 └─ Trả lại kèm ghi chú → NV sửa → nộp lại
Hồ sơ đã duyệt:
   NV gửi "Yêu cầu chỉnh sửa" → Nhân sự: Chấp nhận (mở cho NV sửa → nộp → duyệt lại)
                                          hoặc Từ chối / sửa trực tiếp rồi Lưu
   Nhân sự cũng có thể chủ động "Mở cho NV chỉnh sửa" bất cứ lúc nào.
```

Trạng thái lưu trong `WA_HoSo.TrangThai`: `NHAP` → `CHO_DUYET` → `DA_DUYET` / `TU_CHOI`, và `MO_CHINH_SUA`.
Nhân viên đã có sẵn dòng trong `ThongTinCaNhan` (khai trước đó qua AppSheet) sẽ được coi là **Đã duyệt** và thấy luôn dữ liệu cũ.

## 4. Cách app ghi dữ liệu (an toàn với AppSheet)

- Đọc và ghi **theo tên cột**, nên thứ tự cột không quan trọng. Cột thừa hay thiếu đều không gây lỗi.
- Chỉ ghi đúng các ô cần thiết, **bỏ qua ô đang chứa công thức**.
- Giữ nguyên số 0 ở đầu (CCCD, số điện thoại, số tài khoản) và chặn việc chèn công thức (`=…`) từ dữ liệu nhập.
- Khi duyệt, app ghi vào `ThongTinCaNhan`: các trường nhân viên khai, `MaNhanVien, HoVaTen, Ten, TrangThaiLV, BU1, BU2, Tuoi`, các cột `Nhan…` (Đã nhận), `TrangThai = "Đã duyệt"`, cùng `NgayTao/NguoiTao/NgayCapNhat/NguoiCapNhat`. Ngoài ra app cập nhật `SoDienThoai` trong `ThongTinNhanVien`.
- Cột file và ảnh lưu **link Google Drive**. Nếu muốn AppSheet hiển thị ảnh như file tải lên từ AppSheet, hãy đặt `UPLOAD_FOLDER_ID` là thư mục ảnh của app AppSheet và đặt `APPSHEET_PATH_PREFIX` (ví dụ `ThongTinCaNhan_Files_/`).
- Các cột B1, B2, B3, BanMemHoSoCanNop, GhiChu không bị app động tới.

## 5. Tùy biến nhanh (`Config.gs`)

- **Thêm, bớt trường hoặc đổi bắt buộc**: sửa mảng `FIELDS`. `key` phải trùng tên cột trong `ThongTinCaNhan`, và form sẽ tự sinh theo mảng này.
- **Trường khi thêm nhân viên**: sửa `NV_FIELDS`. Ô gợi ý tự lấy từ dữ liệu sẵn có.
- `BLOCKED_WORK_STATUS`: nhân viên có trạng thái thuộc danh sách này sẽ không đăng nhập được.

## 6. Lưu ý

- **Quét QR**: nút "Quét bằng camera" mở camera trực tiếp. Trên một số trình duyệt, Google không cho trang Apps Script dùng camera trực tiếp. Khi đó hãy dùng nút **"Chụp / chọn ảnh mã QR"**: điện thoại mở camera để chụp, app đọc mã từ ảnh. Cách này chạy được trên mọi máy. Nên chụp gần để mã QR chiếm phần lớn khung hình.
- **Hạn mức email** (OTP và thông báo): tài khoản Google Workspace gửi được khoảng 1.500 người nhận mỗi ngày, Gmail thường khoảng 100. Nếu có đợt tuyển lớn, hãy cho nhân viên đăng nhập rải ra.
- **Phiên đăng nhập** kéo dài tối đa 6 giờ và tự gia hạn khi đang dùng.
- **Dữ liệu cá nhân** (Nghị định 13/2023/NĐ-CP): khi nộp hồ sơ, app hiển thị câu cam đoan và đồng ý xử lý dữ liệu. Thư mục Drive chứa file chỉ nên chia sẻ cho Nhân sự.
- Nếu một người báo không nhận được mã hoặc bị khóa do nhập sai nhiều lần: chạy `resetOtp("email@...")` trong trình soạn thảo.
