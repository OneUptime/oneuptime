###
#
#   Please make sure kubectl is installed and context is pointed to the cluster you want to restore to.
#   This only runs on Linux (Ubuntu) and not on MacOS
###

# IP of the mongodb servers.
MONGO_HOSTS='a59a474aad89940889c1eb69b1a8f884-135820180.us-east-2.elb.amazonaws.com'
MONGO_HOST='a59a474aad89940889c1eb69b1a8f884-135820180.us-east-2.elb.amazonaws.com' #Add one host because mongodump only supports one host.
MONGO_PORT="27017"

ONEUPTIME_DB_USERNAME='oneuptime'
ONEUPTIME_DB_PASSWORD='password'
ONEUPTIME_DB_NAME='oneuptimedb'
CURRENT_DATE=$(date +%s)
CURRENT_USER=$(whoami)
BACKUP_PATH=~/db-backup
BACKUP_RETAIN_DAYS=2
TODAY=`date +"%d-%b-%Y"`
ENVIRONMENT='Staging'

red=$(tput setaf 1)
green=$(tput setaf 2)
reset=$(tput sgr 0)

# # Delete all the monitor logs before 3 days before taking the backup.
THREE_DAYS_AGO=$(date -d "-3 days" +"%Y-%m-%d")
THREE_MONTHS_AGO=$(date -d "-90 days" +"%Y-%m-%d")
SIX_MONTHS_AGO=$(date -d "-180 days" +"%Y-%m-%d")

function HELP() {
  echo ""
  echo "OneUptime DB backup command line documentation."
  echo ""
  echo "all arguments are optional and have a default value when not set"
  echo ""
  echo " -l       Backup path on local system where backup file will be stored. Default value - $BACKUP_PATH"
  echo " -n       Database name. Default value 'oneuptimedb'"
  echo " -p       Database password. Default value 'password'"
  echo " -r       Helm release name. Default value 'fi'"
  echo " -t       Backup retain days. Set the number of days backup is kept before it is deleted. Default value '14'"
  echo " -u       Set database username. Default value 'oneuptime'."
  echo " -v       Set database environment. Enums {Production, Staging}, defaults to 'Staging'."
  echo ""
  echo " -h       Help."
  echo ""
  exit 1
}

# PASS IN ARGUMENTS
while getopts "u:p:n:l:t:v:h" opt; do
  case $opt in
  u)
    ONEUPTIME_DB_USERNAME="$OPTARG"
    ;;
  p)
    ONEUPTIME_DB_PASSWORD="$OPTARG"
    ;;
  n)
    ONEUPTIME_DB_NAME="$OPTARG"
    ;;
  l)
    BACKUP_PATH="$OPTARG"
    ;;
  t)
    BACKUP_RETAIN_DAYS="$OPTARG"
    ;;
  v)
    ENVIRONMENT="$OPTARG"
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

function BACKUP_SUCCESS(){
  curl --request POST \
    --url https://events.pagerduty.com/v2/change/enqueue \
    --header 'Content-Type: application/json' \
    --data '{
    "routing_key": "a92c8fef8b394f01d02a9f9c0e1317f5",
    "payload": {
      "summary": "Backup created successfully on vm. Archive: '$BACKUP_PATH'/oneuptime-backup-'$CURRENT_DATE'.archive",
      "source": "production-db-backup-vm"
    }
  }'

    curl -X POST -H 'Content-type: application/json' --data '{
    "blocks": [
      {
        "type": "divider"
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*'$ENVIRONMENT' Backup Complete*\n Date: '$TODAY'\nPath: '$BACKUP_PATH'/oneuptime-backup-'$CURRENT_DATE'.archive"
        }
      },
      {
        "type": "divider"
      }
    ]
  }' https://hooks.slack.com/services/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
}

