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

if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is not installed. Please install git first.${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed. Please install Node.js and npm first.${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: docker is not installed. Please install Docker first.${NC}"
    exit 1
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

# Start OneUptime
echo -e "${YELLOW}Starting OneUptime...${NC}"
echo ""

npm run start

echo ""
echo -e "${GREEN}OneUptime is now running!${NC}"
echo -e "${BLUE}Access the dashboard at: http://localhost${NC}"
echo ""
