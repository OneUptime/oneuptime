##
# This file is from the official Harakaa Docker Repository - https://github.com/haraka/Haraka
# https://github.com/haraka/Haraka/blob/master/Dockerfile 
##

###
#Important: Highly dependent on *-alpine image.
###

FROM node:15.0.1-alpine3.12

#set language enviroments
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    TIMEZONE="America/New_York" \
    SMTP_PORT=25 \
    LOGLEVEL=warn \
    DATADIR=/data \
    HEADER="Haraka Server" 

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
# Install haraka
    npm install -g --unsafe-perm Haraka && \
#  # Cleaning up
    apk del --purge -r .fetch-deps && \
    apk add --no-cache tzdata openssl execline ca-certificates && \
    rm -rf /var/cache/apk/* /tmp/* ~/.pearrc

RUN apk add bash

# install software
COPY run.sh /
RUN chmod 755 /run.sh

CMD ["/run.sh"]