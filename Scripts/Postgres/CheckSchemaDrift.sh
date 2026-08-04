#!/usr/bin/env bash
#
# Postgres schema drift check.
#
# Applies every registered TypeORM migration to a Postgres database, then asks
# TypeORM to generate a migration from the result. A correctly migrated database
# has nothing left to generate. Anything it does emit is drift: an entity change
# that never got a migration, or a migration file that was generated but never
# registered in SchemaMigrations/Index.ts (unregistered migrations do not run,
# so their tables and columns are simply missing).
#
# Exit codes:
#   0  schema matches the entities
#   1  drift detected, or the check could not be run
#
# Usage:
#   npm run check-postgres-schema-drift
#
# Connection: DATABASE_MIGRATIONS_HOST / DATABASE_MIGRATIONS_PORT (default
# localhost:5400, where docker compose publishes Postgres) plus the usual
# DATABASE_USERNAME / DATABASE_PASSWORD / DATABASE_NAME. config.env is loaded
# when present, so locally this needs no arguments.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

DATA_SOURCE="./Common/Server/Infrastructure/Postgres/LocalMigrationGenerationDataSource.ts"
MIGRATIONS_INDEX="Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts"

# --- Configuration ---

# Local dev keeps credentials in config.env; CI passes them in the job env and
# has no such file. Anything already exported wins over the file, so a one-off
# `DATABASE_MIGRATIONS_PORT=5401 npm run check-postgres-schema-drift` points at
# a throwaway database instead of being silently overridden.
if [ -f "${REPO_ROOT}/config.env" ]; then
  while IFS='=' read -r key value; do
    if [ -z "${!key:-}" ]; then
      export "${key}"="${value}"
    fi
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "${REPO_ROOT}/config.env")
fi

export DATABASE_MIGRATIONS_HOST="${DATABASE_MIGRATIONS_HOST:-localhost}"
export DATABASE_MIGRATIONS_PORT="${DATABASE_MIGRATIONS_PORT:-5400}"

# TypeORM logs any query over DATABASE_SLOW_QUERY_LOG_THRESHOLD_MS. Schema
# reflection reads every column in the database in one statement and migrations
# are slow by nature, so on this path the threshold produces tens of thousands
# of lines of noise around a two-line verdict. 0 disables it.
export DATABASE_SLOW_QUERY_LOG_THRESHOLD_MS=0

TYPEORM=(node --require ts-node/register ./node_modules/typeorm/cli.js)

echo "==========================================="
echo " Postgres Schema Drift Check"
echo "==========================================="
echo "Database: ${DATABASE_MIGRATIONS_HOST}:${DATABASE_MIGRATIONS_PORT}/${DATABASE_NAME:-oneuptimedb}"
echo ""

# --- Step 1: apply every registered migration ---

echo "--- Step 1: Applying registered migrations ---"
if ! "${TYPEORM[@]}" migration:run -d "${DATA_SOURCE}"; then
  echo ""
  echo "ERROR: migrations failed to apply. Fix the migration before the drift"
  echo "check can say anything useful about the schema."
  exit 1
fi
echo ""

# --- Step 2: generate against the migrated schema ---

echo "--- Step 2: Generating a migration against the result ---"

# --check prints the migration it *would* have written and exits 1, rather than
# writing a file into SchemaMigrations/. Nothing is left on disk either way.
CHECK_OUTPUT="$("${TYPEORM[@]}" migration:generate \
  ./Common/Server/Infrastructure/Postgres/SchemaMigrations/SchemaDrift \
  -d "${DATA_SOURCE}" --check 2>&1)"
CHECK_EXIT=$?

if [ ${CHECK_EXIT} -eq 0 ]; then
  echo ""
  echo "No schema drift. The database matches the entities."
  exit 0
fi

if ! grep -q "Unexpected changes in database schema were found" <<<"${CHECK_OUTPUT}"; then
  # Exit 1 without the drift banner means the check itself broke — a bad
  # connection, an entity that fails to load. Show it raw; it is not drift.
  echo ""
  echo "ERROR: could not complete the drift check."
  echo "${CHECK_OUTPUT}"
  exit 1
fi

echo ""
echo "==========================================="
echo " SCHEMA DRIFT DETECTED"
echo "==========================================="
echo ""
echo "The entities in Common/Models/DatabaseModels do not match the schema the"
echo "registered migrations produce. TypeORM would generate this to close the gap:"
echo ""
# Drop TypeORM's own banner line; this script already framed the failure.
grep -v "^Unexpected changes in database schema were found in check mode:$" \
  <<<"${CHECK_OUTPUT}"
echo ""
echo "-------------------------------------------"
echo "To fix, on a database that is already fully migrated:"
echo ""
echo "  1. npm run generate-postgres-migration"
echo ""
echo "  2. Register the generated class in"
echo "     ${MIGRATIONS_INDEX}"
echo "     — add the import at the top AND append it to the default export array."
echo "     A migration that is not in that array never runs, so leaving this step"
echo "     out reproduces this failure rather than fixing it."
echo ""
echo "  3. Re-run this check: npm run check-postgres-schema-drift"
echo ""
echo "Do not hand-write the migration. If the generated statements look wrong,"
echo "the entity is what needs correcting."
echo "-------------------------------------------"
exit 1
