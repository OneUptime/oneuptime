#!/usr/bin/env bash

# Unit tests for Scripts/GHA/use_docker_hub_mirror.sh.
#
# The script points the runner's Docker daemon at mirror.gcr.io before a test
# job pulls postgres, valkey and clickhouse, because Docker Hub's anonymous
# pulls failed every such job on 2026-10-09. These tests pin what it does to
# the daemon's config and when it reloads it, against fakes: sudo runs the
# command as is, systemctl records what it was asked, and docker answers
# `docker info` from the config file the way a reloaded daemon would.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/use_docker_hub_mirror_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/../use_docker_hub_mirror.sh"

PASS=0
FAIL=0

pass() {
	PASS=$(( PASS + 1 ))
	echo "  ✅ $1"
}

fail() {
	FAIL=$(( FAIL + 1 ))
	echo "  ❌ $1" >&2
}

assert_eq() {
	local expected="$1" actual="$2" what="$3"
	if [[ "$expected" == "$actual" ]]; then
		pass "$what"
	else
		fail "$what — expected '${expected}', got '${actual}'"
	fi
}

assert_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" == *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' not found in: ${haystack}"
	fi
}

WORK=""
FAKE_BIN=""

# A fresh runner: a config directory, and fakes for sudo, systemctl and docker.
#   FAKE_RELOAD_FAILS=1   systemctl reload docker exits 1
#   FAKE_RELOAD_IGNORED=1 the reload succeeds but the daemon keeps its old mirrors
setup_runner() {
	WORK="$(mktemp -d)"
	FAKE_BIN="${WORK}/bin"
	mkdir -p "$FAKE_BIN" "${WORK}/etc/docker"
	: >"${WORK}/systemctl.log"
	# What the "running daemon" was last loaded with.
	echo '{}' >"${WORK}/loaded.json"

	cat >"${FAKE_BIN}/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF

	cat >"${FAKE_BIN}/systemctl" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"${WORK}/systemctl.log"
if [[ "\$1" == "reload" && "\${FAKE_RELOAD_FAILS:-}" == "1" ]]; then
	exit 1
fi
if [[ "\$1" == "reload" && "\${FAKE_RELOAD_IGNORED:-}" != "1" ]]; then
	if [[ -e "${WORK}/etc/docker/daemon.json" ]]; then
		cp "${WORK}/etc/docker/daemon.json" "${WORK}/loaded.json"
	else
		echo '{}' >"${WORK}/loaded.json"
	fi
fi
exit 0
EOF

	# `docker info --format '{{json .RegistryConfig.Mirrors}}'`, normalised the
	# way dockerd prints them (a trailing slash).
	cat >"${FAKE_BIN}/docker" <<EOF
#!/usr/bin/env bash
python3 - "${WORK}/loaded.json" <<'PYTHON'
import json, sys
mirrors = json.load(open(sys.argv[1])).get("registry-mirrors", [])
print(json.dumps([m.rstrip("/") + "/" for m in mirrors]))
PYTHON
EOF

	chmod +x "${FAKE_BIN}/sudo" "${FAKE_BIN}/systemctl" "${FAKE_BIN}/docker"
}

run_script() {
	PATH="${FAKE_BIN}:${PATH}" \
		DOCKER_DAEMON_JSON="${WORK}/etc/docker/daemon.json" \
		MIRROR_WAIT_SECONDS=2 \
		bash "$SCRIPT" 2>&1
}

config_value() {
	python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get(sys.argv[2])))" \
		"${WORK}/etc/docker/daemon.json" "$1"
}

reloads() {
	grep -c "^reload docker$" "${WORK}/systemctl.log" || true
}

restarts() {
	grep -c "^restart" "${WORK}/systemctl.log" || true
}

echo "use_docker_hub_mirror"

# --- The GitHub runner's own config: the mirror goes first, the rest stays. ---
setup_runner
echo '{"exec-opts": ["native.cgroupdriver=cgroupfs"], "cgroup-parent": "/actions_job"}' >"${WORK}/etc/docker/daemon.json"
status=0
output="$(run_script)" || status=$?
assert_eq 0 "$status" "exits 0"
assert_eq '["https://mirror.gcr.io"]' "$(config_value registry-mirrors)" "adds mirror.gcr.io as the registry mirror"
assert_eq '["native.cgroupdriver=cgroupfs"]' "$(config_value exec-opts)" "keeps the runner's exec-opts"
assert_eq '"/actions_job"' "$(config_value cgroup-parent)" "keeps the runner's cgroup-parent"
assert_eq 1 "$(reloads)" "reloads the daemon once"
assert_eq 0 "$(restarts)" "never restarts it (that would stop service containers)"
assert_contains "$output" "now pulls Docker Hub images through https://mirror.gcr.io" "says the mirror is in use"

