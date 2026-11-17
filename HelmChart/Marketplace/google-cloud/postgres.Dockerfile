# The PostgreSQL image of the Google Cloud Marketplace edition: the official
# image images.json pins (SOURCE), which mirror-images.sh builds this FROM
# instead of copying it (build.py, GOOGLE_CLOUD_BUILT_IMAGES):
#
#   docker buildx build --platform linux/amd64 --provenance=false \
#     --build-arg SOURCE=docker.io/library/postgres:<version>-alpine \
#     --annotation "manifest:com.googleapis.cloudmarketplace.product.service.name=services/<service name>" \
#     --tag <registry>/postgres:<release> --tag <registry>/postgres:<track> --push .
#
# The official image steps down from root with gosu, and every gosu release is
# built with a Go toolchain whose standard library Google's vulnerability scan
# flags (gosu 1.19 and 1.20: Go 1.24.6), so Google refuses an app that ships
# it. Alpine's su-exec takes the same command line and is written in C: it
# replaces gosu under gosu's name, and the image's entrypoint is unchanged.
ARG SOURCE

FROM ${SOURCE}

RUN set -eux; \
    if ! command -v apk >/dev/null; then \
        echo "postgres.Dockerfile takes an Alpine image: pin postgres to an -alpine tag in images.json." >&2; \
        exit 1; \
    fi; \
    apk add --no-cache su-exec; \
    rm -f /usr/local/bin/gosu; \
    ln -s "$(command -v su-exec)" /usr/local/bin/gosu; \
    gosu nobody true
