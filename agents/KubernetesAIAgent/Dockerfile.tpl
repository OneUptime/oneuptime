# syntax=docker/dockerfile:1.7
#
# OneUptime Kubernetes AI Agent Dockerfile
#
# Runs the kubectl commands OneUptime AI asks for inside a customer's
# cluster, with the pod's own ServiceAccount — read-only unless the
# kubernetes-agent Helm chart grants writes. Installed by that chart
# (templates/ai-agent.yaml).
#

# kubectl, downloaded and verified in its own stage so the download tool
# never ships. Pinned by version AND sha256 per architecture, to the SAME
# ARG KUBECTL_VERSION and digests as packages/Runner/Dockerfile.tpl (the docs
# tests hold the two files together): v1.36.5 (go1.26.8) covers 1.35-1.37
# servers. Bump KUBECTL_VERSION and both digests together, in both files, at
# least once per Kubernetes minor release (dl.k8s.io publishes
# kubectl.sha256 next to each binary), and whenever a patch release clears
# findings an image scan reports in it. What a bump must re-check is in
# packages/Runner/Dockerfile.tpl.
FROM public.ecr.aws/docker/library/node:26-alpine3.24 AS kubectl
ARG TARGETARCH
ARG KUBECTL_VERSION=v1.36.5
ARG KUBECTL_SHA256_AMD64=33bc88a24c3b09cf55bfd59e6ca977881b61fc3f25ab65bc80c65b430248648e
ARG KUBECTL_SHA256_ARM64=88fc1aca8fd0c1b44fe379f67c39bd6858bdfc50241dc55775f84d0f5b31da3a
RUN set -eu \
  && apk add --no-cache curl \
  && arch="${TARGETARCH:-amd64}" \
  && case "${arch}" in \
       amd64) sha256="${KUBECTL_SHA256_AMD64}" ;; \
       arm64) sha256="${KUBECTL_SHA256_ARM64}" ;; \
       *) echo "unsupported TARGETARCH ${arch}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL --retry 6 --retry-all-errors -o /tmp/kubectl \
       "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" \
  && echo "${sha256}  /tmp/kubectl" | sha256sum -c - \
  && install -m 0755 /tmp/kubectl /usr/local/bin/kubectl \
  && rm -f /tmp/kubectl \
  && /usr/local/bin/kubectl version --client

# Alpine, like the other Kubernetes agents. The agent is plain JavaScript
# (no native modules) and needs nothing from the OS beyond CA certificates,
# tini and the kubectl binary copied in below.
FROM public.ecr.aws/docker/library/node:26-alpine3.24

# Update npm to npm@latest with every dependency it bundles (tar, undici,
# brace-expansion, ip-address, ...) reinstalled at the newest version npm's own
# ranges accept. `npm install -g npm@latest` alone ships the dependencies npm
# was packed with, and scanners flagged them in every image. See
# Scripts/Docker/UpdateNpmCli.js.
COPY ./Scripts/Docker/UpdateNpmCli.js /tmp/UpdateNpmCli.js
RUN node /tmp/UpdateNpmCli.js && rm /tmp/UpdateNpmCli.js

# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm ci / compile layers stay cacheable across commits and
# across the community + enterprise build passes.
ENV NODE_OPTIONS="--use-openssl-ca"

# Clusters that reach OneUptime only through an egress proxy set
# HTTPS_PROXY / HTTP_PROXY / NO_PROXY (the chart's aiAgent.extraEnv). The
# agent switches Node's proxy support on itself at start-up
# (http.setGlobalProxyFromEnv, see Proxy.ts). NODE_USE_ENV_PROXY=1 is NOT set
# on purpose: with it, Node parses those variables before any agent code runs,
# and one typo (a URL without http://) kills the process on every start — a
# crash-looping pod instead of a log line saying what to fix. kubectl never
# sees the proxy: its environment is built from scratch for every command.

LABEL org.opencontainers.image.title="OneUptime Kubernetes AI Agent"
LABEL org.opencontainers.image.description="OneUptime Kubernetes AI agent — runs the kubectl commands OneUptime AI asks for inside your cluster, with its own ServiceAccount (read-only unless you allow fixes)."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

## Add intermediate CA certs
COPY ./packages/Common/SslCertificates /usr/local/share/ca-certificates
{{- if file.Exists "SslCertificates" }}
COPY ./SslCertificates /usr/local/share/ca-certificates
{{- end }}
# `apk upgrade` pulls in Alpine security fixes published since the base
# image was built; --no-cache keeps the apk index out of the layer.
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates tini \
    && update-ca-certificates

COPY --from=kubectl /usr/local/bin/kubectl /usr/local/bin/kubectl

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./agents/KubernetesAIAgent/package*.json /usr/src/app/
# Uses the node image's default cache path (~/.npm) rather than the /tmp/npm
# convention the other images set — npm config was never customized here.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --prefer-offline

# The node base image already ships a non-root `node` user at UID/GID 1000.
# Reuse it rather than creating our own (a second user with GID 1000 cannot be
# created). UID 1000 is what the Helm chart's securityContext.runAsUser
# requests. The agent writes nothing outside /tmp (the chart mounts an
# emptyDir there under a read-only root filesystem).
RUN chown -R node:node /usr/src/app

# Alpine's tini package installs the binary at /sbin/tini.
ENTRYPOINT ["/sbin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
USER node
CMD [ "npm", "run", "dev" ]
{{ else }}
COPY --chown=node:node ./agents/KubernetesAIAgent /usr/src/app
RUN npm run compile
USER node
# Per-build metadata last so the npm ci / compile layers above stay cacheable
# across commits and across the community + enterprise build passes.
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
CMD [ "node", "build/dist/Index.js" ]
{{ end }}
