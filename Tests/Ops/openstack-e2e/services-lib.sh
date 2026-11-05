#!/usr/bin/env bash
#
# What every services-<group>.sh shares. Each deploys on a DevStack of its own, drives one
# group of services into the states the OpenStack product must recognise, and records each
# scene through record.sh. A runner has 4 vCPUs and 16 GB, and a DevStack takes half an hour
# to deploy, so one scene going wrong never costs the scenes after it.
#
# A scene's how.txt says how it got there, because the difference matters to whoever reads
# the fixture: a state a service reached on its own is what that service does, and a state
# written into its database is only what its row and its series look like. failed.txt, when
# there is one, says why the state was never reached. The scene is recorded all the same,
# since what a cloud said instead is the next thing anyone needs, and the importer leaves
# it out of the fixtures.
#
# Source this. Nothing here is a secret: DevStack's own throwaway cloud, on a runner that is
# gone when the job ends. Every name starts with "ou-", so nothing else is touched.

set -euo pipefail

SERVICES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OS_CLOUD="${OS_CLOUD:-devstack-admin}"
export OUTPUT_DIR="${OUTPUT_DIR:-out}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
export OUTPUT_DIR
SCENES_FILE="$OUTPUT_DIR/scenes.txt"
: >"$SCENES_FILE"
FAILED_SCENES=()

# The importer gives the runner one stable name: it may not be Nova that says what it is.
{
  hostname -s
  hostname -f
  hostname -I | awk '{print $1}'
} >"$OUTPUT_DIR/runner-names.txt" 2>/dev/null || true

log() {
  printf '\n=== %s\n' "$*"
}

# What a scene adds to how.txt as it learns it, such as which way a state was reached.
note() {
  if [ -n "${CURRENT_SCENE:-}" ]; then
    printf '%s\n' "$*" >>"$OUTPUT_DIR/$CURRENT_SCENE/how.txt"
  fi
  printf '  %s\n' "$*"
}

# Run a command until its output is the wanted word: wait_for <what> <wanted> <tries> <seconds> <command...>
wait_for() {
  local what="$1" wanted="$2" tries="$3" seconds="$4" actual="" try
  shift 4
  for try in $(seq 1 "$tries"); do
    actual="$("$@" 2>/dev/null || true)"
    if [ "$actual" = "$wanted" ]; then
      echo "$what: $wanted"
      return 0
    fi
    sleep "$seconds"
    : "$try"
  done
  echo "$what never became $wanted (it is '$actual')" >&2
  return 1
}

# The same, when a state that can never become the wanted one should stop the wait, such as ERROR.
# wait_for_either <what> <wanted> <stop> <tries> <seconds> <command...>
wait_for_either() {
  local what="$1" wanted="$2" stop="$3" tries="$4" seconds="$5" actual="" try
  shift 5
  for try in $(seq 1 "$tries"); do
    actual="$("$@" 2>/dev/null || true)"
    if [ "$actual" = "$wanted" ]; then
      echo "$what: $wanted"
      return 0
    fi
    if [ "$actual" = "$stop" ]; then
      echo "$what went to $stop while waiting for $wanted" >&2
      return 1
    fi
    sleep "$seconds"
    : "$try"
  done
  echo "$what never became $wanted (it is '$actual')" >&2
  return 1
}

unit_exists() {
  systemctl list-unit-files --no-legend "$1" 2>/dev/null | grep -q .
}

stop_unit() {
  echo "Stopping $1"
  sudo systemctl stop "$1"
}

start_unit() {
  echo "Starting $1"
  sudo systemctl start "$1"
}

# A service's database, for what nothing else gets to. DevStack's action sets this password.
db() {
  local database="$1" sql="$2"
  mysql -uroot -proot -h127.0.0.1 -D "$database" -e "$sql"
}

# Add to a service's config, in a section of its own. oslo.config reads repeated sections.
conf_add() {
  local file="$1" section="$2" line="$3"
  printf '\n[%s]\n%s\n' "$section" "$line" | sudo tee -a "$file" >/dev/null
}

