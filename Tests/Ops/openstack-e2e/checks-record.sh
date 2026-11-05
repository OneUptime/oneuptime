#!/usr/bin/env bash
#
# The lifecycle check against a real cloud, breaking the cloud under it: what issue #5749's "done
# when" asks, by running the probe's own code (checks-run.ts). No OneUptime runs here. The incident
# half is proven on what this records, through the real monitor evaluation code:
# packages/Common/Tests/Utils/OpenStack/OpenStackCheckRecordings.test.ts.
#
# The project, the user, the network and the credential are made with the commands the guide tells a
# person to run (telemetry/openstack.md, "Check the cloud from outside"), and OpenStackChecksGuide
# holds the two to each other.
#
#   healthy            every step, on the cloud as it is, and the API checks
#   signed             the same with an OSProfiler key, on a cloud with OSProfiler off: nothing breaks
#   scheduler-stopped  nova-scheduler stopped: fails at the wait for ACTIVE, with Nova's fault
#   scheduler-started  started again: the next run passes
#   killed-*           a run killed part way: the next is skipped, a later one leaves what it left,
#                      and one past two intervals clears it, on the clock moved on
#   lookalikes         what merely looks like the check's, and another project's, are still there
#   refused-*          a credential scoped elsewhere, an admin and an unrestricted one write nothing
#   volume-stopped     cinder-volume stopped: fails in the volume part, and the boot still passes
#   gateway-removed    the router's gateway removed: fails in the floating IP part
#   writes.json        what the check's credential can write to another project: nothing
#
# Each scene writes $OUTPUT_DIR/checks/<scene>/report.json, what a probe would have reported, and
# requests.jsonl, every request it made with what it was answered. verdict.txt says which held.
#
# Usage: OUTPUT_DIR=out bash Tests/Ops/openstack-e2e/checks-record.sh
# Set CHECKS_PLAIN_HTTP=1 on a cloud with no TLS, which checks-run.ts explains.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUTPUT_DIR="$(mkdir -p "${OUTPUT_DIR:-out}" && cd "${OUTPUT_DIR:-out}" && pwd)"
CHECKS_DIR="$OUTPUT_DIR/checks"
SECRETS_DIR="$(mktemp -d)"
READ=(python3 -I "$HERE/checks-read.py")
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
PROJECT=oneuptime-checks
USER_NAME=oneuptime-check
KEY=0123456789ab
INTERVAL=30
REGION="$(openstack region list -f value -c Region | head -1)"
OPTIONS='{"isFloatingIpEnabled":true,"isVolumeEnabled":true}'
PASSWORD="ou-$(openssl rand -hex 12)"
OSPROFILER_KEY="$(openssl rand -hex 32)"
export OSPROFILER_KEY

mkdir -p "$CHECKS_DIR"
: >"$CHECKS_DIR/verdict.txt"
chmod 0700 "$SECRETS_DIR"
trap 'rm -rf "$SECRETS_DIR"' EXIT

log() {
  printf '\n=== %s\n' "$*"
}

held() {
  printf 'HELD   %s\n' "$*" | tee -a "$CHECKS_DIR/verdict.txt"
}

missed() {
  printf 'MISSED %s\n' "$*" | tee -a "$CHECKS_DIR/verdict.txt"
}

# Says whether a command held, and carries on either way: a scene that fails costs only itself.
holds() {
  local name="$1"
  shift
  if "$@"; then
    held "$name"
  else
    missed "$name"
  fi
}

AUTH_URL="$(openstack endpoint list --service identity --interface public -f value -c URL | head -1)"
AUTH_HOST="$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.urlparse(sys.argv[1]).netloc)' "$AUTH_URL")"

FINGERPRINT=-
JOB_AUTH_URL="$AUTH_URL"
if [ "${CHECKS_PLAIN_HTTP:-0}" = "1" ]; then
  export OS_CHECK_PLAIN_HTTP=1
  # The check reads an address as a probe does, and a probe refuses plain HTTP: see checks-run.ts.
  JOB_AUTH_URL="${AUTH_URL/http:/https:}"