# --- No config file yet: one is written with just the mirror. ---
setup_runner
status=0
output="$(run_script)" || status=$?
assert_eq 0 "$status" "exits 0 without a config file"
assert_eq '["https://mirror.gcr.io"]' "$(config_value registry-mirrors)" "writes a config with the mirror"
assert_eq 1 "$(reloads)" "reloads the daemon once"

# --- A mirror already configured comes after this one, not lost. ---
setup_runner
echo '{"registry-mirrors": ["https://mirror.example.com"]}' >"${WORK}/etc/docker/daemon.json"
status=0
output="$(run_script)" || status=$?
assert_eq '["https://mirror.gcr.io", "https://mirror.example.com"]' "$(config_value registry-mirrors)" "puts mirror.gcr.io first and keeps the other mirror"

# --- Already using the mirror: nothing is written and nothing reloaded. ---
setup_runner
echo '{"registry-mirrors": ["https://mirror.gcr.io"]}' >"${WORK}/etc/docker/daemon.json"
cp "${WORK}/etc/docker/daemon.json" "${WORK}/loaded.json"
before="$(cat "${WORK}/etc/docker/daemon.json")"
status=0
output="$(run_script)" || status=$?
assert_eq 0 "$status" "exits 0 when the mirror is already in use"
assert_eq "$before" "$(cat "${WORK}/etc/docker/daemon.json")" "leaves the config alone"
assert_eq 0 "$(reloads)" "does not reload"
assert_contains "$output" "already pulls Docker Hub images through" "says so"

# --- A reload that fails: the config goes back, the job goes on. ---
setup_runner
echo '{"cgroup-parent": "/actions_job"}' >"${WORK}/etc/docker/daemon.json"
before="$(cat "${WORK}/etc/docker/daemon.json")"
status=0
output="$(FAKE_RELOAD_FAILS=1 run_script)" || status=$?
assert_eq 0 "$status" "a failed reload does not fail the job"
assert_eq "$before" "$(cat "${WORK}/etc/docker/daemon.json")" "a failed reload puts the config back"
assert_contains "$output" "::warning title=Docker Hub mirror not used::" "warns that Docker Hub is used directly"

# --- A reload the daemon ignores: put back as well, never a restart. ---
setup_runner
echo '{"cgroup-parent": "/actions_job"}' >"${WORK}/etc/docker/daemon.json"
before="$(cat "${WORK}/etc/docker/daemon.json")"
status=0
output="$(FAKE_RELOAD_IGNORED=1 run_script)" || status=$?
assert_eq 0 "$status" "an ignored reload does not fail the job"
assert_eq "$before" "$(cat "${WORK}/etc/docker/daemon.json")" "an ignored reload puts the config back"
assert_eq 0 "$(restarts)" "an ignored reload is not followed by a restart"
assert_contains "$output" "did not take https://mirror.gcr.io" "warns that the reload did not take"

# --- No config written before the ignored reload: none is left behind. ---
setup_runner
status=0
output="$(FAKE_RELOAD_IGNORED=1 run_script)" || status=$?
if [[ -e "${WORK}/etc/docker/daemon.json" ]]; then
	fail "removes the config it wrote when the reload did not take"
else
	pass "removes the config it wrote when the reload did not take"
fi

# --- A config that is not JSON is never touched. ---
setup_runner
printf '%s\n' '# not json' >"${WORK}/etc/docker/daemon.json"
before="$(cat "${WORK}/etc/docker/daemon.json")"
status=0
output="$(run_script)" || status=$?
assert_eq 0 "$status" "an unreadable config does not fail the job"
assert_eq "$before" "$(cat "${WORK}/etc/docker/daemon.json")" "an unreadable config is left as it was"
assert_eq 0 "$(reloads)" "an unreadable config is not reloaded"
assert_contains "$output" "could not be read as a JSON object" "warns about the config"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
