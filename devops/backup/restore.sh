###
#
#   Please make sure kubectl is installed nad context is pointed to the cluster you want to resotre to.
#	
#	RUN THIS BY: 
#	bash restore.sh -f <FILENAME>.archive
#
###

# Variables, please check these before you run the script. 

MONGO_PRIMARY_SERVER_IP='167.172.15.25'
MONGO_SERVER_PORT="80"

FYIPE_DB_USERNAME='fyipe'
FYIPE_DB_PASSWORD='password'
FYIPE_DB_NAME='fyipedb'
CURRENT_DATE=$(date +%s)
CURRENT_USER=$(whoami)
FILE_NAME="restore-file.archive"
FILE_PATH="/$CURRENT_USER/db-backup"
TODAY=`date +"%d%b%Y"`

function HELP (){
  echo ""
  echo "Fyipe DB restore command line documentation."
  echo ""
  echo "all arguments are optional and have a default value when not set"
  echo ""
  echo " -f       Name of file to be restored" 
  echo " -l       File path on local system where file will be restored from. Default value - $FILE_PATH"
  echo " -n       Database name. Default value 'fyipe'"
  echo " -p       Database password. Default value 'password'"
  echo " -u       Set database username. Default value 'fyipe'."
  echo ""
  echo " -h       Help."
  echo ""
  exit 1
}

# PASS IN ARGUMENTS
while getopts ":r:u:p:n:l:f:h" opt; do
  case $opt in
    u) FYIPE_DB_USERNAME="$OPTARG"
    ;;
    p) FYIPE_DB_PASSWORD="$OPTARG"
    ;;
    n) FYIPE_DB_NAME="$OPTARG"
    ;;
    l) FILE_PATH="$OPTARG"
    ;;
    f) FILE_NAME="$OPTARG"
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

function RESTORE_SUCCESS (){
  echo " Send Backup success message to slack"
 
  curl -X POST -H 'Content-type: application/json' --data '{
	"blocks": [
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "*Restore complete*\n Date:'${TODAY}'\nFile Name: '${FILE_NAME}'"
			},
			"accessory": {
				"type": "image",
				"image_url":"https://www.fonedog.com/images/backup-restore/ios/what-does-restore-from-backup-mean.jpg",
				"alt_text": "alt text for image"
			}
		},
		{
			"type": "divider"
		}
	]
}' https://hooks.slack.com/services/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
  exit 1
}

function RESTORE_FAIL_SERVER (){
  echo "Send failure message to slack"
  
  curl -X POST -H 'Content-type: application/json' --data '{
	"blocks": [
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "*Restore Failed*\n Date:'${TODAY}'\nReason: Could not restore database.\nFile Name: '${FILE_NAME}'"
			},
			"accessory": {
				"type": "image",
				"image_url":"https://www.fonedog.com/images/backup-restore/ios/what-does-restore-from-backup-mean.jpg",
				"alt_text": "alt text for image"
			}
		},
		{
			"type": "divider"
		}
	]
}' https://hooks.slack.com/services/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
  exit 1
}


function RESTORE_FAIL_LOCAL (){
  echo "Send failure message to slack"
  
  curl -X POST -H 'Content-type: application/json' --data '{
	"blocks": [
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "*Restore Failed*\n Date:'${TODAY}'\nReason: Could not copy backup to container.\nFile Name: '${FILE_NAME}'"
			},
			"accessory": {
				"type": "image",
				"image_url":"https://www.fonedog.com/images/backup-restore/ios/what-does-restore-from-backup-mean.jpg",
				"alt_text": "alt text for image"
			}
		},
		{
			"type": "divider"
		}
	]
}' https://hooks.slack.com/services/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
  exit 1
}


echo "Restoring Database. This will take some time...."
echo ""
if mongorestore --authenticationDatabase="${FYIPE_DB_NAME}" --host="${MONGO_PRIMARY_SERVER_IP}" --db="${FYIPE_DB_NAME}" --port="${MONGO_SERVER_PORT}" --username="${FYIPE_DB_USERNAME}" --password="${FYIPE_DB_PASSWORD}" --archive="$FILE_PATH/$FILE_NAME"; then
	echo "Restore success"
	RESTORE_SUCCESS
else
	echo "Restore Failed, exit status: $?"
	RESTORE_FAIL_SERVER
fi



  