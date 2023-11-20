FROM nginx:1.25.3-alpine

USER root

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}

# Install bash. 
RUN apk add bash && apk add curl

COPY ./Nginx/default.conf.template /etc/nginx/templates/default.conf.template 