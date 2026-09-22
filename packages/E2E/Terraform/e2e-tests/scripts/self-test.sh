#!/bin/bash
#
# Self-tests for the E2E harness itself — the plumbing that decides *which*
# engine the suite drives, not the provider behaviour the suite asserts.
#
# These are hermetic and fast (no network, no Docker, no OneUptime stack, no
# real terraform/tofu binary): engine dispatch is exercised against fake
# binaries on PATH, and the rest are static contract checks over the fixtures
# and the workflow. CI runs this before the expensive bring-up so a broken
# harness fails in seconds instead of after a stack boot.
#
#   ./scripts/self-test.sh
#
# Exit code is the number of failed checks (0 = all passed).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$TEST_DIR/../../../.." && pwd)"
LIB="$SCRIPT_DIR/lib.sh"
RUNNER="$SCRIPT_DIR/run-tests.sh"
CLEANUP="$SCRIPT_DIR/cleanup.sh"
INDEX="$SCRIPT_DIR/index.sh"
WORKFLOW="$REPO_ROOT/.github/workflows/terraform-provider-e2e.yml"

PASSED=0
FAILED=0

pass() {
    PASSED=$((PASSED + 1))
    printf '  \xe2\x9c\x93 %s\n' "$1"
}

fail() {
    FAILED=$((FAILED + 1))
    printf '  \xe2\x9c\x97 %s\n      %s\n' "$1" "$2"
}

assert_eq() { # expected actual description
    if [ "$1" = "$2" ]; then
        pass "$3"
    else
        fail "$3" "expected '$1', got '$2'"
    fi
}

assert_contains() { # haystack needle description
    if printf '%s' "$1" | grep -qF -- "$2"; then
        pass "$3"
    else
        fail "$3" "expected output to contain '$2', got '$1'"
    fi
}

assert_file_matches() { # file regex description
    if grep -Eq -- "$2" "$1"; then
        pass "$3"
    else
        fail "$3" "no line in $(basename "$1") matched /$2/"
    fi
}

assert_file_not_matches() { # file regex description
    if grep -Eq -- "$2" "$1"; then
        fail "$3" "$(basename "$1") unexpectedly matched /$2/: $(grep -En -- "$2" "$1" | head -3)"
    else
        pass "$3"
    fi
}

group() {
    printf '\n%s\n' "$1"
}

# Line number of the first non-comment line in <file> matching <regex> (ERE),
# or 0 when there is none — for checks on the order of workflow steps.
first_line() { # file regex
    local n
    n="$(grep -nE -- "$2" "$1" | grep -vE '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1)"
    echo "${n:-0}"
}

# Prints each workflow step (from its `- name:` line up to the next step,
# comments dropped) that has a line matching <regex> (ERE), so a check can look
# at one step instead of the whole file.
workflow_steps_with() { # regex
    STEP_RE="$1" awk '
        function flush() {
            if (in_step && hit) printf "%s", block
            block = ""
            hit = 0
        }
        /^[[:space:]]*#/ { next }
        {
            match($0, /^ */)
            if ($0 !~ /^[[:space:]]*$/ && RLENGTH < 6) { flush(); in_step = 0 }
        }
        /^      - / { flush(); in_step = 1 }
        {
            block = block $0 "\n"
            if ($0 ~ ENVIRON["STEP_RE"]) hit = 1
        }
        END { flush() }
    ' "$WORKFLOW"
}

# The value of a `key: value` line in a step printed by workflow_steps_with.
step_value() { # step-text key
    printf '%s\n' "$1" | sed -nE "s/^[[:space:]]+$2:[[:space:]]*//p" | head -1
}

#######################################
# Fake engines
#
# Each one echoes its identity and the arguments it received, so a test can
# assert both *which* binary ran and that arguments were forwarded intact.
#######################################

FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

printf '#!/bin/bash\necho "TERRAFORM $*"\n' > "$FAKE_BIN/terraform"
printf '#!/bin/bash\necho "TOFU $*"\n' > "$FAKE_BIN/tofu"
chmod +x "$FAKE_BIN/terraform" "$FAKE_BIN/tofu"
export PATH="$FAKE_BIN:$PATH"

