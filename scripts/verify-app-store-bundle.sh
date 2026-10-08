#!/usr/bin/env bash
set -euo pipefail
APP_PATH="${1:?Pass the archive or exported .app path}"
: "${APPLE_TEAM_ID:?Missing APPLE_TEAM_ID}"
: "${IOS_BUILD_NUMBER:?Missing IOS_BUILD_NUMBER}"
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT

bash scripts/verify-ios-bundle.sh "$APP_PATH"
test -f "$APP_PATH/embedded.mobileprovision"
test -f "$APP_PATH/PrivacyInfo.xcprivacy"
plutil -lint "$APP_PATH/PrivacyInfo.xcprivacy"
codesign --verify --deep --strict "$APP_PATH"
codesign -d --entitlements :- "$APP_PATH" > "$CHECK_DIR/entitlements.plist" 2>/dev/null
security cms -D -i "$APP_PATH/embedded.mobileprovision" > "$CHECK_DIR/profile.plist"
plutil -convert xml1 -o "$CHECK_DIR/info.plist" "$APP_PATH/Info.plist"
node scripts/app-store-config.cjs verify \
  "$CHECK_DIR/info.plist" "$CHECK_DIR/entitlements.plist" "$CHECK_DIR/profile.plist"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Info.plist")"
xcrun lipo "$APP_PATH/$EXECUTABLE" -verify_arch arm64
echo "Verified signed device app, SDK 26+, build number and privacy manifest."
