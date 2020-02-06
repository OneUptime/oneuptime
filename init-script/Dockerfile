#
# Fyipe Init Script
#

FROM node:10

# Set env variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY ./server.js /usr/src/app/

# Execute script
CMD ["node", "./server.js"]