##
# This file is from the official Harakaa Docker Repository - https://github.com/haraka/Haraka
# https://github.com/haraka/Haraka/blob/master/Dockerfile 
##

FROM node:12.16.1-alpine

#set language enviroments
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    TIMEZONE="Asia/Shanghai" \
    PORT=25 \
    LOGLEVEL=warn \
    DATADIR=/data \
    DOMAIN="fyipe.com" \
    HEADER="Haraka Server" 

# install software
COPY run.sh /

# install dependence
RUN apk upgrade --update && \
    apk add --no-cache -t .fetch-deps \
    autoconf \
    g++ \
    gcc \
    make \
    python && \
    addgroup -g 88 -S smtp && \
    adduser -u 88 -D -S -G smtp -h /data smtp && \
#install haraka
    npm install -g --unsafe-perm Haraka toobusy-js && \
#  # Cleaning up
    apk del --purge -r .fetch-deps && \
    apk add --no-cache tzdata openssl execline ca-certificates && \
    rm -rf /var/cache/apk/* /tmp/* ~/.pearrc && chmod 755 /run.sh

CMD ["/run.sh"]