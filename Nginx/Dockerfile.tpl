FROM nginx:1.25.3-alpine as nginx

USER root

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}

# Install bash. 
RUN apk add bash && apk add curl

# Install NJS module
RUN apk add nginx-module-njs

COPY ./Nginx/customssl.js /etc/nginx/customssl.js
COPY ./Nginx/default.conf.template /etc/nginx/templates/default.conf.template 
COPY ./Nginx/nginx.conf /etc/nginx/nginx.conf



