#!/usr/bin/env bash
#
# Opens the pull request that adds one release of the OneUptime
# infrastructure agent to winget (microsoft/winget-pkgs), for
#
#   winget install --id OneUptime.InfrastructureAgent
#
# closes the account's pull requests for older versions that it supersedes,
# and agrees to Microsoft's CLA on it once Microsoft's CLA bot asks.
#
# GoReleaser writes the manifests (agents/InfrastructureAgent/.goreleaser.yaml,
# winget) in infrastructure-agent-build; release.yml's
# publish-infrastructure-agent-winget job runs this once the GitHub release
# they download from is published. Environment:
#
#   PACKAGE_VERSION        the release's version
#   WINGET_MANIFESTS       the directory GoReleaser wrote this version's three
#                          manifests to
#   WINGET_GITHUB_TOKEN    a classic token with the public_repo scope, of the
#                          account that owns the fork the pull request comes
#                          from (a fine-grained token cannot open a pull
#                          request on microsoft/winget-pkgs)
#   WINGET_FORK_OWNER      optional: the owner of that fork, when it is not
#                          the token's account (an organization's fork)
#
# and, optionally, how long to wait for the CLA bot and how often to look (see
# below), in whole seconds: WINGET_CLA_WAIT_SECONDS (900),
# WINGET_CLA_CLEAR_WAIT_SECONDS (300) and WINGET_CLA_POLL_SECONDS (20).
#
# (WINGET_UPSTREAM, WINGET_UPSTREAM_BRANCH and WINGET_RETRY_DELAY_SECONDS are
# for the tests.)
#
# winget-pkgs takes a pull request from a fork; Microsoft's checks validate it
# and a moderator or a bot merges it. Nothing is cloned: winget-pkgs is
# several gigabytes. The branch is made in the fork at winget-pkgs' newest
# commit (a fork shares its parent's objects), the manifests are committed to
# it through the API, and the pull request is opened from it, as GoReleaser
# itself does.
#
# A version winget-pkgs already has, or one with a pull request open, is
# left alone, so a re-run opens nothing twice. Only a clean 404 counts as
# "not there"; any other answer is asked again and then stops the job.
#
# A version's pull request supersedes the account's open ones for older
# versions: winget-pkgs only needs the newest, and on 20 October 2026 five
# were still open (#455532, #455758, #455948, #456276 and #456419, closed by
# hand for 14.0.78's #456494). So once this version's pull request is open,
# opened now or found open, this closes those, each with the comment
# "Superseded by #<number> (OneUptime.InfrastructureAgent <version>)." It
# finds them by title in winget-pkgs' search, and closes one only when its
# version is older than this one (compared number by number: 14.0.9 comes
# before 14.0.10) and GitHub lists it as open from the fork's own branch for
# that version, <owner>:OneUptime.InfrastructureAgent-<version>. So it never
# closes another account's pull request, another package's, or a newer
# version's: a re-run of an older release closes nothing newer. It is best
# effort: a request that fails is asked once more, and then a warning names
# the pull request and the job goes on.
#
# Microsoft's CLA bot asks the account that opened a pull request to agree to
# the Contributor License Agreement on every pull request, not once: it asked
# on #455758, #455948 and #456276 (14.0.76, opened before this agreed at all)
# though HackerBay, Inc. had agreed on #455532. And it ignores an agreement
# posted before it has started on the pull request:
#
#   #456419 (14.0.77)  opened at 03:14:30Z, and agreed on a second later by
#                      this script as it then was; the bot asked at
#                      03:23:40Z, and Needs-CLA stayed
#   #455532 (14.0.71)  opened at 19:56:54Z, agreed on 31 seconds later; the
#                      bot still commented at 52 seconds and asked at 75
#
# So each pull request gets its own agreement, once the bot has asked for it.
# With the pull request open, this reads its labels every
# WINGET_CLA_POLL_SECONDS until the bot labels it Needs-CLA, for at most
# WINGET_CLA_WAIT_SECONDS (the bot took nine minutes on #456419). Then it
# posts the agreement, and waits up to WINGET_CLA_CLEAR_WAIT_SECONDS for the
# bot to take the label off.
#
# Neither wait fails the job: the pull request is open by then. If no
# Needs-CLA label comes, nothing is posted. If the label stays, this warns,
# naming the pull request and the comment to post by hand, and the
# "Infrastructure Agent Release Status" workflow reports the label as a
# problem until it goes. A re-run that finds the pull request open with
# Needs-CLA agrees on it and waits in the same way. An agreement GitHub will
# not post is tried again, and then stops the job with the comment to post by
# hand.

