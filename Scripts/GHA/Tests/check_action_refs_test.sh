#!/usr/bin/env bash

# End-to-end tests for Scripts/GHA/check_action_refs.sh, driven by a fake git
# on PATH whose `ls-remote` answers from files, so nothing here talks to
# GitHub.
#
# What matters: every `uses:` of a workflow or composite action is read (and
# nothing that only looks like one); a ref passes only as a tag or a branch
# its repository has, or as a commit pinned with the tag that is that commit;
# each failure names the file, the line and why, all of them in one run; each
# repository is read once; a read that fails for a moment is tried again, and
# a repository GitHub does not have fails at once.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/check_action_refs_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_REFS="${SCRIPT_DIR}/../check_action_refs.sh"

export ACTION_REFS_READ_DELAYS="0 0"

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

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' found"
	fi
}

count_matches() {
	local file="$1" pattern="$2"
	if [[ ! -f "$file" ]]; then
		echo 0
		return
	fi
	grep -c -- "$pattern" "$file" || true
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Commits, as GitHub would name them.
C_CHECKOUT_V4="1111111111111111111111111111111111111111"
C_CACHE_V4="2222222222222222222222222222222222222222"
C_FREE_DISK_MAIN="3333333333333333333333333333333333333333"
C_DEVSTACK_V019="4444444444444444444444444444444444444444"
C_COSIGN_V413="756fe2d284c7292c4e9b62c8a28f1e5629c59532"
C_COSIGN_V413_TAG_OBJECT="5555555555555555555555555555555555555555"
C_COSIGN_V412="6f9f17788090df1f26f669e9d70d6ae9567deba6"
C_REUSABLE_V1="7777777777777777777777777777777777777777"
C_OTHER="8888888888888888888888888888888888888888"

FAKE_REFS_DIR="${WORK_DIR}/refs"
mkdir -p "$FAKE_REFS_DIR"
export FAKE_REFS_DIR

# What `git ls-remote --tags --heads` prints for each repository, as
# <owner>__<repo>. cosign-installer's v4.1.3 is an annotated tag: its first
# line is the tag object, its ^{} line the commit.
printf '%s\trefs/heads/main\n%s\trefs/tags/v4\n%s\trefs/tags/v4.2.2\n' \
	"$C_OTHER" "$C_CHECKOUT_V4" "$C_CHECKOUT_V4" >"${FAKE_REFS_DIR}/actions__checkout"
printf '%s\trefs/heads/main\n%s\trefs/tags/v4\n' \
	"$C_OTHER" "$C_CACHE_V4" >"${FAKE_REFS_DIR}/actions__cache"
printf '%s\trefs/heads/main\n' "$C_FREE_DISK_MAIN" >"${FAKE_REFS_DIR}/jlumbroso__free-disk-space"
printf '%s\trefs/heads/main\n%s\trefs/tags/v0.19\n' \
	"$C_OTHER" "$C_DEVSTACK_V019" >"${FAKE_REFS_DIR}/gophercloud__devstack-action"
printf '%s\trefs/heads/main\n%s\trefs/tags/v3.9.2\n%s\trefs/tags/v4.0.0\n%s\trefs/tags/v4.1.0\n%s\trefs/tags/v4.10.0\n%s\trefs/tags/v4.2.0\n%s\trefs/tags/v4.1.2\n%s\trefs/tags/v4.1.3\n%s\trefs/tags/v4.1.3^{}\n' \
	"$C_OTHER" "$C_OTHER" "$C_OTHER" "$C_OTHER" "$C_OTHER" "$C_OTHER" "$C_COSIGN_V412" \
	"$C_COSIGN_V413_TAG_OBJECT" "$C_COSIGN_V413" >"${FAKE_REFS_DIR}/sigstore__cosign-installer"
printf '%s\trefs/tags/v1\n' "$C_REUSABLE_V1" >"${FAKE_REFS_DIR}/someorg__shared-workflows"

# A fake git that answers `ls-remote --tags --heads https://github.com/<owner>/<repo>.git`
# from FAKE_REFS_DIR and logs every call. A repository without a refs file
# is one GitHub does not have, which it answers with a sign-in prompt that
# terminal prompts are off for. FAKE_GIT_FLAKY=<owner>/<repo>:<n> fails that
# repository's first <n> reads with a 503.
setup_fakes() {
	local bin_dir="${WORK_DIR}/bin"
	mkdir -p "$bin_dir"

	cat > "${bin_dir}/git" <<'FAKE_EOF'
#!/usr/bin/env bash
echo "$*" >> "${FAKE_GIT_LOG}"
if [[ "$1 $2 $3" != "ls-remote --tags --heads" ]]; then
	echo "fake git: unexpected call: $*" >&2
	exit 2
fi
if [[ "${GIT_TERMINAL_PROMPT:-}" != "0" ]]; then
	echo "fake git: called with terminal prompts on" >&2
	exit 2
fi
url="$4"
repository="${url#https://github.com/}"
repository="${repository%.git}"
if [[ -n "${FAKE_GIT_FLAKY:-}" && "${FAKE_GIT_FLAKY%:*}" == "$repository" ]]; then
	counter="${FAKE_REFS_DIR}/.flaky-${repository//\//__}"
	seen="$(cat "$counter" 2>/dev/null || echo 0)"
	echo $(( seen + 1 )) > "$counter"
	if (( seen < ${FAKE_GIT_FLAKY##*:} )); then
		echo "fatal: unable to access '${url}/': The requested URL returned error: 503" >&2
		exit 128
	fi
fi
file="${FAKE_REFS_DIR}/${repository//\//__}"
if [[ ! -f "$file" ]]; then
	echo "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2
	exit 128
fi
cat "$file"
FAKE_EOF

	chmod +x "${bin_dir}/git"
	export PATH="${bin_dir}:${PATH}"
}

setup_fakes

# A repository of <name> under WORK_DIR with an empty .github/workflows.
new_repo() {
	local root="${WORK_DIR}/$1"
	mkdir -p "${root}/.github/workflows" "${root}/.github/actions"
	echo "$root"
}

run_check() {
	export FAKE_GIT_LOG="${WORK_DIR}/git-$1.log"
	: > "$FAKE_GIT_LOG"
	rm -f "${FAKE_REFS_DIR}"/.flaky-*
	shift
	bash "$CHECK_REFS" "$@" > "${WORK_DIR}/out.log" 2>&1
	echo $? > "${WORK_DIR}/status"
}

GOOD="$(new_repo good)"
cat > "${GOOD}/.github/workflows/build.yml" <<'EOF'
name: Build
on: [push]
jobs:
  reusable:
    uses: someorg/shared-workflows/.github/workflows/ci.yml@v1
  local-reusable:
    uses: ./.github/workflows/common-jobs.yaml
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Cache
        uses: actions/cache/restore@v4
      -   uses: "actions/cache/save@v4"
      - uses: './.github/actions/free-disk-space'
      - uses: docker://alpine:3.20
      # uses: nobody/commented-out@v0
      - run: |
          echo "uses: nobody/in-a-script@v0"
      - name: Install cosign
        uses: sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532 # v4.1.3
      - uses: 'sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6'   #   v4.1.2   (cosign v3.0.6)
EOF
cat > "${GOOD}/.github/workflows/e2e.yaml" <<'EOF'
jobs:
  e2e:
    steps:
      - uses: actions/checkout@v4
      - uses: gophercloud/devstack-action@4444444444444444444444444444444444444444 # v0.19
EOF
mkdir -p "${GOOD}/.github/actions/free-disk-space"
cat > "${GOOD}/.github/actions/free-disk-space/action.yml" <<'EOF'
runs:
  using: composite
  steps:
    - uses: jlumbroso/free-disk-space@main
EOF
echo "not yaml, never read" > "${GOOD}/.github/workflows/README.md"

echo "── every kind of ref that resolves ──"
run_check good --root "$GOOD"
assert_eq "0" "$(cat "${WORK_DIR}/status")" "passes"
assert_contains "$(cat "${WORK_DIR}/out.log")" "All 9 action refs in 3 files resolve (6 repositories)" "counts every remote ref, the files and the repositories"
assert_eq "6" "$(count_matches "$FAKE_GIT_LOG" '^ls-remote --tags --heads https://github.com/')" "reads each repository once"
assert_eq "1" "$(count_matches "$FAKE_GIT_LOG" 'https://github.com/actions/cache.git$')" "reads a repository two of its actions live in once"
assert_eq "1" "$(count_matches "$FAKE_GIT_LOG" 'https://github.com/someorg/shared-workflows.git$')" "reads a reusable workflow's repository"
assert_eq "0" "$(count_matches "$FAKE_GIT_LOG" 'nobody')" "reads no repository a comment or a script names"

echo "── what it reads ──"
run_check list --root "$GOOD" --list
assert_eq "0" "$(cat "${WORK_DIR}/status")" "lists"
LIST="$(cat "${WORK_DIR}/out.log")"
EXPECTED_LIST="$(printf '%s\n' \
	".github/actions/free-disk-space/action.yml:4	jlumbroso/free-disk-space@main	" \
	".github/workflows/build.yml:5	someorg/shared-workflows/.github/workflows/ci.yml@v1	" \
	".github/workflows/build.yml:11	actions/checkout@v4	" \
	".github/workflows/build.yml:13	actions/cache/restore@v4	" \
	".github/workflows/build.yml:14	actions/cache/save@v4	" \
	".github/workflows/build.yml:21	sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532	v4.1.3" \
	".github/workflows/build.yml:22	sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6	v4.1.2   (cosign v3.0.6)" \
	".github/workflows/e2e.yaml:4	actions/checkout@v4	" \
	".github/workflows/e2e.yaml:5	gophercloud/devstack-action@4444444444444444444444444444444444444444	v0.19")"
assert_eq "$EXPECTED_LIST" "$LIST" "lists each remote ref with its file, line and comment, local and docker:// ones left out"
assert_eq "0" "$(count_matches "$FAKE_GIT_LOG" 'ls-remote')" "--list reads no repository"

BAD="$(new_repo bad)"
cat > "${BAD}/.github/workflows/release.yml" <<'EOF'
jobs:
  sign-images:
    steps:
      - uses: actions/checkout@v4
      - name: Install cosign
        uses: sigstore/cosign-installer@v4
EOF
cat > "${BAD}/.github/workflows/pins.yml" <<'EOF'
jobs:
  pins:
    steps:
      - uses: sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532
      - uses: sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4.1.3
      - uses: sigstore/cosign-installer@5555555555555555555555555555555555555555 # v4.1.3
      - uses: sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532 # v9.9.9
      - uses: actions/checkout@v3
      - uses: actions/checkout
EOF

echo "── refs that name nothing ──"
run_check bad --root "$BAD"
assert_eq "1" "$(cat "${WORK_DIR}/status")" "fails"
OUT="$(cat "${WORK_DIR}/out.log")"
assert_contains "$OUT" "7 of 8 action refs name nothing on GitHub" "says how many of how many, in one run"
assert_contains "$OUT" ".github/workflows/release.yml:6: uses: sigstore/cosign-installer@v4 — sigstore/cosign-installer has no tag or branch 'v4' (its newest v4.* tags: v4.1.3 v4.2.0 v4.10.0)" "names a major tag the repository never published, with its newest tags under it in version order"
assert_contains "$OUT" ".github/workflows/pins.yml:4: uses: sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532 — a commit pin says which release it is: '@756fe2d284c7292c4e9b62c8a28f1e5629c59532 # <tag>'" "refuses a commit pin that does not say which release it is"
assert_contains "$OUT" ".github/workflows/pins.yml:5: uses: sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4.1.3 — sigstore/cosign-installer's v4.1.3 is 756fe2d284c7292c4e9b62c8a28f1e5629c59532, not 6f9f17788090df1f26f669e9d70d6ae9567deba6" "refuses a commit pin that is another release than its comment says"
assert_contains "$OUT" ".github/workflows/pins.yml:6: uses: sigstore/cosign-installer@5555555555555555555555555555555555555555 # v4.1.3 — sigstore/cosign-installer's v4.1.3 is 756fe2d284c7292c4e9b62c8a28f1e5629c59532" "refuses an annotated tag's object: a pin is the commit the tag peels to"
assert_contains "$OUT" ".github/workflows/pins.yml:7: uses: sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532 # v9.9.9 — sigstore/cosign-installer has no tag 'v9.9.9'" "refuses a commit pin whose comment names a tag that does not exist"
assert_contains "$OUT" ".github/workflows/pins.yml:8: uses: actions/checkout@v3 — actions/checkout has no tag or branch 'v3'" "refuses a tag the repository does not have"
assert_not_contains "$OUT" "its newest v3.* tags" "and gives no hint when it has no tag under it"
assert_contains "$OUT" ".github/workflows/pins.yml:9: uses: actions/checkout — names no ref: 'actions/checkout@<tag>'" "refuses an action without a ref"
assert_not_contains "$OUT" "release.yml:4" "passes the good ref beside them"
assert_eq "2" "$(count_matches "$FAKE_GIT_LOG" 'ls-remote')" "still reads each repository once"

UNKNOWN="$(new_repo unknown)"
cat > "${UNKNOWN}/.github/workflows/a.yml" <<'EOF'
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - uses: nobody-here/no-such-action@v1
      - uses: nobody-here/no-such-action@v2
EOF

echo "── a repository GitHub does not have ──"
run_check unknown --root "$UNKNOWN"
assert_eq "1" "$(cat "${WORK_DIR}/status")" "fails"
OUT="$(cat "${WORK_DIR}/out.log")"
assert_contains "$OUT" ".github/workflows/a.yml:5: uses: nobody-here/no-such-action@v1 — could not read nobody-here/no-such-action's refs: GitHub has no public repository nobody-here/no-such-action" "names each ref of it, and why"
assert_contains "$OUT" ".github/workflows/a.yml:6: uses: nobody-here/no-such-action@v2 — could not read" "for every line that names it"
assert_eq "1" "$(count_matches "$FAKE_GIT_LOG" 'nobody-here/no-such-action.git$')" "asks once: another read cannot make it exist"
assert_not_contains "$OUT" "trying again" "and never waits to try again"

echo "── a read that fails for a moment ──"
FAKE_GIT_FLAKY="actions/checkout:2" run_check flaky --root "$GOOD"
assert_eq "0" "$(cat "${WORK_DIR}/status")" "passes once a read gets through"
assert_eq "3" "$(count_matches "$FAKE_GIT_LOG" 'actions/checkout.git$')" "trying again after each failure"
assert_contains "$(cat "${WORK_DIR}/out.log")" "Reading actions/checkout's refs failed on attempt 1/3 (exit 128); trying again in 0s" "says it is trying again"

echo "── a read that keeps failing ──"
FAKE_GIT_FLAKY="actions/checkout:9" run_check down --root "$GOOD"
assert_eq "1" "$(cat "${WORK_DIR}/status")" "fails after the last attempt"
assert_eq "3" "$(count_matches "$FAKE_GIT_LOG" 'actions/checkout.git$')" "three attempts, as ACTION_REFS_READ_DELAYS sets"
OUT="$(cat "${WORK_DIR}/out.log")"
assert_contains "$OUT" "could not read actions/checkout's refs: fatal: unable to access 'https://github.com/actions/checkout.git/': The requested URL returned error: 503" "names the refs it could not read, with git's own words"
assert_contains "$OUT" "2 of 9 action refs name nothing" "for both lines that name it, and only them"

EMPTY="$(new_repo empty)"
cat > "${EMPTY}/.github/workflows/only-local.yml" <<'EOF'
jobs:
  a:
    uses: ./.github/workflows/common-jobs.yaml
EOF

echo "── nothing to check ──"
run_check empty --root "$EMPTY"
assert_eq "1" "$(cat "${WORK_DIR}/status")" "fails when no workflow names an action: the root is not this repository"
assert_contains "$(cat "${WORK_DIR}/out.log")" "is --root the repository?" "and says so"
run_check no-github --root "$WORK_DIR/bin"
assert_eq "2" "$(cat "${WORK_DIR}/status")" "refuses a root with no .github"
run_check bad-flag --nope
assert_eq "2" "$(cat "${WORK_DIR}/status")" "refuses a flag it does not know"
run_check no-root-value --root
assert_eq "2" "$(cat "${WORK_DIR}/status")" "refuses --root without a directory"

echo ""
echo "check_action_refs: ${PASS} passed, ${FAIL} failed"
(( FAIL == 0 ))
