<p align="center">
  <img src="docs/assets/mark.svg" width="72" height="72" alt="xrncal">
</p>

<h1 align="center">xrncal</h1>

<p align="center">
  <strong>Lịch desktop local-first cho Windows và Linux.</strong><br>
  Google, Microsoft 365 và CalDAV trong một cửa sổ — kèm <em>lịch âm</em> và <em>giỗ theo năm âm</em>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.2-5865F2?style=flat-square" alt="Phiên bản 0.2.2">
  <img src="https://img.shields.io/badge/Windows-10%2F11-1A73E8?style=flat-square" alt="Windows">
  <img src="https://img.shields.io/badge/Linux-AppImage-34C77B?style=flat-square" alt="Linux">
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square" alt="TypeScript">
  <img src="https://img.shields.io/badge/license-MIT-6C757D?style=flat-square" alt="MIT">
</p>

<p align="center">
  <img src="docs/assets/screenshots/month-dark.png" alt="xrncal — view Tháng, theme tối: ngày âm trên từng ô, số tuần ISO, một ngày lễ Việt Nam, và các lịch trên máy này, của một tài khoản Google và một máy chủ Nextcloud ở thanh bên" width="880">
</p>

<p align="center">
  <strong>Tiếng Việt</strong> · <a href="README.md">English</a>
</p>

<p align="center">
  <a href="#khác-gì-với-app-lịch-thường">Khác gì?</a> ·
  <a href="#ảnh-màn-hình">Ảnh màn hình</a> ·
  <a href="#cài-đặt">Cài đặt</a> ·
  <a href="#tính-năng">Tính năng</a> ·
  <a href="#kiến-trúc">Kiến trúc</a> ·
  <a href="#phát-triển">Phát triển</a>
</p>

---

## Khác gì với app lịch thường

Phần lớn app lịch là **client của một dịch vụ**, hoặc là **tab web đóng gói lại**. xrncal đi hướng khác: dữ liệu nằm trong SQLite trên máy bạn, các provider chỉ là nơi đẩy đi / kéo về.

### 1. Âm lịch là công dân hạng nhất, không phải plugin

Đây là lý do app này tồn tại.

- Nhãn âm lịch hiện trên **mọi view** — ô ngày trong Tháng, header Tuần và Ngày, nhóm ngày trong Danh sách, lưới Năm. Mùng 1 và rằm được đánh dấu, mỗi ngày một màu và một hình riêng, và Tết được ghi tên.
- **Giỗ / ngày âm lặp hằng năm** là một loại sự kiện thật sự: bạn khai báo *"12 tháng 8 âm"*, app tự giải ra ngày dương cho **từng năm**, xử lý cả tháng nhuận và tháng thiếu 29 ngày.
- Google Calendar / Outlook / Apple Calendar không có quy tắc lặp theo lịch âm. Cách duy nhất ở đó là tự tra rồi tạo tay từng năm một — sai một năm là trượt cả chuỗi.
- Giỗ được **materialize** thành sự kiện thường trong lịch có sync, nên điện thoại và đồng nghiệp vẫn thấy, dù họ không dùng xrncal.
- Ngày giỗ mới **nhắc bạn từ hôm trước** - đủ thời gian sắm lễ - và lời nhắc được đồng bộ sang điện thoại cùng sự kiện.

### 2. Offline là mặc định, không phải chế độ dự phòng

SQLite là **nguồn sự thật cho UI**. Mất mạng vẫn xem, vẫn tạo, vẫn sửa, vẫn xoá; sửa đổi được đánh `dirty = 1` và đẩy lên khi có mạng trở lại. Không có màn hình "không kết nối được".

### 3. Ba nhà cung cấp, một cửa sổ, không ưu tiên ai

Google Calendar, Microsoft 365 / Outlook.com và CalDAV (iCloud, Nextcloud, Synology, Fastmail, Radicale, máy chủ bất kỳ) chạy **song song**, mỗi engine có `.catch` riêng — một provider hỏng không chặn hai cái còn lại.

### 4. Xung đột được nói thẳng, không ghi đè im lặng

