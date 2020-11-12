###
#
#   Please make sure kubectl is installed nad context is pointed to the cluster you want to resotre to.
#
#
###

# Variables, please check these before you run the script. 

HELM_RELEASE_NAME='fi'
FYIPE_DB_USERNAME='fyipe'
FYIPE_DB_PASSWORD='password'
FYIPE_DB_NAME='fyipedb'
CURRENT_DATE=$(date +%s)
CURRENT_USER=$(whoami)
FILE_NAME="fyipe-backup-1604889147.archive"
FILE_PATH="/Users/$CURRENT_USER/Documents/$FILE_NAME"

echo "Copying backup from local to server. This will take some time...."
sudo kubectl cp "$FILE_PATH" fi-mongodb-primary-0:/bitnami/mongodb/fyipedata.archive 

echo "Restoring a backup on the server."
sudo kubectl exec fi-mongodb-primary-0 -- mongorestore --uri="mongodb://$FYIPE_DB_USERNAME:$FYIPE_DB_PASSWORD@localhost:27017/$FYIPE_DB_NAME" --archive="/bitnami/mongodb/fyipedata.archive"

echo "Restore Complete"