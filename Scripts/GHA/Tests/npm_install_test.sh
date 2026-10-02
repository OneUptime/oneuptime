#!/usr/bin/env bash

# Unit tests for Scripts/GHA/npm_install.sh and .github/actions/npm-install.
#
# On 2026-10-01 a connection the registry dropped mid-download failed two jobs
# in two minutes, because nothing retried their `npm install`. The helper
# retries network failures and nothing else, so what is pinned here is both
# halves of that:
#
#   * each shape a network failure takes in npm's output is retried: the reset
#     that failed those jobs, as their logs printed it, and the others as npm 11
#     printed them against a local registry that dropped, stalled, refused or
#     answered 503;
#   * a real failure -- a peer-dependency conflict, a lockfile out of step with
#     package.json, a version that does not exist, a failed integrity check, a
#     broken install script -- is not, and fails with npm's own exit status on
#     the first attempt;
#   * attempts are bounded, and npm gets the arguments and directory it was
#     given.
#
# Nothing here touches the network: npm is a stub that prints those outputs,
# and the retry delays are zero.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/npm_install_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
NPM_INSTALL="${REPO_ROOT}/Scripts/GHA/npm_install.sh"
ACTION="${REPO_ROOT}/.github/actions/npm-install/action.yml"

# Zero delays: these tests exercise the retry decision, not the wall clock.
# Same attempt count as production (delays + 1), none of the waiting.
export NPM_INSTALL_RETRY_DELAYS="0 0 0"
# This suite itself runs in GitHub Actions; each test sets what the helper sees.
unset GITHUB_ACTIONS GITHUB_WORKSPACE

PASS=0
FAIL=0

pass() {
	PASS=$((PASS + 1))
	echo "  ✅ $1"
}

fail() {
	FAIL=$((FAIL + 1))
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
		fail "$what — '${needle}' not found in output"
	fi
}

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' unexpectedly found in output"
	fi
}

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

STUB_BIN="${ROOT}/stub-bin"
CALL_LOG="${ROOT}/npm-calls"
NPM_OUTPUT_FILE="${ROOT}/npm-output"
CHECKOUT="${ROOT}/checkout"
WORK_DIR="${CHECKOUT}/packages/Common"
mkdir -p "$STUB_BIN" "$WORK_DIR"

# An npm that fails its first FAKE_NPM_FAIL_TIMES calls -- printing the output
# under test to stderr, where npm writes its errors, and exiting with
# FAKE_NPM_EXIT -- and succeeds after that. Each call is logged as the
# directory it ran in and its arguments, each in brackets, so a test can see
# exactly what npm was given.
cat >"${STUB_BIN}/npm" <<EOF
#!/usr/bin/env bash
{ printf '%s' "\$PWD"; printf '\t[%s]' "\$@"; echo; } >>"${CALL_LOG}"
calls=\$(wc -l <"${CALL_LOG}")
if (( calls <= FAKE_NPM_FAIL_TIMES )); then
	cat "${NPM_OUTPUT_FILE}" >&2
	exit "\$FAKE_NPM_EXIT"
fi
echo "added 1 package, and audited 2 packages in 1s"
EOF
chmod +x "${STUB_BIN}/npm"

# Stand-ins for GITHUB_ACTIONS and GITHUB_WORKSPACE, empty (unset) unless a
# test says otherwise.
IN_ACTIONS=""
WORKSPACE=""

# run_install <fail_times> <npm_exit> <npm_output> <args...>: runs the helper
# in WORK_DIR with the stub npm on PATH, failing its first <fail_times> calls
# with <npm_output> and status <npm_exit>. Sets STATUS and OUTPUT, and resets
# the call log first.
run_install() {
	local fail_times="$1" npm_exit="$2" npm_output="$3"
	shift 3
	: >"$CALL_LOG"
	printf '%s\n' "$npm_output" >"$NPM_OUTPUT_FILE"
	STATUS=0
	OUTPUT="$(
		cd "$WORK_DIR" &&
			PATH="${STUB_BIN}:${PATH}" FAKE_NPM_FAIL_TIMES="$fail_times" FAKE_NPM_EXIT="$npm_exit" \
				GITHUB_ACTIONS="$IN_ACTIONS" GITHUB_WORKSPACE="$WORKSPACE" \
				bash "$NPM_INSTALL" "$@" 2>&1
	)" || STATUS=$?
}

npm_calls() {
	wc -l <"$CALL_LOG" | tr -d ' '
}

