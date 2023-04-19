# This file is work in progress and will not build yet.

FROM docker:latest

# Install bash and curl and git. 
RUN apk update && apk install bash && apk install curl && apk install git && apk install sudo

RUN mkdir /usr/src/oneuptime

WORKDIR /usr/src/oneuptime

COPY . /usr/src/oneuptime/

ENV IS_DOCKER=true

RUN bash install.sh

# Expose ports.
#   - 80: OneUptime HTTP
#   - 443: OneUptime HTTPS
EXPOSE 80
EXPOSE 443

CMD [ "npm", "start" ]