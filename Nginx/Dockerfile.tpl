FROM nginx:1.25.3-alpine 

USER root

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}

# Install bash. 
RUN apk add bash && apk add curl && apk add openssl

# Install NJS module
RUN apk add nginx-module-njs

COPY ./Nginx/default.conf.template /etc/nginx/templates/default.conf.template 
COPY ./Nginx/nginx.conf /etc/nginx/nginx.conf

# Now install nodejs

RUN apk add nodejs npm

RUN mkdir /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common


WORKDIR /usr/src/Model
COPY ./Model/package*.json /usr/src/Model/
RUN npm install
COPY ./Model /usr/src/Model


WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./Nginx/package*.json /usr/src/app/
RUN npm install

COPY ./Nginx /usr/src/app
# Bundle app source
RUN npm run compile

RUN chmod +x ./run.sh

CMD ./run.sh