Mọi update/delete đều gửi kèm precondition `If-Match`. Máy chủ trả `412` nghĩa là bản trên đó đã đổi: hàng đó được đánh dấu xung đột, **loại khỏi hàng đợi đẩy** và hiện ra để bạn chọn — thay vì thử lại rồi thất bại mãi mãi, hoặc đè mất thay đổi của người khác.

### 5. Token nằm trong OS secret store, và fail closed

OAuth token và mật khẩu CalDAV được mã hoá bằng Electron `safeStorage`. Trên Linux không có keyring, app **từ chối lưu** và báo lỗi rõ ràng — không có đường lùi về plaintext. Không telemetry, không tài khoản xrncal, không máy chủ trung gian.

### 6. View viết tay, thao tác bằng chuột đúng nghĩa

Năm view đều là component React tự viết, không dùng thư viện lịch bên thứ ba: kéo-thả, resize mép sự kiện, chọn khoảng thời gian bằng cách quét chuột, bước snap (15 / 30 / 60 phút) chỉnh được trong Settings. Kéo sang lịch khác thì hỏi *Move hay Copy* — và chỉ hỏi khi thao tác thật sự nhập nhằng.

|  | Lịch phổ thông | xrncal |
| --- | --- | --- |
| Âm lịch | Không, hoặc chỉ là nhãn phụ | Trên mọi view + lặp theo năm âm |
| Dữ liệu | Trên máy chủ dịch vụ | SQLite trên máy bạn |
| Offline | Xem là chính | Đọc, ghi, sửa, xoá đầy đủ |
| Nhiều tài khoản | Mỗi dịch vụ một app / một tab | Google + Graph + CalDAV cùng lúc |
| Xung đột sync | Thường là last-write-wins âm thầm | `If-Match` → đánh dấu 412 → bạn quyết |
| Lịch chỉ đọc | Tuỳ UI chặn | Chặn ở tầng repo, không bypass được |

### Lấy One Calendar làm mẫu

Giao diện và cách dùng của xrncal theo One Calendar (Code Spark), app không có bản Linux và không có âm lịch Việt Nam. Phạm vi nằm trong [`docs/urd.md`](docs/urd.md).

- **Giống:** bấm vào ô trống là mở cửa sổ sự kiện đầy đủ, không phải ô nhập tiêu đề; kéo-thả thì hỏi *Move*, *Copy* hay *Cancel*; thanh bên liệt kê từng tài khoản với các lịch của nó bên dưới; *Thêm tài khoản* đi từ loại tài khoản tới các lịch của nó.
- **Riêng của xrncal:** âm lịch và giỗ theo năm âm, bản Linux, gõ ngày giờ vào tiêu đề bằng tiếng Việt hay tiếng Anh, bảng xử lý xung đột, và một file dữ liệu bạn tự sao lưu, khôi phục được. Không có gì nằm sau gói trả phí.
- **Cố ý bỏ:** bản macOS và điện thoại, live tile và màn hình khoá, widget desktop, bản đồ, sự kiện Facebook, danh sách việc cần làm, và Exchange on-premises (tài khoản Microsoft chỉ đi qua Graph).

---