# Run a snippet in a fresh bash with lib.sh sourced. A fresh process each time
# matters: an exported TF_CLI or `terraform` function leaking between cases
# would make these tests pass for the wrong reason.
in_engine() { # engine ("" = unset) , snippet
    local engine="$1"
    local snippet="$2"
    if [ -z "$engine" ]; then
        env -u TF_CLI bash -c "source '$LIB'; $snippet" 2>&1
    else
        env TF_CLI="$engine" bash -c "source '$LIB'; $snippet" 2>&1
    fi
}

#######################################
group "Engine dispatch"
#######################################

assert_eq "TERRAFORM plan" "$(in_engine "" 'terraform plan')" \
    "TF_CLI unset defaults to terraform (unchanged legacy behaviour)"

assert_eq "TERRAFORM plan" "$(in_engine terraform 'terraform plan')" \
    "TF_CLI=terraform dispatches to the terraform binary"

assert_eq "TOFU plan" "$(in_engine tofu 'terraform plan')" \
    "TF_CLI=tofu dispatches a 'terraform' call to the tofu binary"

assert_eq "TOFU output -raw monitor_id" \
    "$(in_engine tofu 'terraform output -raw monitor_id')" \
    "arguments are forwarded through the dispatch function unchanged"

# `command` inside the function is what stops `terraform` recursing into
# itself when TF_CLI is literally "terraform". Losing it hangs the whole suite.
assert_eq "TERRAFORM version" "$(in_engine terraform 'terraform version')" \
    "TF_CLI=terraform does not recurse into the shell function"

# Note: a test that sets TF_CLI via the environment cannot tell whether lib.sh
# exports it — the environment already carries it. The meaningful case is the
# defaulted one, covered in the next group.

#######################################
group "Dispatch reaches spawned verify.sh scripts"
#######################################

# The runner spawns each verify.sh as its own bash process. 19 of the 69
# checked-in verify scripts do not source lib.sh, so they can only inherit the
# dispatch through `export -f` — this is the mechanism that makes the fixtures
# engine-agnostic, and it is worth pinning.
CHILD_DIR="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$CHILD_DIR"' EXIT

printf '#!/bin/bash\nset -e\nterraform output -raw thing\n' > "$CHILD_DIR/no-lib.sh"
printf '#!/bin/bash\nset -e\nsource "%s"\nget_output thing\n' "$LIB" > "$CHILD_DIR/with-lib.sh"
chmod +x "$CHILD_DIR/no-lib.sh" "$CHILD_DIR/with-lib.sh"

assert_eq "TOFU output -raw thing" "$(in_engine tofu "'$CHILD_DIR/no-lib.sh'")" \
    "a verify.sh that does NOT source lib.sh still reaches the selected engine"

assert_eq "TERRAFORM output -raw thing" "$(in_engine terraform "'$CHILD_DIR/no-lib.sh'")" \
    "the same script reaches terraform when that is selected"

assert_eq "TOFU output -raw thing" "$(in_engine tofu "'$CHILD_DIR/with-lib.sh'")" \
    "lib.sh's get_output helper routes through the selected engine"

# The defaulted case, and the reason lib.sh must `export TF_CLI` rather than
# only defaulting it. With TF_CLI unset, `: "${TF_CLI:=terraform}"` creates a
# plain shell variable; a child that inherits the exported dispatch function but
# not the variable runs `command "" ...` and dies with "command not found".
# That breaks the *default* Terraform-only path, so it must stay covered.
assert_eq "TERRAFORM output -raw thing" "$(in_engine "" "'$CHILD_DIR/no-lib.sh'")" \
    "with TF_CLI unset, a non-lib.sh child still resolves an engine (TF_CLI is exported)"

#######################################
group "Engine-derived paths"
#######################################

assert_eq "registry.terraform.io" "$(in_engine terraform 'tf_registry_host')" \
    "terraform resolves against registry.terraform.io"

