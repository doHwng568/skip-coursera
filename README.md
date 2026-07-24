# Trong trường hợp nhóm này bị điều tra bởi các cơ quan trực thuộc Bộ Công An, tôi khẳng định mình không liên quan tới repo hoặc những cá nhân khác trong quá trình phát triển của repo này. Tôi không rõ tại sao mình lại có repo này, có lẽ tài khoản của tôi đã được thêm bởi một bên thứ ba. Tôi cũng xin khẳng định rằng mình không hề giúp sức cho những hành động chống phá Coursera của các thành viên trong repo này. 🐧

# Coursera Skipper - Hướng Dẫn Sử Dụng Chi Tiết

**Coursera Skipper** là một tiện ích mở rộng trên Chrome giúp tự động hóa quá trình học tập trên Coursera, giúp bạn tiết kiệm thời gian đáng kể bằng cách tự động bỏ qua video, bài đọc, tự động thảo luận và chấm điểm bài làm.

---

## 🚀 Các Tính Năng Chính

1.  **Skip Videos**: Tự động đánh dấu hoàn thành các video bài giảng.
    -   Nếu video cho phép skip: Tiện ích sẽ kết thúc video ngay lập tức.
    -   Nếu video bắt buộc xem: Tiện ích sẽ giả lập quá trình xem (start, progress, end) qua API để hoàn thành nhanh chóng.
2.  **Auto Discussion**: Tự động điền và gửi bài thảo luận (Post/Reply) bằng nội dung chuyên nghiệp có sẵn.
3.  **Auto Do Assignment**: Tự động điền nội dung cho các bài tập tự luận (Peer-graded Assignment) và nhấn nộp bài.
4.  **Auto Grade Peer**: Tự động chấm điểm bài làm của học viên khác.
    -   Cho phép nhập số lượng bài muốn chấm (**Grade count**) để tránh việc chấm quá nhiều bài không cần thiết.
    -   Tự động chọn thang điểm cao nhất và điền nhận xét tích cực.
5.  **Locking Browser Bypass (MỚI)**: Vượt qua yêu cầu mở app "Coursera Locking Browser".
    -   Làm bài Assignment trực tiếp ngay trên trình duyệt web thông thường.
    -   Cho phép thoải mái sử dụng các phím tắt sao chép, dán (`Ctrl+C`, `Ctrl+V`).

---

## 🛠 Hướng Dẫn Cài Đặt

1.  Tải mã nguồn của extension về máy tính của bạn.
2.  Mở trình duyệt Google Chrome và truy cập địa chỉ: `chrome://extensions/`.
3.  Bật chế độ **Developer mode** (Chế độ cho nhà phát triển) ở góc trên bên phải.
4.  Nhấn nút **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục chứa mã nguồn này.

---

## 📖 Cách Sử Dụng

### 1. Để Skip Video và Bài Đọc
-   Đăng nhập vào Coursera và vào trang chủ của khóa học (trang có danh sách các tuần học).
-   Mở extension và nhấn **Skip videos**.
-   Tiện ích sẽ quét toàn bộ khóa học và tự động hoàn thành các mục video/reading.

### 2. Để Tự Động Thảo Luận (Auto Discussion)
-   Truy cập vào một bài thảo luận cụ thể trên Coursera.
-   Mở extension và nhấn **Auto Discussion**. Tiện ích sẽ tự động điền nội dung và nhấn **Post**.

### 3. Để Tự Động Nộp Bài (Auto Do Assignment) 
-   Truy cập vào trang nộp bài tập (Submit your assignment).
-   Mở extension và nhấn **Auto Do Assignment**. Tiện ích sẽ điền tiêu đề, nội dung mẫu và nhấn nộp bài.

### 4. Để Tự Động Chấm Điểm (Auto Grade Peer)
-   Truy cập vào trang chấm điểm bài làm của học viên khác (Peer Review).
-   Tại ô **Grade count**, nhập số lượng bài bạn cần chấm (ví dụ: 3).
-   Nhấn **Auto Grade Peer**. Tiện ích sẽ tự động chấm đúng số lượng bài bạn đã nhập và dừng lại.

---

## ⚠️ Lưu Ý Quan Trọng

-   **Rủi ro**: Việc sử dụng công cụ tự động hóa có thể vi phạm điều khoản dịch vụ của Coursera. Hãy cân nhắc trước khi sử dụng.
-   **Token**: Tiện ích sử dụng Cookie `CSRF3-Token` hiện tại của bạn để gửi yêu cầu hợp lệ. Nếu gặp lỗi, hãy thử tải lại trang Coursera.
-   **Dừng lại**: Bạn có thể nhấn nút **Stop** màu đỏ bất cứ lúc nào để dừng quá trình chạy.

---

## 💝 Ủng Hộ Tác Giả (Donate)

Nếu bạn thấy công cụ này hữu ích và giúp bạn tiết kiệm được nhiều thời gian học tập, hãy mời tác giả một ly cà phê để có thêm động lực duy trì và cập nhật tính năng mới nhé!

### 🏦 Chuyển khoản ngân hàng
*   **Ngân hàng:** `Techcombank`
*   **Số tài khoản:** `8626262686868`
*   **Chủ tài khoản:** `DO THE HUNG`

### 📸 Quét mã QR (MoMo / Ngân hàng)

<img src="assets/qr-donate.jpg" alt="Mã QR Ủng Hộ" width="250"/>

---

## 👨‍💻 Tác giả
-   **DoHung**
-   **SĐT**: 0586255568

*Chúc bạn học tập hiệu quả và tiết kiệm thời gian!*