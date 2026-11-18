#!/usr/bin/env bash
#
# Copies the images of a marketplace edition into that marketplace's registry,
# as build.py planned them (<out>/images.json):
#
#   HelmChart/Marketplace/mirror-images.sh <out>/images.json [--dry-run]
#
#   aws           linux/amd64 and linux/arm64 (EKS runs both), into the AWS
#                 Marketplace ECR repositories of the product - and nothing
#                 else from the source's index: AWS refuses images with layers
#                 of architectures it does not run, which includes the build
#                 attestations (unknown/unknown) Docker Hub images carry, and
#                 the official images' other platforms (386, s390x...);
#   aws-eks-addon the same, into the repositories of the Kubernetes agent's
#                 add-on product: an EKS add-on must run on both;
#   azure         linux/amd64 only (the only platform Microsoft takes), into
#                 the publisher's Azure Container Registry;
#   google-cloud  linux/amd64 (GKE apps run on x86 nodes), into Artifact
#                 Registry, each image annotated with the listing's Service
#                 Control service and tagged with its track (major.minor) too.
#                 An image the plan gives a build context (PostgreSQL: see
#                 build.py's GOOGLE_CLOUD_BUILT_IMAGES) is built FROM its
#                 source with Docker Buildx, from <out>/<context>/Dockerfile,
#                 instead of copied.
#
# Needs crane (github.com/google/go-containerregistry), and for an image it
# builds Docker Buildx, logged in to the target registry first:
#   aws    aws ecr get-login-password --region us-east-1 | crane auth login 709825985650.dkr.ecr.us-east-1.amazonaws.com -u AWS --password-stdin
#   azure  az acr login --name <registry> --expose-token ... | crane auth login <registry>.azurecr.io -u 00000000-0000-0000-0000-000000000000 --password-stdin
#   google gcloud auth print-access-token | crane auth login us-docker.pkg.dev -u oauth2accesstoken --password-stdin
#
# --dry-run prints what it would do and touches nothing.

set -euo pipefail

usage() {
    echo "usage: $(basename "$0") <out>/images.json [--dry-run]" >&2
    exit 2
}

[ $# -ge 1 ] || usage

PLAN="$1"
DRY_RUN="false"

if [ "${2:-}" = "--dry-run" ]; then
    DRY_RUN="true"
fi

[ -f "$PLAN" ] || { echo "No such plan: $PLAN" >&2; exit 2; }

run() {
    echo "+ $*"

    if [ "$DRY_RUN" != "true" ]; then
        "$@"
    fi
}

if [ "$DRY_RUN" != "true" ] && ! command -v crane >/dev/null 2>&1; then
    echo "crane is not installed: brew install crane (or go install github.com/google/go-containerregistry/cmd/crane@latest)." >&2
    exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$(dirname "$PLAN")" && pwd)"

# One line per image: marketplace, source, target, extra tags (comma-separated, maybe none)
# and build context ("-" for an image copied), split by a unit separator: not whitespace, so
# read keeps an empty field.
python3 - "$PLAN" <<'PYTHON' >"${TMPDIR:-/tmp}/oneuptime-marketplace-mirror.$$"
import json
import sys

plan = json.load(open(sys.argv[1]))

for image in plan["images"]:
    print("\x1f".join([
        plan["marketplace"],
        image["source"],
        image["target"],
        ",".join(image.get("extraTags", [])),
        image.get("build") or "-",
    ]))
PYTHON

SERVICE_NAME="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["google-cloud"]["serviceName"])' "$HERE/editions.json")"

while IFS=$'\x1f' read -r marketplace source target extra_tags build; do
    case "$marketplace" in
        aws | aws-eks-addon)
            # A release's image is the same image every time, and AWS Marketplace's repositories
            # may refuse to overwrite a tag: one an earlier run copied is left as it is.
            if [ "$DRY_RUN" != "true" ] && crane digest "$target" >/dev/null 2>&1; then
                echo "= $target is there already"
                continue
            fi

            run crane index filter "$source" --platform linux/amd64 --platform linux/arm64 --tag "$target"
            ;;
        azure)
            run crane copy --platform linux/amd64 "$source" "$target"
            ;;
        google-cloud)
            if [ "$build" != "-" ]; then
                if [ "$DRY_RUN" != "true" ] && ! docker buildx version >/dev/null 2>&1; then
                    echo "Docker Buildx is not available: it builds $target." >&2
                    exit 1
                fi

                tag_options=(--tag "$target")
                IFS=',' read -r -a tags <<<"$extra_tags"
                for tag in "${tags[@]}"; do
                    [ -n "$tag" ] && tag_options+=(--tag "${target%:*}:${tag}")
                done

                # stdin is the plan this loop reads: the build gets none of it.
                run docker buildx build --platform linux/amd64 --provenance=false \
                    --build-arg "SOURCE=${source}" \
                    --annotation "manifest:com.googleapis.cloudmarketplace.product.service.name=services/${SERVICE_NAME}" \
                    "${tag_options[@]}" --push "${OUT}/${build}" </dev/null
                continue
            fi

            run crane copy --platform linux/amd64 "$source" "$target"
            run crane mutate --annotation "com.googleapis.cloudmarketplace.product.service.name=services/${SERVICE_NAME}" --tag "$target" "$target"

            IFS=',' read -r -a tags <<<"$extra_tags"
            for tag in "${tags[@]}"; do
                [ -n "$tag" ] && run crane tag "$target" "$tag"
            done
            ;;
        *)
            echo "Unknown marketplace in the plan: $marketplace" >&2
            exit 1
            ;;
    esac
done <"${TMPDIR:-/tmp}/oneuptime-marketplace-mirror.$$"

rm -f "${TMPDIR:-/tmp}/oneuptime-marketplace-mirror.$$"
