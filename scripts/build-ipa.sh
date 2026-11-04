#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED="$ROOT/build"
OUTPUT="$ROOT/output"
PACKAGE="$ROOT/packaging"
mkdir -p "$OUTPUT" "$PACKAGE/Payload"
python3 "$ROOT/scripts/validate.py"
/usr/bin/plutil -lint "$ROOT/Diastomy/Info.plist" "$ROOT/Diastomy.xcodeproj/project.pbxproj"
xcodebuild -version
xcodebuild -project "$ROOT/Diastomy.xcodeproj" -scheme Diastomy \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  CURRENT_PROJECT_VERSION="${GITHUB_RUN_NUMBER:-1}" build
APP="$DERIVED/Build/Products/Release-iphoneos/Diastomy.app"
test -f "$APP/Diastomy"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist"
xcrun lipo -archs "$APP/Diastomy" | grep -q arm64
/usr/bin/ditto "$APP" "$PACKAGE/Payload/Diastomy.app"
/usr/bin/ditto -c -k --keepParent "$PACKAGE/Payload" "$OUTPUT/Diastomy-unsigned.ipa"
shasum -a 256 "$OUTPUT/Diastomy-unsigned.ipa" > "$OUTPUT/SHA256SUMS.txt"
unzip -l "$OUTPUT/Diastomy-unsigned.ipa" | head -15 || true
printf '\nIPA ready: %s\nInstall and sign it on Windows with Sideloadly.\n' "$OUTPUT/Diastomy-unsigned.ipa"
