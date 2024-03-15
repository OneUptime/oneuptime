#!/bin/bash

# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Install latest Node.js via NVM
nvm install node

# Make this nodejs version the default
nvm alias default node

# Now install 
npm install -g ts-node @oneuptime/infrastructure-agent