## Ảnh màn hình

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/week-light.png" alt="View Tuần, theme sáng, có múi giờ thứ hai cạnh cột giờ">
<p align="center"><sub><strong>Tuần</strong> — theme sáng, múi giờ thứ hai cạnh cột giờ, vạch giờ hiện tại</sub></p>
</td>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/year.png" alt="View Năm, mười hai tháng trên một trang">
<p align="center"><sub><strong>Năm</strong> — mười hai tháng trên một trang, mỗi ngày tô theo màu sự kiện, ngày âm dưới số ngày</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/event-editor.png" alt="Cửa sổ sự kiện nằm cạnh lưới tuần">
<p align="center"><sub><strong>Cửa sổ sự kiện</strong> — nằm cạnh lưới: lịch, màu, múi giờ, nhắc nhở, địa điểm, link họp, khách mời</sub></p>
</td>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/lunar-entry.png" alt="Sự kiện mới có ngày âm trong tiêu đề, thành giỗ lặp theo năm âm">
<p align="center"><sub><strong>Gõ ngày vào tiêu đề</strong> — "Giỗ bà ngoại 3/2 âm lịch" thành giỗ theo năm âm, kèm các ngày sắp tới và lời nhắc hôm trước</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/list.png" alt="View Danh sách, giao diện tiếng Việt">
<p align="center"><sub><strong>Danh sách</strong> — giao diện tiếng Việt; mỗi ngày kèm ngày âm và số sự kiện</sub></p>
</td>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/search.png" alt="Bảng tìm kiếm trên view Tháng">
<p align="center"><sub><strong>Tìm kiếm</strong> — mở bằng <code>/</code> hoặc <code>Ctrl+K</code>; không cần gõ dấu, "gio" ra "Giỗ"</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/screenshots/add-account.png" alt="Hộp Thêm tài khoản: Google, Microsoft, iCloud, CalDAV, liên kết, ngày lễ và lịch trên máy này">
<p align="center"><sub><strong>Thêm tài khoản</strong> — ở bản tự build, Google và Microsoft hỏi thông tin đăng nhập của riêng bạn trước</sub></p>
</td>
<td width="50%" valign="top" align="center">
<img src="docs/assets/screenshots/mini.png" alt="Cửa sổ mini liệt kê sự kiện hôm nay và ngày mai" width="300">
<p align="center"><sub><strong>Cửa sổ mini</strong> — mở từ khay hệ thống, có thể nằm trên cùng</sub></p>
</td>
</tr>
</table>

<sub>Tài khoản và sự kiện đều là dữ liệu bịa, chụp từ mã nguồn 0.2.0.</sub>

---

## Cài đặt

