#!/usr/bin/env bash
# Build and push webSSHadmin to local registry
# Usage: ./build-push.sh [tag]   (default tag: latest)
set -euo pipefail

REGISTRY="192.168.66.12:5000"
IMAGE="websshadmin"
TAG="${1:-latest}"
FULL="${REGISTRY}/${IMAGE}:${TAG}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Build: ${FULL}"
docker build --pull -t "${FULL}" "${SCRIPT_DIR}"

echo "==> Push:  ${FULL}"
docker push "${FULL}"

echo "==> Done! Image available at ${FULL}"
docker compose down
docker compose pull
docker compose up -d 