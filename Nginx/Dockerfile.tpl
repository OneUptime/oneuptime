FROM nginx:1.23.3-alpine

USER root

# Install bash. 
RUN apk update && apk add bash && apk add curl

COPY ./Nginx/default.conf.template /etc/nginx/templates/default.conf.template 