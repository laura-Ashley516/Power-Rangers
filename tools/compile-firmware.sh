#!/bin/bash
# Compile the reminder device firmware without the Arduino IDE window (checks the code builds).
# Usage: tools/compile-firmware.sh [c5|classic]   (default: c5, the team's new board)
# Needs arduino-cli (the Arduino IDE 2 app has one inside) and the libraries listed in firmware/README.md.
# classic = ESP32 Dev Module on core 2.0.17; c5 = ESP32-C5 on core 3.3.x. Both use the Huge APP partition.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${ARDUINO_CLI:-$(command -v arduino-cli || echo "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli")}"
EXTRA=()
[ -n "$ARDUINO_CONFIG" ] && EXTRA=(--config-file "$ARDUINO_CONFIG")      # e.g. a separate folder with core 2.0.17
[ -n "$ARDUINO_LIBS" ] && EXTRA+=(--libraries "$ARDUINO_LIBS")
case "${1:-c5}" in
  c5)      FQBN="esp32:esp32:esp32c5:PartitionScheme=huge_app" ;;
  classic) FQBN="esp32:esp32:esp32:PartitionScheme=huge_app" ;;
  *) echo "Usage: $0 [c5|classic]"; exit 1 ;;
esac
"$CLI" "${EXTRA[@]}" compile --warnings all --fqbn "$FQBN" "$ROOT/firmware/pwr_device"