else
  # What a person's "Trust this certificate" saves.
  FINGERPRINT="$(openssl s_client -connect "$AUTH_HOST" -servername "${AUTH_HOST%%:*}" </dev/null 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2)"
  echo "Keystone's certificate: $FINGERPRINT"
fi

log "What the guide tells a person to do: the project, the user, the network, the credential"
openstack project create --domain default --description "OneUptime lifecycle check" "$PROJECT" >/dev/null
openstack quota set --instances 3 --cores 3 --ram 2048 --volumes 3 --gigabytes 3 \
  --floating-ips 3 --secgroups 6 --secgroup-rules 20 --ports 8 "$PROJECT"
openstack user create --domain default --password "$PASSWORD" "$USER_NAME" >/dev/null
openstack role add --project "$PROJECT" --user "$USER_NAME" member

as_check_user() {
  env -u OS_CLOUD OS_AUTH_URL="$AUTH_URL" OS_IDENTITY_API_VERSION=3 OS_USERNAME="$USER_NAME" \
    OS_PASSWORD="$PASSWORD" OS_USER_DOMAIN_NAME=Default OS_PROJECT_NAME="$PROJECT" \
    OS_PROJECT_DOMAIN_NAME=Default OS_CACERT="${OS_CACERT:-/opt/stack/data/ca-bundle.pem}" "$@"
}

as_check_user openstack network create oneuptime-check-net >/dev/null
as_check_user openstack subnet create --network oneuptime-check-net --subnet-range 192.168.250.0/24 oneuptime-check-subnet >/dev/null
as_check_user openstack router create oneuptime-check-router >/dev/null
as_check_user openstack router set --external-gateway public oneuptime-check-router
as_check_user openstack router add subnet oneuptime-check-router oneuptime-check-subnet
CHECK_CREDENTIAL="$(as_check_user openstack application credential create --role member oneuptime-check -f json)"
CHECK_CREDENTIAL_ID="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["id"])' <<<"$CHECK_CREDENTIAL")"
CHECK_CREDENTIAL_SECRET="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["secret"])' <<<"$CHECK_CREDENTIAL")"
export CHECK_CREDENTIAL_SECRET
unset CHECK_CREDENTIAL

log "Another project, which the check's credential has no business touching"
VICTIM=ou-check-victim
IMAGE="$(openstack image list --status active -f value -c Name | grep -i cirros | head -1)"
openstack project create --domain default "$VICTIM" >/dev/null
openstack role add --project "$VICTIM" --user admin member
as_victim() {
  OS_PROJECT_NAME="$VICTIM" "$@"
}
as_victim openstack network create ou-victim-net >/dev/null
as_victim openstack subnet create --network ou-victim-net --subnet-range 10.79.0.0/24 ou-victim-subnet >/dev/null
as_victim openstack security group create ou-victim-sg >/dev/null
as_victim openstack server create --flavor m1.nano --image "$IMAGE" --network ou-victim-net --wait ou-victim-server >/dev/null
as_victim openstack volume create --size 1 ou-victim-volume >/dev/null
VICTIM_FIP_ID="$(as_victim openstack floating ip create public -f value -c id)"
python3 -I - >"$SECRETS_DIR/victim.json" <<VICTIM_JSON
import json, subprocess, os
def value(*args):
    return subprocess.check_output(["openstack", *args, "-f", "value", "-c", "id"], env={**os.environ, "OS_PROJECT_NAME": "$VICTIM"}, text=True).strip()
print(json.dumps({
    "project": value("project", "show", "$VICTIM"),
    "server": value("server", "show", "ou-victim-server"),
    "volume": value("volume", "show", "ou-victim-volume"),
    "network": value("network", "show", "ou-victim-net"),
    "security_group": value("security", "group", "show", "ou-victim-sg"),
    "floating_ip": "$VICTIM_FIP_ID",
    "external_network": value("network", "show", "public"),
    "user": value("user", "show", "admin"),
    "member_role": value("role", "show", "member"),
}))
VICTIM_JSON

