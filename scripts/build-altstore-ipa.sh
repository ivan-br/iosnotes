#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
BUILD_DIR="$ROOT_DIR/build/altstore"
PAYLOAD_DIR="$BUILD_DIR/Payload"
DIST_DIR="$ROOT_DIR/dist"
IPA_PATH="$DIST_DIR/OrderBook.ipa"

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "Full Xcode is required. Install Xcode.app and run:"
  echo "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

XCODE_VERSION="$(xcodebuild -version | awk '/Xcode/ {print $2}')"
node -e 'const [major, minor] = process.argv[1].split(".").map(Number); if (major < 16 || (major === 16 && minor < 1)) { console.error("Expo SDK 54 requires Xcode 16.1 or newer."); process.exit(1); }' "$XCODE_VERSION"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 20 || (major === 20 && minor < 19)) { console.error("Use Node 20.19 or newer (nvm use)."); process.exit(1); }'

if ! command -v pod >/dev/null 2>&1; then
  echo "CocoaPods is required. Install it with:"
  echo "brew install cocoapods"
  exit 1
fi

cd "$ROOT_DIR"
npx expo prebuild --platform ios --no-install

cd "$IOS_DIR"
pod install

cd "$ROOT_DIR"
WORKSPACE="$(find "$IOS_DIR" -maxdepth 1 -type d -name '*.xcworkspace' -print -quit)"
PROJECT="$(find "$IOS_DIR" -maxdepth 1 -type d -name '*.xcodeproj' -print -quit)"
if [[ -z "$WORKSPACE" || -z "$PROJECT" ]]; then
  echo "Application workspace or project not found after prebuild."
  exit 1
fi
SCHEME="$(basename "$PROJECT" .xcodeproj)"
xcodebuild -list -workspace "$WORKSPACE"
rm -rf "$BUILD_DIR"
mkdir -p "$PAYLOAD_DIR" "$DIST_DIR"

xcodebuild \
  -workspace "$WORKSPACE" \
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

bash "$ROOT_DIR/scripts/verify-ios-bundle.sh" "$APP_PATH"
cp -R "$APP_PATH" "$PAYLOAD_DIR/$(basename "$APP_PATH")"
rm -f "$IPA_PATH"

cd "$BUILD_DIR"
/usr/bin/zip -qry "$IPA_PATH" Payload

echo "IPA created: $IPA_PATH"
