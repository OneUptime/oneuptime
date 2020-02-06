#
# Fyipe Init Script
#

FROM ubuntu:19.04

# Set env variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY ./init.sh /usr/src/app/

# Execute script
CMD ["sh", "./init.sh"]