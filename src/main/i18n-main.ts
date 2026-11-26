/**
 * Minimal main-process localization for the handful of user-visible strings that
 * live outside the renderer: the tray menu, OAuth callback pages, notifications
 * and sync status text. The renderer owns the full i18next catalog.
 */
import { getDatabase } from './db/database'
import { SettingsRepo } from './db/repos/settings-repo'
import { isAppLocale, type AppLocale } from '@shared/settings-contract'

let currentLocale: AppLocale = 'en'

const STRINGS: Record<AppLocale, Record<string, string>> = {
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
    'sync.errors': 'Sync finished with {count} error(s)',
    'sync.calendarUnavailable': 'This calendar is no longer available to sync',
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
    'startup.dbFailedLog': 'The log has the details: {path}',
    'startup.dbNewerBody':
      'The database {path} was last used by a newer version of xrncal (data version {version}; this version reads up to {known}). This version will not open it, so that nothing in it is changed. Install the newer xrncal again to use it.'
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
    'sync.errors': 'Đồng bộ hoàn tất với {count} lỗi',
    'sync.calendarUnavailable': 'Không thể đồng bộ lịch này',
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
    'startup.dbFailedLog': 'Chi tiết có trong nhật ký: {path}',
    'startup.dbNewerBody':
      'Cơ sở dữ liệu {path} được dùng lần cuối bởi một phiên bản xrncal mới hơn (phiên bản dữ liệu {version}; phiên bản này chỉ đọc được đến {known}). Phiên bản này sẽ không mở nó, để không thay đổi gì bên trong. Hãy cài lại bản xrncal mới hơn để dùng tiếp.'
  },
  'zh-CN': {
    'tray.openMain': '打开 xrncal',
    'tray.miniWindow': '迷你窗口（即将到来的日程）',
    'tray.quit': '退出',
    'tray.stillRunningTitle': 'xrncal 仍在运行',
    'tray.stillRunningBody': '提醒仍会响起。可从托盘图标或应用菜单重新打开，也可通过托盘菜单或 Ctrl+Q 退出。',
    'notify.now': '现在开始',
    'notify.inMinutes': '{n} 分钟后，{time}',
    'notify.todayAt': '今天 {time}',
    'notify.tomorrowAt': '明天 {time}',
    'notify.onDateAt': '{date} {time}',
    'notify.today': '今天',
    'notify.tomorrow': '明天',
    'notify.onDate': '{date}',
    'update.readyTitle': 'xrncal {version} 已准备就绪',
    'update.readyBody': '下次退出 xrncal 时将安装更新。',
    'sync.done': '同步完成：下载 {pulled} 项，上传 {pushed} 项',
    'sync.errors': '同步时出现 {count} 个错误',
    'sync.calendarUnavailable': '此日历当前无法同步',
    'oauth.google.success': '已连接 Google Calendar！',
    'oauth.microsoft.success': '已连接 Microsoft Outlook / 365！',
    'oauth.account': '账户：{detail}',
    'oauth.canClose': '可以关闭此浏览器标签页并返回 xrncal。',
    'oauth.stateError': '身份验证失败：状态或授权码无效',
    'oauth.google.failed': 'Google 登录失败：{error}',
    'oauth.microsoft.failed': 'Microsoft 登录失败：{error}',
    'oauth.canCloseShort': '可以关闭此标签页。',
    'oauth.profileFailed': '已登录，但无法读取账户信息（HTTP {status}）。请重试。',
    'oauth.timeout.google': 'Google 身份验证已超时（5 分钟）。请重试。',
    'oauth.timeout.microsoft': 'Microsoft 身份验证已超时（5 分钟）。请重试。',
    'startup.dbFailedTitle': 'xrncal 无法打开你的日历',
    'startup.dbFailedBody': '无法打开数据库 {path}，xrncal 将退出。',
    'startup.dbFailedLog': '详情见日志：{path}',
    'startup.dbNewerBody':
      '数据库 {path} 上次由较新的 xrncal 使用（数据版本 {version}，当前仅支持到 {known}）。为保护数据，本版本不会打开它。请使用较新的 xrncal。'
  }
}

export function setMainLocale(locale: string): void {
  if (isAppLocale(locale)) currentLocale = locale
}

export function getMainLocale(): AppLocale {
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
