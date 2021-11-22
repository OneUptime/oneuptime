#
# realtime Dockerfile
#

# Pull base image nodejs image.
FROM node:16

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install kubectl for kubernetes monitor scanning
RUN OS_ARCHITECTURE="amd64"
RUN if [[ "$(uname -m)" -eq "aarch64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
RUN if [[ "$(uname -m)" -eq "arm64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
RUN curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/$(OS_ARCHITECTURE)/kubectl"
RUN chmod +x ./kubectl
RUN mv ./kubectl /usr/local/bin/kubectl && \
  chown root: /usr/local/bin/kubectl

# Due to this EPROTO wrong signature error on http fetch, we need to comment out CipherString
# in the file /etc/ssl/openssl.cnf
# https://github.com/nodejs/help/issues/2804
# https://developers.exlibrisgroup.com/forums/topic/cant-fetch-from-alma-api-with-node/
RUN sed -i 's/^CipherString$\?/#CipherString/g' /etc/ssl/openssl.cnf

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY . /usr/src/app

# Expose ports.
EXPOSE 3300

#Run the app
CMD [ "npm", "start"]
