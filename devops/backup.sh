###
#
#   Please make sure kubectl is installed and context is pointed to the cluster you want to restore to.
#
###

HELM_RELEASE_NAME='fi'
FYIPE_DB_USERNAME='fyipe'
FYIPE_DB_PASSWORD='password'
FYIPE_DB_NAME='fyipedb'
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
    r) HELM_RELEASE_NAME="$OPTARG"
    ;;
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
}


echo "Taking a backup on the server"
echo ""
if sudo kubectl exec fyipe-766b74d759-ncbg7 -- mongodump --uri="mongodb://$FYIPE_DB_USERNAME:$FYIPE_DB_PASSWORD@localhost:27017/$FYIPE_DB_NAME" --archive="/tmp/fyipedata.archive"; then
    echo "Copying backup from server to local computer. This will take some time...."
    echo ""
    if sudo kubectl cp fyipe-766b74d759-ncbg7:tmp/fyipedata.archive "$BACKUP_PATH/fyipe-backup-$CURRENT_DATE.archive"; then
      echo "File Saved: $BACKUP_PATH/fyipe-backup-$CURRENT_DATE.archive"
      echo ""
      BACKUP_SUCCESS
      
    else
      echo "Failure, exit status: $?"
      BACKUP_FAIL_LOCAL
    fi    
else
     echo "Failure, exit status: $"
     BACKUP_FAIL_SERVER
fi


 ####### Remove backups older than {BACKUP_RETAIN_DAYS} days  ########
 
echo "Removing backup older than ${BACKUP_RETAIN_DAYS} days."
DBDELDATE=`date +%s --date="${BACKUP_RETAIN_DAYS} days ago"`
echo ""
if [ ! -z ${BACKUP_PATH} ]; then
      cd ${BACKUP_PATH}
      for backupFile in `ls $BACKUP_PATH`; do
            if [ $backupFile -lt ${DBDELDATE} ]; then
              rm -rf $backupFile
              # Send delete message
              # curl -X POST -H 'Content-type: application/json' --data '{
              #   "blocks": [
              #     {
              #       "type": "divider"
              #     },
              #     {
              #       "type": "section",
              #       "text": {
              #         "type": "mrkdwn",
              #         "text": "*Backup Deleted*\nPath: '$backupFile'"
              #       },
              #       "accessory": {
              #         "type": "image",
              #         "image_url":"https://icon-library.com/images/delete-icon/delete-icon-13.jpg",
              #         "alt_text": "alt text for image"
              #       }
              #     },
              #     {
              #       "type": "divider"
              #     }
              #   ]
              # }' https://hooks.slack.com/services/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
            fi
      done
fi

echo ""
echo "Done"

# # 0 */12 * * *