# What npm printed, line for line, when the failures these tests stand in for
# happened. The 2026-10-01 one is from the compile-probe job's log; the rest
# were captured from npm 11 against a local registry, with only hosts and
# paths changed to CI's.

# The error this helper exists for (job 110481076214), warnings and all.
OCT_1_RESET="npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
npm warn deprecated rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported
npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
npm warn deprecated react-beautiful-dnd@13.1.1: react-beautiful-dnd is now deprecated. Context and options: https://github.com/atlassian/react-beautiful-dnd/issues/2672
npm error code ECONNRESET
npm error network aborted
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
npm error network
npm error network If you are behind a proxy, please make sure that the 'proxy' config is set properly.  See: 'npm help config'
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-01T17_33_51_360Z-debug-0.log"

# Network failures.

REGISTRY_503="npm error code E503
npm error 503 Service Unavailable - GET https://registry.npmjs.org/typescript
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_01_224Z-debug-0.log"

CONNECTION_REFUSED="npm error code ECONNREFUSED
npm error syscall connect
npm error errno ECONNREFUSED
npm error FetchError: request to https://registry.npmjs.org/typescript failed, reason: connect ECONNREFUSED 104.16.3.35:443
npm error     at ClientRequest.<anonymous> (/opt/hostedtoolcache/node/26.10.0/x64/lib/node_modules/npm/node_modules/minipass-fetch/lib/index.js:130:14)
npm error     at ClientRequest.emit (node:events:507:28)
npm error     at process.processTicksAndRejections (node:internal/process/task_queues:91:21) {
npm error   code: 'ECONNREFUSED',
npm error   errno: 'ECONNREFUSED',
npm error   syscall: 'connect',
npm error   address: '104.16.3.35',
npm error   port: 443,
npm error   type: 'system',
npm error   requiredBy: '.'
npm error }
npm error
npm error If you are behind a proxy, please make sure that the
npm error 'proxy' config is set properly.  See: 'npm help config'
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_24_091Z-debug-0.log"

DNS_FAILURE="npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error errno ENOTFOUND
npm error network request to https://registry.npmjs.org/typescript failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
npm error network
npm error network If you are behind a proxy, please make sure that the
npm error network 'proxy' config is set properly.  See: 'npm help config'
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_23_146Z-debug-0.log"

# A registry that accepted the connection and never answered.
REQUEST_TIMEOUT="npm error code FETCH_ERROR
npm error errno FETCH_ERROR
npm error network timeout at: https://registry.npmjs.org/typescript
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_48_528Z-debug-0.log"

