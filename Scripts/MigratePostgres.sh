#!/bin/bash

# =============================================================================
# PostgreSQL Migration Script
# Migrates data from an old (internet-accessible) PostgreSQL instance to a new
# PostgreSQL instance running in a Kubernetes pod.
#
# Usage: Run this script after exec-ing into the new PostgreSQL pod:
#   kubectl exec -it <postgres-pod> -- bash
#   Then run this script inside the pod.
# =============================================================================

set -euo pipefail

# ---------------------
# Configuration
# ---------------------

# Old (source) PostgreSQL instance — accessible via internet
OLD_PG_HOST="${OLD_PG_HOST:?Error: Set OLD_PG_HOST environment variable}"
OLD_PG_PORT="${OLD_PG_PORT:-5432}"
OLD_PG_USER="${OLD_PG_USER:-postgres}"
OLD_PG_PASSWORD="${OLD_PG_PASSWORD:?Error: Set OLD_PG_PASSWORD environment variable}"
OLD_PG_DATABASE="${OLD_PG_DATABASE:-oneuptimedb}"

# New (target) PostgreSQL instance — local (this pod)
NEW_PG_HOST="${NEW_PG_HOST:-localhost}"
NEW_PG_PORT="${NEW_PG_PORT:-5432}"
NEW_PG_USER="${NEW_PG_USER:-postgres}"
NEW_PG_PASSWORD="${NEW_PG_PASSWORD:-${POSTGRES_PASSWORD:-password}}"
NEW_PG_DATABASE="${NEW_PG_DATABASE:-oneuptimedb}"

# Dump file location
DUMP_DIR="/tmp/pg_migration"
DUMP_FILE="${DUMP_DIR}/oneuptimedb.dump"

# ---------------------
# Helper functions
# ---------------------

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error_exit() {
    log "ERROR: $1"
    exit 1
}

cleanup() {
    log "Cleaning up dump files..."
    rm -rf "${DUMP_DIR}"
}

# ---------------------
# Pre-flight checks
# ---------------------

log "=== PostgreSQL Migration Script ==="
log ""
log "Source: ${OLD_PG_HOST}:${OLD_PG_PORT}/${OLD_PG_DATABASE}"
log "Target: ${NEW_PG_HOST}:${NEW_PG_PORT}/${NEW_PG_DATABASE}"
log ""

# Check pg_dump and pg_restore are available
command -v pg_dump >/dev/null 2>&1 || error_exit "pg_dump not found. Ensure PostgreSQL client tools are installed."
command -v pg_restore >/dev/null 2>&1 || error_exit "pg_restore not found. Ensure PostgreSQL client tools are installed."
command -v psql >/dev/null 2>&1 || error_exit "psql not found. Ensure PostgreSQL client tools are installed."

# Test connectivity to old instance
log "Testing connectivity to source database..."
PGPASSWORD="${OLD_PG_PASSWORD}" psql \
    -h "${OLD_PG_HOST}" \
    -p "${OLD_PG_PORT}" \
    -U "${OLD_PG_USER}" \
    -d "${OLD_PG_DATABASE}" \
    -c "SELECT 1;" >/dev/null 2>&1 || error_exit "Cannot connect to source database at ${OLD_PG_HOST}:${OLD_PG_PORT}"
log "Source database connection OK."

# Test connectivity to new instance
log "Testing connectivity to target database..."
PGPASSWORD="${NEW_PG_PASSWORD}" psql \
    -h "${NEW_PG_HOST}" \
    -p "${NEW_PG_PORT}" \
    -U "${NEW_PG_USER}" \
    -d "postgres" \
    -c "SELECT 1;" >/dev/null 2>&1 || error_exit "Cannot connect to target database at ${NEW_PG_HOST}:${NEW_PG_PORT}"
log "Target database connection OK."

# ---------------------
# Step 1: Dump from old instance
# ---------------------

mkdir -p "${DUMP_DIR}"

log ""
log "Step 1: Dumping source database..."
log "This may take a while depending on database size..."

PGPASSWORD="${OLD_PG_PASSWORD}" pg_dump \
    -h "${OLD_PG_HOST}" \
    -p "${OLD_PG_PORT}" \
    -U "${OLD_PG_USER}" \
    -d "${OLD_PG_DATABASE}" \
    -Fc \
    --no-owner \
    --no-privileges \
    --verbose \
    -f "${DUMP_FILE}" \
    2>&1 | while IFS= read -r line; do log "  pg_dump: ${line}"; done

[ -f "${DUMP_FILE}" ] || error_exit "Dump file was not created."

DUMP_SIZE=$(du -sh "${DUMP_FILE}" | cut -f1)
log "Dump complete. File size: ${DUMP_SIZE}"

# ---------------------
# Step 2: Prepare target database
# ---------------------

log ""
log "Step 2: Preparing target database..."

# Drop and recreate the target database
PGPASSWORD="${NEW_PG_PASSWORD}" psql \
    -h "${NEW_PG_HOST}" \
    -p "${NEW_PG_PORT}" \
    -U "${NEW_PG_USER}" \
    -d "postgres" \
    -c "
        -- Terminate existing connections to the target database
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = '${NEW_PG_DATABASE}'
        AND pid <> pg_backend_pid();
    " >/dev/null 2>&1 || true

