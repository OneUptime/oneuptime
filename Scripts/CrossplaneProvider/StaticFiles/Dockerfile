# The provider's runtime image: the provider binary, built for the image's
# platform into bin/<os>_<arch>/ (Scripts/CrossplaneProvider/build-package.sh),
# on a distroless base that has nothing else, run as a user that is not root.
FROM gcr.io/distroless/static-debian12:nonroot

# Links the package GHCR keeps to the repository it is made in, as the
# repository's other images do.
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"

ARG TARGETOS
ARG TARGETARCH

COPY bin/${TARGETOS}_${TARGETARCH}/provider /usr/local/bin/provider

USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/provider"]