function BACKUP_FAIL_SERVER(){
  curl --request POST \
    --url https://events.pagerduty.com/v2/enqueue \
    --header 'Content-Type: application/json' \
    --data '{
    "payload": {
      "summary": "Could not create backup on vm. Archive: '$BACKUP_PATH'/oneuptime-backup-'$CURRENT_DATE'.archive",
      "severity": "error",
      "source": "production-db-backup-vm"
    },
    "routing_key": "a92c8fef8b394f01d02a9f9c0e1317f5",
    "event_action": "trigger"
  }'

    curl -X POST -H 'Content-type: application/json' --data '{
    "blocks": [
      {
        "type": "divider"
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*'$ENVIRONMENT' Backup Failed*\n Date: '$TODAY'\nReason: Could not create backup on container.\nPath: '$BACKUP_PATH'/oneuptime-backup-'$CURRENT_DATE'.archive"
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
          "text": "*'$ENVIRONMENT' Backup Failed*\n Date: '$TODAY'\nReason: Could not create backup on local path.\nPath: '$BACKUP_PATH'/oneuptime-backup-'$CURRENT_DATE'.archive"
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
# echo "Removing audit logs collections. This will take some time."
# sudo mongo ${ONEUPTIME_DB_NAME} --host="${MONGO_HOSTS}" --port="${MONGO_PORT}" --username="$ONEUPTIME_DB_USERNAME" --password="$ONEUPTIME_DB_PASSWORD" --eval 'db.auditlogs.drop()'

# Remove old monitor logs to make backup faster
# echo "Removing old monitor logs. This will take some time."
# sudo mongo ${ONEUPTIME_DB_NAME} --host="${MONGO_HOSTS}" --port="${MONGO_PORT}" --username="$ONEUPTIME_DB_USERNAME" --password="$ONEUPTIME_DB_PASSWORD" --eval "db.monitorlogs.remove({'createdAt': { \$lt: ISODate('${THREE_DAYS_AGO}')}})"
sudo mongo ${ONEUPTIME_DB_NAME} --host="${MONGO_HOSTS}" --port="${MONGO_PORT}" --username="$ONEUPTIME_DB_USERNAME" --password="$ONEUPTIME_DB_PASSWORD" --eval "db.monitorlogbyweeks.remove({'createdAt': { \$lt: ISODate('${SIX_MONTHS_AGO}')}})"
sudo mongo ${ONEUPTIME_DB_NAME} --host="${MONGO_HOSTS}" --port="${MONGO_PORT}" --username="$ONEUPTIME_DB_USERNAME" --password="$ONEUPTIME_DB_PASSWORD" --eval "db.monitorlogbydays.remove({'createdAt': { \$lt: ISODate('${THREE_MONTHS_AGO}')}})"
sudo mongo ${ONEUPTIME_DB_NAME} --host="${MONGO_HOSTS}" --port="${MONGO_PORT}" --username="$ONEUPTIME_DB_USERNAME" --password="$ONEUPTIME_DB_PASSWORD" --eval "db.monitorlogbyhours.remove({'createdAt': { \$lt: ISODate('${THREE_MONTHS_AGO}')}})"

echo "Sleeping for 1 minute..."
# Sleeping for 1 mins for database server to cool down.
sleep 1m

# Ensure the backup directory is already created
mkdir $BACKUP_PATH || echo "Backup directory already exist!"

# Instead of deleting auditlogs and monitorlogs collection, we can ignore the collection during backup
# --excludeCollection=auditlogs --excludeCollection=monitorlogs
if mongodump --forceTableScan --authenticationDatabase="${ONEUPTIME_DB_NAME}" --host="${MONGO_HOST}" --db="${ONEUPTIME_DB_NAME}" --port="${MONGO_PORT}" --username="${ONEUPTIME_DB_USERNAME}" --password="${ONEUPTIME_DB_PASSWORD}" --archive="$BACKUP_PATH/oneuptime-backup-$CURRENT_DATE.archive" --excludeCollection=auditlogs --excludeCollection=monitorlogs; then
    echo  ${green}"BACKUP SUCCESS $"${reset}
    BACKUP_SUCCESS
else
    echo  ${red}"Failure, exit status: $"${reset}
    BACKUP_FAIL_SERVER
fi

####### Remove backups older than {BACKUP_RETAIN_DAYS} days  ########

echo "Removing backup older than ${BACKUP_RETAIN_DAYS} days."
find $BACKUP_PATH* -mtime +${BACKUP_RETAIN_DAYS} -exec rm -f {} \; || echo "Removed!"
echo ""
echo "Done - File Name: oneuptime-backup-$CURRENT_DATE.archive"