victims_are_all_there() {
  as_victim openstack server show ou-victim-server -f value -c status | grep -qx ACTIVE \
    && as_victim openstack volume show ou-victim-volume -f value -c status | grep -qx available \
    && as_victim openstack security group show ou-victim-sg -f value -c id >/dev/null \
    && as_victim openstack floating ip show "$VICTIM_FIP_ID" -f value -c id >/dev/null \
    && [ "$(as_victim openstack server list --name '^oneuptime-check' -f value -c ID | wc -l)" = "0" ] \
    && [ "$(as_victim openstack volume list --name 'oneuptime-check' -f value -c ID | wc -l)" = "0" ]
}

# What merely looks like the check's, in its own project. Nothing here is ever to be deleted.
log "What merely looks like the check's, in its own project"
OLD_STAMP=20200101000000
LOOKALIKE_SERVER="oneuptime-check-$KEY-$OLD_STAMP-abcdef-server-old"
LOOKALIKE_OTHER_KEY="oneuptime-check-ffffffffffff-$OLD_STAMP-abcdef-server"
LOOKALIKE_VOLUME="oneuptime-check-$KEY-$OLD_STAMP-abcdef-server"
LOOKALIKE_SG="oneuptime-check-web"
as_check_user openstack server create --flavor m1.nano --image "$IMAGE" --network oneuptime-check-net --wait "$LOOKALIKE_SERVER" >/dev/null
as_check_user openstack volume create --size 1 "$LOOKALIKE_VOLUME" >/dev/null
as_check_user openstack security group create "$LOOKALIKE_SG" >/dev/null
# Room for these, and for what the scenes make.
openstack quota set --instances 6 --cores 6 --volumes 6 --gigabytes 6 "$PROJECT"

lookalikes_are_all_there() {
  as_check_user openstack server show "$LOOKALIKE_SERVER" -f value -c id >/dev/null \
    && as_check_user openstack volume show "$LOOKALIKE_VOLUME" -f value -c id >/dev/null \
    && as_check_user openstack security group show "$LOOKALIKE_SG" -f value -c id >/dev/null
}

left_by_check() {
  {
    as_check_user openstack server list -f value -c Name
    as_check_user openstack volume list -f value -c Name
    as_check_user openstack floating ip list -f value -c Description 2>/dev/null
    as_check_user openstack security group list -f value -c Name
  } | grep -E "^oneuptime-check-$KEY-[0-9]{14}-[0-9a-f]{6}-(server|volume|sg|fip)$" | grep -v "$OLD_STAMP" | sort || true
}

job_for() {
  # job_for <credential id> <secret env> <expected project>
  "${READ[@]}" job "$JOB_AUTH_URL" "$REGION" public "$FINGERPRINT" "$1" "$2" "$KEY" "$3" "$INTERVAL" "$OPTIONS"
}

# One run of the probe's code. Its report is in checks/<scene>/report.json.
run_check() {
  local scene="$1" kind="$2" job_file="$3" clock="${4:-0}"
  mkdir -p "$CHECKS_DIR/$scene"
  (
    cd "$REPO/packages/Probe" || exit 1
    TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT="$REPO/packages/Probe/tsconfig.json" \
      TS_NODE_FILES=false OS_CHECK_JOB="$job_file" OS_CHECK_OUT="$CHECKS_DIR/$scene" \
      OS_CHECK_CLOCK_MINUTES="$clock" LOG_LEVEL=ERROR \
      timeout 1500 node --require ts-node/register "$HERE/checks-run.ts" "$kind"
  ) 2>&1 | tail -5
}

JOB="$SECRETS_DIR/job.json"
job_for "$CHECK_CREDENTIAL_ID" CHECK_CREDENTIAL_SECRET "$PROJECT" >"$JOB"
chmod 0600 "$JOB"