# A tarball that started downloading and then stopped arriving.
STALLED_DOWNLOAD="npm error code EIDLETIMEOUT
npm error Idle timeout reached for host \`registry.npmjs.org:443\`
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_36_35_476Z-debug-0.log"

# An install script whose own download lost its connection: npm reports the
# script's exit code, and the network error is only in the script's output.
INSTALL_SCRIPT_RESET="npm error code 1
npm error path /home/runner/work/oneuptime/oneuptime/packages/Common/node_modules/isolated-vm
npm error command failed
npm error command sh -c node fetch-binary.js
npm error Downloading prebuilt binary from https://github.com/laverdet/isolated-vm/releases/download/v6.0.2/isolated-vm-linux-x64.tar.gz
npm error Error: socket hang up
npm error     at Socket.socketOnEnd (node:_http_client:542:25)
npm error     at Socket.emit (node:events:519:35)
npm error     at endReadableNT (node:internal/streams/readable:1701:12)
npm error     at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
npm error   code: 'ECONNRESET'
npm error }
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_32_280Z-debug-0.log"

# The 2026-10-01 error under `--color always`, which colours the prefix itself.
COLOURED_RESET="$(printf '%s\n' \
	$'\e[1mnpm\e[22m \e[31merror\e[39m \e[94mcode\e[39m ECONNRESET' \
	$'\e[1mnpm\e[22m \e[31merror\e[39m \e[94mnetwork\e[39m aborted')"

# npm before 10 prefixed its errors "npm ERR!".
LEGACY_PREFIX_RESET="npm ERR! code ECONNRESET
npm ERR! errno ECONNRESET
npm ERR! network request to https://registry.npmjs.org/typescript failed, reason: read ECONNRESET
npm ERR! network This is a problem related to network connectivity."

# Real failures.

PEER_CONFLICT="npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: @oneuptime/common@14.0.11
npm error Found: react@19.1.0
npm error node_modules/react
npm error   react@\"^19.1.0\" from the root project
npm error
npm error Could not resolve dependency:
npm error peer react@\"^18.0.0\" from react-beautiful-dnd@13.1.1
npm error node_modules/react-beautiful-dnd
npm error   react-beautiful-dnd@\"13.1.1\" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
npm error to accept an incorrect (and potentially broken) dependency resolution.
npm error
npm error
npm error For a full report see:
npm error /home/runner/.npm/_logs/2026-10-02T06_28_56_760Z-eresolve-report.txt
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_28_56_760Z-debug-0.log"

# `npm ci` with a lockfile that package.json has moved on from. npm follows
# this with the whole of `npm ci`'s usage text, cut here.
LOCKFILE_OUT_OF_SYNC="npm error code EUSAGE
npm error
npm error \`npm ci\` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with \`npm install\` before continuing.
npm error
npm error Missing: typescript@5.9.2 from lock file
npm error
npm error Clean install a project
npm error
npm error Run \"npm help ci\" for more info
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_22_035Z-debug-0.log"

MISSING_VERSION="npm error code ETARGET
npm error notarget No matching version found for typescript@^9.0.0.
npm error notarget In most cases you or one of your dependencies are requesting
npm error notarget a package version that doesn't exist.
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_28_57_959Z-debug-0.log"

MISSING_PACKAGE="npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@oneuptime%2fdoes-not-exist - Not found
npm error 404
npm error 404  The requested resource '@oneuptime/does-not-exist@^1.0.0' could not be found or you do not have permission to access it.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_28_59_328Z-debug-0.log"

# npm has already retried the tarball twice by the time it reports this.
INTEGRITY_FAILURE="npm warn tarball tarball data for typescript@https://registry.npmjs.org/typescript/-/typescript-5.9.2.tgz (sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==) seems to be corrupted. Trying again.
npm warn tarball tarball data for typescript@https://registry.npmjs.org/typescript/-/typescript-5.9.2.tgz (sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==) seems to be corrupted. Trying again.
npm error code EINTEGRITY
npm error sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ== integrity checksum failed when using sha512: wanted sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ== but got sha512-YJDcfm35HExu+gUn3VtvJOk+e6RAPB+UYDpJ/EBKdqfNJey3oJudJZWy4FR5TGp5UOrscU5IzyH619MlMTn2yA==. (1090 bytes)
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_03_385Z-debug-0.log"

INSTALL_SCRIPT_COMPILE_ERROR="npm error code 1
npm error path /home/runner/work/oneuptime/oneuptime/packages/Common/node_modules/isolated-vm
npm error command failed
npm error command sh -c node-gyp rebuild --release -j max
npm error gyp info it worked if it ends with ok
npm error ../src/isolate/environment.cc:12:3: error: expected ';' after expression
npm error gyp ERR! build error
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-02T06_29_33_291Z-debug-0.log"

echo "npm_install.sh: network failures are retried"

# --- The 2026-10-01 failure: retried, and the install recovers. ---
run_install 1 1 "$OCT_1_RESET" install
assert_eq 0 "$STATUS" "recovers from the reset that failed compile-probe and Session Replay UI"
assert_eq 2 "$(npm_calls)" "retries it exactly once before succeeding"
assert_contains "$OUTPUT" "npm error network aborted" "streams npm's own output to the log"
assert_contains "$OUTPUT" "hit a network error on attempt 1/4 (npm error code ECONNRESET). Retrying in 0s." "names the error and the delay before retrying"
assert_contains "$OUTPUT" "added 1 package" "streams the successful attempt's output too"
assert_contains "$OUTPUT" "succeeded on attempt 2/4" "says which attempt succeeded"

# --- Every other shape a network failure takes. ---
# expect_retried <what> <npm_output>: retried, and recovers on attempt 2.
expect_retried() {
	run_install 1 1 "$2" install
	assert_eq "0 2" "${STATUS} $(npm_calls)" "retries $1"
}

expect_retried "a 503 from the registry" "$REGISTRY_503"
expect_retried "a 429 from the registry" "npm error code E429
npm error 429 Too Many Requests - GET https://registry.npmjs.org/typescript"
expect_retried "a refused connection" "$CONNECTION_REFUSED"
expect_retried "a failed DNS lookup (ENOTFOUND)" "$DNS_FAILURE"
expect_retried "a DNS lookup that timed out (EAI_AGAIN)" "npm error code EAI_AGAIN
npm error syscall getaddrinfo
npm error errno EAI_AGAIN
npm error request to https://registry.npmjs.org/typescript failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org"
expect_retried "a connect timeout (ETIMEDOUT)" "npm error code ETIMEDOUT
npm error syscall connect
npm error errno ETIMEDOUT
npm error network request to https://registry.npmjs.org/typescript failed, reason: connect ETIMEDOUT 104.16.3.35:443"
expect_retried "a registry that never answered (FETCH_ERROR)" "$REQUEST_TIMEOUT"
expect_retried "a download that stalled (EIDLETIMEOUT)" "$STALLED_DOWNLOAD"
expect_retried "a reset inside an install script's own download" "$INSTALL_SCRIPT_RESET"
expect_retried "the reset under --color always" "$COLOURED_RESET"
expect_retried "the reset under npm's old 'npm ERR!' prefix" "$LEGACY_PREFIX_RESET"

# --- Recovers even when it takes every attempt it has. ---
run_install 3 1 "$OCT_1_RESET" install
assert_eq 0 "$STATUS" "recovers on the last permitted attempt"
assert_eq 4 "$(npm_calls)" "makes delays+1 attempts"

# --- Never recovers: give up, with npm's own exit status. ---
run_install 99 7 "$OCT_1_RESET" install
assert_eq 7 "$STATUS" "returns npm's exit status when the attempts run out"
assert_eq 4 "$(npm_calls)" "stops after delays+1 attempts"
assert_contains "$OUTPUT" "attempt 4/4, the last one allowed (npm error code ECONNRESET)" "says it gave up, and on what"

echo ""
echo "npm_install.sh: anything else fails on the first attempt"

# expect_not_retried <what> <npm_output>: fails at once, with npm's status.
expect_not_retried() {
	run_install 99 1 "$2" install
	assert_eq "1 1" "${STATUS} $(npm_calls)" "does not retry $1"
}

expect_not_retried "a peer-dependency conflict (ERESOLVE)" "$PEER_CONFLICT"
expect_not_retried "a lockfile out of step with package.json (EUSAGE)" "$LOCKFILE_OUT_OF_SYNC"
expect_not_retried "a version that does not exist (ETARGET)" "$MISSING_VERSION"
expect_not_retried "a package that does not exist (E404)" "$MISSING_PACKAGE"
expect_not_retried "a failed integrity check (EINTEGRITY)" "$INTEGRITY_FAILURE"
expect_not_retried "an install script that fails to compile" "$INSTALL_SCRIPT_COMPILE_ERROR"

run_install 99 1 "$PEER_CONFLICT" install
assert_contains "$OUTPUT" "None of npm's errors is a network failure, so it was not retried." "says why it did not retry"
assert_contains "$OUTPUT" "npm error ERESOLVE unable to resolve dependency tree" "leaves npm's own error in the log"
assert_not_contains "$OUTPUT" "Retrying" "does not announce a retry"

# --- npm's status goes through untouched: a killed npm is not a network error. ---
run_install 99 137 "Killed" install
assert_eq "137 1" "${STATUS} $(npm_calls)" "fails at once, with npm's status, when npm prints no error at all"

# --- Only npm's error lines count: a network error in a warning, followed
# by a real error, is still a real error. ---
expect_not_retried "a real error that follows a warning naming a network error" "npm warn retry will retry, error on last attempt: Error: read ECONNRESET
$PEER_CONFLICT"

# --- Whole words only: a name that merely contains a code is not one. ---
expect_not_retried "a missing tag whose name contains a network code" "npm error code ETARGET
npm error notarget No matching version found for typescript@ECONNRESET_FIX."

echo ""
echo "npm_install.sh: interface"

# --- Succeeds first time: one call, and nothing added to the log. ---
run_install 0 1 "" install
assert_eq 0 "$STATUS" "returns 0 when npm succeeds"
assert_eq 1 "$(npm_calls)" "runs npm exactly once when it succeeds"
assert_not_contains "$OUTPUT" "attempt" "says nothing about attempts when the first one succeeds"

# --- npm gets the arguments verbatim, in the directory it was run from. ---
run_install 0 1 "" install --no-save --package-lock=false "/tmp/mobile recorder/oneuptime-react-native-replay-1.0.0.tgz"
assert_eq "${WORK_DIR}"$'\t[install]\t[--no-save]\t[--package-lock=false]\t[/tmp/mobile recorder/oneuptime-react-native-replay-1.0.0.tgz]' "$(cat "$CALL_LOG")" "passes the arguments through verbatim, in the current directory"

run_install 1 1 "$OCT_1_RESET" ci --ignore-scripts
assert_eq "0 2" "${STATUS} $(npm_calls)" "retries npm ci too"
assert_eq "[ci]	[--ignore-scripts]" "$(sed -n 2p "$CALL_LOG" | cut -f 2-)" "retries npm ci with the same arguments"

# --- It installs, nothing else: no subcommand, or another one, is refused. ---
run_install 0 1 ""
assert_eq "2 0" "${STATUS} $(npm_calls)" "refuses to run without a subcommand"
run_install 0 1 "" run test
assert_eq "2 0" "${STATUS} $(npm_calls)" "refuses to retry anything but install or ci"
assert_contains "$OUTPUT" "usage:" "prints its usage"

# --- An empty delay list turns retrying off rather than looping forever. ---
(
	export NPM_INSTALL_RETRY_DELAYS=""
	run_install 99 1 "$OCT_1_RESET" install
	exit "$STATUS"
)
status=$?
assert_eq "1 1" "${status} $(npm_calls)" "an empty delay list disables retrying"

echo ""
echo "npm_install.sh: in GitHub Actions"

IN_ACTIONS="true"
WORKSPACE="$CHECKOUT"

run_install 1 1 "$OCT_1_RESET" install
assert_contains "$OUTPUT" $'\n::warning title=npm install retried::npm install (in packages/Common) hit a network error on attempt 1/4 and was retried: npm error code ECONNRESET' "leaves a warning annotation for each retry"
assert_contains "$OUTPUT" "npm install (in packages/Common) hit" "names the directory relative to the checkout"

run_install 99 1 "$OCT_1_RESET" install
assert_contains "$OUTPUT" $'\n::error title=npm install failed::npm install (in packages/Common) hit a network error on every one of its 4 attempts. The last: npm error code ECONNRESET' "leaves an error annotation when the attempts run out"

run_install 99 1 "$PEER_CONFLICT" install
assert_not_contains "$OUTPUT" "::" "leaves no annotation for a real failure; npm's error speaks for itself"

# A workflow command ends at a newline and decodes %XX, so a % in npm's line
# must reach it as %25.
run_install 1 1 "npm error network request to https://registry.npmjs.org/@types%2fnode failed, reason: socket hang up" install
assert_contains "$OUTPUT" "@types%252fnode failed, reason: socket hang up" "escapes % in the annotation"

WORKSPACE="$WORK_DIR"
run_install 1 1 "$OCT_1_RESET" install
assert_contains "$OUTPUT" "npm install (in the repository root) hit" "names the repository root as such"

IN_ACTIONS=""
WORKSPACE=""
run_install 1 1 "$OCT_1_RESET" install
assert_not_contains "$OUTPUT" "::warning" "leaves no annotations outside GitHub Actions"
assert_contains "$OUTPUT" "npm install (in ${WORK_DIR}) hit" "names the full directory outside GitHub Actions"

echo ""
echo ".github/actions/npm-install"

# The action's script, run the way Actions runs a composite bash step. It is
# the only part of the action with behaviour of its own: it splits the args
# input into npm's arguments.
ACTION_SCRIPT="$(awk '
	/^      run: \|$/ { inside = 1; next }
	inside { sub(/^        /, ""); print }
' "$ACTION")"

# run_action <command> <args>: as run_install, through the action's script.
run_action() {
	: >"$CALL_LOG"
	printf '%s\n' "" >"$NPM_OUTPUT_FILE"
	STATUS=0
	OUTPUT="$(
		cd "$WORK_DIR" &&
			PATH="${STUB_BIN}:${PATH}" FAKE_NPM_FAIL_TIMES=0 FAKE_NPM_EXIT=1 \
				GITHUB_WORKSPACE="$REPO_ROOT" NPM_INSTALL_COMMAND="$1" NPM_INSTALL_ARGS="$2" \
				bash --noprofile --norc -eo pipefail -c "$ACTION_SCRIPT" 2>&1
	)" || STATUS=$?
}

assert_contains "$ACTION_SCRIPT" "Scripts/GHA/npm_install.sh" "found the action's script, and it calls the helper"

run_action install ""
assert_eq "0 [install]" "${STATUS} $(cut -f 2- "$CALL_LOG")" "passes no arguments when args is empty"

run_action ci "--ignore-scripts"
assert_eq "0 [ci]	[--ignore-scripts]" "${STATUS} $(cut -f 2- "$CALL_LOG")" "passes the command and a flag"

# A file the glob would match, so globbing would show.
touch "${WORK_DIR}/package.json"
run_action install "  -g   depcheck *.json "
assert_eq "0 [install]	[-g]	[depcheck]	[*.json]" "${STATUS} $(cut -f 2- "$CALL_LOG")" "splits args on whitespace, without globbing"

echo ""
if ((FAIL > 0)); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
