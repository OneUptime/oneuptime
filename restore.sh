# This file takes last 30 days backup. Make sure you run this file atleast once/day. 
# The backup will be in the format of db-(date of the month).backup
# Before the backup, please make sure DATABASE_RESTORE_* ENV vars in config.env is set properly. 


# IMPORTANT: Before restore, all database containers should be stopped. 
# Restoring to a new database,
# Delete existing db. 
# Create a new db.
# Make sure you have created the database and user before running this script. 

export $(grep -v '^#' config.env | xargs)

echo "Starting restore...."

git pull

sudo docker run --net=host --rm \
--env-file config.env \
--volume=$(pwd)$DATABASE_RESTORE_DIRECTORY:/var/lib/postgresql/data \
postgres:latest /usr/bin/pg_restore --dbname=postgresql://$DATABASE_RESTORE_USERNAME:$DATABASE_RESTORE_PASSWORD@$DATABASE_RESTORE_HOST:$DATABASE_RESTORE_PORT/$DATABASE_RESTORE_NAME /var/lib/postgresql/data/$DATABASE_RESTORE_FILENAME


echo "Restore Completed"