log "Scene healthy"
run_check api-healthy api "$JOB"
holds "the API checks answer on a healthy cloud" "${READ[@]}" expect-api "$CHECKS_DIR/api-healthy"
# The reads a member is refused are a refusal, and a failure there would be this check's own bug.
run_check healthy lifecycle "$JOB"
holds "a run passes every step on a healthy cloud" "${READ[@]}" expect "$CHECKS_DIR/healthy" Succeeded
holds "a passing run leaves nothing behind" test -z "$(left_by_check)"

log "Scene signed: the same, with an OSProfiler key, on a cloud with OSProfiler off"
SIGNED_JOB="$SECRETS_DIR/signed-job.json"
python3 -I - "$JOB" >"$SIGNED_JOB" <<'SIGNED'
import json, os, sys
job = json.load(open(sys.argv[1]))
job["osProfilerKey"] = os.environ["OSPROFILER_KEY"]
print(json.dumps(job))
SIGNED
run_check signed lifecycle "$SIGNED_JOB"
holds "a signed run passes, and goes untraced on a cloud with OSProfiler off" "${READ[@]}" expect "$CHECKS_DIR/signed" Succeeded
if grep -q "$OSPROFILER_KEY" "$CHECKS_DIR/signed/report.json" "$CHECKS_DIR/signed/requests.jsonl"; then
  missed "the key is in nothing a run wrote"
else
  held "the key is in nothing a run wrote"
fi

log "Scene scheduler-stopped: the issue's done-when"
sudo systemctl stop devstack@n-sch
run_check scheduler-stopped lifecycle "$JOB"
holds "nova-scheduler stopped fails at the wait for ACTIVE" "${READ[@]}" expect "$CHECKS_DIR/scheduler-stopped" Failed server_active
holds "the failed run says what Nova said" "${READ[@]}" says "$CHECKS_DIR/scheduler-stopped" '"source": "nova"'
holds "a failed run still leaves nothing behind" test -z "$(left_by_check)"
sudo systemctl start devstack@n-sch
for attempt in $(seq 1 30); do
  openstack compute service list --service nova-scheduler -f value -c State | grep -q '^up$' && break
  sleep 5
  : "$attempt"
done
run_check scheduler-started lifecycle "$JOB"
holds "nova-scheduler started: the next run passes" "${READ[@]}" expect "$CHECKS_DIR/scheduler-started" Succeeded

log "Scene killed: a run killed part way"
KILLED_DIR="$CHECKS_DIR/killed-run"
mkdir -p "$KILLED_DIR"
(
  cd "$REPO/packages/Probe" || exit 1
  TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT="$REPO/packages/Probe/tsconfig.json" TS_NODE_FILES=false \
    OS_CHECK_JOB="$JOB" OS_CHECK_OUT="$KILLED_DIR" LOG_LEVEL=ERROR \
    exec node --require ts-node/register "$HERE/checks-run.ts" lifecycle
) &
KILLED_PID=$!
# Until it has made all it makes, or a long while: the volume is the last thing a run creates.
for attempt in $(seq 1 90); do
  sleep 5
  if grep -q '/os-volume_attachments' "$KILLED_DIR/requests.jsonl" 2>/dev/null; then
    break
  fi
  : "$attempt"
done
# A killed process does no clean-up. That is the point.
pkill -9 -P "$KILLED_PID" 2>/dev/null || true
kill -9 "$KILLED_PID" 2>/dev/null || true
wait "$KILLED_PID" 2>/dev/null || true
sleep 5
left_by_check | tee "$KILLED_DIR/left.txt"
if [ -s "$KILLED_DIR/left.txt" ]; then
  held "a killed run leaves what it made"
else
  missed "a killed run leaves what it made"
fi

run_check killed-next-at-once lifecycle "$JOB"
holds "a run right after it is skipped, because one may be going" "${READ[@]}" expect "$CHECKS_DIR/killed-next-at-once" Skipped
left_by_check >"$CHECKS_DIR/killed-next-at-once/left.txt"
holds "the skipped run touched nothing" diff "$KILLED_DIR/left.txt" "$CHECKS_DIR/killed-next-at-once/left.txt"

