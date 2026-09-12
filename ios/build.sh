#!/usr/bin/env bash
#
# Сборка iOS-клиента EVA VPN.
#
# Запускать только на macOS: Xcode существует только там, и библиотека ядра
# под Apple собирается его же инструментами. На Windows и Linux этот скрипт
# честно остановится, а не будет делать вид, что работает.
#
#   ./build.sh            собрать библиотеку ядра и создать проект Xcode
#   ./build.sh --open     то же плюс открыть проект
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

fail() { echo "ошибка: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "нужен macOS: Xcode есть только там"
command -v xcodebuild >/dev/null || fail "не найден Xcode (xcodebuild)"
command -v go >/dev/null || fail "не найден Go — нужен 1.25.x, как в CI sing-box"
command -v xcodegen >/dev/null || fail "не найден xcodegen: brew install xcodegen"

# Версия Go важна: на 1.27 сборка падает с «undefined: json.SkipFunc»,
# потому что go-json-experiment подменяет себя стандартным encoding/json/v2,
# а его состав в 1.27 уже другой. Подробности — в scripts/build-libbox.mjs.
go_version="$(go env GOVERSION)"
case "$go_version" in
  go1.25*) ;;
  *) echo "внимание: Go $go_version, а проверено на 1.25.x — если сборка упадёт, дело в этом" ;;
esac

singbox="${EVA_SINGBOX_SRC:-$HOME/android-build/src/sing-box}"
[[ -d "$singbox" ]] || fail "не найдены исходники sing-box: $singbox
  git clone --depth 1 --branch v1.13.12 https://github.com/SagerNet/sing-box.git \"$singbox\"
  или задайте путь через EVA_SINGBOX_SRC"

echo "== ставлю gomobile ветки SagerNet =="
# Важно: именно их ветка, а не golang.org/x/mobile — апстримный gomobile
# не понимает, как sing-box описывает интерфейс платформы.
go install -v github.com/sagernet/gomobile/cmd/gomobile@v0.1.12
go install -v github.com/sagernet/gomobile/cmd/gobind@v0.1.12

echo "== собираю Libbox.xcframework =="
(
  cd "$singbox"
  go run ./cmd/internal/build_libbox -target apple
)

framework="$singbox/Libbox.xcframework"
[[ -d "$framework" ]] || fail "сборка прошла, но Libbox.xcframework не найден"

rm -rf "$here/Libbox.xcframework"
cp -R "$framework" "$here/Libbox.xcframework"
echo "   библиотека на месте: ios/Libbox.xcframework"

echo "== создаю проект Xcode =="
(cd "$here" && xcodegen generate)

echo
echo "готово. Дальше:"
echo "  1. Откройте ios/EVA VPN.xcodeproj"
echo "  2. В настройках обеих целей укажите свою команду разработчика (Team)"
echo "  3. Зарегистрируйте группу приложений group.ai.theeva.vpn"
echo "  4. Запустите на устройстве — в симуляторе VPN не работает"

if [[ "${1:-}" == "--open" ]]; then
  open "$here/EVA VPN.xcodeproj"
fi
