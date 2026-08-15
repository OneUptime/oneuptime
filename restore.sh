#!/bin/bash

# This file takes last 30 days backup. Make sure you run this file at least once/day.
# The backup will be in the format of db-(date of the month).backup
# Before the backup, please make sure DATABASE_RESTORE_* ENV vars in config.env is set properly.


# IMPORTANT: Before restore, all database containers should be stopped.
# Restoring to a new database,
# Delete existing db.
# Create a new db.
# Make sure you have created the database and user before running this script.

# DESTRUCTIVE: pg_restore below runs with --clean --if-exists, so it DROPs every
# object contained in the dump from DATABASE_RESTORE_NAME before recreating it.
# Point this at the wrong database — or at one that is already populated — and
# that data is gone, with no undo and no prompt from pg_restore itself.
#
# This is a change in blast radius. The restore used to run without --clean, so
# pointing it at a populated database failed noisily on the pre-existing objects
# and nothing was lost. That accident was the only thing protecting you. --clean
# is now required (backup.sh emits an archive-format dump, and pg_dump ignores
# --clean for archive formats, so the drop has to happen at restore time), which
# is why the confirmation prompt below exists instead.
#
# Set DATABASE_RESTORE_ASSUME_YES=1 to skip the prompt for unattended restores.

export $(grep -v '^#' config.env | xargs)

echo "WARNING: this restore is DESTRUCTIVE."
echo "  Target database : $DATABASE_RESTORE_NAME on $DATABASE_RESTORE_HOST:$DATABASE_RESTORE_PORT"
echo "  Dump file       : $DATABASE_RESTORE_DIRECTORY/$DATABASE_RESTORE_FILENAME"
echo ""
echo "pg_restore runs with --clean --if-exists: every object in that dump is DROPPED"
echo "from the target database and recreated. Anything currently in that database"
echo "that the dump also defines will be destroyed. There is no undo."
echo ""

if [ "$DATABASE_RESTORE_ASSUME_YES" = "1" ]; then
    echo "DATABASE_RESTORE_ASSUME_YES=1 is set, skipping confirmation."
else
    read -r -p "Do you want to restore into $DATABASE_RESTORE_NAME? [y/N] " response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])+$ ]]
    then
        echo "OK!"
    else
        echo "Restore aborted. Nothing was changed."
        exit 1
    fi
fi

echo "Starting restore...."

git pull

# DATABASE_RESTORE_FILENAME must name a custom-format (-Fc) dump produced by
# backup.sh — i.e. db-(date of the month).backup. backup.sh used to emit only
# db-DD.sql / db-DD.tar, so this line pointed at a .backup file that never existed
# and the restore path was broken out of the box; it now writes exactly that name.
#
# --clean --if-exists drops each object before recreating it. backup.sh cannot carry
# --clean any more (pg_dump ignores it for archive formats), so it has to be applied
# here to keep the old drop-then-recreate behaviour. --create is intentionally NOT
# passed: this connects straight to DATABASE_RESTORE_NAME, which per the note above
# you are expected to have created already.
sudo docker run --net=host --rm \
--env-file config.env \
--add-host=host.docker.internal:host-gateway \
--volume=$(pwd)$DATABASE_RESTORE_DIRECTORY:/var/lib/postgresql/data \
postgres:latest /usr/bin/pg_restore --clean --if-exists --dbname=postgresql://$DATABASE_RESTORE_USERNAME:$DATABASE_RESTORE_PASSWORD@$DATABASE_RESTORE_HOST:$DATABASE_RESTORE_PORT/$DATABASE_RESTORE_NAME /var/lib/postgresql/data/$DATABASE_RESTORE_FILENAME

echo "Restore Completed"