# An interval on, by the check's clock: past a run's time and short of two intervals.
run_check killed-an-interval-on lifecycle "$JOB" 31
holds "a run an interval on goes ahead" "${READ[@]}" expect "$CHECKS_DIR/killed-an-interval-on" Succeeded
left_by_check >"$CHECKS_DIR/killed-an-interval-on/left.txt"
holds "and leaves what the dead run made" diff "$KILLED_DIR/left.txt" "$CHECKS_DIR/killed-an-interval-on/left.txt"

# Past two intervals, by the check's clock. The deletes are real.
run_check killed-two-intervals-on lifecycle "$JOB" 62
holds "a run past two intervals goes ahead" "${READ[@]}" expect "$CHECKS_DIR/killed-two-intervals-on" Succeeded
holds "and says what the janitor removed" "${READ[@]}" says "$CHECKS_DIR/killed-two-intervals-on" '"removed": ['
left_by_check >"$CHECKS_DIR/killed-two-intervals-on/left.txt"
holds "and nothing of the dead run's is left" test ! -s "$CHECKS_DIR/killed-two-intervals-on/left.txt"

log "Scene lookalikes: everything the janitor has run past"
holds "what merely looks like the check's is still there" lookalikes_are_all_there
holds "another project's is still there, and holds nothing named for the check" victims_are_all_there

log "Scene refused: credentials that could reach further"
# A credential on another project, however good otherwise.
VICTIM_CREDENTIAL="$(as_victim openstack application credential create --role member ou-check-elsewhere -f json)"
VICTIM_CREDENTIAL_ID="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["id"])' <<<"$VICTIM_CREDENTIAL")"
VICTIM_SECRET="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["secret"])' <<<"$VICTIM_CREDENTIAL")"
export VICTIM_SECRET
job_for "$VICTIM_CREDENTIAL_ID" VICTIM_SECRET "$PROJECT" >"$SECRETS_DIR/elsewhere.json"
run_check refused-scoped-elsewhere lifecycle "$SECRETS_DIR/elsewhere.json"
holds "a credential scoped elsewhere is refused" "${READ[@]}" expect "$CHECKS_DIR/refused-scoped-elsewhere" Refused

# An admin on the check's own project.
openstack role add --project "$PROJECT" --user admin admin
ADMIN_CREDENTIAL="$(OS_PROJECT_NAME="$PROJECT" openstack application credential create --role admin ou-check-admin -f json)"
ADMIN_CREDENTIAL_ID="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["id"])' <<<"$ADMIN_CREDENTIAL")"
ADMIN_SECRET="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["secret"])' <<<"$ADMIN_CREDENTIAL")"
export ADMIN_SECRET
job_for "$ADMIN_CREDENTIAL_ID" ADMIN_SECRET "$PROJECT" >"$SECRETS_DIR/admin.json"
run_check refused-admin lifecycle "$SECRETS_DIR/admin.json"
holds "an admin credential is refused, on the right project" "${READ[@]}" expect "$CHECKS_DIR/refused-admin" Refused

# One that can make more credentials.
UNRESTRICTED_CREDENTIAL="$(as_check_user openstack application credential create --role member --unrestricted ou-check-unrestricted -f json)"
UNRESTRICTED_ID="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["id"])' <<<"$UNRESTRICTED_CREDENTIAL")"
UNRESTRICTED_SECRET="$(python3 -I -c 'import json, sys; print(json.load(sys.stdin)["secret"])' <<<"$UNRESTRICTED_CREDENTIAL")"
export UNRESTRICTED_SECRET
job_for "$UNRESTRICTED_ID" UNRESTRICTED_SECRET "$PROJECT" >"$SECRETS_DIR/unrestricted.json"
run_check refused-unrestricted lifecycle "$SECRETS_DIR/unrestricted.json"
holds "an unrestricted application credential is refused" "${READ[@]}" expect "$CHECKS_DIR/refused-unrestricted" Refused

# None of those three wrote, whatever else: a refused run's writes are the login and nothing else.
for scene in refused-scoped-elsewhere refused-admin refused-unrestricted; do
  writes="$(python3 -I -c '
