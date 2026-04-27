#!/bin/bash
#
# ClickHouse Data Migration Script (Schema + Data)
# Copies schema and data from old ClickHouse to new ClickHouse using remoteSecure/remote.
#
# Usage:
#   export OLD_CH_HOST="old-clickhouse.example.com"
#   export OLD_CH_PORT="8443"
#   export OLD_CH_USER="default"
#   export OLD_CH_PASSWORD="password"
#   export OLD_CH_DATABASE="oneuptime"
#   export OLD_CH_PROTOCOL="https"
#   export OLD_CH_NATIVE_PORT="9440"   # native port for remote() function
#
#   export NEW_CH_HOST="new-clickhouse.example.com"
#   export NEW_CH_PORT="8443"
#   export NEW_CH_USER="default"
#   export NEW_CH_PASSWORD="password"
#   export NEW_CH_DATABASE="oneuptime"
#   export NEW_CH_PROTOCOL="https"
#
#   # Optional
#   export USE_SECURE="true"           # use remoteSecure (default) or remote
#
#   ./migrate.sh
#

set -euo pipefail

# --- Configuration ---
OLD_CH_HOST="${OLD_CH_HOST:?Set OLD_CH_HOST}"
OLD_CH_PORT="${OLD_CH_PORT:-8443}"
OLD_CH_USER="${OLD_CH_USER:-default}"
OLD_CH_PASSWORD="${OLD_CH_PASSWORD:?Set OLD_CH_PASSWORD}"
OLD_CH_DATABASE="${OLD_CH_DATABASE:-oneuptime}"
OLD_CH_PROTOCOL="${OLD_CH_PROTOCOL:-https}"

NEW_CH_HOST="${NEW_CH_HOST:?Set NEW_CH_HOST}"
NEW_CH_PORT="${NEW_CH_PORT:-8443}"
NEW_CH_USER="${NEW_CH_USER:-default}"
NEW_CH_PASSWORD="${NEW_CH_PASSWORD:?Set NEW_CH_PASSWORD}"
NEW_CH_DATABASE="${NEW_CH_DATABASE:-oneuptime}"
NEW_CH_PROTOCOL="${NEW_CH_PROTOCOL:-https}"

OLD_CH_NATIVE_PORT="${OLD_CH_NATIVE_PORT:-9440}"
USE_SECURE="${USE_SECURE:-true}"

# --- Helpers ---

old_ch_query() {
  curl -sS \
    --user "${OLD_CH_USER}:${OLD_CH_PASSWORD}" \
    "${OLD_CH_PROTOCOL}://${OLD_CH_HOST}:${OLD_CH_PORT}/" \
    --data-binary "$1"
}

new_ch_query() {
  curl -sS \
    --user "${NEW_CH_USER}:${NEW_CH_PASSWORD}" \
    "${NEW_CH_PROTOCOL}://${NEW_CH_HOST}:${NEW_CH_PORT}/" \
    --data-binary "$1"
}

get_remote_func() {
  if [ "$USE_SECURE" = "true" ]; then
    echo "remoteSecure"
  else
    echo "remote"
  fi
}

# --- Main ---

echo "==========================================="
echo " ClickHouse Migration (Schema + Data)"
echo "==========================================="
echo "Source: ${OLD_CH_PROTOCOL}://${OLD_CH_HOST}:${OLD_CH_PORT}/${OLD_CH_DATABASE}"
echo "Target: ${NEW_CH_PROTOCOL}://${NEW_CH_HOST}:${NEW_CH_PORT}/${NEW_CH_DATABASE}"
echo ""

# Test connectivity
echo "Testing connectivity..."
old_ch_query "SELECT 1 FORMAT TabSeparated" > /dev/null
echo "  Source: OK"
new_ch_query "SELECT 1 FORMAT TabSeparated" > /dev/null
echo "  Target: OK"
echo ""

# Step 1: Create database on new instance
echo "--- Step 1: Create database ---"
echo -n "  Creating database '${NEW_CH_DATABASE}'... "
new_ch_query "CREATE DATABASE IF NOT EXISTS ${NEW_CH_DATABASE}"
echo "OK"
echo ""

# Step 2: Get list of all tables from old instance
echo "--- Step 2: Discover tables ---"
TABLES=$(old_ch_query "SELECT name FROM system.tables WHERE database = '${OLD_CH_DATABASE}' AND engine NOT IN ('MaterializedView') FORMAT TabSeparated")

if [ -z "$TABLES" ]; then
  echo "  No tables found in source database. Exiting."
  exit 0
fi

echo "  Found tables:"
echo "$TABLES" | while read -r t; do echo "    - $t"; done
echo ""

