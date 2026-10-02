#!/usr/bin/env bash

# Runs `npm install` or `npm ci` in the current directory, and runs it again,
# with backoff, when -- and only when -- npm failed on a network error.
#
#   npm_install.sh <install|ci> [npm arguments...]
#
# A workflow step installs through .github/actions/npm-install, which calls
# this. A `run:` block that installs partway through other commands calls this
# script directly.
#
# Why this exists. On 2026-10-01 two jobs failed 97 seconds apart -- Compile /
# compile-probe in `cd packages/Common && npm install`, and App Test / Session
# Replay UI in its "Install shared dependencies" step -- with the same error:
#
#   npm error code ECONNRESET
#   npm error network aborted
#   npm error network This is a problem related to network connectivity.
#
# "aborted" is the registry dropping the connection while a tarball was still
# streaming. npm's own fetch retries do not cover that: they retry a request
# that fails before its response starts, and this one had started, so npm
# gave up on the first reset. Nothing around those installs retried either,
# and the Session Replay UI job went on to fail its next step with
# `playwright: not found`, because the install had never finished.
#
# Only network failures are retried. A peer-dependency conflict (ERESOLVE), a
# lockfile out of step with package.json (`npm ci`'s EUSAGE), a version that
# does not exist (ETARGET, E404) or a tarball that fails its integrity check
# (EINTEGRITY, which npm has already retried twice by then) fails the same way
# every time, so it still fails on the first attempt, with npm's own error and
# exit status.
#
# How a failure is told apart: npm prefixes every line of its error report
# with "npm error" ("npm ERR!" before npm 10) -- including the output of an
# install script that failed, which is where a node-gyp header download or a
# prebuilt-binary fetch reports its own dropped connection. Only those lines
# are read, and only for the failures listed in NPM_NETWORK_ERRORS, so a
# warning that mentions a dropped connection cannot make the real error after
# it look like a network failure.
#
# npm's output streams to the log as it runs and is kept for that check. Each
# retry leaves a warning annotation on the run, so a flaky registry stays
# visible even when every install recovers.

set -uo pipefail

# Seconds to wait before each retry, space separated; the count also sets the
# attempt limit (delays + 1), and an empty value disables retrying. A reset is
# usually one dropped connection, so the first retry comes quickly; the later
# ones are spread out to ride out a registry incident of a few minutes. A
# string so it can be overridden from the environment: Scripts/GHA/Tests
# zeroes it.
NPM_INSTALL_RETRY_DELAYS="${NPM_INSTALL_RETRY_DELAYS-10 30 90}"

# What counts as a network failure, matched (case-sensitively, as an extended
# regex) against npm's error lines only:
#
#   * The codes Node and npm give a connection that was reset, refused,
#     aborted or timed out, an unreachable network, and a failed DNS lookup,
#     plus the timeouts of npm's own HTTP agent (a download that stalls ends
#     in EIDLETIMEOUT) -- wherever they appear on an error line: npm's "code"
#     and "errno" lines, a message, or an install script's output quoting
#     `code: 'ECONNRESET'`. Whole words only, so a package or path that merely
#     contains one does not count.
#   * The messages Node and minipass-fetch use for the same things without
#     one of those codes: "socket hang up", and the FETCH_ERROR timeouts.
#   * "npm error network ...", the category npm files network errors under.
#   * An HTTP 408, 429 or 5xx from the registry: it answered, but could not
#     serve the request then.
NPM_NETWORK_ERROR_CODES='ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EAI_FAIL|ENETUNREACH|ENETDOWN|EHOSTUNREACH|ERR_SOCKET_TIMEOUT|ERR_STREAM_PREMATURE_CLOSE|ECONNECTIONTIMEOUT|EIDLETIMEOUT|ERESPONSETIMEOUT|ETRANSFERTIMEOUT'
NPM_NETWORK_ERRORS="(^|[^A-Za-z0-9_])(${NPM_NETWORK_ERROR_CODES})([^A-Za-z0-9_]|\$)"
NPM_NETWORK_ERRORS+='|socket hang up|network timeout at: |Response timeout while trying to fetch '
NPM_NETWORK_ERRORS+='|^npm (error|ERR!) network( |$)'
NPM_NETWORK_ERRORS+='|^npm (error|ERR!) code E(408|429|5[0-9][0-9])$'

usage() {
	echo "usage: $(basename "$0") <install|ci> [npm arguments...]" >&2
	exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in
	install | ci) ;;
	*) usage ;;
esac

# What the messages call this install: the command, and where it ran -- as a
# path inside the checkout when it ran in one.
where="$PWD"
if [[ -n "${GITHUB_WORKSPACE:-}" ]]; then
	case "$PWD" in
		"$GITHUB_WORKSPACE") where="the repository root" ;;
		"$GITHUB_WORKSPACE"/*) where="${PWD#"$GITHUB_WORKSPACE"/}" ;;
	esac
fi
description="npm $* (in ${where})"

# annotate <warning|error> <title> <message>: a GitHub Actions annotation, so
# the line shows on the run's summary page. A no-op outside Actions.
annotate() {
	if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
		# The message is data in a workflow command: escape what would end it.
		local message="${3//\%/%25}"
		echo "::$1 title=$2::${message}"
	fi
}

output="$(mktemp)" || exit 1
trap 'rm -f "$output"' EXIT

# The first of npm's error lines in the last attempt's output that reports a
# network failure; nothing when there is none. Colour codes are stripped
# first, because `--color always` puts them inside the "npm error" prefix.
first_network_error() {
	sed -e $'s/\x1b\\[[0-9;]*m//g' "$output" |
		grep -E '^npm (error|ERR!)( |$)' |
		grep -m 1 -E "$NPM_NETWORK_ERRORS"
}

delays=()
read -ra delays <<<"$NPM_INSTALL_RETRY_DELAYS"
max_attempts=$((${#delays[@]} + 1))
attempt=1

while true; do
	# stderr is merged so the check reads npm's lines in the order npm wrote
	# them; GitHub shows both streams in the same log anyway. npm's own status
	# is PIPESTATUS[0], whatever became of tee.
	npm "$@" 2>&1 | tee "$output"
	status=${PIPESTATUS[0]}

	if ((status == 0)); then
		if ((attempt > 1)); then
			echo "✅ ${description} succeeded on attempt ${attempt}/${max_attempts}."
		fi
		exit 0
	fi

	network_error="$(first_network_error)"

	if [[ -z "$network_error" ]]; then
		echo "❌ ${description} failed (exit ${status}). None of npm's errors is a network failure, so it was not retried." >&2
		exit "$status"
	fi

	if ((attempt >= max_attempts)); then
		echo "❌ ${description} hit a network error on attempt ${attempt}/${max_attempts}, the last one allowed (${network_error}). Giving up with npm's exit status, ${status}." >&2
		annotate error "npm $1 failed" "${description} hit a network error on every one of its ${max_attempts} attempts. The last: ${network_error}"
		exit "$status"
	fi

	delay="${delays[attempt - 1]}"
	echo "⚠️  ${description} hit a network error on attempt ${attempt}/${max_attempts} (${network_error}). Retrying in ${delay}s." >&2
	annotate warning "npm $1 retried" "${description} hit a network error on attempt ${attempt}/${max_attempts} and was retried: ${network_error}"
	sleep "$delay"
	attempt=$((attempt + 1))
done
