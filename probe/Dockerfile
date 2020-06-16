#
# Fyipe-backend Dockerfile
#

# Pull base image nodejs image.
FROM node:12.16.1

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install trivy for container scanning
RUN sudo apt-get install wget apt-transport-https gnupg lsb-release \
    && wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add - \
    && echo deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main | sudo tee -a /etc/apt/sources.list.d/trivy.list \
    && sudo apt-get update \
    && sudo apt-get install trivy

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3008: probe
EXPOSE 3008

#Run the app
CMD [ "npm", "start"]
