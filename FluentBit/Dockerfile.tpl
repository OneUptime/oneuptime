FROM cr.fluentbit.io/fluent/fluent-bit

# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom for consistency with the other images (this image has no build
# steps, so it only affects metadata layering).

LABEL org.opencontainers.image.title="OneUptime Fluent Bit"
LABEL org.opencontainers.image.description="OneUptime Fluent Bit collector — lightweight log shipper for the OneUptime telemetry pipeline."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# This container will only run in dev env, so this is ok.
USER root

EXPOSE 24224
EXPOSE 24284
EXPOSE 2020
EXPOSE 8889

# Per-build metadata last (kept consistent with the other images).
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

CMD ["/fluent-bit/bin/fluent-bit", "-c", "/fluent-bit/etc/fluent-bit.yaml"]