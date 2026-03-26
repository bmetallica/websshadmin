#!/bin/bash
set -e

REGISTRY="192.168.66.12:5000"
IMAGE_NAME="web-ssh-client"
TAG="latest"

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

echo "==> Building Docker image: ${FULL_IMAGE}"
docker build -t "${FULL_IMAGE}" .

echo "==> Pushing to registry: ${REGISTRY}"
docker push "${FULL_IMAGE}"

echo "==> Done! Image pushed: ${FULL_IMAGE}"
