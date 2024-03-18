# Deploy OneUptime completely free with Docker Compose

If you prefer to host OneUptime on your own server, you can use Docker Compose to deploy a single-server instance of OneUptime on Debian, Ubuntu, or RHEL. This option gives you more control and customization over your instance, but it also requires more technical skills and resources to deploy and maintain it.

#### Choose Your System Requirements
Depending on your usage and budget, you can choose from different system requirements for your server. For optimal performance, we suggest using OneUptime with:

- **Recommended System Requirements**
  - 16GB RAM
  - 8 Core
  - 400 GB Disk
  - Ubuntu 22.04
  - Docker and Docker Compose installed
- **Homelab / Minimal Requirements**
  - If you want to run OneUptime for personal or experimental use in a home environment (Some of our users even have it installed on RaspberyPi), you can use the homelab requirements:
    - 8 GB RAM
    - 4 Core
    - 20 GB Disk
    - Docker and Docker Compose installed


#### Prerequisites for Single-Server Deployment
Before you start the deployment process, please make sure you have:

- A server running Debian, Ubuntu, or RHEL derivative
- Docker and Docker Compose installed on your server

To install OneUptime: 

```
# Clone this repo and cd into it.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Please make sure you're on release branch.
git checkout release

# Copy config.example.env to config.env
cp config.example.env config.env

# IMPORTANT: Edit config.env file. Please make sure you have random secrets.

npm start
```

If you don't like to use npm or do not have it installed, run this instead: 

```
# Read env vars from config.env file and run docker-compose up.
export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d
```

To update: 

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```


### Things to consider

- In our Docker setup, we employ a local logging driver. OneUptime, particularly within the probe and ingestor containers, generates a substantial amount of logs. To prevent your storage from becoming full, it's crucial to limit the logging storage in Docker. For detailed instructions on how to do this, please refer to the official Docker documentation [here](https://docs.docker.com/config/containers/logging/local/).

OneUptime should run at: http://localhost. You need to register a new account for your instance to start using it. If you would like to use https, please use a reverse proxy like Nginx.