set -euo pipefail

readonly PACKAGE_ID="OneUptime.InfrastructureAgent"
readonly PACKAGE_DIR="manifests/o/OneUptime/InfrastructureAgent"
readonly UPSTREAM="${WINGET_UPSTREAM:-microsoft/winget-pkgs}"
readonly UPSTREAM_BRANCH="${WINGET_UPSTREAM_BRANCH:-master}"
readonly MANIFESTS=(
	"$PACKAGE_ID.yaml"
	"$PACKAGE_ID.installer.yaml"
	"$PACKAGE_ID.locale.en-US.yaml"
)
# The title this gives the package's pull requests (below); the version is
# the second group.
readonly TITLE_PATTERN='^New (version|package): OneUptime\.InfrastructureAgent version ([0-9]+(\.[0-9]+)*)$'
# How the account agrees to Microsoft's CLA, for HackerBay, Inc.
readonly CLA_AGREEMENT='@microsoft-github-policy-service agree company="HackerBay, Inc."'
# How long to wait for the CLA bot to ask, and then to take its label off,
# and how often to look.
readonly CLA_WAIT_SECONDS="${WINGET_CLA_WAIT_SECONDS:-900}"
readonly CLA_CLEAR_WAIT_SECONDS="${WINGET_CLA_CLEAR_WAIT_SECONDS:-300}"
readonly CLA_POLL_SECONDS="${WINGET_CLA_POLL_SECONDS:-20}"

VERSION="${PACKAGE_VERSION:-}"

fail() {
	echo "PublishWingetManifests: $*" >&2
	exit 1
}

# warn <title> <message>: something a person has to see to, which does not
# stop the job; in a GitHub Actions job, a warning on the run as well.
warn() {
	local message="$2"
	echo "PublishWingetManifests: warning: $message" >&2
	if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
		# A workflow command is one line, and GitHub's answers can be more.
		message="${message//'%'/'%25'}"
		message="${message//$'\r'/'%0D'}"
		message="${message//$'\n'/'%0A'}"
		echo "::warning title=$1::$message"
	fi
}

[[ -n "$VERSION" ]] || fail "PACKAGE_VERSION is required"
[[ -d "${WINGET_MANIFESTS:-}" ]] || fail "WINGET_MANIFESTS must be a directory: '${WINGET_MANIFESTS:-}'"
[[ -n "${WINGET_GITHUB_TOKEN:-}" ]] || fail "WINGET_GITHUB_TOKEN is required"
for manifest in "${MANIFESTS[@]}"; do
	[[ -f "$WINGET_MANIFESTS/$manifest" ]] || fail "missing $WINGET_MANIFESTS/$manifest"
	grep -qx "PackageVersion: $VERSION" "$WINGET_MANIFESTS/$manifest" ||
		fail "$manifest is not for version $VERSION"
done
# Checked before anything is opened, not once the pull request waits.
[[ "$CLA_WAIT_SECONDS" =~ ^(0|[1-9][0-9]*)$ ]] ||
	fail "WINGET_CLA_WAIT_SECONDS must be a whole number of seconds: '$CLA_WAIT_SECONDS'"
[[ "$CLA_CLEAR_WAIT_SECONDS" =~ ^(0|[1-9][0-9]*)$ ]] ||
	fail "WINGET_CLA_CLEAR_WAIT_SECONDS must be a whole number of seconds: '$CLA_CLEAR_WAIT_SECONDS'"
