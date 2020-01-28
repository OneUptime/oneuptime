# This script runs the local development server in Docker.
if [[ ! $(which docker) && ! $(docker  --version) ]]
then
  echo -e "\033[91mPlease install Docker. https://docs.docker.com/install"
  exit
fi

sudo chmod +x ./uninstall.sh
sudo ./uninstall.sh

# Sleep 
sleep 5s


# Run Probes 1
sudo docker build -t fyipe-project/probe:latest ./probe
sudo docker run  --name probe1 -p 3019:3019 -e "PORT=3019" -e "SERVER_URL=http://localhost:3002" -e "PROBE_NAME=EU" -e "PROBE_KEY=13b674ca-9fdd-11e9-a2a3-2a2ae2dbcce4" -d fyipe-project/probe:latest 

# Run Probes 2
sudo docker build -t fyipe-project/probe:latest ./probe
sudo docker run --name probe2 -p 3020:3020 -e "PORT=3020" -e "SERVER_URL=http://localhost:3002" -e "PROBE_NAME=US" -e "PROBE_KEY=33b674ca-9fdd-11e9-a2a3-2a2ae2dbcce4" -d fyipe-project/probe:latest 
