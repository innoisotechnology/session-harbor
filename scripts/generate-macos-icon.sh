#!/usr/bin/env bash
set -euo pipefail

SRC_ICON="${1:-assets/icon/icon-1024.png}"
OUT_DIR="assets/icon"
ICONSET_DIR="${OUT_DIR}/app.iconset"

if [[ ! -f "${SRC_ICON}" ]]; then
  echo "Missing source icon at ${SRC_ICON}."
  exit 1
fi

rm -rf "${ICONSET_DIR}"
mkdir -p "${ICONSET_DIR}"

sizes=(16 32 128 256 512 1024)
for size in "${sizes[@]}"; do
  sips -z "${size}" "${size}" "${SRC_ICON}" --out "${ICONSET_DIR}/icon_${size}x${size}.png" >/dev/null
  if [[ "${size}" -lt 1024 ]]; then
    double_size=$((size * 2))
    sips -z "${double_size}" "${double_size}" "${SRC_ICON}" --out "${ICONSET_DIR}/icon_${size}x${size}@2x.png" >/dev/null
  fi
done

iconutil -c icns "${ICONSET_DIR}" -o "${OUT_DIR}/app.icns"
rm -rf "${ICONSET_DIR}"

echo "Wrote ${OUT_DIR}/app.icns"
