# This file is work in progress and will not build yet.

FROM docker:latest

# Install bash. 
RUN apk update && apk add bash && apk add curl && apk add sudo && apk add nodejs && apk add npm && apk add gomplate

RUN npm i -g ts-node

RUN mkdir /usr/src
RUN mkdir /usr/src/oneuptime

WORKDIR /usr/src/oneuptime

COPY . /usr/src/oneuptime/

RUN bash ./Scripts/Install/generate-secrets.sh
RUN bash ./Scripts/Install/generate-env-files.sh

RUN docker compose build

# Expose ports.
#   - 80: OneUptime HTTP
#   - 443: OneUptime HTTPS


EXPOSE 80