assert_eq "registry.opentofu.org" "$(in_engine tofu 'tf_registry_host')" \
    "tofu resolves against registry.opentofu.org"

assert_eq "registry.terraform.io" "$(in_engine "" 'tf_registry_host')" \
    "registry host falls back to the terraform default when TF_CLI is unset"

assert_contains "$(in_engine tofu 'tf_cli_version')" "TOFU" \
    "the run header reports the selected engine's version"

#######################################
group "CLI config handling"
#######################################

# Regression guard. The harness used to write dev_overrides straight into
# ~/.terraformrc and delete it afterwards, which could destroy a developer's
# own config. It now writes a temp file and points TF_CLI_CONFIG_FILE at it.
assert_file_not_matches "$RUNNER" '^[^#]*>[[:space:]]*"?\$HOME/\.terraformrc' \
    "run-tests.sh never writes to ~/.terraformrc"

assert_file_not_matches "$RUNNER" '^[^#]*>[[:space:]]*"?\$HOME/\.tofurc' \
    "run-tests.sh never writes to ~/.tofurc"

assert_file_matches "$RUNNER" 'export TF_CLI_CONFIG_FILE=' \
    "run-tests.sh points TF_CLI_CONFIG_FILE at its own config (honoured by both engines)"

assert_file_matches "$RUNNER" 'dev_overrides' \
    "run-tests.sh still installs the provider via dev_overrides"

# restore_terraformrc restores a backup from a pre-change run...
HOME_DIR="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$CHILD_DIR" "$HOME_DIR"' EXIT
printf 'ORIGINAL\n' > "$HOME_DIR/.terraformrc.oneuptime-e2e-backup"
env HOME="$HOME_DIR" bash -c "source '$LIB'; restore_terraformrc" > /dev/null 2>&1
assert_eq "ORIGINAL" "$(cat "$HOME_DIR/.terraformrc" 2>/dev/null)" \
    "restore_terraformrc restores a backup left by a pre-change run"

# ...and must never delete a config it did not create. Before the change this
# branch removed any ~/.terraformrc mentioning oneuptime/oneuptime, which would
# now hit a developer's own dev_overrides.
rm -f "$HOME_DIR/.terraformrc.oneuptime-e2e-backup"
printf 'provider_installation { dev_overrides { "oneuptime/oneuptime" = "/my/build" } }\n' \
    > "$HOME_DIR/.terraformrc"
env HOME="$HOME_DIR" bash -c "source '$LIB'; restore_terraformrc" > /dev/null 2>&1
assert_eq "0" "$([ -f "$HOME_DIR/.terraformrc" ] && echo 0 || echo 1)" \
    "restore_terraformrc leaves a developer's own ~/.terraformrc alone"

#######################################
group "Per-engine isolation"
#######################################

assert_file_matches "$RUNNER" 'INSTALL_DIR=.*tf_registry_host' \
    "the provider install path is keyed by engine, so runs cannot read each other's build"

assert_file_matches "$RUNNER" 'RANDOM_PROVIDER_DIR=.*\$TF_CLI' \
    "the random-provider download is per-engine (each resolves against its own registry)"

# The pre-downloaded provider tree must be planted whole. Copying one hard-coded
# registry host's subtree silently produced an empty provider dir under the
# other engine.
assert_file_not_matches "$RUNNER" '^[^#]*cp .*providers/registry\.(terraform\.io|opentofu\.org)' \
    "the runner does not copy a hard-coded registry host's provider subtree"

assert_file_matches "$CLEANUP" 'registry\.opentofu\.org/oneuptime' \
    "cleanup.sh removes the OpenTofu provider install"

assert_file_matches "$CLEANUP" 'registry\.terraform\.io/oneuptime' \
    "cleanup.sh removes the Terraform provider install"

assert_file_matches "$INDEX" 'TF_CLI=tofu' \
    "index.sh runs the OpenTofu pass as well"

#######################################
group "Random provider installation"
#######################################

