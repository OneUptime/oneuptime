###
#
#   Please make sure kubectl is installed nad context is pointed to the cluster you want to resotre to.
#
###

# Variables, please check these before you run the script. 

HELM_RELEASE_NAME='fi'
FYIPE_DB_USERNAME='fyipe'
FYIPE_DB_PASSWORD='password'
FYIPE_DB_NAME='fyipedb'
CURRENT_DATE=$(date +%s)
CURRENT_USER=$(whoami)
BACKUP_PATH="/Users/$CURRENT_USER/Documents"

echo "Taking a backup on the server"
sudo kubectl exec fi-mongodb-primary-0 -- mongodump --uri="mongodb://$FYIPE_DB_USERNAME:$FYIPE_DB_PASSWORD@localhost:27017/$FYIPE_DB_NAME" --archive="/bitnami/mongodb/fyipedata.archive"

echo "Copying backup from server to local computer. This will take some time...."
sudo kubectl cp fi-mongodb-primary-0:/bitnami/mongodb/fyipedata.archive "$BACKUP_PATH/fyipe-backup-$CURRENT_DATE.archive"

echo "File Saved: $BACKUP_PATH/fyipe-backup-$CURRENT_DATE.archive"