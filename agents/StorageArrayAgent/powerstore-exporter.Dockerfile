# Dell's PowerStore Metrics Exporter (github.com/dell/powerstore-metrics-exporter,
# Apache-2.0), as the OneUptime Storage Array Agent runs it for a Dell
# PowerStore. Dell publishes the exporter as a release binary, not as an image,
# and its README builds the image from the binary on busybox, which is what this
# does: the base Dell's own Dockerfile names, and the binary of the release
# pinned below, checked against its SHA-256 before it is used. The binary is
# statically linked (x86-64), so the image needs nothing else.
#
# docker-compose.yml builds this image the first time the `powerstore` profile
# starts, and again only when its image tag changes: the tag is the pinned
# release and this file's revision (1.0.3-1), so change it with any change
# here. The exporter's config, which holds the PowerStore user's password, is
# never part of the image: the compose service writes it from .env to a tmpfs
# when the container starts.
#
# Move this pin only together with a new recording of the exporter's output
# (packages/Common/Tests/Fixtures/DellPowerStoreExporter, see its README): the
# release, its SHA-256 and the image tag in docker-compose.yml move together.
FROM quay.io/prometheus/busybox-linux-amd64:latest@sha256:a851e9241d003db87121bcca8f940a2f88b367d2969955c517a883173360e887

# powerstore-metrics-exporter_v1.0.3: commit 564df4d, 5 February 2026. Dell
# publishes the binary's SHA-1 beside it
# (c2524cc773679965c575b5001c65a909e65c1ba6); this is its SHA-256.
ADD https://github.com/dell/powerstore-metrics-exporter/releases/download/powerstore-metrics-exporter_v1.0.3/powerstore-metrics-exporter /powerstore-exporter/powerstore-metrics-exporter

RUN echo "1b7996e11d8b4e3dd09d3145738aa87aac7a3959470c8b531f71999229d470fc  /powerstore-exporter/powerstore-metrics-exporter" | sha256sum -c - \
 && chmod 0555 /powerstore-exporter/powerstore-metrics-exporter

# The exporter needs no privileges: it listens on 9010 and writes only its
# config and the bulk metrics archive, both on the tmpfs the compose service
# mounts at /tmp.
USER 65534:65534

EXPOSE 9010

ENTRYPOINT ["/powerstore-exporter/powerstore-metrics-exporter"]
