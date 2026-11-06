#!/usr/bin/env bash
#
# Builds an Iron Bank project's Dockerfile as Iron Bank's pipeline does: on the
# base image its hardening_manifest.yaml's args name (under registry1's ironbank/
# project), with the manifest's labels. Log in to Registry1 and run
# Scripts/IronBank/fetch_resources.sh first.
#
# The build reaches Alpine's or Debian's package repositories for the Dockerfile's
# packages, as Iron Bank's does through its proxy; the Ops suites hold the
# Dockerfiles to fetching nothing else.
#
# Usage:
#   bash Scripts/IronBank/build_image.sh IronBank/App oneuptime/app:iron-bank-preflight
#
# Needs docker and yq (mikefarah's, which GitHub's Ubuntu runners have). The Iron
# Bank Preflight workflow (.github/workflows/iron-bank.yml) runs it.

set -euo pipefail

DIR="${1:?Usage: build_image.sh <directory with hardening_manifest.yaml> <image>}"
IMAGE="${2:?Usage: build_image.sh <directory with hardening_manifest.yaml> <image>}"
MANIFEST="${DIR}/hardening_manifest.yaml"

BASE_IMAGE="$(yq -r '.args.BASE_IMAGE' "$MANIFEST")"
BASE_TAG="$(yq -r '.args.BASE_TAG' "$MANIFEST")"

docker pull --quiet "registry1.dso.mil/ironbank/${BASE_IMAGE}:${BASE_TAG}"
mapfile -t LABELS < <(yq -r '.labels | to_entries | .[] | "--label=" + .key + "=" + .value' "$MANIFEST")
docker build \
	--build-arg BASE_REGISTRY=registry1.dso.mil/ironbank \
	--build-arg BASE_IMAGE="$BASE_IMAGE" \
	--build-arg BASE_TAG="$BASE_TAG" \
	"${LABELS[@]}" \
	-t "$IMAGE" \
	"$DIR"
