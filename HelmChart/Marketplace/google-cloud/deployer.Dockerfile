# The deployer image of the Google Cloud Marketplace Kubernetes app, built
# from the context build.py writes (chart/oneuptime, schema.yaml, apptest/):
#
#   docker buildx build --platform linux/amd64 --provenance=false \
#     --build-arg REGISTRY=<registry> --build-arg TAG=<version> \
#     --annotation "manifest:com.googleapis.cloudmarketplace.product.service.name=services/<service name>" \
#     --tag <registry>/deployer:<version> --tag <registry>/deployer:<track> --push .
#
# <registry> is the app's path in Artifact Registry and <service name> its
# Service Control service (editions.json, google-cloud); <track> is major.minor.
#
# Laid out as Google's own click-to-deploy apps are: the chart and the tester's
# template (which a verification run lays over the chart) as tarballs, the
# schemas with REGISTRY and TAG filled in.
#
# Google serves its deployer image (gcr.io/cloud-marketplace-tools) only to a
# signed-in Google account: `docker login gcr.io` first. The build stage ships
# nothing but the files it makes, so it starts from a public image, and
# `--target build` builds everything but the deployer with no sign-in at all.
ARG MARKETPLACE_TOOLS_TAG=latest

FROM debian:12-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gettext \
    && rm -rf /var/lib/apt/lists/*

# The kubectl the deployer runs, in place of the one Google's deployer_helm
# ships. 13.0.18, the newest, ships kubectl v1.37.2, built with Go 1.26.10:
# Google's vulnerability scan refuses it (CVE-2026-97040, fixed in Go 1.26.11),
# in the deployer as in every other image. v1.37.3 is built with Go 1.26.11.
# Pinned by version and sha256 (dl.k8s.io publishes kubectl.sha256 next to the
# binary). Drop this, and the COPY below, once deployer_helm's own kubectl is
# built with a Go the scan accepts; move it to a newer patch when the scan
# flags this one.
ARG KUBECTL_VERSION=v1.37.3
ARG KUBECTL_SHA256=9a1b55af2795b25dd288dbef62387db9b5530087ab918d28c6ad067f2e3cb07c
RUN curl -fsSL --retry 6 --retry-all-errors -o /tmp/kubectl \
        "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && echo "${KUBECTL_SHA256}  /tmp/kubectl" | sha256sum -c - \
    && chmod 0755 /tmp/kubectl

ADD chart/oneuptime /tmp/chart
RUN cd /tmp && tar -czf /tmp/oneuptime.tar.gz chart

ADD apptest/deployer/oneuptime /tmp/test/chart
RUN cd /tmp/test && tar -czf /tmp/test/oneuptime.tar.gz chart

ARG REGISTRY
ARG TAG

ADD schema.yaml /tmp/schema.yaml
RUN env -i "REGISTRY=$REGISTRY" "TAG=$TAG" envsubst < /tmp/schema.yaml > /tmp/schema.yaml.new \
    && mv /tmp/schema.yaml.new /tmp/schema.yaml

ADD apptest/deployer/schema.yaml /tmp/apptest/schema.yaml
RUN env -i "REGISTRY=$REGISTRY" "TAG=$TAG" envsubst < /tmp/apptest/schema.yaml > /tmp/apptest/schema.yaml.new \
    && mv /tmp/apptest/schema.yaml.new /tmp/apptest/schema.yaml

FROM gcr.io/cloud-marketplace-tools/k8s/deployer_helm:$MARKETPLACE_TOOLS_TAG

COPY --from=build /tmp/oneuptime.tar.gz /data/chart/
COPY --from=build /tmp/test/oneuptime.tar.gz /data-test/chart/
COPY --from=build /tmp/apptest/schema.yaml /data-test/
COPY --from=build /tmp/schema.yaml /data/

# Over deployer_helm's own kubectl, which /opt/kubectl/default points to. The
# test stops the build if that kubectl moved (a deployer_helm on another
# Kubernetes minor): then this one replaces nothing, and the pin above needs a
# look.
RUN test "$(readlink -f /opt/kubectl/default)" = /opt/kubectl/v1.37 \
    && test -x /opt/kubectl/v1.37/kubectl
COPY --from=build /tmp/kubectl /opt/kubectl/v1.37/kubectl

# OneUptime migrates its database on first start, which takes a few minutes.
ENV WAIT_FOR_READY_TIMEOUT=1800
ENV TESTER_TIMEOUT=1800