import json, sys
print(sum(1 for line in open(sys.argv[1]) if json.loads(line)["method"] != "GET" and not json.loads(line)["path"].endswith("/auth/tokens")))
' "$CHECKS_DIR/$scene/requests.jsonl")"
  holds "$scene wrote nothing" test "$writes" = "0"
done

log "Scene writes: what the check's credential can write to another project"
CHECK_TOKEN_BODY="$SECRETS_DIR/token.json"
KEYSTONE_TOKENS="${AUTH_URL%/}/v3/auth/tokens"
curl -ksS -D "$SECRETS_DIR/token-headers.txt" -o "$CHECK_TOKEN_BODY" -H 'Content-Type: application/json' \
  -d "$(python3 -I -c '
import json, os, sys
print(json.dumps({"auth": {"identity": {"methods": ["application_credential"], "application_credential": {"id": sys.argv[1], "secret": os.environ["CHECK_CREDENTIAL_SECRET"]}}}}))
' "$CHECK_CREDENTIAL_ID")" "$KEYSTONE_TOKENS"
OS_CHECK_TOKEN="$(awk 'tolower($1) == "x-subject-token:" { print $2 }' "$SECRETS_DIR/token-headers.txt" | tr -d '\r')"
export OS_CHECK_TOKEN
# What Keystone says of itself to this credential, which the guide's refusals rest on.
python3 -I -c '
import json, sys
token = json.load(open(sys.argv[1]))["token"]
print(json.dumps({key: token.get(key) for key in ("project", "roles", "application_credential", "is_admin_project", "is_domain", "methods")}, indent=1))
' "$CHECK_TOKEN_BODY" >"$CHECKS_DIR/token-of-the-check.json"
holds "the check's credential cannot write to another project, or beyond its own" \
  "${READ[@]}" matrix "$CHECKS_DIR/writes.json" "$CHECK_TOKEN_BODY" "$SECRETS_DIR/victim.json"
holds "and everything of the other project's is still there" victims_are_all_there
unset OS_CHECK_TOKEN

log "Scene volume-stopped: cinder-volume stopped"
sudo systemctl stop devstack@c-vol
# Long enough for Cinder's scheduler to read it as down, or a create only waits on it.
sleep 75
run_check volume-stopped lifecycle "$JOB"
holds "cinder-volume stopped fails in the volume part" "${READ[@]}" says "$CHECKS_DIR/volume-stopped" '"volume": "Failed"'
holds "and the boot still passes" "${READ[@]}" says "$CHECKS_DIR/volume-stopped" '"boot": "Passed"'
sudo systemctl start devstack@c-vol
for attempt in $(seq 1 30); do
  openstack volume service list --service cinder-volume -f value -c State | grep -q '^up$' && break
  sleep 5
  : "$attempt"
done

log "Scene gateway-removed: nothing can reach the project's floating IPs"
as_check_user openstack router unset --external-gateway oneuptime-check-router
run_check gateway-removed lifecycle "$JOB"
holds "a router with no gateway fails in the floating IP part" "${READ[@]}" says "$CHECKS_DIR/gateway-removed" '"floating_ip": "Failed"'
holds "and the boot still passes" "${READ[@]}" says "$CHECKS_DIR/gateway-removed" '"boot": "Passed"'
as_check_user openstack router set --external-gateway public oneuptime-check-router

log "Scene recovered: a last run on the cloud as it was"
run_check recovered lifecycle "$JOB"
holds "with everything back, a run passes" "${READ[@]}" expect "$CHECKS_DIR/recovered" Succeeded
holds "nothing is left but what merely looks like the check's" test -z "$(left_by_check)"
holds "which is all still there" lookalikes_are_all_there
holds "and so is everything of the other project's" victims_are_all_there

log "What held"
cat "$CHECKS_DIR/verdict.txt"
if grep -q '^MISSED' "$CHECKS_DIR/verdict.txt"; then
  exit 1
fi
