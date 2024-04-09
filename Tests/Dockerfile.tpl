FROM node:21.7.2-alpine3.18
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

# Install bash. 
RUN apk add bash && apk add curl


ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi

RUN apk add bash

COPY ./Tests .

RUN chmod -R +x Scripts

CMD ["bash start.sh"]