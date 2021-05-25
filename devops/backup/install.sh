#!/bin/sh


FYIPE_DB_USERNAME='fyipe'
FYIPE_DB_PASSWORD='password'
FYIPE_DB_NAME='fyipedb'
BACKUP_RETAIN_DAYS=14
BACKUP_PATH=~/Documents/backup 

red=`tput setaf 1`
green=`tput setaf 2`
reset=`tput sgr 0`

function HELP (){
  echo ""
  echo "Fyipe DB backup command line documentation."
  echo ""
  echo "optional arguments have a default value when not set"
  echo ""
  echo " -l       Backup path on local system where backup file will be stored. Default value - $BACKUP_PATH"
  echo " -n       Database name. Default value 'fyipedb'"
  echo " -p       Database password. Default value 'password'"
  echo " -u       Set database username. Default value 'fyipe'."
  echo " -t       Backup retain days. Number of days backup is kept before it is deleted. Default value '14'"
  echo ""
  echo " -h      Help."
  echo ""
  exit 1
}

# PASS IN ARGUMENTS
while getopts ":a:l:p:n:t:u:h" opt; do
  case $opt in
    l) BACKUP_PATH="$OPTARG"
    ;;
    p) FYIPE_DB_PASSWORD="$OPTARG"
    ;;
    n) FYIPE_DB_NAME="$OPTARG"
    ;;
    t) BACKUP_RETAIN_DAYS="$OPTARG"
    ;;
    u) FYIPE_DB_USERNAME="$OPTARG"
    ;;
    h) HELP
       ;;
    \?) echo "Invalid option -$OPTARG" >&2
       HELP
       echo -e "Use -h to see the help documentation."
       exit 2
    ;;
  esac
done
 
  #Step 1: Install Docker and setup registry and insecure access to it.
  if [[ ! $(which kubectl) ]]
  then
    #Install Kubectl
    echo "RUNNING COMMAND: curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
    curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl
    echo "RUNNING COMMAND: chmod +x ./kubectl"
    chmod +x ./kubectl
    echo "RUNNING COMMAND: sudo mv ./kubectl /usr/local/bin/kubectl"
    sudo mv ./kubectl /usr/local/bin/kubectl
  fi

  #  STEP 2: create directories
  mkdir -p ~/.kube
  mkdir -p ${BACKUP_PATH}

  # STEP 4 : create service file for backup
  echo '
[Unit]
Description=Fyipe database backup
        
[Service]
ExecStart=bash '"$HOME"'/backup.sh -u '${FYIPE_DB_USERNAME}' -p '${FYIPE_DB_PASSWORD}' -n '${FYIPE_DB_NAME}' -l '${BACKUP_PATH}' -t '${BACKUP_RETAIN_DAYS}'

' > /etc/systemd/system/backup.service


#Step 5: Set up timer to run service every 12 hours
echo '
[Unit]
Description= 12 hours Fyipe backup
Requires=backup.service

[Timer]
Unit=backup.service
OnCalendar=*-*-* 12:00:00
Persistent=true

[Install]
WantedBy=timers.target
' > /etc/systemd/system/backup.timer

# STEP 6: make files.sh executable
chmod +x "$HOME"/backup.sh

# STEP 7: Start timer
sudo systemctl daemon-reload

sudo systemctl enable backup.timer

sudo systemctl start backup.timer

# Install Mongodb locally for mongo cli and mongodump and mongorestore.
wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
sudo apt-get update
sudo apt-get install -y mongodb-org
