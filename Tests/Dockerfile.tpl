FROM public.ecr.aws/docker/library/node:24.9-alpine3.21
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000


# Install bash. 
RUN apk add bash && apk add curl


ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi

RUN apk add bash

COPY ./Tests .

RUN chmod -R +x Scripts
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"

CMD ["bash start.sh"]