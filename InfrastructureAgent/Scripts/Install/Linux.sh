#!/bin/bash

# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Export to path
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# Refresh bash 
source ~/.bashrc

# Install latest Node.js via NVM
nvm install node

# Make this nodejs version the default
nvm alias default node

# Now install 
npm install -g ts-node @oneuptime/infrastructure-agent
