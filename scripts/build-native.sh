#!/usr/bin/env bash
# Build libopus_mlow (the MLow/SMPL Opus fork) as a shared library and place it
# in prebuilds/<platform>-<arch>/. Works on Linux (.so) and macOS (.dylib).
#
# Requirements:
#   Linux:  apt install -y build-essential cmake git   (or distro equivalent)
#   macOS:  xcode-select --install && brew install cmake git
set -euo pipefail

REPO="${OPUS_MLOW_REPO:-https://github.com/edgardmessias/opus_mlow.git}"
# NO REF BY DEFAULT: clone whatever the repository calls its default branch.
# It used to default to "master"; the fork only has "main", so a clean machine
# got `Remote branch master not found` and no library — the build never ran
# anywhere except where someone passed OPUS_MLOW_REF by hand.
REF="${OPUS_MLOW_REF:-}"

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${PKG_DIR}/vendor/opus_mlow"
BUILD_DIR="${SRC_DIR}/build"

case "$(uname -s)" in
  Darwin) EXT="dylib" ; PLATFORM="darwin" ;;
  Linux)  EXT="so"    ; PLATFORM="linux"  ;;
  *) echo "unsupported platform: $(uname -s)" >&2 ; exit 1 ;;
esac
ARCH="$(node -p 'process.arch' 2>/dev/null || echo "$(uname -m)")"
OUT_DIR="${PKG_DIR}/prebuilds/${PLATFORM}-${ARCH}"

echo "==> opus_mlow: ${REPO}@${REF:-default}  ->  ${OUT_DIR}/libopus_mlow.${EXT}"

if [ ! -d "${SRC_DIR}/.git" ]; then
  rm -rf "${SRC_DIR}"
  if [ -n "${REF}" ]; then
    git clone --depth 1 --branch "${REF}" "${REPO}" "${SRC_DIR}"
  else
    git clone --depth 1 "${REPO}" "${SRC_DIR}"
  fi
fi

cmake -S "${SRC_DIR}" -B "${BUILD_DIR}" \
  -DOPUS_BUILD_SHARED_LIBRARY=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -DOPUS_BUILD_PROGRAMS=OFF \
  -DOPUS_BUILD_TESTING=OFF \
  -DOPUS_INSTALL_PKG_CONFIG_MODULE=OFF \
  -DOPUS_INSTALL_CMAKE_CONFIG_MODULE=OFF

cmake --build "${BUILD_DIR}" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

mkdir -p "${OUT_DIR}"
# The fork builds libopus.<ext>; ship it renamed so the loader is unambiguous.
LIB="$(find "${BUILD_DIR}" -maxdepth 1 -name "libopus.*${EXT}" ! -type l | head -1)"
if [ -z "${LIB}" ]; then
  LIB="$(find "${BUILD_DIR}" -maxdepth 1 -name "libopus.${EXT}" | head -1)"
fi
cp "${LIB}" "${OUT_DIR}/libopus_mlow.${EXT}"
echo "==> done: ${OUT_DIR}/libopus_mlow.${EXT}"
