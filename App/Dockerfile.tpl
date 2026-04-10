#
# OneUptime-App Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:24.9-alpine3.21
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000



ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

LABEL org.opencontainers.image.title="OneUptime App"
LABEL org.opencontainers.image.description="OneUptime core application server — dashboard API, workers, and telemetry ingestion."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi


# Install bash. 
RUN apk add bash && apk add curl


# Install python
RUN apk update && apk add --no-cache --virtual .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]


RUN mkdir /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
# Set version in ./Common/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/Common/package.json
RUN npm install
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./App/package*.json /usr/src/app/
# Set version in ./App/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/app/package.json
RUN npm install

WORKDIR /usr/src/app/FeatureSet/Accounts
COPY ./App/FeatureSet/Accounts/package*.json /usr/src/app/FeatureSet/Accounts/
RUN npm install

WORKDIR /usr/src/app/FeatureSet/Dashboard
COPY ./App/FeatureSet/Dashboard/package*.json /usr/src/app/FeatureSet/Dashboard/
RUN npm install

WORKDIR /usr/src/app/FeatureSet/AdminDashboard
COPY ./App/FeatureSet/AdminDashboard/package*.json /usr/src/app/FeatureSet/AdminDashboard/
RUN npm install

WORKDIR /usr/src/app/FeatureSet/StatusPage
COPY ./App/FeatureSet/StatusPage/package*.json /usr/src/app/FeatureSet/StatusPage/
RUN npm install

WORKDIR /usr/src/app/FeatureSet/PublicDashboard
COPY ./App/FeatureSet/PublicDashboard/package*.json /usr/src/app/FeatureSet/PublicDashboard/
RUN npm install

WORKDIR /usr/src/app

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./App /usr/src/app
# Copy frontend sources
COPY ./App/FeatureSet/Accounts /usr/src/app/FeatureSet/Accounts
COPY ./App/FeatureSet/Dashboard /usr/src/app/FeatureSet/Dashboard
COPY ./App/FeatureSet/AdminDashboard /usr/src/app/FeatureSet/AdminDashboard
COPY ./App/FeatureSet/StatusPage /usr/src/app/FeatureSet/StatusPage
COPY ./App/FeatureSet/PublicDashboard /usr/src/app/FeatureSet/PublicDashboard
# Bundle frontend source
RUN npm run build-frontends:prod
# Bundle app source
RUN npm run compile
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"
#Run the app
CMD [ "npm", "start" ]
{{ end }}
