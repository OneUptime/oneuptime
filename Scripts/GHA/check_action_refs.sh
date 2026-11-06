#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: check_action_refs.sh [--root <dir>] [--list]

Checks that every action the workflows and composite actions in .github name
(`uses: owner/repo[/path]@ref`) exists on GitHub: as a tag or a branch of its
repository, or as a commit pinned with the tag it is:

  uses: sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532 # v4.1.3

GitHub resolves a `uses:` ref only when a job that runs it starts, and some
jobs start only on release day: 14.0.104's "Sign the release's images" never
started, because sigstore/cosign-installer publishes no v4 tag (its v4
releases are v4.0.0 to v4.1.3), and nothing had run that job since it named
one. Run on every pull request, this fails the change that names a ref
instead.

Each repository's tags and branches are read once, with `git ls-remote`: no
API token and no REST rate limit. A read that fails for a moment is tried
again; a repository GitHub does not have fails at once.

Optional flags:
	--root <dir>   The repository to check (default: this script's)
	--list         Print every action ref found, one a line as
	               <file>:<line> TAB <owner/repo[/path]@ref> TAB <comment>,
	               and check nothing
EOF
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIST_ONLY=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--root)
			if [[ $# -lt 2 || -z "$2" ]]; then
				echo "--root needs a directory" >&2
				exit 2
			fi
			ROOT="$2"
			shift 2
			;;
		--list)
			LIST_ONLY=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage
			exit 2
			;;
	esac
done

if [[ ! -d "${ROOT}/.github" ]]; then
	echo "❌ ${ROOT} has no .github directory" >&2
	exit 2
fi

# Seconds to wait before each new read of a repository's refs, space
# separated; the count also sets the attempt limit (delays + 1). An
# ls-remote that fails for a moment clears in seconds. Overridable so the
# tests run without sleeping.
ACTION_REFS_READ_DELAYS="${ACTION_REFS_READ_DELAYS-10 30 60}"

# What git says when the repository does not exist, or is private, which is
# the same to anyone outside it: GitHub asks for a sign-in rather than say
# which. Another read cannot change that, so it fails at once.
NOT_A_REPOSITORY='Repository not found|could not read Username|Authentication failed|terminal prompts disabled'

# `uses: owner/repo[/path]@ref`, as a step or a job (a reusable workflow)
# names it, quoted or not, with an optional `# comment` after it.
USES_LINE='^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*["'"'"']?([^"'"'"'[:space:]#]+)["'"'"']?[[:space:]]*(#[[:space:]]*(.*))?$'
FULL_SHA='^[0-9a-f]{40}$'

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

FILES=()
while IFS= read -r file; do
	FILES+=("$file")
done < <(
	cd "$ROOT" &&
		find .github/workflows .github/actions \
			-type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null |
		sed 's#^\./##' |
		LC_ALL=C sort
)

# Every remote action ref, as <file>:<line> TAB <target> TAB <comment>.
USES_FILE="${WORK_DIR}/uses"
: >"$USES_FILE"
for file in "${FILES[@]}"; do
	line_number=0
	while IFS= read -r line || [[ -n "$line" ]]; do
		line_number=$(( line_number + 1 ))
		[[ "$line" =~ $USES_LINE ]] || continue
		target="${BASH_REMATCH[2]}"
		comment="${BASH_REMATCH[4]:-}"
		comment="${comment%"${comment##*[![:space:]]}"}"
		case "$target" in
			./*|docker://*) continue ;;
		esac
		printf '%s:%s\t%s\t%s\n' "$file" "$line_number" "$target" "$comment" >>"$USES_FILE"
	done <"${ROOT}/${file}"
done

if [[ "$LIST_ONLY" == true ]]; then
	cat "$USES_FILE"
	exit 0
fi

if [[ ! -s "$USES_FILE" ]]; then
	echo "❌ No workflow under ${ROOT}/.github names an action: is --root the repository?" >&2
	exit 1
fi

# <owner>/<repo> of a target: an action may live in a folder of its
# repository (actions/cache/restore), and a reusable workflow under
# .github/workflows of it.
repository_of() {
	local action="${1%@*}"
	local owner="${action%%/*}"
	local rest="${action#*/}"
	echo "${owner}/${rest%%/*}"
}

