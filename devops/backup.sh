###
#
#   Please make sure kubectl is installed and context is pointed to the cluster you want to restore to.
#
###

HELM_RELEASE_NAME='fi'
FYIPE_DB_USERNAME='fyipe'
FYIPE_DB_PASSWORD='password'
FYIPE_DB_NAME='fyipe'
CURRENT_DATE=$(date +%s)
CURRENT_USER=$(whoami)
BACKUP_PATH="/Users/$CURRENT_USER/Documents"
BACKUP_RETAIN_DAYS=14
TODAY=`date +"%d%b%Y"`

function HELP (){
  echo ""
  echo "Fyipe DB backup command line documentation."
  echo ""
  echo "all arguments are optional and have a default value when not set"
  echo ""
  echo " -c       Database username. Default value 'fyipe'."
  echo " -l       Backup path on local system where backup file will be stored. Default value - Users/$CURRENT_USER/Documents"
  echo " -n       Database name. Default value 'fyipe'"
  echo " -p       Database password. Default value 'password'"
  echo " -r       Helm release name. Default value 'fi'"
  echo " -t       Backup retain days. Set the number of days backup is kept before it is deleted. Default value '14'"
  echo ""
  echo " -h       Help."
  echo ""
  exit 1
}


# PASS IN PROPS
while getopts ":r:u:p:n:c:l:t:h" opt; do
  case $opt in
    r) HELM_RELEASE_NAME="$OPTARG"
    ;;
    u) FYIPE_DB_USERNAME="$OPTARG"
    ;;
    p) FYIPE_DB_PASSWORD="$OPTARG"
    ;;
    n) FYIPE_DB_NAME="$OPTARG"
    ;;
    c) CURRENT_USER="$OPTARG"
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

echo "Taking a backup on the server"
sudo kubectl exec fi-mongodb-primary-0 -- mongodump --uri="mongodb://$FYIPE_DB_USERNAME:$FYIPE_DB_PASSWORD@localhost:27017/$FYIPE_DB_NAME" --archive="/bitnami/mongodb/fyipedata.archive"
echo ""

echo "Copying backup from server to local computer. This will take some time...."
sudo kubectl cp fi-mongodb-primary-0:/bitnami/mongodb/fyipedata.archive "$BACKUP_PATH/fyipe-backup-$CURRENT_DATE.archive"


echo "File Saved: $BACKUP_PATH/fyipe-backup-$CURRENT_DATE.archive"
echo ""

  # Send Backup succss message to slack
  curl -X POST -H 'Content-type: application/json' --data '{
	"blocks": [
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "*Backup complete*\n Date:'${TODAY}'\nFolder Name: '${CURRENT_DATE}'"
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

 ####### Remove backups older than {BACKUP_RETAIN_DAYS} days  ########
 
echo "Removing backup older than ${BACKUP_RETAIN_DAYS} days."
DBDELDATE=`date +%s --date="${BACKUP_RETAIN_DAYS} days ago"`
echo ""
if [ ! -z ${BACKUP_PATH} ]; then
      cd ${BACKUP_PATH}
      for backupFile in `ls $BACKUP_PATH`; do
            if [ $backupFile -lt ${DBDELDATE} ]; then
              rm -rf $backupFile
              Send delete message
              curl -X POST -H 'Content-type: application/json' --data '{
                "blocks": [
                  {
                    "type": "divider"
                  },
                  {
                    "type": "section",
                    "text": {
                      "type": "mrkdwn",
                      "text": "*Backup Deleted*\nFolder Name: '$backupFile'"
                    },
                    "accessory": {
                      "type": "image",
                      "image_url":"https://icon-library.com/images/delete-icon/delete-icon-13.jpg",
                      "alt_text": "alt text for image"
                    }
                  },
                  {
                    "type": "divider"
                  }
                ]
              }' https://hooks.slack.com/services/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
            fi
      done
fi

echo ""
echo "Done"

# # 0 */12 * * *