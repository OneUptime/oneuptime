#!/bin/sh

ONEUPTIME_DB_USERNAME='oneuptime'
ONEUPTIME_DB_PASSWORD='password'
ONEUPTIME_DB_NAME='oneuptimedb'
BACKUP_RETAIN_DAYS=14
BACKUP_PATH=~/db-backup

red=$(tput setaf 1)
green=$(tput setaf 2)
reset=$(tput sgr 0)

function HELP() {
  echo ""
  echo "OneUptime DB backup command line documentation."
  echo ""
  echo "optional arguments have a default value when not set"
  echo ""
  echo " -l       Backup path on local system where backup file will be stored. Default value - $BACKUP_PATH"
  echo " -n       Database name. Default value 'oneuptimedb'"
  echo " -p       Database password. Default value 'password'"
  echo " -u       Set database username. Default value 'oneuptime'."
  echo " -t       Backup retain days. Number of days backup is kept before it is deleted. Default value '14'"
  echo ""
  echo " -h      Help."
  echo ""
  exit 1
}

# PASS IN ARGUMENTS
while getopts "l:p:n:t:u:h" opt; do
  case $opt in
  l)
    BACKUP_PATH=$OPTARG
    ;;
  p)
    ONEUPTIME_DB_PASSWORD="$OPTARG"
    ;;
  n)
    ONEUPTIME_DB_NAME="$OPTARG"
    ;;
  t)
    BACKUP_RETAIN_DAYS="$OPTARG"
    ;;
  u)
    ONEUPTIME_DB_USERNAME="$OPTARG"
    ;;
  h)
    HELP
    ;;
  \?)
    echo "Invalid option -$OPTARG" >&2
    HELP
    echo -e "Use -h to see the help documentation."
    exit 2
    ;;
  esac
done

# STEP 1 : create service file for backup
echo '
[Unit]
Description=OneUptime database backup
        
[Service]
ExecStart=bash '"$HOME"'/backup.sh -u '${ONEUPTIME_DB_USERNAME}' -p '${ONEUPTIME_DB_PASSWORD}' -n '${ONEUPTIME_DB_NAME}' -l '${BACKUP_PATH}' -t '${BACKUP_RETAIN_DAYS}'

' | sudo tee -a /etc/systemd/system/backup.service

# Step 2: Set up timer to run service every 24 hours
echo '
[Unit]
Description= 24 hours OneUptime backup (Runs once per day)
Requires=backup.service

[Timer]
Unit=backup.service
OnCalendar=*-*-* 23:59:00
Persistent=true

[Install]
WantedBy=timers.target
' | sudo tee -a /etc/systemd/system/backup.timer

# STEP 3: make files.sh executable
chmod +x "$HOME"/backup.sh

# STEP 4: Start timer
sudo systemctl daemon-reload

sudo systemctl enable backup.timer

sudo systemctl start backup.timer

# STEP 5: Install Mongodb locally for mongo cli and mongodump and mongorestore.
if [[ ! $(which mongo) ]]; then
  # install gnupg just incase it's not available on the vm
  sudo apt-get install -y gnupg
  wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | sudo apt-key add -
  echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/5.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-5.0.list
  sudo apt-get update
  sudo apt-get install -y mongodb-org
fi
