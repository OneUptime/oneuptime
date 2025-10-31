#
# OneUptime-App Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:24.9-alpine3.21
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

# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi

# Install bash. 
RUN apk add bash && apk add curl && apk add git


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
COPY ./Home/package*.json /usr/src/app/
# Set version in ./App/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/app/package.json
RUN npm install

# Expose ports.
#   - 1444: OneUptime-home
EXPOSE 1444

# Make a directory for blog. 
RUN mkdir -p /usr/src

# Clone blog repo. 
RUN cd /usr/src && git clone https://github.com/oneuptime/blog

# Now we have the blog repo cloned to /usr/src/blog.

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./Home /usr/src/app
# Bundle app source
RUN npm run compile
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"
#Run the app
CMD [ "npm", "start" ]
{{ end }}