# run-tests.sh installs hashicorp/random once per engine through
# tf_prepare_random_provider (lib.sh) and plants the result into each test. In
# CI that must come from the pinned mirror in TF_E2E_PROVIDER_MIRROR and never
# from a registry: OpenTofu's registry serves the provider from GitHub's
# release CDN, whose 500/504 bursts beat tofu's own retry three times in two
# weeks. Exercised against a fake engine whose `init` records the CLI config it
# was handed and leaves behind what a real init would, so these checks see
# exactly what the real engine is told.
assert_file_matches "$RUNNER" '^[^#]*tf_prepare_random_provider "\$RANDOM_PROVIDER_DIR" "\$RANDOM_PROVIDER_VERSION"' \
    "run-tests.sh installs hashicorp/random through tf_prepare_random_provider"

PROVIDER_WORK="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$CHILD_DIR" "$HOME_DIR" "$PROVIDER_WORK"' EXIT

mkdir -p "$PROVIDER_WORK/bin"
cat > "$PROVIDER_WORK/bin/terraform" << 'EOF'
#!/bin/bash
case "$(basename "$0")" in
    tofu) host=registry.opentofu.org ;;
    *) host=registry.terraform.io ;;
esac
echo "$*" >> "$FAKE_ENGINE_LOG"
echo "${TF_CLI_CONFIG_FILE:-<unset>}" > "$FAKE_ENGINE_CONFIG_PATH"
[ -n "${TF_CLI_CONFIG_FILE:-}" ] && cp "$TF_CLI_CONFIG_FILE" "$FAKE_ENGINE_CONFIG"
version="$(sed -n 's/^ *version *= *"\(.*\)"$/\1/p' main.tf)"
mkdir -p ".terraform/providers/$host/hashicorp/random/$version/linux_amd64"
if [ "${FAKE_INIT_NO_LOCK:-0}" != 1 ]; then
    printf 'provider "%s/hashicorp/random" {\n  version     = "%s"\n}\n' "$host" "$version" > .terraform.lock.hcl
fi
# A failing init still leaves a complete-looking result behind, so only its
# exit status can tell the caller it failed.
[ "${FAKE_INIT_FAIL:-0}" = 1 ] && exit 1
exit 0
EOF
cp "$PROVIDER_WORK/bin/terraform" "$PROVIDER_WORK/bin/tofu"
chmod +x "$PROVIDER_WORK/bin/terraform" "$PROVIDER_WORK/bin/tofu"

# A packed-layout mirror holding both engines' zips, as the workflow stages it,
# and one holding only Terraform's.
MIRROR="$PROVIDER_WORK/mirror"
TF_ONLY_MIRROR="$PROVIDER_WORK/tf-only-mirror"
for host in registry.terraform.io registry.opentofu.org; do
    mkdir -p "$MIRROR/$host/hashicorp/random"
    echo zip > "$MIRROR/$host/hashicorp/random/terraform-provider-random_3.8.0_linux_amd64.zip"
done
mkdir -p "$TF_ONLY_MIRROR/registry.terraform.io/hashicorp/random"
echo zip > "$TF_ONLY_MIRROR/registry.terraform.io/hashicorp/random/terraform-provider-random_3.8.0_linux_amd64.zip"
MIRROR="$(cd "$MIRROR" && pwd)"
MIRROR_EXCLUDE='exclude = ["registry.terraform.io/hashicorp/random", "registry.opentofu.org/hashicorp/random"]'

