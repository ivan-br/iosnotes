#!/usr/bin/env bash
set -euo pipefail
APP_PATH="${1:?Pass the built .app path}"
test -f "$APP_PATH/main.jsbundle"
test -f "$APP_PATH/Assets.car"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Info.plist")"
test -x "$APP_PATH/$EXECUTABLE"
/usr/bin/plutil -convert json -o - "$APP_PATH/Info.plist" | node -e '
let text = "";
process.stdin.on("data", part => text += part);
process.stdin.on("end", () => {
  const plist = JSON.parse(text);
  const schemes = (plist.CFBundleURLTypes || []).flatMap(item => item.CFBundleURLSchemes || []);
  if (plist.CFBundleDisplayName !== "Stakan" || plist.CFBundleIdentifier !== "com.softdev.orderbook" || !schemes.includes("orderbook")) {
    console.error("Incorrect display name, bundle identifier or Router URL scheme.");
    process.exit(1);
  }
});'
echo "Verified Stakan executable, assets, JavaScript and URL scheme."
