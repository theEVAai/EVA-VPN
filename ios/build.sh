#!/usr/bin/env bash
# Build only: never launches the app, a simulator or a VPN connection.
# bash ios/build.sh --ipa produces a device IPA for subsequent Apple signing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
mode="${1:---project}"
fail() { echo "error: $*" >&2; exit 1; }

case "$mode" in --project|--ipa|--open) ;; *) fail "use --project, --ipa or --open" ;; esac
[[ "$(uname -s)" == Darwin ]] || fail "this build script uses macOS/Xcode; see ios/README.md"
command -v xcodebuild >/dev/null || fail "Xcode is required"
command -v xcodegen >/dev/null || fail "install XcodeGen: brew install xcodegen"

if [[ ! -d "$here/Libbox.xcframework" || "${EVA_REBUILD_CORE:-0}" == 1 ]]; then
  command -v go >/dev/null || fail "Go 1.25.x is required"
  singbox="${EVA_SINGBOX_SRC:-$HOME/sing-box}"
  [[ -d "$singbox" ]] || fail "set EVA_SINGBOX_SRC to the sing-box v1.13.12 checkout"
  go install github.com/sagernet/gomobile/cmd/gomobile@v0.1.12
  go install github.com/sagernet/gomobile/cmd/gobind@v0.1.12
  (cd "$singbox" && go run ./cmd/internal/build_libbox -target apple -platform ios)
  [[ -d "$singbox/Libbox.xcframework" ]] || fail "Libbox.xcframework was not built"
  rm -rf "$here/Libbox.xcframework"
  cp -R "$singbox/Libbox.xcframework" "$here/Libbox.xcframework"
fi

icon="$here/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
sips -s format png --resampleHeightWidth 1024 1024 "$root/build/icon.png" --out "$icon" >/dev/null
(cd "$here" && xcodegen generate)
if [[ "$mode" == --open ]]; then
  open "$here/EVA VPN.xcodeproj"
elif [[ "$mode" == --ipa ]]; then
  out="${EVA_IOS_OUTPUT:-$root/dist/ios}"
  mkdir -p "$out"
  xcodebuild -project "$here/EVA VPN.xcodeproj" -scheme "EVA VPN" \
    -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
    -derivedDataPath "$out/DerivedData" -archivePath "$out/EVA-VPN.xcarchive" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
    CURRENT_PROJECT_VERSION="${EVA_BUILD_NUMBER:-2}" archive

  app="$out/EVA-VPN.xcarchive/Products/Applications/EVA VPN.app"
  [[ -d "$app/PlugIns/EvaTunnel.appex" ]] || fail "archive is missing the VPN extension"

  # Ad-hoc signatures preserve the requested entitlements for a re-signing
  # tool. They are not an Apple certificate or a provisioning profile.
  if [[ -d "$app/Frameworks" ]]; then
    while IFS= read -r -d '' framework; do
      executable="$framework/$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$framework/Info.plist")"
      if file "$executable" | grep -q 'dynamically linked shared library'; then
        codesign --force --sign - --timestamp=none "$framework"
      fi
    done < <(find "$app/Frameworks" -maxdepth 1 -name '*.framework' -print0)
  fi
  codesign --force --sign - --timestamp=none \
    --entitlements "$here/Resources/Tunnel.entitlements" "$app/PlugIns/EvaTunnel.appex"
  codesign --force --sign - --timestamp=none \
    --entitlements "$here/Resources/App.entitlements" "$app"

  package="$(mktemp -d "$out/package.XXXXXX")"
  mkdir "$package/Payload"
  ditto "$app" "$package/Payload/EVA VPN.app"
  ipa="$out/EVA-VPN-0.6.0-iOS-unsigned.ipa"
  ditto -c -k --keepParent "$package/Payload" "$ipa"
  (cd "$out" && shasum -a 256 "$(basename "$ipa")" > "$(basename "$ipa").sha256")
  echo "IPA: $ipa (requires Apple signing before installation)"
fi