# prepare_random <engine> <mirror, "" for unset>: runs tf_prepare_random_provider
# in a fresh bash, as run-tests.sh does. Sets PREP_STATUS and PREP_OUTPUT; what
# the engine saw is in $PROVIDER_WORK/engine.*.
prepare_random() {
    rm -rf "$PROVIDER_WORK/out" "$PROVIDER_WORK"/engine.*
    PREP_STATUS=0
    PREP_OUTPUT="$(env -u TF_E2E_PROVIDER_MIRROR ${2:+"TF_E2E_PROVIDER_MIRROR=$2"} TF_CLI="$1" \
        PATH="$PROVIDER_WORK/bin:$PATH" \
        FAKE_ENGINE_LOG="$PROVIDER_WORK/engine.log" \
        FAKE_ENGINE_CONFIG_PATH="$PROVIDER_WORK/engine.config-path" \
        FAKE_ENGINE_CONFIG="$PROVIDER_WORK/engine.tfrc" \
        bash -c "source '$LIB'; tf_prepare_random_provider '$PROVIDER_WORK/out' 3.8.0 linux_amd64" 2>&1)" ||
        PREP_STATUS=$?
}

engine_config() {
    cat "$PROVIDER_WORK/engine.tfrc" 2>/dev/null
}

for engine in terraform tofu; do
    prepare_random "$engine" "$MIRROR"
    if [ "$PREP_STATUS" -eq 0 ]; then
        pass "TF_CLI=${engine} with TF_E2E_PROVIDER_MIRROR set installs hashicorp/random"
    else
        fail "TF_CLI=${engine} with TF_E2E_PROVIDER_MIRROR set installs hashicorp/random" \
            "exit ${PREP_STATUS}: ${PREP_OUTPUT}"
    fi
    assert_contains "$(engine_config)" "path    = \"$MIRROR\"" \
        "TF_CLI=${engine}: init is pointed at the mirror as a filesystem_mirror"
    assert_contains "$(engine_config | sed -n '/^  direct {/,/^  }/p')" "$MIRROR_EXCLUDE" \
        "TF_CLI=${engine}: the registry is excluded for hashicorp/random, so a mirror miss cannot fall back to the network"
done

# The mirror lacks the zip for the engine being run: fail up front, naming the
# file, rather than running init against a config that cannot satisfy it.
prepare_random tofu "$TF_ONLY_MIRROR"
assert_eq "1" "$PREP_STATUS" \
    "a mirror without the running engine's zip fails the install"
assert_contains "$PREP_OUTPUT" "registry.opentofu.org/hashicorp/random/terraform-provider-random_3.8.0_linux_amd64.zip" \
    "...and names the file it expected"
assert_eq "0" "$([ -e "$PROVIDER_WORK/engine.log" ] && echo 1 || echo 0)" \
    "...without ever running the engine"

# run-tests.sh has changed directory before it gets here, so a relative mirror
# path would silently point somewhere else.
prepare_random terraform "relative/mirror"
assert_eq "1" "$PREP_STATUS" \
    "a relative TF_E2E_PROVIDER_MIRROR is refused"
assert_contains "$PREP_OUTPUT" "must be an absolute path" \
    "...saying why"

# Local runs: no mirror, so the engine downloads from its registry as before —
# with an empty harness-owned CLI config, never the developer's own.
prepare_random terraform ""
assert_eq "0" "$PREP_STATUS" \
    "without TF_E2E_PROVIDER_MIRROR, hashicorp/random is still installed"
assert_eq "$PROVIDER_WORK/out/random-provider.tfrc" "$(cat "$PROVIDER_WORK/engine.config-path" 2>/dev/null)" \
    "...with TF_CLI_CONFIG_FILE pointing at the harness's own config"
assert_eq "" "$(engine_config)" \
    "...which is empty, so the engine uses its default registry"

FAKE_INIT_FAIL=1 prepare_random terraform "$MIRROR"
assert_eq "1" "$PREP_STATUS" \
    "a failed init fails the install, even when it left a lock file behind"

FAKE_INIT_NO_LOCK=1 prepare_random terraform "$MIRROR"
assert_eq "1" "$PREP_STATUS" \
    "an init that leaves no lock file fails the install"

#######################################
group "Fixture contract"
#######################################

# `export -f` only crosses into bash children. A verify script with a /bin/sh
# or zsh shebang would silently run the real terraform binary and quietly test
# the wrong engine — a green run that proves nothing.
BAD_SHEBANG=""
while IFS= read -r script; do
    if [ "$(head -1 "$script")" != "#!/bin/bash" ]; then
        BAD_SHEBANG="$BAD_SHEBANG $script"
    fi
