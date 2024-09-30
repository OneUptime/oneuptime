#
# OneUptime-App Dockerfile
#

# Pull base image nodejs image.
FROM node:21.2
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 100000
RUN npm config set fetch-retry-maxtimeout 600000



ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi

RUN apt-get update

# Install bash. 
RUN apt-get install bash -y && apt-get install curl -y


# Install python
RUN apt-get install .gyp python3 make g++ -y

#Use bash shell by default
SHELL ["/bin/bash", "-c"]


WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
# Set version in ./Common/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/Common/package.json
RUN npm install
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app

RUN npx playwright install --with-deps

# Install app dependencies
COPY ./App/package*.json /usr/src/app/
# Set version in ./App/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/app/package.json
RUN npm install

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./App /usr/src/app
# Bundle app source
RUN npm run compile
#Run the app
CMD [ "npm", "start" ]
{{ end }}