# Step 3: Copy schema for each table
echo "--- Step 3: Copy schema ---"
while IFS= read -r table; do
  [ -z "$table" ] && continue

  echo -n "  ${table}: fetching schema... "

  # Get the CREATE TABLE statement from the old instance
  CREATE_STMT=$(old_ch_query "SHOW CREATE TABLE ${OLD_CH_DATABASE}.${table} FORMAT TabSeparated")

  if [ -z "$CREATE_STMT" ]; then
    echo "FAILED (could not get CREATE TABLE)"
    continue
  fi

  # Replace the database name in case they differ
  CREATE_STMT=$(echo "$CREATE_STMT" | sed "s/${OLD_CH_DATABASE}\./${NEW_CH_DATABASE}\./g")

  # Use CREATE TABLE IF NOT EXISTS to be safe
  CREATE_STMT=$(echo "$CREATE_STMT" | sed 's/CREATE TABLE /CREATE TABLE IF NOT EXISTS /g')

  echo -n "creating on target... "
  RESULT=$(new_ch_query "$CREATE_STMT" 2>&1) || {
    echo "FAILED"
    echo "    Error: ${RESULT}"
    continue
  }
  echo "OK"

done <<< "$TABLES"
echo ""

# Step 4: Copy materialized views (if any)
echo "--- Step 4: Copy materialized views ---"
MV_LIST=$(old_ch_query "SELECT name FROM system.tables WHERE database = '${OLD_CH_DATABASE}' AND engine = 'MaterializedView' FORMAT TabSeparated")

if [ -z "$MV_LIST" ]; then
  echo "  No materialized views found."
else
  while IFS= read -r mv; do
    [ -z "$mv" ] && continue
    echo -n "  ${mv}: fetching definition... "

    MV_STMT=$(old_ch_query "SHOW CREATE TABLE ${OLD_CH_DATABASE}.${mv} FORMAT TabSeparated")
    MV_STMT=$(echo "$MV_STMT" | sed "s/${OLD_CH_DATABASE}\./${NEW_CH_DATABASE}\./g")
    MV_STMT=$(echo "$MV_STMT" | sed 's/CREATE MATERIALIZED VIEW /CREATE MATERIALIZED VIEW IF NOT EXISTS /g')

    echo -n "creating on target... "
    RESULT=$(new_ch_query "$MV_STMT" 2>&1) || {
      echo "FAILED"
      echo "    Error: ${RESULT}"
      continue
    }
    echo "OK"
  done <<< "$MV_LIST"
fi
echo ""

# Step 5: Copy data for each table
echo "--- Step 5: Copy data ---"
REMOTE_FUNC=$(get_remote_func)

while IFS= read -r table; do
  [ -z "$table" ] && continue

  # Get source row count
  SRC_COUNT=$(old_ch_query "SELECT count() FROM ${OLD_CH_DATABASE}.${table} FORMAT TabSeparated")
  echo "  ${table}: ${SRC_COUNT} rows in source"

  if [ "$SRC_COUNT" = "0" ]; then
    echo "    Skipping (empty table)."
    continue
  fi

  echo -n "    Copying via ${REMOTE_FUNC}()... "

  QUERY="INSERT INTO ${NEW_CH_DATABASE}.${table}
SELECT * FROM ${REMOTE_FUNC}(
  '${OLD_CH_HOST}:${OLD_CH_NATIVE_PORT}',
  '${OLD_CH_DATABASE}',
  '${table}',
  '${OLD_CH_USER}',
  '${OLD_CH_PASSWORD}'
)
SETTINGS max_execution_time=7200, receive_timeout=3600, send_timeout=3600"

  RESULT=$(new_ch_query "$QUERY" 2>&1) || {
    echo "FAILED"
    echo "    Error: ${RESULT}"
    continue
  }
  echo "OK"

  # Verify
  DST_COUNT=$(new_ch_query "SELECT count() FROM ${NEW_CH_DATABASE}.${table} FORMAT TabSeparated")
  if [ "$SRC_COUNT" = "$DST_COUNT" ]; then
    echo "    Verified: ${DST_COUNT} rows ✓"
  else
    echo "    WARNING: row mismatch — Source: ${SRC_COUNT}, Dest: ${DST_COUNT}"
  fi

done <<< "$TABLES"
echo ""

# Step 6: Final verification
echo "==========================================="
echo " Final Verification"
echo "==========================================="
printf "  %-30s %12s %12s %s\n" "TABLE" "SOURCE" "DEST" "STATUS"
printf "  %-30s %12s %12s %s\n" "-----" "------" "----" "------"

ALL_TABLES=$(old_ch_query "SELECT name FROM system.tables WHERE database = '${OLD_CH_DATABASE}' AND engine NOT IN ('MaterializedView') FORMAT TabSeparated")
while IFS= read -r table; do
  [ -z "$table" ] && continue
  OLD_COUNT=$(old_ch_query "SELECT count() FROM ${OLD_CH_DATABASE}.${table} FORMAT TabSeparated")
  NEW_COUNT=$(new_ch_query "SELECT count() FROM ${NEW_CH_DATABASE}.${table} FORMAT TabSeparated")
  if [ "$OLD_COUNT" = "$NEW_COUNT" ]; then
    STATUS="✓"
  else
    STATUS="✗ MISMATCH"
  fi
  printf "  %-30s %12s %12s %s\n" "$table" "$OLD_COUNT" "$NEW_COUNT" "$STATUS"
done <<< "$ALL_TABLES"

echo ""
echo "Done."