PGPASSWORD="${NEW_PG_PASSWORD}" psql \
    -h "${NEW_PG_HOST}" \
    -p "${NEW_PG_PORT}" \
    -U "${NEW_PG_USER}" \
    -d "postgres" \
    -c "DROP DATABASE IF EXISTS \"${NEW_PG_DATABASE}\";" \
    2>&1 | while IFS= read -r line; do log "  psql: ${line}"; done

PGPASSWORD="${NEW_PG_PASSWORD}" psql \
    -h "${NEW_PG_HOST}" \
    -p "${NEW_PG_PORT}" \
    -U "${NEW_PG_USER}" \
    -d "postgres" \
    -c "CREATE DATABASE \"${NEW_PG_DATABASE}\";" \
    2>&1 | while IFS= read -r line; do log "  psql: ${line}"; done

log "Target database ready."

# ---------------------
# Step 3: Restore to new instance
# ---------------------

log ""
log "Step 3: Restoring to target database..."
log "This may take a while depending on database size..."

PGPASSWORD="${NEW_PG_PASSWORD}" pg_restore \
    -h "${NEW_PG_HOST}" \
    -p "${NEW_PG_PORT}" \
    -U "${NEW_PG_USER}" \
    -d "${NEW_PG_DATABASE}" \
    --no-owner \
    --no-privileges \
    --verbose \
    --jobs=4 \
    "${DUMP_FILE}" \
    2>&1 | while IFS= read -r line; do log "  pg_restore: ${line}"; done

log "Restore complete."

# ---------------------
# Step 4: Verify migration
# ---------------------

log ""
log "Step 4: Verifying migration..."

# Get table counts from source
log "Counting tables in source..."
SOURCE_TABLES=$(PGPASSWORD="${OLD_PG_PASSWORD}" psql \
    -h "${OLD_PG_HOST}" \
    -p "${OLD_PG_PORT}" \
    -U "${OLD_PG_USER}" \
    -d "${OLD_PG_DATABASE}" \
    -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
SOURCE_TABLES=$(echo "${SOURCE_TABLES}" | xargs)

# Get table counts from target
log "Counting tables in target..."
TARGET_TABLES=$(PGPASSWORD="${NEW_PG_PASSWORD}" psql \
    -h "${NEW_PG_HOST}" \
    -p "${NEW_PG_PORT}" \
    -U "${NEW_PG_USER}" \
    -d "${NEW_PG_DATABASE}" \
    -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
TARGET_TABLES=$(echo "${TARGET_TABLES}" | xargs)

log "Source tables: ${SOURCE_TABLES}"
log "Target tables: ${TARGET_TABLES}"

if [ "${SOURCE_TABLES}" = "${TARGET_TABLES}" ]; then
    log "Table count matches."
else
    log "WARNING: Table count mismatch! Source=${SOURCE_TABLES}, Target=${TARGET_TABLES}"
fi

# Compare row counts for each table
log ""
log "Row count comparison (source vs target):"
log "-------------------------------------------"

TABLES=$(PGPASSWORD="${NEW_PG_PASSWORD}" psql \
    -h "${NEW_PG_HOST}" \
    -p "${NEW_PG_PORT}" \
    -U "${NEW_PG_USER}" \
    -d "${NEW_PG_DATABASE}" \
    -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")

MISMATCH_COUNT=0

while IFS= read -r table; do
    table=$(echo "${table}" | xargs)
    [ -z "${table}" ] && continue

    src_count=$(PGPASSWORD="${OLD_PG_PASSWORD}" psql \
        -h "${OLD_PG_HOST}" \
        -p "${OLD_PG_PORT}" \
        -U "${OLD_PG_USER}" \
        -d "${OLD_PG_DATABASE}" \
        -t -c "SELECT count(*) FROM \"${table}\";" 2>/dev/null | xargs)

    tgt_count=$(PGPASSWORD="${NEW_PG_PASSWORD}" psql \
        -h "${NEW_PG_HOST}" \
        -p "${NEW_PG_PORT}" \
        -U "${NEW_PG_USER}" \
        -d "${NEW_PG_DATABASE}" \
        -t -c "SELECT count(*) FROM \"${table}\";" 2>/dev/null | xargs)

    if [ "${src_count}" = "${tgt_count}" ]; then
        status="OK"
    else
        status="MISMATCH"
        MISMATCH_COUNT=$((MISMATCH_COUNT + 1))
    fi

    printf "  %-50s src=%-10s tgt=%-10s %s\n" "${table}" "${src_count}" "${tgt_count}" "${status}"
done <<< "${TABLES}"

log "-------------------------------------------"

if [ "${MISMATCH_COUNT}" -eq 0 ]; then
    log "All row counts match. Migration verified successfully."
else
    log "WARNING: ${MISMATCH_COUNT} table(s) have row count mismatches."
    log "This may be expected if the source database had writes during migration."
fi

# ---------------------
# Cleanup
# ---------------------

log ""
cleanup
log ""
log "=== Migration complete ==="
log ""
log "Next steps:"
log "  1. Update your application's DATABASE_HOST to point to the new instance"
log "  2. Restart application pods to pick up the new connection"
log "  3. Verify the application is working correctly"
log "  4. Decommission the old database once confirmed"
