#
# probe Dockerfile
#

# Pull base image nodejs image.
FROM node:alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir /usr/src

# Install common
RUN mkdir /usr/src/common
WORKDIR /usr/src/common
COPY ./common/package*.json /usr/src/common/
RUN npm install
COPY ./common /usr/src/common
RUN npm compile

# Install CommonServer
RUN mkdir /usr/src/CommonServer
WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer
RUN npm compile



# Install app
RUN mkdir /usr/src/app
WORKDIR /usr/src/app

# Install trivy for container scanning
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/master/contrib/install.sh | sh -s -- -b /usr/local/bin

# Install kubectl for kubernetes monitor scanning
RUN OS_ARCHITECTURE="amd64"
RUN if [[ "$(uname -m)" -eq "aarch64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
RUN if [[ "$(uname -m)" -eq "arm64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
RUN curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/$(OS_ARCHITECTURE)/kubectl"
RUN chmod +x ./kubectl
RUN mv ./kubectl /usr/local/bin/kubectl && \
  chown root: /usr/local/bin/kubectl



# Install app dependencies
COPY ./probe/package*.json /usr/src/app/
RUN npm install
RUN npm install -g ts-node

# Bundle app source
COPY /probe /usr/src/app

# Expose ports.
#   - 3008: probe
EXPOSE 3008

#Run the app
RUN npm compile
CMD [ "npm", "start"]
