#
# OneUptime-OpenTelemetryIngest Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:23.8
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 100000
RUN npm config set fetch-retry-maxtimeout 600000


ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE=false

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE=${IS_ENTERPRISE}
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_OPTIONS="--use-openssl-ca"

## Add Intermediate Certs 
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN update-ca-certificates


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi


RUN apt-get update

# Install bash. 
RUN apt-get install bash -y && apt-get install curl -y && apt-get install iputils-ping -y

# Install python
RUN apt-get update && apt-get install -y .gyp python3 make g++

# Install playwright dependencies
RUN apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libgtk-3-0 libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0 libasound2 libatspi2.0-0

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Install iputils
RUN apt-get install net-tools -y

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
# Set version in ./Common/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/Common/package.json
RUN npm install
COPY ./Common /usr/src/Common



ENV PRODUCTION=true

WORKDIR /usr/src/app

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx playwright install --with-deps

# Install app dependencies
COPY ./OpenTelemetryIngest/package*.json /usr/src/app/
RUN npm install

# Expose ports.
#   - 3403: OneUptime-OpenTelemetryIngest
EXPOSE 3403

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./OpenTelemetryIngest /usr/src/app
# Bundle app source
RUN npm run compile
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"
#Run the app
CMD [ "npm", "start" ]
{{ end }}

