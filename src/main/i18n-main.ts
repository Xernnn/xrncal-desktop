/**
 * Minimal main-process localization for the handful of user-visible strings that
 * live outside the renderer: the tray menu, OAuth callback pages, notifications
 * and sync status text. The renderer owns the full i18next catalog.
 */
import { getDatabase } from './db/database'
import { SettingsRepo } from './db/repos/settings-repo'

type MainLocale = 'en' | 'vi'

let currentLocale: MainLocale = 'en'

const STRINGS: Record<MainLocale, Record<string, string>> = {
  en: {
    'tray.openMain': 'Open xrncal',
    'tray.miniWindow': 'Mini window (upcoming events)',
    'tray.quit': 'Quit',
    'tray.stillRunningTitle': 'xrncal is still running',
    'tray.stillRunningBody': 'Reminders will still ring. Open it again from its tray icon or your app menu; quit from the tray menu or with Ctrl+Q.',
    'notify.now': 'Starting now',
    'notify.inMinutes': 'In {n} min, at {time}',
    'notify.todayAt': 'Today at {time}',
    'notify.tomorrowAt': 'Tomorrow at {time}',
    'notify.onDateAt': '{date} at {time}',
    'notify.today': 'Today',
    'notify.tomorrow': 'Tomorrow',
    'notify.onDate': '{date}',
    'update.readyTitle': 'xrncal {version} is ready',
    'update.readyBody': 'It will be installed the next time you quit xrncal.',
    'sync.done': 'Sync complete: pulled {pulled}, pushed {pushed}',
    'oauth.google.success': 'Google Calendar connected!',
    'oauth.microsoft.success': 'Microsoft Outlook / 365 connected!',
    'oauth.account': 'Account: {detail}',
    'oauth.canClose': 'You can close this browser tab and return to xrncal.',
    'oauth.stateError': 'Authentication error: invalid state or code',
    'oauth.google.failed': 'Google sign-in failed: {error}',
    'oauth.microsoft.failed': 'Microsoft sign-in failed: {error}',
    'oauth.canCloseShort': 'You can close this tab.',
    'oauth.profileFailed': 'Signed in, but your account details could not be read (HTTP {status}). Please try again.',
    'oauth.timeout.google': 'Google authentication timed out (5 minutes). Please try again.',
    'oauth.timeout.microsoft': 'Microsoft authentication timed out (5 minutes). Please try again.',
    'startup.dbFailedTitle': 'xrncal could not open your calendar',
    'startup.dbFailedBody': 'The database {path} could not be opened, so xrncal will close.',
    'startup.dbFailedLog': 'The log has the details: {path}'
  },
  vi: {
    'tray.openMain': 'Mở xrncal',
    'tray.miniWindow': 'Cửa sổ Mini (sự kiện sắp tới)',
    'tray.quit': 'Thoát',
    'tray.stillRunningTitle': 'xrncal vẫn đang chạy',
    'tray.stillRunningBody': 'Nhắc nhở vẫn sẽ kêu. Mở lại từ biểu tượng ở khay hệ thống hoặc menu ứng dụng; thoát từ menu của biểu tượng hoặc bằng Ctrl+Q.',
    'notify.now': 'Đang bắt đầu',
    'notify.inMinutes': 'Còn {n} phút, lúc {time}',
    'notify.todayAt': 'Hôm nay lúc {time}',
    'notify.tomorrowAt': 'Ngày mai lúc {time}',
    'notify.onDateAt': '{date} lúc {time}',
    'notify.today': 'Hôm nay',
    'notify.tomorrow': 'Ngày mai',
    'notify.onDate': '{date}',
    'update.readyTitle': 'xrncal {version} đã sẵn sàng',
    'update.readyBody': 'Bản mới sẽ được cài khi bạn thoát xrncal lần tới.',
    'sync.done': 'Đồng bộ hoàn tất: đã tải {pulled}, đã đẩy {pushed}',
    'oauth.google.success': 'Kết nối Google Calendar thành công!',
    'oauth.microsoft.success': 'Kết nối Microsoft Outlook / 365 thành công!',
    'oauth.account': 'Tài khoản: {detail}',
    'oauth.canClose': 'Bạn có thể đóng tab trình duyệt này và quay lại ứng dụng xrncal.',
    'oauth.stateError': 'Lỗi xác thực: State hoặc Code không hợp lệ',
    'oauth.google.failed': 'Đăng nhập Google thất bại: {error}',
    'oauth.microsoft.failed': 'Đăng nhập Microsoft thất bại: {error}',
    'oauth.canCloseShort': 'Bạn có thể đóng tab này.',
    'oauth.profileFailed': 'Đã đăng nhập nhưng không đọc được thông tin tài khoản (HTTP {status}). Vui lòng thử lại.',
    'oauth.timeout.google': 'Quá thời gian xác thực Google (5 phút). Vui lòng thử lại.',
    'oauth.timeout.microsoft': 'Quá thời gian xác thực Microsoft (5 phút). Vui lòng thử lại.',
    'startup.dbFailedTitle': 'xrncal không mở được lịch của bạn',
    'startup.dbFailedBody': 'Không mở được cơ sở dữ liệu {path}, nên xrncal sẽ đóng lại.',
    'startup.dbFailedLog': 'Chi tiết có trong nhật ký: {path}'
  }
}

export function setMainLocale(locale: string): void {
  if (locale === 'en' || locale === 'vi') currentLocale = locale
}

export function getMainLocale(): MainLocale {
  return currentLocale
}

/** Load the locale - the chosen one, else the computer's (call once after DB init). */
export function loadMainLocaleFromDb(): void {
  try {
    setMainLocale(new SettingsRepo(getDatabase()).getSetting('locale'))
  } catch {
    // keep default
  }
}

export function mt(key: string, vars?: Record<string, string | number>): string {
  let s = STRINGS[currentLocale][key] ?? STRINGS.en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // A function, so a `$&` or `$1` in the value is text, not a replacement pattern.
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v))
    }
  }
  return s
}
