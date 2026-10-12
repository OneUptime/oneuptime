#!/usr/bin/env bash
#
# Starts the three datastores OneUptime runs against, inside the image
# .oss-scanner/Dockerfile builds, with no network:
#
#   Postgres 15        localhost:5400
#   Valkey (Redis 7)   localhost:6310
#   ClickHouse 26.7    localhost:8123 (HTTP) and localhost:9000 (native)
#
# config.env at the repository root, written when the image was built, points
# the test suites and the App at them (with their passwords). A datastore that
# already answers is left alone, so this is safe to run again.
#
#   bash .oss-scanner/start-services.sh
#
# Logs: /var/log/postgresql/, /var/log/oneuptime-valkey.log and
# /var/log/clickhouse-server/.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f config.env ]; then
  echo "start-services.sh: no config.env here. Run it inside the image .oss-scanner/Dockerfile builds, which writes one." >&2
  exit 1
fi

# A setting as the suites see it: they export config.env, so the last
# assignment of a name wins.
setting() {
  sed -n "s/^$1=//p" config.env | tail -n 1
}

# Runs a check once a second until it passes, for at most <seconds>.
wait_until() {
  local name="$1" seconds="$2" log="$3"
  shift 3

  for _ in $(seq "${seconds}"); do
    if "$@" >/dev/null 2>&1; then
      echo "${name} is up."
      return 0
    fi
    sleep 1
  done

  echo "start-services.sh: ${name} did not answer within ${seconds}s. Its log: ${log}" >&2
  return 1
}

# Postgres. pg_ctlcluster runs it as the postgres user.
if ! pg_isready -q -h localhost -p 5400; then
  pg_ctlcluster 15 main start
fi
wait_until "Postgres (localhost:5400)" 60 /var/log/postgresql/ \
  pg_isready -h localhost -p 5400

# Valkey. Redis 7.0 stands in for it (see the Dockerfile).
valkey_password="$(setting VALKEY_PASSWORD)"
valkey_ping() {
  [ "$(REDISCLI_AUTH="${valkey_password}" redis-cli -h 127.0.0.1 -p 6310 ping)" = "PONG" ]
}
if ! valkey_ping >/dev/null 2>&1; then
  # The configuration arrives on stdin, so the password is on no command line.
  printf 'port 6310\nbind 127.0.0.1 -::1\nrequirepass %s\nsave ""\nappendonly no\ndaemonize yes\nlogfile /var/log/oneuptime-valkey.log\n' \
    "${valkey_password}" | redis-server - >/dev/null
fi
wait_until "Valkey (localhost:6310)" 30 /var/log/oneuptime-valkey.log valkey_ping

# ClickHouse, as its own user, with the repository's drop-ins (config.d).
clickhouse_ping() {
  curl -fsS --max-time 2 http://localhost:8123/ping
}
if ! clickhouse_ping >/dev/null 2>&1; then
  runuser -u clickhouse -- clickhouse server \
    --config-file=/etc/clickhouse-server/config.xml \
    --pid-file=/var/lib/clickhouse/clickhouse-server.pid \
    --daemon
fi
wait_until "ClickHouse (localhost:8123)" 120 /var/log/clickhouse-server/ clickhouse_ping