[[ "$CLA_POLL_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
	fail "WINGET_CLA_POLL_SECONDS must be a whole number of seconds, at least 1: '$CLA_POLL_SECONDS'"

export GH_TOKEN="$WINGET_GITHUB_TOKEN"
VERSION_DIR="$PACKAGE_DIR/$VERSION"
BRANCH="$PACKAGE_ID-$VERSION"

# exists <api path>: 0 when GitHub answers 200, 1 when it answers 404. Any
# other answer is asked again, and then stops the script: an outage must not
# read as "not published yet".
exists() {
	local out status attempt=1
	while true; do
		status=0
		out="$(gh api "$1" 2>&1)" || status=$?
		if ((status == 0)); then
			return 0
		fi
		if grep -q "HTTP 404" <<<"$out"; then
			return 1
		fi
		if ((attempt >= 4)); then
			fail "could not ask GitHub for $1: $out"
		fi
		echo "Asking GitHub for $1 failed (attempt $attempt of 4); asking again. GitHub said: $out" >&2
		sleep $((attempt * ${WINGET_RETRY_DELAY_SECONDS:-15}))
		attempt=$((attempt + 1))
	done
}

# retry_once <gh api arguments...>: a request whose failure does not stop the
# job, asked once more when it fails. Prints GitHub's last answer (with what
# it said on stderr), and fails when both requests did.
retry_once() {
	local out status=0
	out="$(gh api "$@" 2>&1)" || status=$?
	if ((status != 0)); then
		echo "Asking GitHub for $* failed; asking once more. GitHub said: $out" >&2
		sleep "${WINGET_RETRY_DELAY_SECONDS:-15}"
		status=0
		out="$(gh api "$@" 2>&1)" || status=$?
	fi
	printf '%s\n' "$out"
	return "$status"
}

# older <version> <version>: 0 when the first comes before the second. Each
# is whole numbers joined by dots, compared number by number, as semantic
# versions without a pre-release are: 1.2.9 comes before 1.2.10.
older() {
	local -a first second
	local i a b
	IFS=. read -ra first <<<"$1"
	IFS=. read -ra second <<<"$2"
	for ((i = 0; i < ${#first[@]} || i < ${#second[@]}; i++)); do
		a=$((10#${first[i]:-0}))
		b=$((10#${second[i]:-0}))
		if ((a < b)); then
			return 0
		elif ((a > b)); then
			return 1
		fi
	done
	return 1
}

# close_superseded <pull request number>: closes the account's open pull
# requests for older versions of the package, which this version's pull
# request supersedes (see the top). Best effort: what fails is a warning
# naming the pull request, and the job goes on.
close_superseded() {
	local number="$1" listed other title version owned out older_ones=0
	if ! [[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
		echo "Closing no older pull requests: $VERSION is not whole numbers joined by dots, so no version can be compared with it."
		return
	fi
	if ! listed="$(retry_once --method GET search/issues -f q="repo:$UPSTREAM is:pr is:open in:title $PACKAGE_ID" -f per_page=100 --jq '.items[] | "\(.number) \(.title)"')"; then
		warn "Older winget pull requests not closed" "Could not list the open pull requests for $PACKAGE_ID, so none was closed as superseded by #$number. GitHub said: $listed"
		return
	fi
	while read -r -u 3 other title; do
		# Another pull request for this package, as this script titles them.
		if [[ -z "$other" || "$other" == "$number" || ! "$title" =~ $TITLE_PATTERN ]]; then
			continue
		fi
		version="${BASH_REMATCH[2]}"
		if ! older "$version" "$VERSION"; then
			echo "Leaving #$other ($PACKAGE_ID $version) open: it is not older than $VERSION."
			continue
		fi
		older_ones=$((older_ones + 1))
		# The account's own: open from the fork's branch for that version.
		if ! owned="$(retry_once "repos/$UPSTREAM/pulls?state=open&head=$OWNER:$PACKAGE_ID-$version" --jq '.[].number')"; then
			warn "winget #$other not closed" "Could not check whether #$other ($PACKAGE_ID $version) is from $OWNER's fork, so it was not closed as superseded by #$number. GitHub said: $owned"
			continue
		fi
		if ! grep -qx "$other" <<<"$owned"; then
			echo "Leaving #$other ($PACKAGE_ID $version) open: it is not from $OWNER's fork."
			continue
		fi
		# Closed first, so a pull request the account may not close gets no
		# comment, on this run or the next.
		if ! out="$(retry_once --method PATCH "repos/$UPSTREAM/pulls/$other" -f state=closed)"; then
			warn "winget #$other not closed" "Could not close #$other ($PACKAGE_ID $version), superseded by #$number: close it by hand. GitHub said: $out"
			continue
		fi
		if ! out="$(retry_once --method POST "repos/$UPSTREAM/issues/$other/comments" -f body="Superseded by #$number ($PACKAGE_ID $VERSION).")"; then
			warn "winget #$other closed without a comment" "Closed #$other ($PACKAGE_ID $version) as superseded by #$number, but could not comment that on it. GitHub said: $out"
			continue
		fi
		echo "Closed #$other ($PACKAGE_ID $version): superseded by #$number."
	done 3<<<"$listed"
	if ((older_ones == 0)); then
		echo "No other open pull request is for an older version of $PACKAGE_ID: none to close."
	fi
}

# agree <pull request number>: posts the CLA agreement on the pull request.
# A failure is tried again, and then stops the job with what to comment.
agree() {
	local out attempt=1
	while ! out="$(gh api --method POST "repos/$UPSTREAM/issues/$1/comments" -f body="$CLA_AGREEMENT" 2>&1 >/dev/null)"; do
		if ((attempt >= 4)); then
			fail "could not post the CLA agreement on #$1; comment it there by hand from the account that opened it: $CLA_AGREEMENT. GitHub said: $out"
		fi
		echo "Posting the CLA agreement failed (attempt $attempt of 4); posting it again. GitHub said: $out" >&2
		sleep $((attempt * ${WINGET_RETRY_DELAY_SECONDS:-15}))
		attempt=$((attempt + 1))
	done
	echo "Posted the CLA agreement for HackerBay, Inc. on #$1."
}

# needs_cla <pull request number>: "true" when the pull request has the
# Needs-CLA label, "false" when it has not, and "unknown" (said on stderr)
# when GitHub does not answer. The waits look again at their next poll: a
# read GitHub fails never stops the job.
needs_cla() {
	local out status=0
	out="$(gh api "repos/$UPSTREAM/issues/$1" --jq 'any(.labels[]; .name == "Needs-CLA")' 2>&1)" || status=$?
	if ((status == 0)) && [[ "$out" == "true" || "$out" == "false" ]]; then
		echo "$out"
	else
		echo "Reading the labels of #$1 failed. GitHub said: $out" >&2
		echo "unknown"
	fi
}

# wait_for_cla <pull request number> <true|false> <seconds>: reads the pull
# request's labels every CLA_POLL_SECONDS until it has the Needs-CLA label
# (true) or has not (false), sleeping <seconds> at most. 0 once it is so, 1
# when the time runs out first.
wait_for_cla() {
	local number="$1" wanted="$2" left="$3"
	until [[ "$(needs_cla "$number")" == "$wanted" ]]; do
		if ((left <= 0)); then
			return 1
		fi
		sleep $((left < CLA_POLL_SECONDS ? left : CLA_POLL_SECONDS))
		left=$((left - CLA_POLL_SECONDS))
	done
}

# agree_and_confirm <pull request number> <url>: on a pull request the CLA
# bot has labelled Needs-CLA, posts the agreement, then waits for the bot to
# take the label off. A label that stays is a warning, not a failure.
agree_and_confirm() {
	agree "$1"
	echo "Waiting up to $CLA_CLEAR_WAIT_SECONDS seconds for Microsoft's CLA bot to take the Needs-CLA label off #$1."
	if wait_for_cla "$1" false "$CLA_CLEAR_WAIT_SECONDS"; then
		echo "Microsoft's CLA bot took the Needs-CLA label off #$1: the CLA is agreed."
		return
	fi
	warn "Needs-CLA on winget #$1" "Microsoft's CLA bot had not taken the Needs-CLA label off #$1 $CLA_CLEAR_WAIT_SECONDS seconds after the CLA agreement was posted. If the label is still there, comment this on $2 by hand, from the account that opened it: $CLA_AGREEMENT"
}

if exists "repos/$UPSTREAM/contents/$VERSION_DIR?ref=$UPSTREAM_BRANCH"; then
	echo "$UPSTREAM already has $PACKAGE_ID $VERSION; nothing to do."
	exit 0
fi

OWNER="${WINGET_FORK_OWNER:-$(gh api user --jq .login)}"
FORK="$OWNER/winget-pkgs"

# "<number> <url> <whether it has the Needs-CLA label>", or nothing.
open_pull_request="$(gh api "repos/$UPSTREAM/pulls?state=open&head=$OWNER:$BRANCH" \
	--jq '.[0] | select(.) | "\(.number) \(.html_url) \([.labels[].name] | index("Needs-CLA") != null)"')"
if [[ -n "$open_pull_request" ]]; then
	read -r number url asked <<<"$open_pull_request"
	echo "$PACKAGE_ID $VERSION is already waiting in $url; nothing to open."
	close_superseded "$number"
	# The bot has asked on it, so an agreement posted now counts.
	if [[ "$asked" == "true" ]]; then
		agree_and_confirm "$number" "$url"
	else
		echo "#$number has no Needs-CLA label, so no CLA agreement is posted. If Microsoft's CLA bot asks for one later, re-run this job."
	fi
	exit 0
fi

exists "repos/$FORK" ||
	fail "$FORK does not exist: fork $UPSTREAM into $OWNER first (see the setup in Scripts/PackageManagers/README.md)"
[[ "$(gh api "repos/$FORK" --jq '.parent.full_name // empty')" == "$UPSTREAM" ]] ||
	fail "$FORK is not a fork of $UPSTREAM"

if exists "repos/$UPSTREAM/contents/$PACKAGE_DIR?ref=$UPSTREAM_BRANCH"; then
	TITLE="New version: $PACKAGE_ID version $VERSION"
else
	TITLE="New package: $PACKAGE_ID version $VERSION"
fi

# set_branch: the branch, at winget-pkgs' newest commit ($BASE). One left by a
# run that stopped before its pull request is moved there too, so it carries
# only this commit. GitHub can refuse this for a moment: on 14.0.93's release
# (2026-10-27) it answered "Reference update failed (HTTP 422)" to the
# branch's creation, and the fork had the commit when it was looked at
# again. So it is asked up to four times, as exists() asks, looking each time
# whether an earlier attempt made the branch after all, before the job stops.
set_branch() {
	local out status attempt=1
	while true; do
		status=0
		if exists "repos/$FORK/git/ref/heads/$BRANCH"; then
			out="$(gh api --method PATCH "repos/$FORK/git/refs/heads/$BRANCH" \
				-f sha="$BASE" -F force=true 2>&1 >/dev/null)" || status=$?
		else
			out="$(gh api --method POST "repos/$FORK/git/refs" \
				-f ref="refs/heads/$BRANCH" -f sha="$BASE" 2>&1 >/dev/null)" || status=$?
		fi
		if ((status == 0)); then
			return 0
		fi
		if ((attempt >= 4)); then
			fail "could not point $FORK's $BRANCH at $UPSTREAM's $BASE: $out"
		fi
		echo "Pointing $FORK's $BRANCH at $BASE failed (attempt $attempt of 4); asking again. GitHub said: $out" >&2
		sleep $((attempt * ${WINGET_RETRY_DELAY_SECONDS:-15}))
		attempt=$((attempt + 1))
	done
}

BASE="$(gh api "repos/$UPSTREAM/git/ref/heads/$UPSTREAM_BRANCH" --jq .object.sha)"
set_branch

for manifest in "${MANIFESTS[@]}"; do
	gh api --method PUT "repos/$FORK/contents/$VERSION_DIR/$manifest" \
		-f message="$TITLE" \
		-f branch="$BRANCH" \
		-f content="$(base64 <"$WINGET_MANIFESTS/$manifest" | tr -d '\n')" >/dev/null
done

created="$(gh api --method POST "repos/$UPSTREAM/pulls" \
	-f title="$TITLE" \
	-f head="$OWNER:$BRANCH" \
	-f base="$UPSTREAM_BRANCH" \
	-f body="$PACKAGE_ID $VERSION, released at https://github.com/OneUptime/oneuptime/releases/tag/$VERSION. The manifests are generated by GoReleaser in OneUptime's release workflow." \
	--jq '"\(.number) \(.html_url)"')"
read -r NUMBER PULL_REQUEST <<<"$created"

echo "Opened $PULL_REQUEST"
close_superseded "$NUMBER"

# An agreement posted before the CLA bot has started on the pull request does
# not count (see the top), so wait for the bot's Needs-CLA label first.
echo "Waiting up to $CLA_WAIT_SECONDS seconds for Microsoft's CLA bot to label #$NUMBER Needs-CLA, reading its labels every $CLA_POLL_SECONDS seconds."
if wait_for_cla "$NUMBER" true "$CLA_WAIT_SECONDS"; then
	echo "Microsoft's CLA bot labelled #$NUMBER Needs-CLA."
	agree_and_confirm "$NUMBER" "$PULL_REQUEST"
else
	echo "#$NUMBER had no Needs-CLA label after $CLA_WAIT_SECONDS seconds, so no CLA agreement was posted: Microsoft's CLA bot has not asked for one. If it asks later, re-run this job, or comment this on $PULL_REQUEST by hand from the account that opened it: $CLA_AGREEMENT"
fi
