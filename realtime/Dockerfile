#
# realtime Dockerfile
#

# Pull base image nodejs image.
FROM node:lts-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Install common-server
RUN mkdir /usr/src
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm ci --only=production
COPY ./common-server /usr/src/common-server

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install kubectl for kubernetes monitor scanning
RUN OS_ARCHITECTURE="amd64"
RUN if [[ "$(uname -m)" -eq "aarch64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
RUN if [[ "$(uname -m)" -eq "arm64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
RUN curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/$(OS_ARCHITECTURE)/kubectl"
RUN chmod +x ./kubectl
RUN mv ./kubectl /usr/local/bin/kubectl && \
  chown root: /usr/local/bin/kubectl

# Install app dependencies
COPY ./realtime/package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY ./realtime /usr/src/app

# Expose ports.
EXPOSE 3300

#Run the app
CMD [ "npm", "start"]
