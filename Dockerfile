# This file is work in progress and will not build yet.

FROM node:18.13.0-alpine

USER root
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global
RUN npm install -g pm2

# Install bash. 
RUN apk update && apk add bash && apk add curl

RUN mkdir /usr/src/oneuptime

WORKDIR /usr/src/oneuptime

COPY . /usr/src/oneuptime/

ENV IS_DOCKER=true

RUN bash ./Scripts/NodeModulesScripts/install-node-modules.sh

# Expose ports.
#   - 80: OneUptime HTTP
#   - 443: OneUptime HTTPS


EXPOSE 80

ENTRYPOINT ["pm2", "--no-daemon", "start"]

# Actual script to start can be overridden from `docker run`
CMD ["process.json"]