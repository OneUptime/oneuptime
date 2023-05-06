# This file is work in progress and will not build yet.

FROM ubuntu:latest

# Install bash and curl and git. 
RUN apt-get update && apt-get install -y bash && apt-get install -y curl && apt-get install -y git && apt-get install -y sudo

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