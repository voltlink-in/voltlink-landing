#!/usr/bin/env bash
# ==============================================================================
# VoltLink Landing Page - Run Script
# Usage: ./run.sh [--dev | --prod | --preview | --stop | --help]
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

MODE="dev"

show_help() {
  echo "VoltLink Landing Page Runner"
  echo ""
  echo "Usage: ./run.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --dev       Start Vite development server on port 5173 (Target: localhost:5174)"
  echo "  --prod      Start Vite production preview server on port 5173 (Target: guradge.voltlink.in)"
  echo "  --preview   Alias for --prod"
  echo "  --stop      Stop any running landing page server on port 5173"
  echo "  --help, -h  Show this help message"
  echo ""
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      MODE="dev"
      shift
      ;;
    --prod|--preview)
      MODE="prod"
      shift
      ;;
    --stop)
      MODE="stop"
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

stop_landing() {
  echo "Stopping any landing page server on port 5173..."
  local pids
  pids=$(lsof -ti :5173 2>/dev/null || true)
  if [ -n "${pids}" ]; then
    kill -9 ${pids} 2>/dev/null || true
    echo "[OK] Stopped landing page server process(es)."
  else
    echo "No process running on port 5173."
  fi
}

run_dev() {
  echo "=== Launching VoltLink Landing Page (Dev Mode via npm run dev) ==="
  if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
  fi
  exec npm run dev
}

run_prod() {
  echo "=== Launching VoltLink Landing Page (Prod Preview Mode via npm run preview) ==="
  if [ ! -d "dist" ]; then
    echo "Dist directory not found. Building production bundle first..."
    npm run build
  fi
  exec npm run preview
}

case "${MODE}" in
  dev)
    run_dev
    ;;
  prod)
    run_prod
    ;;
  stop)
    stop_landing
    ;;
esac
