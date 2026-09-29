#!/usr/bin/env bash

# Sets up what the Common, App and Enterprise Edition test jobs run against:
# config.env at the repository root, which each suite's `npm test` exports,
# and the dev compose file's postgres (localhost:5400) and valkey
# (localhost:6310). test.common.yaml, test.app.yaml and test.ee.yaml each run
# it as `bash test-setup.sh` from packages/Common. It overwrites config.env, so
# it is for CI's throwaway checkouts, not for a development checkout.
#
# Every step has to succeed, or the step fails. That was not always so: this
# used to run without errexit, leave config.env to `npm run prerun`, and start
# the containers with a bare `up -d`, so the step only ever reported whether
# that last command had created two containers. On 2026-09-21 prerun's
# Scripts/Install/configure.sh could not download gomplate from GitHub's
# release CDN, which was answering 504, and exited before it merged the env
# template. config.env had no DATABASE_* settings, postgres restart-looped for
# want of a password, the step passed anyway, and ten Postgres tests failed
# fifteen minutes later with a bare AggregateError (ECONNREFUSED) that pointed
# nowhere near here.
#
# Not -u: BILLING_PRIVATE_KEY, expanded below, is unset outside CI.
set -eo pipefail

# The repository root, whichever directory this is run from.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

fail() {
	if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
		echo "::error title=Test setup failed::$1" >&2
	fi
	echo "test-setup.sh: $1" >&2
	exit 1
}

# The settings the suites run with that differ from config.example.env's.
# Everything else is appended from the template by MergeEnvTemplate.js below.
cat <<EOL > config.env
NODE_ENV=test
BILLING_ENABLED=true
DATABASE_HOST=localhost
DATABASE_PORT=5400
VALKEY_HOST=localhost
VALKEY_PORT=6310
VALKEY_DB=0
VALKEY_USERNAME=default
SUBSCRIPTION_PLAN_BASIC=Free,price_1M4niQANuQdJ93r7AVjhnik5,price_1M4niQANuQdJ93r7l1Wz1dkm,0,0,1,0
SUBSCRIPTION_PLAN_GROWTH=Growth,price_1M4nhZANuQdJ93r7yfQ1MePQ,price_1M4r3OANuQdJ93r7g8NyoCBq,22,20,2,14
SUBSCRIPTION_PLAN_SCALE=Scale,price_1MKidGANuQdJ93r7FoaZ1dOb,price_1MKidRANuQdJ93r7LVOc0BUy,99,84,3,14
SUBSCRIPTION_PLAN_ENTERPRISE=Enterprise,price_1M4ng9ANuQdJ93r7CP90ezSN,price_1M4ng9ANuQdJ93r72ZYUp4PU,-1,-1,4,14
BILLING_PUBLIC_KEY=pk_test_51LleTZANuQdJ93r7PvyfOvpm5TZXtUf1T5fjS5cbOmDuCFIiGMoEhvuIrzTRMcZirg7qJwgbjLeCmXmxL1BiUDi100IzcuP3SU
BILLING_PRIVATE_KEY=$BILLING_PRIVATE_KEY
EOL

# Two of the steps `npm run prerun` takes, and the only two these suites need.
# prerun's other step, Scripts/Install/configure.sh, is an installer: before it
# merges the env template it downloads gomplate from GitHub's release CDN and
# installs ts-node globally, and afterwards it renders the Dockerfile.tpl
# templates with gomplate. No suite reads a rendered Dockerfile (the ones that
# check Dockerfiles read the .tpl templates) or runs a global ts-node (App's
# tests load ts-node/register from App's own node_modules), so none of that
# belongs here. Both of these are offline, so the network can no longer stop
# config.env from being written.
#
# Every package.json's version, synced to VERSION: ee's ModuleShape test holds
# ee/package.json to it.
node ./Scripts/Install/SyncPackageVersions.js
# Appends every config.example.env setting config.env does not have yet,
# DATABASE_USERNAME, DATABASE_PASSWORD and DATABASE_NAME among them.
node ./Scripts/Install/MergeEnvTemplate.js

# A setting's value as the suites will see it: config.env exported the way
# their `npm test` scripts export it, into an otherwise empty environment, so a
# variable this job happens to carry cannot stand in for one config.env lacks.
config_env_value() {
	# Single-quoted on purpose: the inner bash expands it.
	# shellcheck disable=SC2016
	env -i PATH="$PATH" bash -c 'export $(grep -v "^#" config.env | xargs) && printenv "$1"' _ "$1" || true
}

# postgres initialises its database from these (POSTGRES_USER,
# POSTGRES_PASSWORD and POSTGRES_DB in docker-compose.base.yml) and the suites
# connect with them. Without a password the postgres image refuses to
# initialise at all, which is how 2026-09-21 failed, so check before starting
# it rather than wait for it.
missing=()
for key in DATABASE_USERNAME DATABASE_PASSWORD DATABASE_NAME; do
	if [ -z "$(config_env_value "$key")" ]; then
		missing+=("$key")
	fi
done
if [ ${#missing[@]} -gt 0 ]; then
	fail "config.env has no value for ${missing[*]} after merging config.example.env into it. postgres is initialised with DATABASE_USERNAME, DATABASE_PASSWORD and DATABASE_NAME, and the suites connect with them, so nothing was started."
fi

# For the log, without BILLING_PRIVATE_KEY's value. GitHub masks the secret it
# comes from, but masking is a backstop, and whether it is set is all a reader
# of this log needs.
redact() {
	sed -E 's/^(BILLING_PRIVATE_KEY=).+$/\1<set, not printed>/'
}

echo "config.env file"
redact < config.env
echo

# Exported so compose interpolates postgres's and valkey's settings, and the
# password valkey's healthcheck pings with, from config.env. Unquoted on
# purpose, as in every suite's `npm test`: one KEY=value per word.
# shellcheck disable=SC2046
export $(grep -v '^#' config.env | xargs)

echo "env vars"
printenv | redact

# --wait: the step passes only once postgres and valkey report healthy (both
# have a healthcheck in docker-compose.base.yml: pg_isready and valkey-cli
# ping), so a database that cannot start fails here, with its logs, instead of
# in whichever suite reaches for it first. The timeout covers the wait alone,
# not the image pulls before it, and outlasts the healthchecks' own budget
# (a 15s start period, then 5 retries 10s apart), so Docker's verdict is what
# decides. Both are normally healthy within ten seconds of starting.
COMPOSE=(docker compose --project-directory . -f Scripts/Dev/docker-compose.dev.yml)
if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres valkey; then
	"${COMPOSE[@]}" ps --all postgres valkey || true
	"${COMPOSE[@]}" logs --no-color --tail 100 postgres valkey || true
	fail "postgres and valkey did not both become healthy. Their state and logs are printed above."
fi
