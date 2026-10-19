#!/usr/bin/env bash
#
# Installs the OneUptime infrastructure agent with the Homebrew command of the
# Server / VM Monitor docs page, as written; checks the version installed,
# that Gatekeeper's quarantine is off the program and that the program runs;
# then uninstalls it. Everything brew prints while it reads the cask is kept,
# and anything it calls deprecated or disabled fails the check: brew prints
# that warning in every command that reads the cask, and asks people to report
# it to the tap (see homebrew_casks in agents/InfrastructureAgent/.goreleaser.yaml).
#
# Usage: InstallFromHomebrew.sh <version>
#
# The "Infrastructure Agent Release Status" workflow runs it on macOS once
# ReleaseStatus.sh finds the version in the tap. It changes the Mac it runs on
# (brew update, and brew uninstall removes dependencies nothing else needs),
# so run it on a CI runner or a throwaway machine.
#
# Prints a Markdown table, to $GITHUB_STEP_SUMMARY as well when that is set,
# and exits 1 when a check failed. Needs brew.

set -euo pipefail

readonly CASK="oneuptime-infrastructure-agent"
readonly TAPPED="oneuptime/tap/$CASK"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCS_PAGE="$REPO_ROOT/packages/App/FeatureSet/Docs/Content/en/monitor/server-monitor.md"

fail() {
	echo "InstallFromHomebrew: $*" >&2
	exit 2
}

VERSION="${1:-}"
[[ -n "$VERSION" ]] || fail "usage: InstallFromHomebrew.sh <version>"
command -v brew >/dev/null || fail "needs brew"

# The docs' command, which is what runs below.
documented="$(grep -m 1 -E '^brew install ' "$DOCS_PAGE" || true)"
[[ "$documented" == "brew install $TAPPED" ]] ||
	fail "the docs page says '$documented', not 'brew install $TAPPED'"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
LOG="$WORK/brew.log"
: >"$LOG"

ROWS=()
FAILED=0
check() {
	if [[ "$2" == "pass" ]]; then
		ROWS+=("| $1 | ✅ $3 |")
	else
		ROWS+=("| $1 | ❌ $3 |")
		FAILED=$((FAILED + 1))
		if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
			echo "::error title=Homebrew: $1::$3"
		fi
	fi
}

# brew <arguments>: runs brew, keeping what it prints in the log.
brew_logged() {
	echo "\$ brew $*" | tee -a "$LOG"
	brew "$@" 2>&1 | tee -a "$LOG"
}

brew update --quiet

if ! brew_logged install "$TAPPED"; then
	check "brew install $TAPPED" fail "failed: see the log"
else
	installed="$(brew list --cask --versions "$CASK" 2>/dev/null || true)"
	if [[ "$installed" == "$CASK $VERSION" ]]; then
		check "Version" pass "$VERSION"
	else
		check "Version" fail "brew installed '${installed:-nothing}', not $VERSION"
	fi

	program="$(brew --prefix)/bin/$CASK"
	if [[ ! -x "$program" ]]; then
		check "Program" fail "$program is missing"
	else
		binary="$(readlink -f "$program")"
		if command -v xattr >/dev/null && xattr -p com.apple.quarantine "$binary" >/dev/null 2>&1; then
			check "Quarantine" fail "$binary is quarantined: Gatekeeper refuses to run it"
		else
			check "Quarantine" pass "off the program"
		fi
		if "$program" help >/dev/null 2>&1; then
			check "Program" pass "runs"
		else
			check "Program" fail "$program help failed"
		fi
	fi

	brew_logged info --cask "$TAPPED" >/dev/null || true
	brew_logged uninstall --cask "$CASK" >/dev/null || check "brew uninstall" fail "failed: see the log"
fi

# One line per warning. In a GitHub Actions job brew writes its warnings as
# workflow commands, "::warning::<message>%0A<more lines>": keep the message's
# first line, without the command.
warnings="$(grep -iE 'deprecat|disabled!' "$LOG" |
	sed -E 's/^::(warning|error|notice)[^:]*:://; s/%0A.*$//' | sort -u || true)"
if [[ -z "$warnings" ]]; then
	check "Warnings" pass "brew called nothing in the cask deprecated"
else
	check "Warnings" fail "$(paste -sd ' ' - <<<"$warnings" | sed 's/|/\\|/g')"
fi

{
	echo "### Homebrew on macOS $(uname -m), as the docs say"
	echo
	echo "| Check | Result |"
	echo "| --- | --- |"
	printf '%s\n' "${ROWS[@]}"
} >"$WORK/summary.md"

cat "$WORK/summary.md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
	cat "$WORK/summary.md" >>"$GITHUB_STEP_SUMMARY"
fi

if ((FAILED > 0)); then
	exit 1
fi
