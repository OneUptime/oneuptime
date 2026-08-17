# This file takes last 30 days backup. Make sure you run this file at least once/day. 
# The backup will be in the format of db-(date of the month).backup
# Before the backup, please make sure DATABASE_BACKUP_* ENV vars in config.env is set properly. 

export $(grep -v '^#' config.env | xargs)

echo "Starting backup...."

git pull

# One custom-format (-Fc) dump — the single artifact this script produces, and the
# one restore.sh feeds to pg_restore.
#
# This used to write TWO uncompressed files every run: a plain --format=plain .sql
# (which pg_restore cannot read at all) and a --format=tar .tar. Neither matched the
# db-(date of the month).backup name documented at the top of this file, the
# Backups/*.backup entry in .gitignore, or the DATABASE_RESTORE_FILENAME default in
# config.example.env (db-31.backup) — so on a stock install restore.sh pointed at a
# file that was never created and every restore failed. Keep the .backup extension
# here and in DATABASE_RESTORE_FILENAME in lockstep.
#
# --format=custom is compressed on the way out (typically 8-16x smaller than the
# plain/tar pair, over 30 daily retained copies) and is the only format pg_restore
# can restore selectively from (--table / --schema / --jobs).
#
# --clean/--create are deliberately absent: pg_dump ignores both for archive formats.
# They are restore-time options, so restore.sh passes --clean --if-exists instead.
# Ownership and ACLs are still dumped (no --no-owner / --no-acl), same as before.
sudo docker run --net=host --rm \
--env-file config.env \
--volume=$(pwd)$DATABASE_BACKUP_DIRECTORY:/var/lib/postgresql/data \
postgres:latest /usr/bin/pg_dump --format=custom --dbname=postgresql://$DATABASE_BACKUP_USERNAME:$DATABASE_BACKUP_PASSWORD@$DATABASE_BACKUP_HOST:$DATABASE_BACKUP_PORT/$DATABASE_BACKUP_NAME --file=/var/lib/postgresql/data/db-$(date +%d).backup


echo "Backup completed successfully!"