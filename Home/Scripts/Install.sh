#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "  ___              _   _       _   _                "
echo " / _ \ _ __   ___ | | | |_ __ | |_(_)_ __ ___   ___ "
echo "| | | | '_ \ / _ \| | | | '_ \| __| | '_ \` _ \ / _ \\"
echo "| |_| | | | |  __/| |_| | |_) | |_| | | | | | |  __/"
echo " \___/|_| |_|\___| \___/| .__/ \__|_|_| |_| |_|\___|"
echo "                        |_|                         "
echo -e "${NC}"
echo -e "${GREEN}OneUptime Installation Script${NC}"
echo ""

# Check for required dependencies
echo -e "${YELLOW}Checking dependencies...${NC}"

# Detect package manager
install_package() {
    if command -v apt-get &> /dev/null; then
        sudo apt-get update -y && sudo apt-get install -y "$@"
    elif command -v yum &> /dev/null; then
        sudo yum install -y "$@"
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y "$@"
    elif command -v pacman &> /dev/null; then
        sudo pacman -Sy --noconfirm "$@"
    else
        echo -e "${RED}Error: Could not detect package manager. Please install $* manually.${NC}"
        exit 1
    fi
}

if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}git is not installed. Installing git...${NC}"
    install_package git
fi

if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}Node.js/npm is not installed. Installing Node.js and npm...${NC}"
    if command -v apt-get &> /dev/null || command -v yum &> /dev/null || command -v dnf &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        install_package nodejs
    elif command -v pacman &> /dev/null; then
        install_package nodejs npm
    else
        echo -e "${RED}Error: Could not install Node.js automatically. Please install Node.js and npm manually.${NC}"
        exit 1
    fi
fi

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker is not installed. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    sudo systemctl start docker
    sudo systemctl enable docker
fi

echo -e "${GREEN}All dependencies are installed.${NC}"
echo ""

# Clone the repository
echo -e "${YELLOW}Cloning OneUptime repository...${NC}"

if [ -d "oneuptime" ]; then
    echo -e "${YELLOW}Directory 'oneuptime' already exists. Pulling latest changes...${NC}"
    cd oneuptime
    git pull
else
    git clone https://github.com/OneUptime/oneuptime.git
    cd oneuptime
fi

echo ""
echo -e "${GREEN}Repository cloned successfully.${NC}"
echo ""

# Configure environment
echo -e "${YELLOW}Configuring environment...${NC}"
echo ""

# Ask for host configuration
echo -e "${YELLOW}Enter the hostname where OneUptime will be accessible${NC}"
echo -e "${YELLOW}(e.g., oneuptime.yourdomain.com or an IP address)${NC}"
read -p "Host [localhost]: " USER_HOST
USER_HOST=${USER_HOST:-localhost}

# Create config.env if it doesn't exist
touch config.env

# Merge default values from config.example.env into config.env
node ./Scripts/Install/MergeEnvTemplate.js

# Set the host value
sed -i "s/^HOST=.*/HOST=$USER_HOST/" config.env

# Generate random passwords for any placeholder values
generate_password() {
    openssl rand -hex 32
}

if grep -q "please-change-this-to-random-value" config.env; then
    echo -e "${YELLOW}Generating random passwords for secrets...${NC}"
    # Replace each occurrence with a unique random password
    while grep -q "please-change-this-to-random-value" config.env; do
        RANDOM_PASSWORD=$(generate_password)
        sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$RANDOM_PASSWORD/}" config.env
    done
    echo -e "${GREEN}Random passwords generated.${NC}"
fi

echo -e "${GREEN}Environment configured successfully.${NC}"
echo ""

# Start OneUptime
echo -e "${YELLOW}Starting OneUptime...${NC}"
echo ""

npm run start

echo ""
echo -e "${GREEN}OneUptime is now running!${NC}"
echo ""
echo -e "${BLUE}You can access OneUptime at: http://$USER_HOST${NC}"
echo ""
