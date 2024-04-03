#!/bin/bash

# Check if this is debian based

# Check if system supports apt-get

if [ -x "$(command -v apt-get)" ]; then
    # Update apt-get
    sudo apt-get update
    # Install build-essential
    sudo apt-get install build-essential -y
fi

# Check if system supports yum
if [ -x "$(command -v yum)" ]; then
    # Update yum
    sudo yum update
    # Install build-essential
    sudo yum install gcc-c++ make -y
fi

# Check if system supports apk
if [ -x "$(command -v apk)" ]; then
    # Update apk
    sudo apk update
    # Install build-essential
    sudo apk add build-base
fi


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

# Use the default version
nvm use default

# Now install 
npm install -g tsx
npm install -g @oneuptime/infrastructure-agent
