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
REPO_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
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
    assert_file_matches "$WORKFLOW" 'hashicorp/setup-terraform' \
        "the workflow installs Terraform"

    assert_file_matches "$WORKFLOW" 'opentofu/setup-opentofu' \
        "the workflow installs OpenTofu"

    # Both wrappers replace the binary with a script that buffers stdout for
    # step outputs, which breaks command substitution and -detailed-exitcode.
    assert_file_matches "$WORKFLOW" 'terraform_wrapper: false' \
        "the Terraform wrapper is disabled"

    assert_file_matches "$WORKFLOW" 'tofu_wrapper: false' \
        "the OpenTofu wrapper is disabled"

    assert_file_matches "$WORKFLOW" 'TF_CLI: terraform' \
        "the workflow runs the suite against Terraform"

    assert_file_matches "$WORKFLOW" 'TF_CLI: tofu' \
        "the workflow runs the suite against OpenTofu"

    RUN_COUNT="$(grep -cE '^ +run: \./E2E/Terraform/e2e-tests/scripts/run-tests\.sh' "$WORKFLOW")"
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
