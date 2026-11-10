#!/usr/bin/env bash
#
# Helpers for run-tests.sh, which sources this file. They read WORK,
# KUBECONFIG_FILE, NAMESPACE, GROUP, ONEUPTIME_URL and ONEUPTIME_API_KEY.

PASSED=0

log() { printf '\n=== %s\n' "$*"; }
pass() {
  PASSED=$((PASSED + 1))
  printf '  ok    %s\n' "$*"
}
fail() {
  printf '  FAIL  %s\n' "$*" >&2
  exit 1
}

# k <kubectl arguments>: kubectl against the test cluster, never the
# kubeconfig of whoever runs the test.
k() { kubectl --kubeconfig "${KUBECONFIG_FILE}" "$@"; }

# field <kind> <name> <jsonpath>: a field of a resource of the provider in the
# test namespace.
field() { k -n "${NAMESPACE}" get "$1.${GROUP}" "$2" -o "jsonpath=$3"; }

# render <manifest>: the manifest with ${NAME} filled in for each NAME in
# RENDER_VARS. A placeholder it does not fill fails the test, so a misspelled
# one never reaches the cluster.
render() {
  local text name value
  text="$(<"$1")"
  for name in "${RENDER_VARS[@]}"; do
    value="${!name}"
    # Both quoted: the pattern matches literally, and a value with & or \
    # in it is used as it is.
    text=${text//"\${${name}}"/"${value}"}
  done
  if [[ "$text" == *'${'* ]]; then
    fail "$(basename "$1") has a placeholder run-tests.sh does not fill"
  fi
  printf '%s\n' "$text"
}

# api <METHOD> <path under /api> [<JSON body>]: calls OneUptime with the
# project's API key. The answer goes to ${WORK}/api.json; the HTTP status is
# printed.
api() {
  local args=(-sS -o "${WORK}/api.json" -w '%{http_code}' -X "$1"
    "${ONEUPTIME_URL%/}/api$2"
    -H 'Content-Type: application/json'
    -H "APIKey: ${ONEUPTIME_API_KEY}")
  if [[ $# -ge 3 ]]; then
    args+=(--data "$3")
  fi
  curl "${args[@]}"
}

# item <API path> <ID> <select>: the item's JSON. Any answer but 200 fails.
item() {
  local status
  status="$(api POST "/$1/$2/get-item" "{\"select\": $3}")" || return 1
  if [[ "$status" != 200 ]]; then
    echo "POST /api/$1/$2/get-item answered ${status}: $(cat "${WORK}/api.json")" >&2
    return 1
  fi
  cat "${WORK}/api.json"
}

# item_matches <API path> <ID> <select> <jq filter>: the item is there and the
# filter holds for it.
item_matches() {
  local json
  json="$(item "$1" "$2" "$3")" || return 1
  jq -e "$4" >/dev/null <<<"${json}"
}

# item_missing <API path> <ID>: OneUptime answers that there is no such item.
item_missing() {
  local status
  status="$(api POST "/$1/$2/get-item" '{"select": {"_id": true}}')" || return 1
  [[ "${status}" == 404 ]]
}

# id_named <API path> <name>: the ID of the project's item of that name.
id_named() {
  local status body
  body="$(jq -cn --arg name "$2" \
    '{query: {name: $name}, select: {_id: true, name: true}, limit: 1}')"
  status="$(api POST "/$1/get-list" "${body}")" || return 1
  if [[ "${status}" != 200 ]]; then
    echo "POST /api/$1/get-list answered ${status}: $(cat "${WORK}/api.json")" >&2
    return 1
  fi
  jq -er '.data[0]._id' "${WORK}/api.json"
}

# check <what> <command...>: the command succeeds now.
check() {
  local what=$1
  shift
  "$@" || fail "${what}"
  pass "${what}"
}

# eventually <seconds> <what> <command...>: the command succeeds within the
# time, tried every five seconds. What a failed try printed is kept in
# ${WORK}/eventually.log for the diagnostics.
eventually() {
  local timeout=$1 what=$2
  shift 2
  local deadline=$((SECONDS + timeout))
  until "$@" 2>>"${WORK}/eventually.log"; do
    if ((SECONDS >= deadline)); then
      fail "${what} (not within ${timeout}s)"
    fi
    sleep 5
  done
  pass "${what}"
}

# wait_ready <kind/name...>: each managed resource in the test namespace is
# Ready (it exists in OneUptime) and Synced (the provider's last pass
# succeeded).
wait_ready() {
  local resources=() r
  for r in "$@"; do
    resources+=("${r%%/*}.${GROUP}/${r#*/}")
  done
  k -n "${NAMESPACE}" wait --for=condition=Ready --timeout=300s "${resources[@]}" ||
    fail "not Ready: $*"
  k -n "${NAMESPACE}" wait --for=condition=Synced --timeout=60s "${resources[@]}" ||
    fail "not Synced: $*"
  pass "Ready and Synced: $*"
}

# gone <kind> <name>: the managed resource is no longer in the cluster.
gone() {
  [[ -z "$(k -n "${NAMESPACE}" get "$1.${GROUP}" "$2" --ignore-not-found -o name)" ]]
}

# diagnose: what the cluster says, for a failed run.
diagnose() {
  log "Diagnostics"
  k get providers.pkg.crossplane.io,providerrevisions.pkg.crossplane.io -o wide
  k get managed -A -o wide
  k -n "${NAMESPACE}" describe managed
  k -n crossplane-system get pods -o wide
  echo "--- provider logs"
  k -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime --all-containers --tail=300
  echo "--- crossplane logs"
  k -n crossplane-system logs deploy/crossplane --tail=100
  echo "--- events"
  k get events -A --sort-by=.lastTimestamp | tail -n 60
  if [[ -s "${WORK}/eventually.log" ]]; then
    echo "--- last failed tries"
    tail -n 20 "${WORK}/eventually.log"
  fi
}
