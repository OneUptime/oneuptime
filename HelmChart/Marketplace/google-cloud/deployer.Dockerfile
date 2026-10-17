# The deployer image of the Google Cloud Marketplace Kubernetes app, built
# from the context build.py writes (chart/oneuptime, schema.yaml, apptest/):
#
#   docker buildx build --platform linux/amd64 \
#     --build-arg REGISTRY=<registry>/oneuptime-enterprise --build-arg TAG=<version> \
#     --annotation "manifest:com.googleapis.cloudmarketplace.product.service.name=<service name>" \
#     --tag <registry>/oneuptime-enterprise/deployer:<version> --push .
#
# Laid out as Google's own click-to-deploy apps are: the chart and the tester
# chart as tarballs, the schemas with REGISTRY and TAG filled in.
ARG MARKETPLACE_TOOLS_TAG=latest

FROM marketplace.gcr.io/google/debian12 AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext \
    && rm -rf /var/lib/apt/lists/*

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

# OneUptime migrates its database on first start, which takes a few minutes.
ENV WAIT_FOR_READY_TIMEOUT=1800
ENV TESTER_TIMEOUT=1800
