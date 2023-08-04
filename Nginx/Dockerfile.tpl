FROM nginx:1.25.1-alpine

USER root

# Install bash. 
RUN apk update && apk add bash && apk add curl

COPY ./Nginx/default.conf.template /etc/nginx/templates/default.conf.template 