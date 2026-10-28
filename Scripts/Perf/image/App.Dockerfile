# The App as its production image runs it (packages/App/Dockerfile.tpl's
# community stage): node:26-alpine3.24 (musl), npm ci of Common and App,
# the sources at /usr/src/Common and /usr/src/app, the node user, transpile-only
# ts-node and the image's own CMD. Left out: the frontends' production builds
# (the Dashboard's bundle is copied in from the checkout) and the build-time
# type check.
FROM public.ecr.aws/docker/library/node:26-alpine3.24
RUN apk upgrade --no-cache \
    && apk add --no-cache bash curl \
    && apk add --no-cache --virtual .gyp python3 make g++
SHELL ["/bin/bash", "-c"]
RUN mkdir /usr/src
WORKDIR /usr/src/Common
COPY packages/Common/package*.json /usr/src/Common/
RUN npm ci --prefer-offline --no-audit --no-fund
WORKDIR /usr/src/app
COPY packages/App/package*.json /usr/src/app/
RUN npm ci --prefer-offline --no-audit --no-fund && rm -rf node_modules/aedes/examples
RUN apk del .gyp
COPY packages/Common /usr/src/Common
COPY --chown=1000:1000 packages/App /usr/src/app
ENV PRODUCTION=true
ENV IS_ENTERPRISE_EDITION=false
USER node
ENV TS_NODE_TRANSPILE_ONLY=1
CMD [ "sh", "-c", "export NODE_OPTIONS=\"--max-old-space-size=8096${NODE_OPTIONS:+ $NODE_OPTIONS}\" && exec node --no-node-snapshot --require ts-node/register Index.ts" ]
