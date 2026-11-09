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

# --ozone-platform=x11: under Wayland the app would otherwise run as a native
# Wayland client, where the tray's mini window can neither place itself nor
# stay on top (see executableArgs in electron-builder.yml).
#
# --appimage-extract-and-run with NO_CLEANUP=1: run from an extracted copy in
# ${TMPDIR:-/tmp}, not from the FUSE mount. The mount lives only as long as the
# AppImage runtime process does; if that process goes while the app is still
# running, the app dies with SIGBUS the next time it pages in code from the
# mount. app.relaunch() (database restore) hits the same thing: the old process
# exits, the runtime unmounts, and the relaunched process loses its code.
# NO_CLEANUP keeps the extracted copy after the runtime exits. Without it, a
# second launch that only hands off to the running instance would delete that
# instance's files on its way out. The runtime still sets APPIMAGE to this
# file, which launch-at-login relies on.
cat > "$DESKTOP_DIR/${APP_ID}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Modern desktop calendar with multi-provider sync
Exec=env NO_CLEANUP=1 "${TARGET_APPIMAGE}" --appimage-extract-and-run --ozone-platform=x11 %U
Icon=${ICON_DIR}/${APP_ID}.png
Terminal=false
Categories=Office;Calendar;
MimeType=text/calendar;
StartupWMClass=xrncal
EOF
chmod 644 "$DESKTOP_DIR/${APP_ID}.desktop"

# Each build extracts to its own ${TMPDIR:-/tmp}/appimage_extracted_<digest>,
# and NO_CLEANUP keeps it there, so remove the copies no running process uses.
for dir in "${TMPDIR:-/tmp}"/appimage_extracted_*; do
  [[ -x "$dir/$APP_NAME" && -f "$dir/${APP_ID}.desktop" ]] || continue
  in_use=0
  for exe in /proc/[0-9]*/exe; do
    if [[ "$(readlink "$exe" 2>/dev/null)" == "$dir/"* ]]; then
      in_use=1
      break
    fi
  done
  (( in_use )) || rm -rf -- "$dir"
done

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 --noincremental >/dev/null 2>&1 || true
fi

VERSION="$(node -p "require('./package.json').version")"
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