# Reads <repository>'s tags and branches into <file>, trying again while
# the failure may pass. Returns 1 when it did not read them, and writes why
# to <file>.error.
read_refs() {
	local repository="$1"
	local file="$2"

	local -a delays=()
	read -ra delays <<< "$ACTION_REFS_READ_DELAYS" || true
	local max_attempts=$(( ${#delays[@]} + 1 ))
	local attempt=1

	while true; do
		local status=0
		GIT_TERMINAL_PROMPT=0 git ls-remote --tags --heads "https://github.com/${repository}.git" \
			</dev/null >"$file" 2>"${file}.error" || status=$?
		if (( status == 0 )); then
			return 0
		fi
		if grep -qE "$NOT_A_REPOSITORY" "${file}.error"; then
			echo "GitHub has no public repository ${repository}" >"${file}.error"
			return 1
		fi
		if (( attempt >= max_attempts )); then
			return 1
		fi
		local delay="${delays[attempt - 1]}"
		echo "⚠️  Reading ${repository}'s refs failed on attempt ${attempt}/${max_attempts} (exit ${status}); trying again in ${delay}s" >&2
		sleep "$delay"
		attempt=$(( attempt + 1 ))
	done
}

# The commit <name> names in a refs file: a tag's commit (peeled, for an
# annotated tag), else a branch's head. Prints nothing when it names none.
commit_of() {
	local refs="$1"
	local kind="$2"
	local name="$3"
	local peeled tagged
	if [[ "$kind" == tag ]]; then
		peeled="$(awk -v ref="refs/tags/${name}^{}" '$2 == ref { print $1; exit }' "$refs")"
		tagged="$(awk -v ref="refs/tags/${name}" '$2 == ref { print $1; exit }' "$refs")"
		echo "${peeled:-$tagged}"
	else
		awk -v ref="refs/heads/${name}" '$2 == ref { print $1; exit }' "$refs"
	fi
}

# Up to three of the newest tags that start with <name>., for a hint: what
# a major (v4) should have been.
tags_under() {
	local refs="$1"
	local name="$2"
	awk -v prefix="refs/tags/${name}." 'index($2, prefix) == 1 && $2 !~ /\^\{\}$/ { sub("refs/tags/", "", $2); print $2 }' "$refs" |
		sort -V |
		tail -n 3 |
		paste -sd ' ' -
}

declare -A REFS_OF=()
declare -A UNREAD=()
FAILED=()
CHECKED=0

while IFS=$'\t' read -r place target comment; do
	CHECKED=$(( CHECKED + 1 ))
	if [[ "$target" != *@* ]]; then
		FAILED+=("${place}: uses: ${target} — names no ref: '${target}@<tag>'")
		continue
	fi
	repository="$(repository_of "$target")"
	ref="${target##*@}"

	if [[ -z "${REFS_OF[$repository]+set}" ]]; then
		refs_file="${WORK_DIR}/refs.${#REFS_OF[@]}"
		REFS_OF[$repository]="$refs_file"
		if ! read_refs "$repository" "$refs_file"; then
			UNREAD[$repository]="$(tail -n 1 "${refs_file}.error")"
			echo "❌ Could not read ${repository}'s refs: ${UNREAD[$repository]}" >&2
		fi
	fi
	refs_file="${REFS_OF[$repository]}"

	if [[ -n "${UNREAD[$repository]+set}" ]]; then
		FAILED+=("${place}: uses: ${target} — could not read ${repository}'s refs: ${UNREAD[$repository]}")
		continue
	fi

	if [[ "$ref" =~ $FULL_SHA ]]; then
		tag="${comment%%[[:space:]]*}"
		if [[ -z "$tag" ]]; then
			FAILED+=("${place}: uses: ${target} — a commit pin says which release it is: '@${ref} # <tag>'")
			continue
		fi
		tag_commit="$(commit_of "$refs_file" tag "$tag")"
		if [[ -z "$tag_commit" ]]; then
			FAILED+=("${place}: uses: ${target} # ${comment} — ${repository} has no tag '${tag}'")
		elif [[ "$tag_commit" != "$ref" ]]; then
			FAILED+=("${place}: uses: ${target} # ${comment} — ${repository}'s ${tag} is ${tag_commit}, not ${ref}")
		fi
		continue
	fi

	if [[ -n "$(commit_of "$refs_file" tag "$ref")" || -n "$(commit_of "$refs_file" branch "$ref")" ]]; then
		continue
	fi
	hint=""
	newest="$(tags_under "$refs_file" "$ref")"
	if [[ -n "$newest" ]]; then
		hint=" (its newest ${ref}.* tags: ${newest})"
	fi
	FAILED+=("${place}: uses: ${target} — ${repository} has no tag or branch '${ref}'${hint}")
done <"$USES_FILE"

if (( ${#FAILED[@]} > 0 )); then
	echo "❌ ${#FAILED[@]} of ${CHECKED} action refs name nothing on GitHub; a job that uses one fails at 'Set up job':" >&2
	printf '  %s\n' "${FAILED[@]}" >&2
	exit 1
fi

echo "✅ All ${CHECKED} action refs in ${#FILES[@]} files resolve (${#REFS_OF[@]} repositories)"
