FROM ubuntu:lunar

# Install bash and curl. 
RUN apt-get update && apt-get install -y bash && apt-get install -y curl

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

COPY . /usr/src/app/

RUN bash install.sh

# Expose ports.
#   - 80: OneUptime HTTP
#   - 443: OneUptime HTTPS
EXPOSE 80
EXPOSE 443

CMD [ "npm", "start" ]