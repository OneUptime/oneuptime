FROM node:alpine

ARG PORT=25

#set language enviroments
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    TIMEZONE="America/New_York" \
    LOGLEVEL=info \
    DATADIR=/data \
    HEADER="Haraka Server at Your Service" \
    SMTP_PORT=${PORT}


# install dependence
RUN apk upgrade --update && \
    apk add --no-cache -t .fetch-deps \
    autoconf \
    g++ \
    gcc \
    make \
    python3 && \
    addgroup -g 88 -S smtp && \
    adduser -u 88 -D -S -G smtp -h /data smtp && \
    # Install haraka and toobusy package
    npm install -g --unsafe-perm Haraka@2.8.27 toobusy-js && \
    #  # Cleaning up
    apk del --purge -r .fetch-deps && \
    apk add --no-cache tzdata openssl execline ca-certificates && \
    rm -rf /var/cache/apk/* /tmp/* ~/.pearrc

RUN apk add bash
RUN apk add curl

# install software
COPY haraka.sh /
RUN chmod 755 /haraka.sh

EXPOSE 2525

CMD ["/haraka.sh"]