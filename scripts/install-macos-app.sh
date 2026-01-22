#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Session Harbor.app"
DIST_DIR="dist-electron"
TARGET_DIR="/Applications"

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "Missing ${DIST_DIR}. Run the desktop build first."
  exit 1
fi

DMG_PATH="$(ls -t "${DIST_DIR}"/Session\ Harbor-*.dmg 2>/dev/null | head -n 1 || true)"
ZIP_PATH="$(ls -t "${DIST_DIR}"/Session\ Harbor-*-mac.zip 2>/dev/null | head -n 1 || true)"

if [[ -n "${DMG_PATH}" ]]; then
  echo "Installing from ${DMG_PATH}..."
  MOUNT_DIR="$(mktemp -d)"
  hdiutil attach "${DMG_PATH}" -mountpoint "${MOUNT_DIR}" -nobrowse -quiet
  if [[ ! -d "${MOUNT_DIR}/${APP_NAME}" ]]; then
    hdiutil detach "${MOUNT_DIR}" -quiet
    rm -rf "${MOUNT_DIR}"
    echo "App not found in DMG."
    exit 1
  fi
  sudo ditto "${MOUNT_DIR}/${APP_NAME}" "${TARGET_DIR}/${APP_NAME}"
  hdiutil detach "${MOUNT_DIR}" -quiet
  rm -rf "${MOUNT_DIR}"
  echo "Installed to ${TARGET_DIR}/${APP_NAME}"
  exit 0
fi

if [[ -n "${ZIP_PATH}" ]]; then
  echo "Installing from ${ZIP_PATH}..."
  TMP_DIR="$(mktemp -d)"
  ditto -xk "${ZIP_PATH}" "${TMP_DIR}"
  if [[ ! -d "${TMP_DIR}/${APP_NAME}" ]]; then
    rm -rf "${TMP_DIR}"
    echo "App not found in ZIP."
    exit 1
  fi
  sudo ditto "${TMP_DIR}/${APP_NAME}" "${TARGET_DIR}/${APP_NAME}"
  rm -rf "${TMP_DIR}"
  echo "Installed to ${TARGET_DIR}/${APP_NAME}"
  exit 0
fi

echo "No DMG or ZIP found in ${DIST_DIR}."
exit 1