# One scene: its description, what drives the cloud there, and what puts it back. A failure in
# either is reported at the end instead of stopping here. In a subshell of its own with -e on,
# because bash ignores -e inside anything tested with `if` or `||`.
#
#   scene <name> <how it gets there> <drive function> [undo function]
scene() {
  local name="$1" how="$2" drive="$3" undo="${4:-}" status=0
  log "Scene $name: $how"
  mkdir -p "$OUTPUT_DIR/$name"
  printf '%s\n' "$how" >"$OUTPUT_DIR/$name/how.txt"
  rm -f "$OUTPUT_DIR/$name/failed.txt"
  set +e
  (
    set -eE
    CURRENT_SCENE="$name"
    # By a name no drive function has: the trap runs in that function's scope, and one with a
    # `local name` would send the reason nowhere.
    trap 'printf "line %s: %s\n" "$LINENO" "$BASH_COMMAND" >>"$OUTPUT_DIR/$CURRENT_SCENE/failed.txt"' ERR
    "$drive"
  )
  status=$?
  set -e

  if ! bash "$SERVICES_DIR/record.sh" "$name"; then
    echo "record.sh failed on $name" >>"$OUTPUT_DIR/$name/failed.txt"
    status=1
  fi

  if [ "$status" = 0 ]; then
    echo "$name recorded" >>"$SCENES_FILE"
  else
    [ -s "$OUTPUT_DIR/$name/failed.txt" ] || echo "exit $status" >"$OUTPUT_DIR/$name/failed.txt"
    echo "$name FAILED: $(tr '\n' ' ' <"$OUTPUT_DIR/$name/failed.txt")" >>"$SCENES_FILE"
    FAILED_SCENES+=("$name")
  fi

  if [ -n "$undo" ]; then
    set +e
    (
      set -e
      "$undo"
    )
    status=$?
    set -e
    if [ "$status" != 0 ]; then
      echo "$name: could not put the cloud back (exit $status)" | tee -a "$SCENES_FILE" >&2
    fi
  fi
}

# Say what happened, and fail the job if a scene went wrong. Everything is uploaded either way.
finish_scenes() {
  log "Scenes"
  cat "$SCENES_FILE"
  if [ "${#FAILED_SCENES[@]}" -gt 0 ]; then
    echo "Did not reach: ${FAILED_SCENES[*]}" >&2
    return 1
  fi
}

# Two projects, because whether a read crosses projects is half of what these recordings show,
# and the flavors a small estate needs.
services_base() {
  log "Projects and flavors"
  local project
  for project in ou-payments ou-research; do
    openstack project show "$project" >/dev/null 2>&1 \
      || openstack project create --domain default --description "OneUptime test estate" "$project" >/dev/null
    openstack role add --project "$project" --user admin member >/dev/null
  done
  openstack flavor show ou.tiny >/dev/null 2>&1 \
    || openstack flavor create --vcpus 1 --ram 128 --disk 1 ou.tiny >/dev/null
  # No hypervisor can hold this one, so what asks for it fails with Nova's "No valid host".
  openstack flavor show ou.impossible >/dev/null 2>&1 \
    || openstack flavor create --vcpus 1 --ram 1048576 --disk 1 ou.impossible >/dev/null
  openstack quota set --instances 20 --cores 40 --ram 2097152 ou-payments >/dev/null
}

# A command line a plugin does not install, in the virtualenv DevStack's command line runs from.
# Held to the release's constraints where they are, so it takes what this release expects.
ensure_client() {
  local package="$1" constraints=/opt/stack/requirements/upper-constraints.txt
  if [ -f "$constraints" ]; then
    /opt/stack/data/venv/bin/pip install -q -c "$constraints" "$package"
  else
    /opt/stack/data/venv/bin/pip install -q "$package"
  fi
}

cirros_image() {
  openstack image list --status active -f value -c Name | grep -i cirros | head -1
}

# A project's network with a router out, for what needs an address.
services_network() {
  local project="$1" name="$2" range="$3"
  (
    export OS_PROJECT_NAME="$project"
    openstack network show "$name" >/dev/null 2>&1 || openstack network create "$name" >/dev/null
    openstack subnet show "$name-subnet" >/dev/null 2>&1 \
      || openstack subnet create --network "$name" --subnet-range "$range" "$name-subnet" >/dev/null
    openstack router show "$name-router" >/dev/null 2>&1 || {
      openstack router create "$name-router" >/dev/null
      openstack router set --external-gateway public "$name-router"
      openstack router add subnet "$name-router" "$name-subnet"
    }
  )
}

server_status() {
  openstack server show "$1" -f value -c status
}
