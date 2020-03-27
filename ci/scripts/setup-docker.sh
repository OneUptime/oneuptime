# Cleanup
echo "RUNNING COMMAND:  chmod +x ./ci/cleanup.sh"
chmod +x ./kubernetes/ci/cleanup.sh
echo "RUNNING COMMAND:  ./ci/cleanup.sh"
./kubernetes/ci/cleanup.sh

#Install Docker and setup registry and insecure access to it.
#IF docker is already installed, do not install docker.
if [[ ! $(which docker) ]]
then
    echo "RUNNING COMMAND: curl -sSL https://get.docker.com/ | sh"
    curl -sSL https://get.docker.com/ | sh
    echo "RUNNING COMMAND: sudo touch /etc/docker/daemon.json"
    sudo touch /etc/docker/daemon.json
    echo "RUNNING COMMAND:  echo -e  "{\n   "insecure-registries": ["localhost:32000"]\n}" | sudo tee -a /etc/docker/daemon.json >> /dev/null"
    echo -e  "{\n   "insecure-registries": ["localhost:32000"]\n}" | sudo tee -a /etc/docker/daemon.json >> /dev/null
    echo "RUNNING COMMAND: sudo systemctl restart docker"
    sudo systemctl restart docker
fi

# Install packages.
echo "RUNNING COMMAND:  sudo apt-get update -y && sudo apt-get install -y bash git sudo nodejs"
sudo apt-get update -y && sudo apt-get install -y bash git sudo nodejs

# Install additional dependencies for puppeteer.
echo "RUNNING COMMAND: sudo apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils
"
sudo apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
