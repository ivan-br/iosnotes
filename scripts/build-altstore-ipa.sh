#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
BUILD_DIR="$ROOT_DIR/build/altstore"
PAYLOAD_DIR="$BUILD_DIR/Payload"
DIST_DIR="$ROOT_DIR/dist"
APP_NAME="mynotesappsdk54"
SCHEME="mynotesappsdk54"
IPA_PATH="$DIST_DIR/my-notes-app-sdk54.ipa"

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "Full Xcode is required. Install Xcode.app and run:"
  echo "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

if ! command -v pod >/dev/null 2>&1; then
  echo "CocoaPods is required. Install it with:"
  echo "brew install cocoapods"
  exit 1
fi

cd "$ROOT_DIR"
npx expo prebuild --platform ios

cd "$IOS_DIR"
pod install

cd "$ROOT_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$PAYLOAD_DIR" "$DIST_DIR"

xcodebuild \
  -workspace "$IOS_DIR/$SCHEME.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

APP_PATH="$(find "$BUILD_DIR/DerivedData/Build/Products/Release-iphoneos" -maxdepth 1 -name "*.app" -print -quit)"

if [[ -z "$APP_PATH" ]]; then
  echo "Could not find built .app in Release-iphoneos."
  exit 1
fi

cp -R "$APP_PATH" "$PAYLOAD_DIR/$APP_NAME.app"
rm -f "$IPA_PATH"

cd "$BUILD_DIR"
/usr/bin/zip -qry "$IPA_PATH" Payload

echo "IPA created: $IPA_PATH"
