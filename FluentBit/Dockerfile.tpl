FROM cr.fluentbit.io/fluent/fluent-bit

ARG IS_ENTERPRISE=false
ENV IS_ENTERPRISE=${IS_ENTERPRISE}

# This container will only run in dev env, so this is ok.
USER root

EXPOSE 24224
EXPOSE 24284
EXPOSE 2020
EXPOSE 8889

CMD ["/fluent-bit/bin/fluent-bit", "-c", "/fluent-bit/etc/fluent-bit.yaml"]