#!/usr/bin/env bash
# ==============================================================================
# VoltLink Landing Page - Build Script
# Usage: ./build.sh [--dev | --prod | --all | --help]
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

MODE="all"

show_help() {
  echo "VoltLink Landing Page Build Script"
  echo ""
  echo "Usage: ./build.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --dev        Build development bundle (target garage: localhost:5174) -> dist/dev"
  echo "  --prod       Build production bundle (target garage: guradge.voltlink.in) -> dist/prod & dist"
  echo "  --all        Build both development and production bundles (default)"
  echo "  --help, -h   Show this help message"
  echo ""
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      MODE="dev"
      shift
      ;;
    --prod)
      MODE="prod"
      shift
      ;;
    --all)
      MODE="all"
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

echo "=== Building VoltLink Landing Page [Mode: ${MODE}] ==="

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

build_dev() {
  echo "Building development bundle (--mode development -> dist/dev)..."
  mkdir -p dist/dev
  npx vite build --mode development --outDir dist/dev
}

build_prod() {
  echo "Building production bundle (npm run build -> dist & dist/prod)..."
  npm run build
  mkdir -p dist/prod
  cp -r dist/* dist/prod/ 2>/dev/null || true
}

case "${MODE}" in
  dev)
    build_dev
    ;;
  prod)
    build_prod
    ;;
  all)
    build_prod
    build_dev
    echo "[OK] Built Landing Page (both dev & prod) in dist, dist/dev, and dist/prod"
    ;;
esac
