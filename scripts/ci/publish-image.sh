#!/usr/bin/env bash
set -euo pipefail
: "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}" "${IMAGE_NAME:?}" "${IMAGE_TAG:?}"
registry=gitea.example.com
# A single native builder on container-build reuses unpacked layers. Do not
# export every intermediate layer to the registry or archive the build cache.
export DOCKER_CONFIG="${RUNNER_TEMP:?}/container-registry"
export BUILDX_CONFIG=/opt/hostedtoolcache/container-images-buildx
mkdir -m 700 -p "$DOCKER_CONFIG" "$BUILDX_CONFIG"
started=false
cleanup() {
  if "$started"; then docker buildx stop container-images >/dev/null 2>&1 || true; fi
  rm -rf "$DOCKER_CONFIG"
}
trap cleanup EXIT
printf '%s' "$REGISTRY_TOKEN" | docker login "$registry" -u "$REGISTRY_USER" --password-stdin
unset REGISTRY_TOKEN
if ! docker buildx inspect container-images >/dev/null 2>&1; then
  docker buildx create --name container-images --driver docker-container \
    --driver-opt image=moby/buildkit@sha256:98cc6a3fc46220d00f8224ae483f3274fc874e9be8d7dd1e2e2c5481209228b5 \
    --buildkitd-config scripts/ci/buildkitd.toml
fi
started=true
args=(--builder container-images --platform linux/amd64 --provenance=false
      --tag "$registry/$IMAGE_NAME:$IMAGE_TAG")
if [[ "${PUBLISH_LATEST:-true}" == true && "$IMAGE_TAG" != latest ]]; then args+=(--tag "$registry/$IMAGE_NAME:latest"); fi
docker buildx build "${args[@]}" --push "${IMAGE_CONTEXT:-.}"
docker buildx imagetools inspect "$registry/$IMAGE_NAME:$IMAGE_TAG"
