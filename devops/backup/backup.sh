###
#
#   Please make sure kubectl is installed and context is pointed to the cluster you want to restore to.
#   This only runs on Linux (Ubuntu) and not on MacOS
###

# IP of the mongodb servers.
MONGO_PRIMARY_SERVER_IP='167.172.15.25'
MONGO_SECONDARY_SERVER_IP='157.230.66.225'
MONGO_SERVER_PORT="80"

FYIPE_DB_USERNAME='fyipe'
FYIPE_DB_PASSWORD='password'
FYIPE_DB_NAME='fyipedb'
CURRENT_DATE=$(date +%s)
CURRENT_USER=$(whoami)
BACKUP_PATH=~/db-backup 
BACKUP_RETAIN_DAYS=2
TODAY=`date +"%d%b%Y"`

red=`tput setaf 1`
green=`tput setaf 2`
reset=`tput sgr 0`

# Delete all the monitor logs before 3 days before taking the backup.
THREE_DAYS_AGO=$(date -d "-3 days" +"%Y-%m-%d")
THREE_MONTHS_AGO=$(date -d "-120 days" +"%Y-%m-%d")
SIX_MONTHS_AGO=$(date -d "-180 days" +"%Y-%m-%d")

function HELP (){
  echo ""
  echo "Fyipe DB backup command line documentation."
  echo ""
  echo "all arguments are optional and have a default value when not set"
  echo ""
  echo " -l       Backup path on local system where backup file will be stored. Default value - $BACKUP_PATH"
  echo " -n       Database name. Default value 'fyipedb'"
  echo " -p       Database password. Default value 'password'"
  echo " -r       Helm release name. Default value 'fi'"
  echo " -t       Backup retain days. Set the number of days backup is kept before it is deleted. Default value '14'"
  echo " -u       Set database username. Default value 'fyipe'."
  echo ""
  echo " -h       Help."
  echo ""
  exit 1
}


# PASS IN ARGUMENTS
while getopts ":r:u:p:n:l:t:h" opt; do
  case $opt in
    u) FYIPE_DB_USERNAME="$OPTARG"
    ;;
    p) FYIPE_DB_PASSWORD="$OPTARG"
    ;;
    n) FYIPE_DB_NAME="$OPTARG"
    ;;
    l) BACKUP_PATH="$OPTARG"
    ;;
    t) BACKUP_RETAIN_DAYS="$OPTARG"
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

function BACKUP_SUCCESS(){
    curl -X POST -H 'Content-type: application/json' --data '{
    "blocks": [
      {
        "type": "divider"
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*Backup complete*\n Date:'${TODAY}'\nPath: '$BACKUP_PATH'/fyipe-backup-'$CURRENT_DATE'.archive"
        }
      },
      {
        "type": "divider"
      }
    ]
  }' https://hooks.slack.com/services/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
}

function BACKUP_FAIL_SERVER(){
    curl -X POST -H 'Content-type: application/json' --data '{
    "blocks": [
      {
        "type": "divider"
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*Backup Failed*\n Date:'${TODAY}'\nReason: Could not create backup on container.\nPath: '$BACKUP_PATH'/fyipe-backup-'$CURRENT_DATE'.archive"
        }
      },
      {
        "type": "divider"
      }
    ]
  }' https://hooks.slack.com/services/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
}

function BACKUP_FAIL_LOCAL(){
    curl -X POST -H 'Content-type: application/json' --data '{
    "blocks": [
      {
        "type": "divider"
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*Backup failed*\n Date:'${TODAY}'\nReason: Could not create backup on local path.\nPath: '$BACKUP_PATH'/fyipe-backup-'$CURRENT_DATE'.archive"
        }
      },
      {
        "type": "divider"
      }
    ]
  }' https://hooks.slack.com/services/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
}


echo "Taking a backup on the server"
echo ""

# Drop audit logs collection because we dont need to take backup of that.
echo "Removing audit logs collections. This will take some time." 
sudo mongo ${FYIPE_DB_NAME} --host="${MONGO_PRIMARY_SERVER_IP}" --port="${MONGO_SERVER_PORT}" --username="$FYIPE_DB_USERNAME" --password="$FYIPE_DB_PASSWORD" --eval 'db.auditlogs.drop()'

# Remove old monitor logs to make backup faster
echo "Removing old monitor logs. This will take some time."
sudo mongo ${FYIPE_DB_NAME} --host="${MONGO_PRIMARY_SERVER_IP}" --port="${MONGO_SERVER_PORT}" --username="$FYIPE_DB_USERNAME" --password="$FYIPE_DB_PASSWORD" --eval "db.monitorlogs.remove({'createdAt': { \$lt: ISODate('${THREE_DAYS_AGO}')}})"
sudo mongo ${FYIPE_DB_NAME} --host="${MONGO_PRIMARY_SERVER_IP}" --port="${MONGO_SERVER_PORT}" --username="$FYIPE_DB_USERNAME" --password="$FYIPE_DB_PASSWORD" --eval "db.monitorlogbyweeks.remove({'createdAt': { \$lt: ISODate('${SIX_MONTHS_AGO}')}})"
sudo mongo ${FYIPE_DB_NAME} --host="${MONGO_PRIMARY_SERVER_IP}" --port="${MONGO_SERVER_PORT}" --username="$FYIPE_DB_USERNAME" --password="$FYIPE_DB_PASSWORD" --eval "db.monitorlogbydays.remove({'createdAt': { \$lt: ISODate('${THREE_MONTHS_AGO}')}})" 
sudo mongo ${FYIPE_DB_NAME} --host="${MONGO_PRIMARY_SERVER_IP}" --port="${MONGO_SERVER_PORT}" --username="$FYIPE_DB_USERNAME" --password="$FYIPE_DB_PASSWORD" --eval "db.monitorlogbyhours.remove({'createdAt': { \$lt: ISODate('${THREE_MONTHS_AGO}')}})"

# Sleeping for 10 mins for database server to cool down. 
sleep 10m

# Take backup from secondary and not from primary. This will not slow primary down.
if mongodump --forceTableScan --authenticationDatabase="${FYIPE_DB_NAME}" --host="${MONGO_SECONDARY_SERVER_IP}" --db="${FYIPE_DB_NAME}" --port="${MONGO_SERVER_PORT}" --username="${FYIPE_DB_USERNAME}" --password="${FYIPE_DB_PASSWORD}" --archive="$BACKUP_PATH/fyipe-backup-$CURRENT_DATE.archive"; then
    echo  ${green}"BACKUP SUCCESS $"${reset}
    BACKUP_SUCCESS
else
    echo  ${red}"Failure, exit status: $"${reset}
    BACKUP_FAIL_SERVER
fi

####### Remove backups older than {BACKUP_RETAIN_DAYS} days  ########

echo "Removing backup older than ${BACKUP_RETAIN_DAYS} days."
find $BACKUP_PATH* -mtime +${BACKUP_RETAIN_DAYS} -exec rm {} \;
echo ""
echo "Done - File Name: fyipe-backup-$CURRENT_DATE.archive"