#!/usr/bin/env bash
# Build xrncal and (re)install it as a clickable desktop app for the
# current user. Re-run this any time to update the installed app to the latest
# code — it overwrites the same paths, so the launcher entry always points at
# the newest build.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

APP_NAME="xrncal"
APP_ID="xrncal"
APPS_DIR="$HOME/Applications"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons"
TARGET_APPIMAGE="$APPS_DIR/${APP_NAME}.AppImage"
# Where the launcher has the AppImage unpack itself (see TMPDIR below): xrncal's
# own folder in the user's cache, on disk. src/main/launch-at-login.ts uses the
# same one for the entry that starts xrncal at login.
UNPACK_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/${APP_ID}"

echo "==> Building production bundle + AppImage"
npm run pack:linux

SRC_APPIMAGE="$(find dist -maxdepth 1 -name '*.AppImage' -type f -printf '%T@ %p\n' \
  | sort -nr | head -1 | cut -d' ' -f2-)"
if [[ -z "${SRC_APPIMAGE:-}" || ! -f "$SRC_APPIMAGE" ]]; then
  echo "!! No .AppImage produced in dist/. Aborting." >&2
  exit 1
fi
echo "==> Built: $SRC_APPIMAGE"

mkdir -p "$APPS_DIR" "$DESKTOP_DIR" "$ICON_DIR"
install -d -m 700 "$UNPACK_DIR"

# Write beside the target and rename over it, rather than copying into it.
# An AppImage that is already running is mounted from this exact file, and
# `install` opens the destination and truncates it - which corrupts the mount
# under the running app. A rename only swaps the directory entry: the running
# instance keeps the inode it opened and carries on, and the new build is what
# launches next time.
TMP_APPIMAGE="$(mktemp "${TARGET_APPIMAGE}.new.XXXXXX")"
install -m 755 "$SRC_APPIMAGE" "$TMP_APPIMAGE"
mv -f "$TMP_APPIMAGE" "$TARGET_APPIMAGE"
install -m 644 resources/icon.png "$ICON_DIR/${APP_ID}.png"

# Native Wayland by default: in a Wayland session Electron 38+ runs as a
# Wayland client. Under XWayland - one X server for every X11 app - any other
# X11 client can read xrncal's windows and keystrokes, the password typed into
# the account dialog included, and a sandboxed app that was given the X11
# socket is no exception. On Wayland the tray's mini window can neither place
# itself nor stay on top; a compositor rule does both (README, "Linux"), and
# it keeps its title, "xrncal Mini", for the rule to match.
# XRNCAL_X11=1 npm run app:install writes --ozone-platform=x11 into the
# launcher, running it under XWayland as earlier builds did, and XRNCAL_X11=1
# into its environment, which the login entry (src/main/launch-at-login.ts)
# follows.
#
# --appimage-extract-and-run with NO_CLEANUP=1: run from an extracted copy in
# UNPACK_DIR, not from the FUSE mount. The mount lives only as long as the
# AppImage runtime process does; if that process goes while the app is still
# running, the app dies with SIGBUS the next time it pages in code from the
# mount. app.relaunch() (database restore) hits the same thing: the old process
# exits, the runtime unmounts, and the relaunched process loses its code.
# NO_CLEANUP keeps the extracted copy after the runtime exits. Without it, a
# second launch that only hands off to the running instance would delete that
# instance's files on its way out. The runtime still sets APPIMAGE to this
# file, which launch-at-login relies on.
#
# TMPDIR: the runtime extracts into $TMPDIR/appimage_extracted_<MD5 of the
# AppImage>, so this puts the copy in UNPACK_DIR, on disk. In /tmp, which is
# often memory (tmpfs), each build held about 300 MB of RAM until a restart,
# and systemd-tmpfiles removes /tmp files untouched for 10 days, which can take
# files xrncal has not read since it started (locale packs, the icon) from
# under it while it sits in the tray. xrncal gets this TMPDIR too: Chromium's
# single-instance socket and the .ics files Share writes go in the same
# user-only folder, and a second launch still finds the running xrncal through
# the link to that socket in its profile.
OZONE_ENV=""
OZONE_ARGS=""
if [[ "${XRNCAL_X11:-}" == "1" ]]; then
  OZONE_ENV=" XRNCAL_X11=1"
  OZONE_ARGS=" --ozone-platform=x11"
fi
cat > "$DESKTOP_DIR/${APP_ID}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Modern desktop calendar with multi-provider sync
Exec=env NO_CLEANUP=1${OZONE_ENV} "TMPDIR=${UNPACK_DIR}" "${TARGET_APPIMAGE}" --appimage-extract-and-run${OZONE_ARGS} %U
Icon=${ICON_DIR}/${APP_ID}.png
Terminal=false
Categories=Office;Calendar;
MimeType=text/calendar;
StartupWMClass=xrncal
EOF
chmod 644 "$DESKTOP_DIR/${APP_ID}.desktop"

# Each build extracts to its own folder and NO_CLEANUP keeps it, so remove the
# copies of earlier builds that nothing uses: no process runs from one, works in
# one or has one of its files mapped. The copy a running xrncal uses stays,
# whichever build it is, and so does this build's, which a launch may be
# extracting right now. The same goes for the copies launchers before this one
# extracted into ${TMPDIR:-/tmp}, where only xrncal's own are touched.
CURRENT_COPY="$UNPACK_DIR/appimage_extracted_$(md5sum "$TARGET_APPIMAGE" | cut -d' ' -f1)"
IN_USE="$( { find /proc/[0-9]*/exe /proc/[0-9]*/cwd -maxdepth 0 -printf '%l\n'; cat /proc/[0-9]*/maps; } 2>/dev/null || true)"
for dir in "$UNPACK_DIR"/appimage_extracted_* "${TMPDIR:-/tmp}"/appimage_extracted_*; do
  [[ -d "$dir" && "$dir" != "$CURRENT_COPY" ]] || continue
  [[ "$dir" == "$UNPACK_DIR"/* || ( -x "$dir/$APP_NAME" && -f "$dir/${APP_ID}.desktop" ) ]] || continue
  if grep -qF -- "$dir/" <<<"$IN_USE" || grep -qxF -- "$dir" <<<"$IN_USE"; then
    continue
  fi
  rm -rf -- "$dir"
done

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 --noincremental >/dev/null 2>&1 || true
fi

VERSION="$(node -p "require('./package.json').shortVersion ?? require('./package.json').version")"
echo
echo "==> Installed '${APP_NAME}' v${VERSION}"
echo "    App image : ${TARGET_APPIMAGE}"
echo "    Launcher  : ${DESKTOP_DIR}/${APP_ID}.desktop"
echo "    Find it in your app menu as \"${APP_NAME}\" (search: calendar)."
echo "    Re-run this script after approving changes to update the app."
if pgrep -f "${APP_NAME}.AppImage" >/dev/null 2>&1; then
  echo
  echo "    NOTE: ${APP_NAME} is running. It is still on the previous build -"
  echo "          quit and reopen it to pick this one up."
fi
