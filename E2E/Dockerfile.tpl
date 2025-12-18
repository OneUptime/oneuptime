#
# OneUptime-E2E Dockerfile
# This file is used to build the E2E docker image which is used to run the E2E tests.
#

# Pull base image nodejs image.

# Note: Alpine Images don't work with Playwright.
FROM public.ecr.aws/docker/library/node:21.6
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

# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi

# Install bash. 
RUN apt-get install bash -y && apt-get install curl -y

# Install python
RUN apt-get update && apt-get install -y .gyp python3 make g++

# Install playwright dependencies
RUN apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libgtk-3-0 libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0 libasound2 libatspi2.0-0


#Use bash shell by default
SHELL ["/bin/bash", "-c"]

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
# Set version in ./Common/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/Common/package.json
RUN npm install
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

# Do not show the html report in the browser when job fails. 
ENV PW_TEST_HTML_REPORT_OPEN='never'

WORKDIR /usr/src/app

# Install app dependencies
COPY ./E2E/package*.json /usr/src/app/
RUN npm install

# Copy app source
COPY ./E2E /usr/src/app

RUN npm run compile
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"
#Run the app
CMD [ "npm", "test" ]