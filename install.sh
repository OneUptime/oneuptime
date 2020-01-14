# This script runs the local development server in Docker.

USER=$whoami

if [[ ! $(which docker) && ! $(docker  --version) ]]
then
  echo -e "\033[91mPlease install Docker. https://docs.docker.com/install"
  exit
fi

if [[ ! $(which git) && ! $(docker --git) ]]
then
  echo -e "\033[91mPlease install Git. https://git-scm.com/book/en/v2/Getting-Started-Installing-Git"
  exit
fi

if [[ ! $(which node) ]]
then
  echo -e "\033[91mPlease install Node."
  exit
fi

if [[ ! $(which npm) ]]
then
  echo -e "\033[91mPlease install npm."
  exit
fi

sudo chmod +x ./uninstall.sh
sudo ./uninstall.sh

sudo docker network create fyipe-network

# Sleep 
sleep 5s

sudo mkdir /Users/$USER/mongodb || echo 'Path already exists'

# Run Dependencies
sudo docker run --name mongo --net=host -v /Users/$USER/mongodb:/data/db -p 27017:27017 -d mongo:3.4
sudo docker run --name redis --net=host -p 6379:6379 -d redis:5.0.7 redis-server

# Sleep 
sleep 5s

# Run Backend
sudo docker build -t fyipe-project/backend:latest ./backend
sudo docker run --name backend --net=host -p 3002:3002 --env-file=./backend/.env.development -d fyipe-project/backend:latest #port is not needed because of nethost

# Run Accounts
sudo docker build -t fyipe-project/accounts:latest ./accounts
sudo docker run --name accounts --net=host -p 3003:3003 -d fyipe-project/accounts:latest

#Run Dashboard
sudo docker build -t fyipe-project/dashboard:latest ./dashboard
sudo docker run --name dashboard --net=host -p 3000:3000 -d fyipe-project/dashboard:latest

# Run home
sudo docker build -t fyipe-project/home:latest ./home
sudo docker run --name home -p 1444:1444 -d fyipe-project/home:latest

# Run Status Page
sudo docker build -t fyipe-project/status-page:latest ./status-page
sudo docker run --name status-page --net=host -p 3006:3006 -d fyipe-project/status-page:latest

# Run Admin Dashboard
sudo docker build -t fyipe-project/admin-dashboard:latest ./admin-dashboard
sudo docker run --name admin-dashboard --net=host -p 3100:3100 -d fyipe-project/admin-dashboard:latestcd

# Run Probes 1
sudo docker build -t fyipe-project/probe:latest ./probe
sudo docker run  --name probe1 --net=host -p 3019:3008 -e "PORT=3019" -e "SERVER_URL=http://localhost:3002" -e "PROBE_NAME=EU" -e "PROBE_KEY=13b674ca-9fdd-11e9-a2a3-2a2ae2dbcce4" -d fyipe-project/probe:latest 

# Run Probes 2
sudo docker build -t fyipe-project/probe:latest ./probe
sudo docker run --name probe2 --net=host -p 3020:3008 -e "PORT=3020" -e "SERVER_URL=http://localhost:3002" -e "PROBE_NAME=US" -e "PROBE_KEY=33b674ca-9fdd-11e9-a2a3-2a2ae2dbcce4" -d fyipe-project/probe:latest 