done < <(find "$TEST_DIR/tests" -name "verify*.sh")
assert_eq "" "$BAD_SHEBANG" \
    "every verify script is #!/bin/bash (required to inherit the dispatch function)"

# The fixtures being identical across both runs is the compatibility claim. A
# fixture that names a binary tests one engine twice.
HARDCODED="$(grep -rlE '(^|[^a-zA-Z_-])tofu +(init|plan|apply|destroy|output|state|show|import|version)' \
    "$TEST_DIR/tests" 2>/dev/null)"
assert_eq "" "$HARDCODED" \
    "no fixture or verify script invokes 'tofu' directly"

HOSTED_SOURCE="$(grep -rlE '^[[:space:]]*source[[:space:]]*=.*registry\.(terraform\.io|opentofu\.org)' \
    "$TEST_DIR/tests" 2>/dev/null)"
assert_eq "" "$HOSTED_SOURCE" \
    "no fixture pins a provider source to a specific registry host"

#######################################
group "CI workflow contract"
#######################################

if [ ! -f "$WORKFLOW" ]; then
    fail "workflow exists" "$WORKFLOW not found"
else
    # Both engines are installed by hand rather than through
    # hashicorp/setup-terraform / opentofu/setup-opentofu, which download from
    # an external host with no retry and inject a wrapper (below). The release
    # archives stay the first source.
    assert_file_matches "$WORKFLOW" 'releases\.hashicorp\.com/terraform/' \
        "the workflow installs Terraform from its release archive"

    assert_file_matches "$WORKFLOW" 'github\.com/opentofu/opentofu/releases' \
        "the workflow installs OpenTofu from its release archive"

    # The real binaries must land on PATH (not a wrapper). Installing them
    # directly is also what removes the stdout-buffering wrapper the setup
    # actions inject, which used to break command substitution and
    # -detailed-exitcode — so the actions must not be reintroduced.
    assert_file_matches "$WORKFLOW" 'install -m 0755 .*/usr/local/bin/terraform' \
        "the Terraform binary is installed on PATH"

    assert_file_matches "$WORKFLOW" 'install -m 0755 .*/usr/local/bin/tofu' \
        "the OpenTofu binary is installed on PATH"

    assert_file_not_matches "$WORKFLOW" 'uses: *hashicorp/setup-terraform' \
        "the wrapper-injecting Terraform setup action is not used"

    assert_file_not_matches "$WORKFLOW" 'uses: *opentofu/setup-opentofu' \
        "the wrapper-injecting OpenTofu setup action is not used"

    # Retrying the downloads was not enough: GitHub's release CDN answers
    # 500/504 in bursts longer than any per-step retry (on 2026-09-21 it failed
    # "Setup OpenTofu" on master after ~54s of retries). The engines and the
    # random provider now come from the Actions cache, keyed on sha256 pins
    # checked into the workflow, and are only downloaded — by
    # Scripts/GHA/fetch_pinned_artifact.sh, which verifies every copy against
    # its pin — on a cache miss. Each check below is one leg of that.
    FETCH_STEP="$(workflow_steps_with 'fetch_pinned_artifact\.sh')"
    CACHE_RESTORE_STEP="$(workflow_steps_with 'uses: *actions/cache/restore@')"
    CACHE_SAVE_STEP="$(workflow_steps_with 'uses: *actions/cache/save@')"
    CACHE_PATH="$(step_value "$CACHE_RESTORE_STEP" path)"
    CACHE_KEY="$(step_value "$CACHE_RESTORE_STEP" key)"

    if [ -n "$CACHE_PATH" ] && [ -n "$CACHE_KEY" ] && [ -n "$FETCH_STEP" ]; then
        pass "the engines and providers are restored from the Actions cache before any download"
    else
        fail "the engines and providers are restored from the Actions cache before any download" \
            "expected an actions/cache/restore step with a path and key (got path='${CACHE_PATH}', key='${CACHE_KEY}') and a step running fetch_pinned_artifact.sh"
    fi

    for pin in TERRAFORM_SHA256 TOFU_SHA256 \
        RANDOM_PROVIDER_TERRAFORM_REGISTRY_SHA256 RANDOM_PROVIDER_OPENTOFU_REGISTRY_SHA256; do
        if ! grep -Eq "^ +${pin}: \"?[0-9a-f]{64}\"?$" "$WORKFLOW"; then
            fail "$pin is pinned and enforced" "no '${pin}: <64 hex chars>' line in the job env"
        elif ! printf '%s' "$FETCH_STEP" | grep -qF -- "--sha256 \"\$${pin}\""; then
            fail "$pin is pinned and enforced" "the fetch_pinned_artifact.sh step never passes --sha256 \"\$${pin}\""
        elif ! printf '%s' "$CACHE_KEY" | grep -qF -- "env.${pin}"; then
            fail "$pin is pinned and enforced" "the cache key '${CACHE_KEY}' does not include env.${pin}, so a new pin would restore the old file"
        else
            pass "$pin is pinned in the job env, keys the cache, and is checked by fetch_pinned_artifact.sh"
        fi
    done

    # A hand-rolled download next to the pinned one would reintroduce exactly
    # the per-run CDN dependency (and the unverified binary) this replaced.
    assert_file_not_matches "$WORKFLOW" '^[^#]*(curl|wget)[^#]*(releases\.hashicorp\.com|github\.com/[^ ]*/releases|packages\.opentofu\.org)' \
        "no engine or provider is downloaded outside fetch_pinned_artifact.sh"

    # On a miss the engines have a second source that is not a GitHub release
    # asset, so a CDN outage alone cannot fail a cold run.
    assert_contains "$FETCH_STEP" 'deb:./usr/bin/tofu "https://packages.opentofu.org/' \
        "OpenTofu falls back to its own package repository, off GitHub's release CDN"

    assert_contains "$FETCH_STEP" 'deb:./usr/bin/terraform "https://apt.releases.hashicorp.com/' \
        "Terraform falls back to HashiCorp's apt repository"

    assert_eq "$CACHE_PATH" "$(step_value "$FETCH_STEP" PINNED_DIR)" \
        "the fetch step fills the directory the cache restores and saves"

    assert_eq "$CACHE_PATH" "$(step_value "$CACHE_SAVE_STEP" path)" \
        "the cache is saved from the same path it is restored to"

    # Under the key the restore computed, so the two cannot drift apart and
    # leave every run missing the entry the previous one saved.
    CACHE_RESTORE_ID="$(step_value "$CACHE_RESTORE_STEP" id)"
    assert_eq "\${{ steps.${CACHE_RESTORE_ID:-<no id>}.outputs.cache-primary-key }}" \
        "$(step_value "$CACHE_SAVE_STEP" key)" \
        "the cache is saved under the key the restore step computed"

    # Saved straight away on a miss, not by a post step that only runs when the
    # whole job passes — otherwise a red run never fills the cache.
    assert_contains "$CACHE_SAVE_STEP" "cache-hit != 'true'" \
        "the cache is saved as soon as a restore misses"

    RESTORE_AT="$(first_line "$WORKFLOW" 'uses: *actions/cache/restore@')"
    FETCH_AT="$(first_line "$WORKFLOW" 'fetch_pinned_artifact\.sh')"
    SAVE_AT="$(first_line "$WORKFLOW" 'uses: *actions/cache/save@')"
    INSTALL_AT="$(first_line "$WORKFLOW" 'install -m 0755 .*/usr/local/bin/terraform')"
    if [ "$RESTORE_AT" -gt 0 ] && [ "$RESTORE_AT" -lt "$FETCH_AT" ] &&
        [ "$FETCH_AT" -lt "$SAVE_AT" ] && [ "$SAVE_AT" -lt "$INSTALL_AT" ]; then
        pass "restore, verify-or-fetch, save and install run in that order"
    else
        fail "restore, verify-or-fetch, save and install run in that order" \
            "restore@${RESTORE_AT} fetch@${FETCH_AT} save@${SAVE_AT} install@${INSTALL_AT}"
    fi

    # The random provider zips are staged as a packed provider mirror — one per
    # engine's registry host — which both test runs point run-tests.sh at.
    assert_contains "$FETCH_STEP" '${PINNED_DIR}/provider-mirror/registry.terraform.io/hashicorp/random' \
        "Terraform's hashicorp/random is staged in the mirror under registry.terraform.io"

    assert_contains "$FETCH_STEP" '${PINNED_DIR}/provider-mirror/registry.opentofu.org/hashicorp/random' \
        "OpenTofu's hashicorp/random is staged in the mirror under registry.opentofu.org"

    for engine in terraform tofu; do
        assert_eq "${CACHE_PATH}/provider-mirror" \
            "$(step_value "$(workflow_steps_with "^ +TF_CLI: ${engine}\$")" TF_E2E_PROVIDER_MIRROR)" \
            "the TF_CLI=${engine} run is pointed at the cached provider mirror (TF_E2E_PROVIDER_MIRROR)"
    done

    # The version the mirror holds must be the one the runner asks for, or the
    # runner fails before its first test. Caught here in seconds instead.
    WORKFLOW_RANDOM="$(sed -nE 's/^ +RANDOM_PROVIDER_VERSION: *"?([^"]*)"?$/\1/p' "$WORKFLOW")"
    RUNNER_RANDOM="$(sed -nE 's/^RANDOM_PROVIDER_VERSION="([^"]*)"$/\1/p' "$RUNNER")"
    if [ -n "$RUNNER_RANDOM" ] && [ "$WORKFLOW_RANDOM" = "$RUNNER_RANDOM" ]; then
        pass "the workflow stages the hashicorp/random version run-tests.sh requires ($RUNNER_RANDOM)"
    else
        fail "the workflow stages the hashicorp/random version run-tests.sh requires" \
            "workflow RANDOM_PROVIDER_VERSION='${WORKFLOW_RANDOM}', run-tests.sh RANDOM_PROVIDER_VERSION='${RUNNER_RANDOM}'"
    fi

    # `npm run dev` → prerun → configure.sh downloads gomplate from the same
    # CDN unless it is already on PATH; the composite action puts the pinned,
    # cached copy there. It reads configure.sh, so it needs the checkout.
    CHECKOUT_AT="$(first_line "$WORKFLOW" 'uses: *actions/checkout@')"
    GOMPLATE_AT="$(first_line "$WORKFLOW" 'uses: *\./\.github/actions/setup-gomplate')"
    DEV_AT="$(first_line "$WORKFLOW" 'npm run dev')"
    if [ "$GOMPLATE_AT" -gt "$CHECKOUT_AT" ] && [ "$DEV_AT" -gt "$GOMPLATE_AT" ] && [ "$CHECKOUT_AT" -gt 0 ]; then
        pass "gomplate is set up from the pinned cache after checkout and before npm run dev"
    else
        fail "gomplate is set up from the pinned cache after checkout and before npm run dev" \
            "checkout@${CHECKOUT_AT} setup-gomplate@${GOMPLATE_AT} npm-run-dev@${DEV_AT}"
    fi

    assert_file_matches "$WORKFLOW" 'TF_CLI: terraform' \
        "the workflow runs the suite against Terraform"

    assert_file_matches "$WORKFLOW" 'TF_CLI: tofu' \
        "the workflow runs the suite against OpenTofu"

    RUN_COUNT="$(grep -cE '^ +run: \./packages/E2E/Terraform/e2e-tests/scripts/run-tests\.sh' "$WORKFLOW")"
    assert_eq "2" "$RUN_COUNT" \
        "the suite is invoked exactly twice — once per engine"
fi

#######################################
# Summary
#######################################

printf '\n==========================================\n'
printf 'Harness self-test: %d passed, %d failed\n' "$PASSED" "$FAILED"
printf '==========================================\n'

exit "$FAILED"
