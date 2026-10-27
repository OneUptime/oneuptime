# This file takes last 30 days backup. Make sure you run this file at least once/day. 
# The backup will be in the format of db-(date of the month).backup
# Before the backup, please make sure DATABASE_BACKUP_* ENV vars in config.env is set properly. 

# config.env's settings, each value as written - a value with spaces, quotes or
# a * in it included - read the way npm start reads them: the script runs
# itself again through Scripts/Install/WithConfig.sh. It used to export
# $(grep -v '^#' config.env | xargs), which split values at their spaces.
if [ "${ONEUPTIME_WITH_CONFIG:-}" != "1" ]; then
    ONEUPTIME_WITH_CONFIG=1 exec sh ./Scripts/Install/WithConfig.sh bash "$0" "$@"
fi

# PostgreSQL's port on this server: DATABASE_BACKUP_PORT, or else the port
# docker-compose.yml publishes it on (DATABASE_PUBLISHED_PORT, 5400 by default).
DATABASE_BACKUP_PORT="${DATABASE_BACKUP_PORT:-${DATABASE_PUBLISHED_PORT:-5400}}"

mkdir -p "$(pwd)$DATABASE_BACKUP_DIRECTORY"

echo "Starting backup...."

# No `git pull` here: taking a backup does not update OneUptime. This used to
# pull on every run, which moved the whole checkout (docker-compose.yml,
# config.example.env, both scripts) to the branch's latest commit without
# `npm run update`, and the next backup ran whatever backup.sh it had pulled.
# It never changed the run that pulled, either: git replaces a file rather
# than editing it, so the shell finishes the copy it already opened. To
# update, back up first, then `git pull` and `npm run update`.

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
#
# The folder and the connection are quoted, so a value with a space or a * in
# it reaches pg_dump as one argument, as config.env holds it.
sudo docker run --net=host --rm \
--env-file config.env \
--volume="$(pwd)$DATABASE_BACKUP_DIRECTORY:/var/lib/postgresql/data" \
postgres:latest /usr/bin/pg_dump --format=custom --dbname="postgresql://$DATABASE_BACKUP_USERNAME:$DATABASE_BACKUP_PASSWORD@$DATABASE_BACKUP_HOST:$DATABASE_BACKUP_PORT/$DATABASE_BACKUP_NAME" --file=/var/lib/postgresql/data/db-$(date +%d).backup


echo "Backup completed successfully!"