Chưa có bản release nào: phiên bản 0.2.2 đã nằm trong `package.json`, và workflow release đã sẵn sàng. Trong lúc chờ, hãy [tự build](#tự-build).

Bản release sẽ nằm ở **[Releases](https://github.com/Xernnn/xrncal-desktop/releases/latest)**, gồm:

- **Windows 10/11:** `xrncal Setup <phiên bản>.exe`. Khi bộ cài chưa được ký số, SmartScreen sẽ hỏi trước: *More info → Run anyway*.
- **Linux:** `xrncal-<phiên bản>.AppImage`. Cho phép chạy (`chmod +x`, hoặc *Properties → Allow executing*) rồi mở.

Lần mở đầu tiên có ba bước ngắn: ngôn ngữ, vài thiết lập cơ bản (âm lịch, ngày lễ, khởi động cùng máy) và các lịch muốn thêm vào. Bản đã cài tự cập nhật khi có release mới; tắt ở *Cài đặt → Chung → Kiểm tra bản cập nhật*.

### Tự build

Cần **Node.js 23.4+** (khuyên dùng 24 - phần test dùng `node:sqlite` có sẵn trong Node) và Git.

```bash
git clone https://github.com/Xernnn/xrncal-desktop.git
cd xrncal-desktop
npm install
```

#### Linux — cài thành app bấm được từ menu

```bash
npm run app:install
```

Lệnh này build AppImage, đặt vào `~/Applications/xrncal.AppImage`, tạo launcher ở `~/.local/share/applications/xrncal.desktop` rồi refresh menu. Tìm "xrncal" trong app menu là ra. Chạy lại chính lệnh đó mỗi khi muốn cập nhật — nó ghi đè đúng các đường dẫn cũ, và ghi bằng cách `rename` nên **không làm hỏng app đang chạy** (bản đang mở vẫn dùng bản cũ cho tới khi bạn thoát và mở lại).

Launcher chạy app từ một bản giải nén trong `~/.cache/xrncal` thay vì từ chỗ mount của AppImage (chỗ mount có thể biến mất khi app đang chạy), và chạy dưới X11 (`--ozone-platform=x11`) để cửa sổ mini tự đặt được vị trí và nằm trên cùng trên desktop Wayland. Mỗi lần cài lại sẽ xoá các bản giải nén cũ không còn ai dùng.

Muốn tự cầm file AppImage:

```bash
npm run pack:linux     # -> dist/*.AppImage
chmod +x dist/xrncal-*.AppImage
./dist/xrncal-*.AppImage
```

#### Windows

```bash
npm run pack:win       # -> dist/  (NSIS installer, x64)
```

Chạy file `.exe` trong `dist/` để cài. Không có bản macOS.

#### Chạy thẳng bản dev

```bash
npm run dev            # electron-vite, renderer hot-reload
```

### Kết nối tài khoản

CalDAV (Nextcloud, Synology, Fastmail, …) và iCloud chỉ cần địa chỉ + tài khoản (iCloud dùng mật khẩu dành riêng cho ứng dụng). Máy chủ `http://` chỉ được chấp nhận khi nằm trên chính máy này, trong mạng nội bộ, trong tailnet hoặc có tên cục bộ; máy chủ `http://` trên internet bị từ chối, để mật khẩu không bao giờ bị gửi đi không mã hoá.

**Google và Microsoft** đăng nhập qua trình duyệt, dùng một OAuth client: thông tin đăng nhập giúp họ nhận ra ứng dụng. Bản build có sẵn OAuth client thì đăng nhập được ngay. Với bản chưa có, **Thêm tài khoản → Google hoặc Microsoft** sẽ hướng dẫn từng bước để bạn tự tạo, rồi nhập luôn ở đó: không phải sửa file, không phải khởi động lại. Thông tin được mã hóa bằng kho khóa của hệ thống, giống token tài khoản, và secret không bao giờ hiện lại.

Lập trình viên có thể đặt cùng thông tin đó bên ngoài ứng dụng: chép [`.env.example`](.env.example) thành `.env` rồi điền:

```ini
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

Với bản tự đóng gói, đặt cùng nội dung đó vào `xrncal.env` trong thư mục dữ liệu (xem bên dưới). Mọi thứ khác — lịch trên máy, CalDAV, iCloud, lịch đăng ký bằng liên kết — vẫn chạy mà không cần chúng. Đăng ký OAuth client và các secret mà workflow release dùng để build: [`docs/deployment-guide.md`](docs/deployment-guide.md).

### Dữ liệu nằm ở đâu

| Hệ | Đường dẫn |
| --- | --- |
| Linux | `~/.config/xrncal/xrncal.sqlite` |
| Windows | `%APPDATA%\xrncal\xrncal.sqlite` |

Mỗi tuần một lần, xrncal cũng tự chép nó vào thư mục `backups` ngay bên cạnh và giữ lại bốn bản gần nhất (**Cài đặt → Chung → Tự động sao lưu**). Bạn có thể tự sao lưu bất cứ lúc nào bằng **Cài đặt → Sao lưu dữ liệu** (ghi ra một file `.sqlite` mở được bằng bất kỳ công cụ SQLite nào), và khôi phục bằng **Cài đặt → Khôi phục từ bản sao lưu**, hộp chọn tệp sẽ mở sẵn ở thư mục sao lưu tự động (dữ liệu hiện tại được lưu vào đó trước). Chỉ tài khoản người dùng của bạn đọc được các bản sao lưu. Bản xrncal cũ không mở dữ liệu mà một bản mới hơn đã dùng, và khi dữ liệu không mở được thì app giải thích rồi mới thoát.

Khi có sự cố, **Cài đặt → Mở tệp nhật ký** mở thư mục chứa `xrncal.log`: lần khởi động, lỗi đồng bộ và lúc đồng bộ chạy lại, các bản sao lưu và lỗi cập nhật. Tệp này không bao giờ ghi nội dung sự kiện hay mật khẩu.

> Nâng cấp từ bản **Gone Calendar** cũ: lần chạy đầu tiên xrncal tự chép dữ liệu từ `gone-calendar` sang. Profile cũ vẫn được giữ nguyên tại chỗ.

---

## Tính năng

<table>
<tr>
<td width="50%" valign="top">

**Lịch**
- 5 view: Ngày, Tuần, Tháng, Năm, Danh sách — mỗi trang một kỳ; Năm vừa đủ mười hai tháng trên màn hình, tô mỗi ngày theo màu sự kiện và chuyển từng năm một
- Bấm vào ô trống hoặc sự kiện để mở cửa sổ sự kiện đầy đủ, hoặc nút Tạo trên thanh tiêu đề; chuột phải vào sự kiện để sửa, nhân bản hoặc xoá, hoặc vào một ngày để tạo sự kiện ở đó
- Kéo-thả, resize mép, quét chọn khoảng giờ
- Bước snap 15 / 30 / 60 phút, và bước riêng cho danh sách giờ trong cửa sổ sự kiện
- Sự kiện mới dài bao lâu là do bạn đặt (15 phút đến 2 giờ) khi bấm vào ô trống, bấm chuột phải hoặc nút Tạo; khoảng giờ quét chọn thì giữ nguyên độ dài
- Thêm biểu tượng cảm xúc trước tiêu đề bằng một nút trong cửa sổ sự kiện ("🍴 Ăn trưa"), những biểu tượng hay dùng nằm trên cùng
- Gõ thời gian ngay vào tiêu đề: "Họp 3h chiều thứ 6", "Ăn trưa mai 12h30", "Chạy bộ 6h sáng hàng ngày" tự điền ngày, giờ và lặp lại, tiêu đề lưu không kèm những chữ đó; nút × giữ nguyên tiêu đề như đã gõ
- Lặp lại: lần này / từ đây trở đi / cả chuỗi; một ngày của chuỗi, hoặc phần còn lại, chuyển được sang lịch khác
- Xoá thì hiện nút Hoàn tác thay vì hỏi trước, và `Ctrl+Z` hoàn tác lần di chuyển, đổi độ dài, sao chép hoặc xoá
- In tuần hoặc tháng, hay lưu thành PDF: một trang A4, có cả âm lịch
- Sự kiện nhiều ngày, cả ngày, số tuần ISO; tuần bắt đầu từ Thứ hai, Chủ nhật hoặc Thứ bảy
- Múi giờ thứ hai cạnh cột giờ cho lịch xuyên quốc gia

</td>
<td width="50%" valign="top">

**Việt Nam & ngôn ngữ**
- Âm lịch trên mọi view; đánh dấu mùng 1, rằm và Tết
- Giỗ lặp theo năm âm, xử lý tháng nhuận, nhắc trước một ngày - hoặc chỉ cần gõ "Giỗ ông 12/8 âm lịch"
- Lịch lễ Việt Nam và quốc tế, subscribe 1 cú bấm, tự kéo dài khi sang năm mới
- Giao diện tiếng Việt và English — bản mới cài theo ngôn ngữ, kiểu giờ và ngày đầu tuần của máy

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Đồng bộ**
- Google Calendar (OAuth loopback + PKCE)
- Microsoft 365 / Outlook.com (Graph), kể cả những lần xuất hiện bị dời, sửa hoặc huỷ trong Outlook
- CalDAV: iCloud, Nextcloud, Synology, Fastmail, generic; mỗi người dùng trên một máy chủ là một tài khoản
- Sửa một lần xuất hiện cũng được đẩy lên đúng
- Nhắc nhở và danh sách khách đồng bộ hai chiều, màu của lịch CalDAV cũng vậy
- Trả lời lời mời: Có / Có thể / Không
- Đăng ký lịch từ bất kỳ liên kết `.ics` / `webcal://`, làm mới mỗi sáu giờ
- Poll thích ứng: 20 giây một lần khi cửa sổ đang được dùng, 5 phút một lần khi không
- Bảng xử lý xung đột 412
- Sửa sự kiện CalDAV vẫn giữ những gì ứng dụng khác đã lưu
- Sự kiện mới bị mất câu trả lời lúc tạo vẫn chỉ được tạo một lần, không thành hai
- Mỗi tài khoản cho biết vì sao lần đồng bộ trước lỗi (đăng nhập bị từ chối, không tìm thấy máy chủ, keyring bị khoá, …)

</td>
<td width="50%" valign="top">

**Chỗ làm việc**
- Vẫn chạy ở khay hệ thống khi đóng cửa sổ, và có thể khởi động cùng máy, nên nhắc nhở luôn kêu (`Ctrl+Q` để thoát)
- Cửa sổ mini luôn-trên-cùng từ khay hệ thống
- Nhắc nhở cho từng sự kiện (kể cả cả ngày), có báo lại và nút Tham gia; báo lại và các thẻ nhắc đang hiện vẫn còn sau khi khởi động lại
- Theme sáng / tối / theo hệ thống, màu nhấn, và ảnh nền (bốn ảnh có sẵn, hoặc ảnh của bạn) có làm mờ và làm tối
- Tìm kiếm không cần gõ dấu ("hop" ra "họp"), gợi ý tiêu đề từ lịch sử của bạn
- Ô Địa điểm gợi ý những nơi bạn đã dùng khi đang gõ, không cần gõ dấu ("ca phe" ra "Cà phê")
- Mỗi sự kiện có thể có múi giờ và màu riêng, giữ nguyên khi đồng bộ CalDAV hay xuất .ics; sự kiện lưu không kèm múi giờ (như bản xuất của Google) mở theo múi giờ nơi bạn ở vào ngày đó
- Nhập `.ics` (trong Cài đặt, kéo tệp vào cửa sổ, hoặc *Mở bằng xrncal*) và xuất từng lịch; sao lưu và khôi phục dữ liệu
- Gỡ tài khoản mà vẫn giữ lại sự kiện
- Hộp thoại giữ bàn phím ở bên trong và tự báo mình là hộp thoại cho trình đọc màn hình

</td>
</tr>
</table>

### Phím tắt

Toàn bộ ứng dụng dùng được mà không cần chuột. `↑` `↓` di chuyển con trỏ qua
các sự kiện đang hiển thị; mọi phím còn lại tác động lên sự kiện đang chọn.

| Phím | Việc |
| --- | --- |
| `T` | Về hôm nay |
| `←` `K` · `→` `J` | Kỳ trước · kỳ kế tiếp (hoặc `PgUp` / `PgDn`) |
| `1` `2` `3` `4` `5` | Ngày · Tuần · Tháng · Năm · Danh sách (hoặc `D` `W` `M` `Y` `L`) |
| `↑` `↓` | Sự kiện trước · sự kiện kế tiếp |
| `Enter` | Mở sự kiện đang chọn (hoặc tạo mới) |
| `Del` `⌫` | Xóa sự kiện đang chọn |
| `Shift+↑` `Shift+↓` | Dời sớm hơn · muộn hơn một bước |
| `Shift+←` `Shift+→` | Dời lùi · tới một ngày |
| `Alt+↑` `Alt+↓` | Rút ngắn · kéo dài giờ kết thúc |
| `Ctrl+Z` | Hoàn tác lần di chuyển, đổi độ dài, sao chép hoặc xoá gần nhất |
| `N` hoặc `C` | Tạo sự kiện |
| `Ctrl+K` hoặc `/` | Tìm kiếm |
| `Ctrl+B` | Ẩn / hiện thanh bên |
| `Ctrl+P` | In hoặc lưu PDF |
| `R` | Đồng bộ ngay |
| `,` | Cài đặt |
| `?` hoặc `F1` | Bảng phím tắt |
| `Esc` | Đóng hộp thoại, hoặc bỏ chọn |
| `Ctrl+Q` | Thoát (đóng cửa sổ thì xrncal vẫn chạy ở khay) |

Trong cửa sổ sự kiện, `Tab` đi qua từng ô và mọi bộ chọn đều mở được bằng bàn
phím: `↑` `↓` di chuyển trong danh sách, `Enter` chọn mục đang tô sáng; riêng
lịch ngày còn nhận `←` `→` cho ngày, `PgUp` `PgDn` cho tháng (kèm `Shift` là
năm) và `T` để về hôm nay.

| Phím | Việc |
| --- | --- |
| `Enter` | Lưu ngay từ ô tiêu đề |
| `Ctrl+Enter` | Lưu / tạo sự kiện từ bất kỳ ô nào |
| `Ctrl+⌫` `Ctrl+Del` | Xóa sự kiện đang sửa (trong ô nhập chữ thì xoá một từ, như mọi nơi khác) |
| `Esc` | Đóng bộ chọn đang mở, nếu không thì đóng cửa sổ |

---

## Kiến trúc

```mermaid
flowchart LR
  subgraph renderer [Renderer · sandboxed]
    UI[5 view · Editor · DnD]
  end
  subgraph preload [Preload]
    Bridge["window.xrncal"]
  end
  subgraph main [Main process]
    DB[(SQLite · WAL)]
    Sync[Google · Graph · CalDAV]
    OS[Tray · Mini · Notifications]
  end
  UI -->|"contextBridge"| Bridge
  Bridge -->|"ipcMain"| main
  Sync --- DB
  OS --- DB
```

| Tầng | Thư mục | Việc |
| --- | --- | --- |
| Renderer | `src/renderer` | React 19, 5 view, editor, i18n, theme, cửa sổ mini (`#mini`) |
| Preload | `src/preload` | `window.xrncal` có type, sandbox bật |
| Main | `src/main` | SQLite và 29 migration, OAuth, sync, tray, thông báo, sao lưu, cập nhật |
| Shared | `src/shared` | `CalendarEvent`, `XrncalAPI`, âm lịch, ngày lễ, lặp lại, đọc ngày giờ trong tiêu đề |

Renderer **không bao giờ** import `src/main`; IPC là cây cầu duy nhất, và mọi channel được khai báo tập trung trong `src/shared/ipc-contract.ts`. Chỉ yêu cầu đến từ chính trang của app mới được trả lời. Lịch chỉ đọc (ngày lễ, lịch `.ics` đăng ký) bị chặn ghi ngay ở tầng repo, không phải ở UI. Bản đóng gói tắt chế độ chạy như Node, `NODE_OPTIONS` và inspector của Electron, và không chịu chạy khi có cổng debug.

---

## Phát triển

```bash
npm run dev            # chạy app, hot-reload renderer
npm run typecheck      # tsc cho main + renderer (chạy trước khi commit)
npm run lint           # ESLint 10 flat config, không cho phép warning
npm run test           # Vitest — chạy trong Node, không cần Electron binary
npm run test:e2e       # build, rồi Playwright chạy thử app thật (cần màn hình)
npm run test:caldav    # đồng bộ CalDAV với một Radicale thật (pip install radicale)
npm run build          # bundle production -> out/
```

Chạy một file test: `npx vitest run tests/expand-occurrences.test.ts`, hoặc một test với `-t "<tên>"`. `test:caldav` tự chạy một Radicale trên cổng trống; đặt `XRNCAL_RADICALE` trỏ tới file `radicale` nếu nó không nằm trong `PATH` (của một virtualenv chẳng hạn). CI chạy lint + typecheck + test + build trên mọi push và PR, chạy thử bản build bằng Playwright dưới `xvfb-run`, và đồng bộ với một máy chủ Radicale thật.

Release: tăng `version` trong `package.json`, commit, rồi push tag `v<phiên bản>`. `.github/workflows/release.yml` build bộ cài Windows và AppImage Linux vào một bản release nháp trên GitHub; chưa đến tay ai cho tới khi bản nháp đó được publish.

`site/` là trang chủ và chính sách quyền riêng tư của dự án, thứ mà màn hình đồng ý OAuth của Google yêu cầu. `.github/workflows/pages.yml` đăng nó lên [GitHub Pages](https://xernnn.github.io/xrncal-desktop/) mỗi khi nó đổi trên `main`.

| Tài liệu | Nội dung |
| --- | --- |
| [Architecture](docs/system-architecture.md) | Process, IPC, luồng dữ liệu |
| [Codebase](docs/codebase-summary.md) | Map thư mục và schema |
| [Standards](docs/code-standards.md) | Naming, quy ước, bảo mật |
| [Design](docs/design-guidelines.md) | Token màu, chrome, motion |
| [Deploy](docs/deployment-guide.md) | Build, đóng gói, đăng ký OAuth |
| [URD](docs/urd.md) · [PDR](docs/project-overview-pdr.md) · [Roadmap](docs/project-roadmap.md) | Phạm vi và quyết định sản phẩm |

---

## Giấy phép

[MIT](LICENSE) © Xernnn.

Dùng `ical.js` (MPL-2.0) và `rrule` (BSD-3-Clause); còn lại là MIT hoặc ISC. Không có phụ thuộc copyleft lây lan. App và trang web dùng font [MiSans](https://hyperos.mi.com/font) của Xiaomi, miễn phí cho mục đích thương mại và được đóng gói theo điều khoản của nó; font đi kèm sẵn nên không tải từ đâu cả.

---

<p align="center">
  <sub>Electron · React · TypeScript · Tailwind · SQLite · Windows &amp; Linux</sub>
</p>
