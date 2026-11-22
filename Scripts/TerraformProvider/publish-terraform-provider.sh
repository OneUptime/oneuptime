#!/bin/bash

# OneUptime Terraform Provider Publisher
# This script publishes the generated Terraform provider to the Terraform Registry
# Note: Provider generation and Go module setup is handled by the TypeScript generator
#
# Release-integrity ordering: ALL GoReleaser assets are built and signed FIRST
# (locally, against a local tag). Only after a fully successful build+sign does
# the script push the commit, push the tag, create the GitHub release, and
# upload the pre-built assets. A build or signing failure therefore can never
# leave a public tag with zero assets (which the Terraform Registry would
# otherwise try to ingest as a broken version).
#
# A published release is never changed. The Terraform and OpenTofu registries
# read a version's assets once, when it is published, and keep each zip's
# SHA-256; `terraform init` and `tofu init` check what GitHub serves against
# it. This script used to "heal" a release on a second run of the same
# version - a release run repeated after a failure elsewhere - by building
# the assets again and uploading them over the published ones. GoReleaser
# does not make the same zip twice, so 14.3.0, 16.0.0, 17.0.0 and 17.1.0 (and
# older versions) failed init with "checksum list has unexpected SHA-256
# hash" (OneUptime/terraform-provider-oneuptime#20). So:
#
#   - a run first asks whether its version is published. When it is, with
#     every asset its SHA256SUMS lists, the run stops there, successfully,
#     having built nothing. When it is published without them, the run fails
#     and says to publish a new version: it never uploads to it.
#   - a release is made as a draft, which no registry sees. Every asset is
#     uploaded to it, the draft is checked against what was built (names,
#     sizes, SHA-256s), and only then is it published, whole. A run that
#     stops halfway leaves a draft, which the next run deletes and makes
#     again.
#   - --republish-from publishes a published version's provider again, as a
#     new version: the way to mend a version whose assets no longer match
#     what the registries read.
#
# Tests/Ops/TerraformProviderPublishedRelease.test.js runs this script against
# a stand-in GitHub, git remote and GoReleaser.

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
TERRAFORM_DIR="$PROJECT_ROOT/Terraform"
PROVIDER_FRAMEWORK_DIR="$TERRAFORM_DIR/terraform-provider-oneuptime"
PROVIDER_NAME="oneuptime"
PROVIDER_REPO="terraform-provider-$PROVIDER_NAME"
GITHUB_ORG="OneUptime"
REPOSITORY="$GITHUB_ORG/$PROVIDER_REPO"
# The checks on a release (ProviderRelease.js) and its notes
# (GenerateReleaseNotes.js): plain Node.js, with nothing to install.
RELEASE_HELPER="$SCRIPT_DIR/ProviderRelease.js"
NOTES_GENERATOR="$SCRIPT_DIR/GenerateReleaseNotes.js"
VERSION=""
TEST_RELEASE=false
SKIP_TESTS=false
FORCE=false
DRY_RUN=false
HEAL_MODE=false
NOTHING_TO_PUBLISH=false
ALREADY_PUBLISHED=false
# --republish-from: the published release (vX.Y.Z) whose provider this run
# publishes again as v$VERSION.
REPUBLISH_FROM=""
# The OneUptime commit the provider is generated from, named in the provider
# commit's OneUptime-Commit trailer (the release notes read it).
ONEUPTIME_COMMIT=""
# This run's scratch files: gh's answers, the release notes.
WORK_DIR=""
NOTES_FILE=""
# The draft this run made, by its id: every later call names it so.
DRAFT_ID=""
# Push URL with embedded credentials. Held in memory only for the push
# commands — never written to git config or a credentials file on disk.
PUSH_URL=""

# Go's soft memory limit, for every Go command this script runs: go vet, go
# test and GoReleaser's cross-compiles, one target after another. A guard
# rail: compiled as one package of ~985 files, the provider took ~15 GB of a
# 16 GB CI runner without a limit; split into packages
# (Scripts/TerraformProvider/Core/ProviderShards.ts), a compile holds under
# 1 GiB. The generator sets the same value for its own Go commands
# (Scripts/TerraformProvider/Core/GoCommand.ts); a caller's own value wins.
export GOMEMLIMIT="${GOMEMLIMIT:-10GiB}"

# Files in the provider repo that are owned by the repo itself (the generator
# does not emit them) and must survive the deletion-aware sync. .git is never
# touched by `git rm`, so it needs no entry here. LICENSE is not one of them:
# the generator writes it (TerraformProviderGenerator.generateLicense).
REPO_OWNED_PATHSPECS=(
    ':(exclude).github'
    ':(exclude)CHANGELOG*'
    ':(exclude).gitignore'
)

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${PURPLE}[STEP]${NC} $1"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    -v, --version VERSION                    Specify the version to publish (e.g., 1.0.0)
    -t, --test-release                      Run in test release mode (creates draft release)
    -s, --skip-tests                        Skip running go vet / go test (emergencies only)
    -f, --force                            Force regeneration even if files exist (never changes a published release)
    -d, --dry-run                          Build and sign all release assets but skip git push, tag push, release creation, and uploads
    --republish-from TAG                    Publish the provider of the published release TAG (e.g. v17.1.0) again, as --version
    --gpg-private-key KEY                   GPG private key for signing releases
    --github-token TOKEN                    GitHub token for authentication and operations
    --github-repo-deploy-key KEY            GitHub repository deploy key
    -h, --help                             Show this help message

Examples:
    $0 -v 1.0.0 --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }} --gpg-private-key \${{ secrets.GPG_PRIVATE_KEY }}
    $0 -v 1.1.0 --test-release --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }}
    $0 -v 1.0.1-test --test-release --dry-run
    $0 -v 17.1.1 --republish-from v17.1.0 --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }}

A published release is never changed: a run whose version is published
already stops, and changes nothing. To mend a published version, publish its
provider again as a new version with --republish-from.

Note: The GITHUB_TOKEN should have the following permissions:
    - repo (for creating releases in the terraform-provider-oneuptime repository)
    - write:packages (if publishing packages)
    - For organization repos, ensure the token has access to the OneUptime organization
    - The token must have access to the terraform-provider-oneuptime repository

EOF
}

# Function to parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            -t|--test-release)
                TEST_RELEASE=true
                shift
                ;;
            -s|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -f|--force)
                FORCE=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            --republish-from)
                REPUBLISH_FROM="$2"
                shift 2
                ;;
            --gpg-private-key)
                GPG_PRIVATE_KEY="$2"
                shift 2
                ;;
            --github-token)
                GITHUB_TOKEN="$2"
                shift 2
                ;;
            --github-repo-deploy-key)
                TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY="$2"
                shift 2
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    if [[ -z "$VERSION" ]]; then
        print_error "Version is required. Use -v or --version to specify."
        show_usage
        exit 1
    fi

    if [[ -n "$REPUBLISH_FROM" ]]; then
        # The release's tag, as the provider repository names it: v17.1.0.
        if [[ ! "$REPUBLISH_FROM" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            print_error "--republish-from takes a published release's tag, as v17.1.0. Got: $REPUBLISH_FROM"
            exit 1
        fi
        REPUBLISH_FROM="v${REPUBLISH_FROM#v}"
        if [[ "$REPUBLISH_FROM" == "v$VERSION" ]]; then
            print_error "--republish-from $REPUBLISH_FROM publishes its provider again as a new version: --version must name another one."
            exit 1
        fi
        if [[ "$FORCE" == true ]]; then
            print_error "--force regenerates the provider, and --republish-from publishes one already made: use one or the other."
            exit 1
        fi
    fi
}

# Runs gh, up to four times, 5, 15 and 30 seconds apart: GitHub's API fails
# for minutes at a time (on 2026-08-17 it answered "Error 503: No server is
# currently available to service your request"). An answer that matches the
# first argument, such as "HTTP 404", is an answer, and is not asked again.
# Leaves gh's output in GH_STDOUT and GH_STDERR (apart, so a warning cannot
# get into the JSON), and returns the last attempt's status.
gh_retrying() {
    local stop_on="$1"
    shift
    local -a delays=(5 15 30)
    local max_attempts=$(( ${#delays[@]} + 1 ))
    local attempt=1
    local status

    while true; do
        status=0
        gh "$@" > "$WORK_DIR/gh.out" 2> "$WORK_DIR/gh.err" || status=$?
        GH_STDOUT="$(cat "$WORK_DIR/gh.out")"
        GH_STDERR="$(cat "$WORK_DIR/gh.err")"

        if (( status == 0 )); then
            return 0
        fi
        if [[ -n "$stop_on" ]] && grep -qiE -- "$stop_on" <<< "$GH_STDERR$GH_STDOUT"; then
            return "$status"
        fi
        if (( attempt >= max_attempts )); then
            return "$status"
        fi

        print_warning "gh $1 $2 failed (attempt ${attempt} of ${max_attempts}); trying again in ${delays[attempt - 1]}s. GitHub said: ${GH_STDERR:-$GH_STDOUT}" >&2
        sleep "${delays[attempt - 1]}"
        attempt=$(( attempt + 1 ))
    done
}

# What GitHub said last, for an error message.
gh_said() {
    printf '%s' "${GH_STDERR:-$GH_STDOUT}"
}

# Confirms the token can see the provider repo, retrying transient API failures.
#
# This is one HTTP call against the GitHub API, and it used to be a single
# attempt whose stderr went to /dev/null — so every failure, whatever the cause,
# was reported as "ensure the GitHub token has access to this repository". On
# 2026-08-17 a GitHub API incident tripped it (the same outage returned
# "Error 503: No server is currently available to service your request" to the
# release-creation job, and failed CodeQL on both master and release). The
# release run had already spent ~50 minutes at that point, and the log pointed
# at a perfectly valid PAT.
#
# Retry rather than classify: telling "expired token" from "GitHub is down"
# means pattern-matching gh's prose, which is exactly the kind of guess that
# produced the misleading message in the first place. A few short retries cost
# under a minute on a genuinely bad token, and gh's own words are printed either
# way so whoever reads the log can tell which it was.
validate_repo_access() {
    local -a delays=(5 15 30)
    local max_attempts=$(( ${#delays[@]} + 1 ))
    local attempt=1
    local output status delay

    while true; do
        # Capture the status on the same line: after a failed command whose
        # output is being captured, $? belongs to the assignment otherwise.
        status=0
        output="$(GH_TOKEN="$GITHUB_TOKEN" gh repo view "$GITHUB_ORG/$PROVIDER_REPO" 2>&1)" || status=$?

        if (( status == 0 )); then
            if (( attempt > 1 )); then
                print_success "Repository access check succeeded on attempt ${attempt}/${max_attempts}"
            fi
            return 0
        fi

        if (( attempt >= max_attempts )); then
            print_error "Cannot access repository $GITHUB_ORG/$PROVIDER_REPO after ${max_attempts} attempts"
            print_error "GitHub said: ${output}"
            print_error "Either the GitHub token is expired or lacks access to this repository, or the GitHub API is degraded — check https://www.githubstatus.com before rotating the token."
            exit 1
        fi

        delay="${delays[attempt - 1]}"
        print_warning "Repository access check failed on attempt ${attempt}/${max_attempts}; retrying in ${delay}s. GitHub said: ${output}"
        sleep "$delay"
        attempt=$(( attempt + 1 ))
    done
}

# Function to validate prerequisites
validate_prerequisites() {
    print_step "Validating prerequisites..."

    # Check if we're in the correct directory
    if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
        print_error "Not in OneUptime project root directory"
        exit 1
    fi

    # goreleaser is required even in dry-run mode (asset build is the point of
    # a dry run); gh is only needed when we actually create the release.
    local tools=("node" "npm" "go" "git" "goreleaser")
    if [[ "$DRY_RUN" == false ]]; then
        tools+=("gh")
    fi
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            print_error "$tool is not installed or not in PATH"
            exit 1
        fi
    done

    # Check Go version
    local go_version=$(go version | grep -oE 'go[0-9]+\.[0-9]+' | cut -d'o' -f2)
    local required_version="1.19"
    if [[ "$(printf '%s\n' "$required_version" "$go_version" | sort -V | head -n1)" != "$required_version" ]]; then
        print_error "Go version $required_version or higher is required. Found: $go_version"
        exit 1
    fi

    # Check Node.js version
    local node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ "$node_version" -lt 18 ]]; then
        print_error "Node.js version 18 or higher is required. Found: v$node_version"
        exit 1
    fi

    # Validate version format (semantic versioning)
    if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$ ]]; then
        print_error "Invalid version format. Please use semantic versioning (e.g., 1.0.0)"
        exit 1
    fi

    if [[ "$DRY_RUN" == true ]]; then
        print_status "Dry run: skipping GitHub token and repository access checks"
    else
        if [[ -z "$GITHUB_TOKEN" ]]; then
            print_error "GitHub token is required for publishing."
            print_error "Use --github-token option to provide the token."
            exit 1
        fi

        # Validate access to the target repository
        print_status "Validating access to target repository: $GITHUB_ORG/$PROVIDER_REPO"
        validate_repo_access
        print_success "Repository access validated"

        if [[ -z "$GPG_PRIVATE_KEY" ]]; then
            print_warning "GPG private key not provided. Required for signing releases."
            print_warning "Use --gpg-private-key option to provide the key."
        fi
    fi

    print_success "Prerequisites validated"
}

# The published release of a tag, by GitHub's REST API, which never answers
# with a draft for it: PUBLISHED is true or false, and PUBLISHED_FILE holds
# the release (its id, assets and their SHA-256s). `gh release view` finds a
# draft of the tag too, and when there are both it answers with whichever it
# found first, so it cannot say whether a tag is published.
read_published_release() {
    local tag="${1:-v$VERSION}"
    PUBLISHED_FILE="$WORK_DIR/published-$tag.json"
    PUBLISHED=false

    if gh_retrying "HTTP 404|Not Found" api "repos/$REPOSITORY/releases/tags/$tag"; then
        printf '%s\n' "$GH_STDOUT" > "$PUBLISHED_FILE"
        if [[ "$(node "$RELEASE_HELPER" state "$PUBLISHED_FILE")" == "published" ]]; then
            PUBLISHED=true
        fi
        return 0
    fi

    if grep -qiE "HTTP 404|Not Found" <<< "$GH_STDERR$GH_STDOUT"; then
        : > "$PUBLISHED_FILE"
        return 0
    fi

    print_error "Could not tell whether $tag of $REPOSITORY is published. GitHub said: $(gh_said)"
    exit 1
}

# Every published release's tag, for which one this follows and whether it
# is the latest: RELEASES_FILE holds them, or nothing when GitHub could not
# list them (RELEASES_LISTED=false). Drafts are listed, and skipped by the
# helper.
list_releases() {
    RELEASES_FILE="$WORK_DIR/releases.json"
    RELEASES_LISTED=false
    if gh_retrying "" release list --repo "$REPOSITORY" --limit 100 --json tagName,isDraft,isPrerelease; then
        printf '%s\n' "$GH_STDOUT" > "$RELEASES_FILE"
        RELEASES_LISTED=true
    else
        : > "$RELEASES_FILE"
    fi
}

# Whether a published release is all a registry needs: its SHA256SUMS, the
# signature, and every file the SHA256SUMS lists, each as it lists it. The
# problems, one per line, are in PUBLISHED_PROBLEMS; returns 1 when there are
# any.
check_published_assets() {
    local version="$1"
    local sums_name="terraform-provider-${PROVIDER_NAME}_${version}_SHA256SUMS"
    local sums_file="$WORK_DIR/published-${version}-SHA256SUMS"
    local asset_id status=0

    : > "$sums_file"
    asset_id="$(node "$RELEASE_HELPER" asset-id "$PUBLISHED_FILE" "$sums_name")"

    # By the asset's id, from the published release itself: by the tag, gh
    # could read a draft's.
    if [[ -n "$asset_id" ]]; then
        if gh_retrying "HTTP 404|Not Found" api -H "Accept: application/octet-stream" "repos/$REPOSITORY/releases/assets/$asset_id"; then
            cp "$WORK_DIR/gh.out" "$sums_file"
        else
            print_error "Could not read $sums_name of the published v$version. GitHub said: $(gh_said)"
            exit 1
        fi
    fi

    PUBLISHED_PROBLEMS="$(node "$RELEASE_HELPER" check-published "$version" "$PUBLISHED_FILE" "$sums_file")" || status=$?
    if (( status > 1 )); then
        print_error "Could not check the published v$version's assets: $PUBLISHED_PROBLEMS"
        exit 1
    fi
    return "$status"
}

# Before anything is generated or built: a version that is published already
# is left as it is. With every asset its SHA256SUMS lists, the run has nothing
# to do and stops successfully (ALREADY_PUBLISHED). Without, it fails: the
# registries may have read what is there, so uploading what is missing (built
# again, and so other bytes than its SHA256SUMS lists) or anything else would
# break the version for anyone who installs it. --republish-from also needs
# the release it names to be published.
check_published_release() {
    if [[ "$DRY_RUN" == true ]]; then
        print_status "Dry run: not asking GitHub whether v$VERSION is published"
        return
    fi

    print_step "Checking whether v$VERSION is published already..."
    read_published_release "v$VERSION"

    if [[ "$PUBLISHED" == true ]]; then
        if [[ "$FORCE" == true ]]; then
            print_error "v$VERSION is published, and --force does not change a published release either: the registries have read its assets. Publish the provider as a new version instead."
            exit 1
        fi

        if check_published_assets "$VERSION"; then
            ALREADY_PUBLISHED=true
            print_success "v$VERSION is published already, with every asset its SHA256SUMS lists. A published release is never changed: there is nothing to do."
            return
        fi

        print_error "v$VERSION is published, but:"
        while IFS= read -r problem; do
            [[ -n "$problem" ]] && print_error "  - $problem"
        done <<< "$PUBLISHED_PROBLEMS"
        print_error "A published release is never changed, since the registries may have read it already. Publish the provider as a new version: bump VERSION, or run this script with --republish-from v$VERSION --version <the next patch version>."
        exit 1
    fi

    print_status "v$VERSION is not published yet"

    if [[ -n "$REPUBLISH_FROM" ]]; then
        read_published_release "$REPUBLISH_FROM"
        if [[ "$PUBLISHED" != true ]]; then
            print_error "$REPUBLISH_FROM is not a published release of $REPOSITORY, so there is no provider of it to publish again."
            exit 1
        fi
        print_status "$REPUBLISH_FROM is published: its provider will be published again as v$VERSION"
    fi
}

# Function to generate terraform provider
generate_provider() {
    if [[ -n "$REPUBLISH_FROM" ]]; then
        print_status "Republishing $REPUBLISH_FROM: its provider is built as it was tagged, and nothing is generated"
        return
    fi

    print_step "Generating Terraform provider..."

    cd "$PROJECT_ROOT"

    # Clean existing terraform directory if force is enabled
    if [[ "$FORCE" == true && -d "$TERRAFORM_DIR" ]]; then
        print_status "Force mode enabled. Cleaning existing Terraform directory..."
        rm -rf "$TERRAFORM_DIR"
    fi

    # Generate the provider
    print_status "Running terraform provider generation..."
    npm run generate-terraform-provider

    # Verify generation was successful
    if [[ ! -d "$TERRAFORM_DIR" ]]; then
        print_error "Terraform provider generation failed - directory not created"
        exit 1
    fi

    # Check if the provider framework directory exists
    if [[ ! -d "$PROVIDER_FRAMEWORK_DIR" ]]; then
        print_error "Provider framework directory not found at $PROVIDER_FRAMEWORK_DIR"
        print_error "The generation process should create terraform-provider-framework subdirectory"
        exit 1
    fi

    cd "$PROJECT_ROOT"
    print_success "Terraform provider generated and validated successfully"
}

# The OneUptime commit the provider is generated from: the one the release
# run checked out (GITHUB_SHA), else this checkout's. Nothing when neither is
# a commit.
find_oneuptime_commit() {
    local commit="${GITHUB_SHA:-}"
    if [[ -z "$commit" ]]; then
        commit="$(git -C "$PROJECT_ROOT" rev-parse --verify --quiet HEAD 2>/dev/null || true)"
    fi
    if [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
        ONEUPTIME_COMMIT="$commit"
    fi
}

# Checks out exactly the commit a remote tag points to, for a tag pushed by a
# run that stopped before it published the release: the release is built
# from what the tag holds, never from a fresh generation that may differ.
check_out_remote_tag() {
    local tag="$1"
    git tag -d "$tag" 2>/dev/null || true
    if ! git fetch --depth=1 origin "refs/tags/${tag}:refs/tags/${tag}"; then
        print_error "Failed to fetch remote tag $tag"
        exit 1
    fi
    git reset --hard "refs/tags/$tag^{commit}"
    # Remove untracked leftovers from generation so GoReleaser's dirty
    # check sees a pristine tree for the tagged commit.
    git clean -fdx
    print_success "Checked out tagged commit $(git rev-parse HEAD) for $tag"
}

# --republish-from: the commit the published release's tag points to, tagged
# v$VERSION too. Nothing is committed: v$VERSION is built from the same tree
# (its VERSION file still says the version it was made for), and only its
# tag is pushed, so the provider's main branch is not moved back.
check_out_republished_release() {
    if [[ "$DRY_RUN" == false ]] && git ls-remote --tags origin | grep -q "refs/tags/v$VERSION$"; then
        # Pushed by a run that stopped before it published the release.
        print_warning "Tag v$VERSION already exists on the remote repository: building the release from it"
        HEAL_MODE=true
        check_out_remote_tag "v$VERSION"
        return
    fi

    print_status "Fetching $REPUBLISH_FROM..."
    if ! git fetch --depth=1 origin "refs/tags/${REPUBLISH_FROM}:refs/tags/${REPUBLISH_FROM}"; then
        print_error "Failed to fetch $REPUBLISH_FROM from $REPOSITORY"
        exit 1
    fi
    git reset --hard "refs/tags/$REPUBLISH_FROM^{commit}"
    git clean -fdx

    git tag -d "v$VERSION" 2>/dev/null || true
    git tag -a "v$VERSION" -m "Release v$VERSION: the provider of $REPUBLISH_FROM, published again"
    print_success "Tagged $REPUBLISH_FROM's commit $(git rev-parse HEAD) as v$VERSION (nothing pushed yet)"
}

# Function to sync generated code into the terraform-provider-oneuptime
# repository checkout: authenticate, fetch remote state, perform a
# deletion-aware sync, and create the local commit + tag. Nothing is pushed
# here — pushing happens only after release assets are fully built and signed.
sync_provider_repository() {
    print_step "Syncing generated code into terraform-provider-oneuptime repository checkout..."

    if [[ -n "$REPUBLISH_FROM" ]]; then
        # Nothing is generated: a fresh checkout of the provider's repository.
        rm -rf "$PROVIDER_FRAMEWORK_DIR"
        mkdir -p "$PROVIDER_FRAMEWORK_DIR"
    fi

    cd "$PROVIDER_FRAMEWORK_DIR"

    # Check for authentication method
    local remote_url="https://github.com/$GITHUB_ORG/$PROVIDER_REPO.git"
    if [[ -n "$TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY" ]]; then
        print_status "Using deploy key for GitHub authentication"

        # Set up SSH key for git operations
        local ssh_key_file="$HOME/.ssh/terraform_provider_deploy_key"

        # Ensure SSH directory exists
        mkdir -p "$HOME/.ssh"

        echo "$TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY" > "$ssh_key_file"
        chmod 600 "$ssh_key_file"

        # Configure git to use the deploy key
        export GIT_SSH_COMMAND="ssh -i $ssh_key_file -o StrictHostKeyChecking=no"

        remote_url="git@github.com:$GITHUB_ORG/$PROVIDER_REPO.git"
        PUSH_URL="$remote_url"

        # For GitHub API operations, we still need a token
        if [[ "$DRY_RUN" == false && -z "$GITHUB_TOKEN" ]]; then
            print_error "GitHub token is required for GitHub API operations (release creation)"
            print_error "Deploy key is used for git operations, but API operations require a token"
            print_error "Use --github-token option to provide the token."
            exit 1
        fi
        if [[ -n "$GITHUB_TOKEN" ]]; then
            export GH_TOKEN="$GITHUB_TOKEN"
        fi
    elif [[ -n "$GITHUB_TOKEN" ]]; then
        print_status "Using GitHub token for authentication"
        export GH_TOKEN="$GITHUB_TOKEN"
        # The token is embedded in the in-memory push URL only; the on-disk
        # remote stays tokenless and nothing is written to a credential store.
        PUSH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/$GITHUB_ORG/$PROVIDER_REPO.git"
    elif [[ "$DRY_RUN" == true ]]; then
        print_status "Dry run: no GitHub authentication configured (none needed)"
    else
        print_error "Either deploy key or GitHub token is required for GitHub authentication"
        print_error "Use --github-repo-deploy-key or --github-token option to provide authentication"
        exit 1
    fi

    # Save generated files to a temporary location.
    # Exclude build artifacts (especially the ~60MB compiled provider binary at
    # the repo root) so they never get staged when we copy the files back. If
    # they slip in here, .gitignore alone won't help because the binary was
    # previously committed and stays tracked across resets.
    local temp_dir=""
    if [[ -z "$REPUBLISH_FROM" ]]; then
        print_status "Saving generated files temporarily..."
        temp_dir=$(mktemp -d)
        cp -r . "$temp_dir/"
        rm -rf \
            "$temp_dir/.git" \
            "$temp_dir/dist" \
            "$temp_dir/builds" \
            "$temp_dir/terraform-provider-oneuptime" \
            "$temp_dir/terraform-provider-oneuptime.exe" \
            2>/dev/null || true
    fi

    # Initialize or reset git repository
    if [[ ! -d ".git" ]]; then
        print_status "Initializing git repository..."
        git init
        git branch -M master
    fi

    # Configure git user (must be after git init)
    print_status "Configuring git user..."
    git config user.name "OneUptime Terraform Provider Bot"
    git config user.email "terraform-provider@oneuptime.com"

    # Set up remote
    if ! git remote get-url origin &> /dev/null; then
        print_status "Adding remote origin: $remote_url"
        git remote add origin "$remote_url"
    else
        git remote set-url origin "$remote_url"
    fi

    if [[ -n "$REPUBLISH_FROM" ]]; then
        check_out_republished_release
        return
    fi

    # Fetch remote to get the latest state.
    # Use --depth=1 so we don't pull down the full history (which currently
    # carries large committed binaries from older runs and made the fetch take
    # ~9 minutes). We only need the tip to compute the diff for the new commit.
    if [[ "$DRY_RUN" == true ]]; then
        # A dry run must not depend on (or touch) the real provider repo: it
        # exercises the full commit/tag/build pipeline against a fresh local
        # repository instead.
        print_status "Dry run: skipping remote fetch; using a fresh local repository"
    else
        print_status "Fetching remote repository..."
        if git fetch --depth=1 origin master 2>/dev/null; then
            print_status "Remote repository exists, resetting to origin/master..."
            git reset --hard origin/master
        else
            print_status "Remote repository is empty or doesn't exist yet"
        fi
    fi

    # If the tag already exists on the remote, a previous run pushed this
    # version's code and stopped before it published the release (a published
    # one stops the run before anything is generated: check_published_release).
    # Unless --force is given we do NOT rebuild from the freshly generated
    # (potentially different) tree — we build the release from the exact
    # commit the remote tag points to.
    if [[ "$DRY_RUN" == false ]] && git ls-remote --tags origin | grep -q "refs/tags/v$VERSION$"; then
        if [[ "$FORCE" == true ]]; then
            print_warning "Tag v$VERSION exists on remote, force mode enabled - will overwrite (its release was never published)"
        else
            print_warning "Tag v$VERSION already exists on remote repository, and its release was never published"
            print_status "Healing mode: the release will be built from the exact commit the remote tag points to."
            print_status "Use --force flag to overwrite the code/tag if needed"
            HEAL_MODE=true

            rm -rf "$temp_dir"
            check_out_remote_tag "v$VERSION"
            return
        fi
    fi

    # Deletion-aware sync: drop every tracked file before copying the fresh
    # generator output in, so resources/docs the generator no longer emits are
    # actually deleted from the provider repo instead of accumulating forever.
    # Repo-owned files (.github/, CHANGELOG*, .gitignore) are excluded and
    # survive; .git is never touched by git rm.
    print_status "Removing tracked files before sync (deletion-aware)..."
    git rm -rf -q -- . "${REPO_OWNED_PATHSPECS[@]}" 2>/dev/null || true

    # Copy generated files back (overwriting remote content)
    print_status "Restoring generated files..."
    cp -r "$temp_dir"/* . 2>/dev/null || true
    cp -r "$temp_dir"/.[!.]* . 2>/dev/null || true  # Copy hidden files except . and ..
    rm -rf "$temp_dir"

    # Ensure build artifact directories are not committed to the provider repo.
    # GoReleaser runs with --clean and will wipe dist/. If dist/ (or builds/)
    # were tracked, that --clean would leave the working tree dirty and
    # GoReleaser would abort with "git is in a dirty state". Guarantee a
    # .gitignore exists and untrack any previously-committed build output.
    print_status "Ensuring .gitignore excludes build artifacts..."
    local gitignore_entries=(
        "dist/"
        "builds/"
        "*.zip"
        "*.sig"
        "*SHA256SUMS*"
        "terraform-provider-oneuptime"
        "terraform-provider-oneuptime.exe"
    )
    if [[ ! -f .gitignore ]]; then
        : > .gitignore
    fi
    for entry in "${gitignore_entries[@]}"; do
        if ! grep -qxF "$entry" .gitignore 2>/dev/null; then
            echo "$entry" >> .gitignore
        fi
    done

    # Remove any previously-tracked build output from the index so it won't be
    # recommitted (files stay on disk for the subsequent GoReleaser step). The
    # ~60MB compiled provider binary at the repo root was getting re-committed
    # on every run because .gitignore alone can't exclude an already-tracked
    # file — it has to be untracked here first.
    git rm -r --cached --ignore-unmatch \
        dist \
        builds \
        terraform-provider-oneuptime \
        terraform-provider-oneuptime.exe \
        2>/dev/null || true

    # Stage all generated files
    print_status "Staging generated files..."
    git add -A

    # No-change skip: the VERSION file historically carries a forced timestamp
    # that changes on every generation, so exclude it from change detection.
    # If nothing else changed there is nothing worth publishing — no commit,
    # no tag, no release.
    if [[ -z "$(git status --porcelain -- . ':(exclude)VERSION')" ]]; then
        print_success "No provider changes detected compared to remote (ignoring VERSION). Skipping publish entirely for v$VERSION."
        NOTHING_TO_PUBLISH=true
        return
    fi

    # Create commit with generated files. Its last paragraph is a trailer
    # naming the OneUptime commit it is generated from: the next release's
    # notes list OneUptime's changes to the provider since it.
    print_status "Creating commit with generated files..."
    local commit_message="chore: generate provider for version v$VERSION

This commit contains the auto-generated Terraform provider code for OneUptime v$VERSION.

Generated from OneUptime API specification on $(date -u '+%Y-%m-%d %H:%M:%S UTC').

Changes include:
- Updated provider resources and data sources
- Latest API schema definitions
- Generated documentation"
    if [[ -n "$ONEUPTIME_COMMIT" ]]; then
        commit_message="$commit_message

OneUptime-Commit: $ONEUPTIME_COMMIT"
    fi
    git commit -m "$commit_message"
    print_success "Created commit for v$VERSION"

    # Create the local tag. It is only pushed after assets build successfully.
    print_status "Creating local tag v$VERSION..."
    if git tag -l | grep -q "^v$VERSION$"; then
        print_warning "Tag v$VERSION already exists locally, removing..."
        git tag -d "v$VERSION"
    fi
    git tag -a "v$VERSION" -m "Release v$VERSION"
    print_success "Created local commit and tag for v$VERSION (nothing pushed yet)"
}

# Function to run go vet and go test against the synced provider tree. Runs
# before anything is built or pushed so a broken provider never reaches the
# public repo or the registry.
run_provider_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_warning "Skipping go vet / go test (--skip-tests). Use only for emergencies."
        return
    fi

    print_step "Running go vet and go test on the provider tree..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    print_status "Running go vet ./..."
    if ! go vet ./...; then
        print_error "go vet failed. Aborting before anything is pushed or released."
        exit 1
    fi

    print_status "Running go test ./..."
    if ! go test ./...; then
        print_error "go test failed. Aborting before anything is pushed or released."
        exit 1
    fi

    print_success "go vet and go test passed"
}

# The files a release is made of, each once, in RELEASE_ASSETS: the zips, the
# SHA256SUMS, its signature and the Terraform Registry manifest. The globs
# used to be *SHA256SUMS* and *.sig, which both match the signature, so it was
# uploaded twice.
collect_release_assets() {
    local dist_dir="$PROVIDER_FRAMEWORK_DIR/dist"
    local file
    RELEASE_ASSETS=()
    for file in "$dist_dir"/*.zip "$dist_dir"/*_SHA256SUMS "$dist_dir"/*_SHA256SUMS.sig "$dist_dir"/*_manifest.json; do
        if [[ -f "$file" ]]; then
            RELEASE_ASSETS+=("$file")
        fi
    done
}

# Function to build and sign ALL release assets locally with GoReleaser.
# This runs BEFORE any push/tag/release, so a failed build cannot leave a
# public tag (or a release) without assets.
build_release_assets() {
    print_step "Building and signing release assets with GoReleaser..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    if [[ ! -f "$PROVIDER_FRAMEWORK_DIR/.goreleaser.yml" ]]; then
        print_error ".goreleaser.yml not found in $PROVIDER_FRAMEWORK_DIR"
        print_error "The provider generator must emit it; assets cannot be built without it."
        exit 1
    fi

    # Get GPG fingerprint for signing
    local gpg_fingerprint=$(gpg --list-secret-keys --keyid-format=long | grep -E "^sec" | head -1 | sed 's/.*\/\([A-F0-9]*\).*/\1/')

    if [[ -z "$gpg_fingerprint" ]]; then
        print_error "No GPG secret key found for GoReleaser signing."
        exit 1
    fi

    export GPG_FINGERPRINT="$gpg_fingerprint"
    export GITHUB_TOKEN="${GITHUB_TOKEN:-}"
    # The version GoReleaser builds, named: with --republish-from, the commit
    # carries two tags, and GoReleaser would pick one of them itself.
    export GORELEASER_CURRENT_TAG="v$VERSION"

    print_status "Using GPG key: $gpg_fingerprint"
    print_status "Running GoReleaser to create archives, checksums, and signatures..."

    # GoReleaser builds archives + checksums + signs in one parallelized step
    # We use --skip=publish because the release is created and assets are
    # uploaded separately, only after this build fully succeeds.
    #
    # --parallelism 1 forces GoReleaser to cross-compile one target at a time.
    # The generated provider was a single ~600K-line `package provider`, so
    # each Go compilation was memory-heavy. GoReleaser defaults parallelism to
    # the CPU count (4 on GitHub's ubuntu-latest), which compiled 4 targets at
    # once and exhausted the runner's 16GB RAM -> the host killed the runner
    # mid-build ("The runner has received a shutdown signal" / exit 143). The
    # provider is split into packages now (ProviderShards.ts), and each target's
    # build already compiles four of them at a time on the runner's four CPUs,
    # so the targets still build one after another.
    goreleaser release \
        --clean \
        --parallelism 1 \
        --skip=publish \
        --config .goreleaser.yml

    print_success "GoReleaser completed: archives, checksums, and signatures created"

    local dist_dir="$PROVIDER_FRAMEWORK_DIR/dist"

    if [[ ! -d "$dist_dir" ]]; then
        print_error "GoReleaser dist directory not found"
        exit 1
    fi

    # GoReleaser lists the Terraform Registry manifest in SHA256SUMS (via
    # checksum.extra_files in .goreleaser.yml) but does NOT copy it into dist/.
    # Place it in dist/ under the exact name that appears in SHA256SUMS so it is
    # uploaded and its hash matches the checksum entry. The Terraform Registry
    # needs this manifest to negotiate the plugin protocol version - without it,
    # `terraform init` fails even when every archive/checksum/signature is present.
    if [[ -f "terraform-registry-manifest.json" ]]; then
        cp "terraform-registry-manifest.json" \
            "$dist_dir/terraform-provider-${PROVIDER_NAME}_${VERSION}_manifest.json"
        print_status "Staged registry manifest as terraform-provider-${PROVIDER_NAME}_${VERSION}_manifest.json"
    else
        print_error "terraform-registry-manifest.json not found in $PROVIDER_FRAMEWORK_DIR"
        print_error "The provider generator must emit it; otherwise the release is missing the Registry manifest."
        exit 1
    fi

    # Verify the assets exist NOW, before anything is pushed or released.
    collect_release_assets

    if [[ "${#RELEASE_ASSETS[@]}" -eq 0 ]]; then
        print_error "GoReleaser produced no release assets (dist/ had no zip/SHA256SUMS/sig/manifest files)"
        exit 1
    fi

    # And that they are the whole release: the SHA256SUMS, its signature, and
    # every file it lists, as it lists them. A release missing any of them
    # cannot be installed from a registry, and once published it is never
    # changed.
    local problems status=0
    problems="$(node "$RELEASE_HELPER" check-built "$VERSION" "${RELEASE_ASSETS[@]}")" || status=$?
    if (( status != 0 )); then
        print_error "The release assets GoReleaser built are not a whole release:"
        while IFS= read -r problem; do
            [[ -n "$problem" ]] && print_error "  - $problem"
        done <<< "$problems"
        exit 1
    fi

    print_success "Built and signed ${#RELEASE_ASSETS[@]} release assets (not uploaded yet)"
}

# Function to push the local commit and tag. Only called after all release
# assets were built and signed successfully.
push_repository_changes() {
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: skipping git push of commit and tag"
        return
    fi

    if [[ "$HEAL_MODE" == true ]]; then
        print_status "Healing mode: code and tag already exist on remote - nothing to push"
        return
    fi

    cd "$PROVIDER_FRAMEWORK_DIR"

    if [[ -n "$REPUBLISH_FROM" ]]; then
        # Only the tag: the provider's main branch stays where it is.
        print_step "Pushing tag v$VERSION (on $REPUBLISH_FROM's commit) to terraform-provider-oneuptime repository..."
        if ! git push "$PUSH_URL" "refs/tags/v$VERSION"; then
            print_error "Failed to push tag v$VERSION"
            exit 1
        fi
        print_success "Tag v$VERSION pushed to terraform-provider-oneuptime repository"
        return
    fi

    print_step "Pushing commit and tag to terraform-provider-oneuptime repository..."

    print_status "Pushing changes to remote repository..."
    if ! git push "$PUSH_URL" master; then
        print_error "Failed to push to remote repository"
        print_error "This might be due to conflicts or permission issues"
        exit 1
    fi

    print_status "Pushing tag v$VERSION..."
    if [[ "$FORCE" == true ]] && git ls-remote --tags origin | grep -q "refs/tags/v$VERSION$"; then
        # Force push the tag if it exists and force mode is enabled. Its
        # release was never published: a published one stops the run first.
        if ! git push -f "$PUSH_URL" "v$VERSION"; then
            print_error "Failed to force push tag v$VERSION"
            exit 1
        fi
        print_warning "Force pushed tag v$VERSION"
    else
        if ! git push "$PUSH_URL" "v$VERSION"; then
            print_error "Failed to push tag v$VERSION"
            exit 1
        fi
    fi

    print_success "Code and tag pushed to terraform-provider-oneuptime repository"
}

# The release this one follows, for its notes: the newest published release
# older than v$VERSION (ProviderRelease.js previous), in PREVIOUS_TAG, and
# fetched into the provider's checkout, where the notes read its pages.
# Deriving it arithmetically (patch - 1) produced v13.0.-1 on a x.y.0 release
# and pointed at the wrong tag after any minor or major bump; taking the
# newest release by date would after a republished older version. Never
# fails: without it the notes say less, and the release is not held back.
find_previous_release() {
    PREVIOUS_TAG=""
    list_releases
    if [[ "$RELEASES_LISTED" != true ]]; then
        print_warning "Could not list the releases of $REPOSITORY, so the notes of v$VERSION compare it with none. GitHub said: $(gh_said)"
        return 0
    fi

    PREVIOUS_TAG="$(node "$RELEASE_HELPER" previous "$VERSION" "$RELEASES_FILE" 2>/dev/null || true)"
    if [[ -z "$PREVIOUS_TAG" ]]; then
        print_warning "No published release of $REPOSITORY is older than v$VERSION"
        return 0
    fi

    print_status "v$VERSION follows $PREVIOUS_TAG"
    if ! git -C "$PROVIDER_FRAMEWORK_DIR" fetch --depth=1 origin "refs/tags/${PREVIOUS_TAG}:refs/tags/${PREVIOUS_TAG}" 2>/dev/null; then
        print_warning "Could not fetch $PREVIOUS_TAG, so the notes of v$VERSION cannot say what changed since it"
    fi
}

# What a release says when its notes could not be written: never nothing.
write_fallback_notes() {
    {
        echo "The provider for OneUptime $VERSION, generated from its API."
        echo ""
        if [[ -n "$PREVIOUS_TAG" ]]; then
            echo "**Full changelog:** https://github.com/$REPOSITORY/compare/$PREVIOUS_TAG...v$VERSION"
        else
            echo "**Changes:** https://github.com/$REPOSITORY/commits/v$VERSION"
        fi
    } > "$NOTES_FILE"
}

# The release notes (GenerateReleaseNotes.js): what changed in the provider's
# resources and data sources since the release before, and OneUptime's
# changes to the provider. Every release used to get the same text
# (OneUptime/terraform-provider-oneuptime#19). They go to the job's summary
# too, a dry run's included.
write_release_notes() {
    print_step "Writing the release notes..."

    NOTES_FILE="$WORK_DIR/release-notes.md"
    PREVIOUS_TAG=""
    local -a args=(
        --version "$VERSION"
        --provider-dir "$PROVIDER_FRAMEWORK_DIR"
        --ref "v$VERSION"
        --output "$NOTES_FILE"
        --fallback-on-error
    )

    if [[ -n "$REPUBLISH_FROM" ]]; then
        args+=(--republish-of "$REPUBLISH_FROM")
    elif [[ "$DRY_RUN" == true ]]; then
        print_status "Dry run: not asking GitHub which release v$VERSION follows"
    else
        find_previous_release
        if [[ -n "$PREVIOUS_TAG" ]]; then
            args+=(--previous "$PREVIOUS_TAG")
        fi
    fi
    if [[ -n "$ONEUPTIME_COMMIT" ]]; then
        args+=(--oneuptime-to "$ONEUPTIME_COMMIT")
    fi

    if ! node "$NOTES_GENERATOR" "${args[@]}"; then
        print_warning "The notes of v$VERSION could not be written, so its release links to its changes instead"
        write_fallback_notes
    fi

    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
        {
            echo "## Terraform provider v$VERSION"
            echo ""
            cat "$NOTES_FILE"
            echo ""
        } >> "$GITHUB_STEP_SUMMARY"
    fi
    print_success "Release notes written"
}

# The drafts of v$VERSION, by id, in DRAFT_IDS: none, unless a run stopped
# between making its draft and publishing it.
list_drafts() {
    DRAFT_IDS=()
    if ! gh_retrying "" api "repos/$REPOSITORY/releases?per_page=100" --paginate --jq ".[] | select(.draft and .tag_name == \"v$VERSION\") | .id"; then
        print_error "Could not list the drafts of $REPOSITORY. GitHub said: $(gh_said)"
        exit 1
    fi
    local id
    while IFS= read -r id; do
        if [[ "$id" =~ ^[0-9]+$ ]]; then
            DRAFT_IDS+=("$id")
        fi
    done <<< "$GH_STDOUT"
}

# Makes v$VERSION's release as a draft, which no registry sees, in DRAFT_ID.
# A draft an earlier run left is deleted first: it was never published, so
# nothing has read it, and its assets may be from another build. They are
# deleted by id, and only drafts are ever deleted.
create_draft_release() {
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: skipping GitHub release creation"
        return
    fi

    print_step "Creating the draft of GitHub release v$VERSION..."

    # One more look, right before writing anything: a release published while
    # this run built its assets is left as it is.
    read_published_release "v$VERSION"
    if [[ "$PUBLISHED" == true ]]; then
        print_error "v$VERSION was published while this run built its assets. A published release is never changed: this run uploads nothing."
        exit 1
    fi

    list_drafts
    local id
    for id in "${DRAFT_IDS[@]}"; do
        print_warning "Deleting draft $id of v$VERSION, which an earlier run left unpublished"
        if ! gh_retrying "HTTP 404|Not Found" api -X DELETE "repos/$REPOSITORY/releases/$id" && ! grep -qiE "HTTP 404|Not Found" <<< "$GH_STDERR$GH_STDOUT"; then
            print_error "Could not delete draft $id of v$VERSION. GitHub said: $(gh_said)"
            exit 1
        fi
    done

    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "TEST RELEASE: Creating draft release v$VERSION (will not be published)"
    fi

    # The tag was already pushed, so the release attaches to the exact tagged
    # commit.
    if ! gh_retrying "" api -X POST "repos/$REPOSITORY/releases" \
        -f tag_name="v$VERSION" \
        -f name="v$VERSION" \
        -F body=@"$NOTES_FILE" \
        -F draft=true \
        -F prerelease=false \
        --jq .id; then
        print_error "Failed to create the draft of GitHub release v$VERSION. GitHub said: $(gh_said)"
        exit 1
    fi
    DRAFT_ID="$GH_STDOUT"
    if [[ ! "$DRAFT_ID" =~ ^[0-9]+$ ]]; then
        print_error "GitHub made the draft of v$VERSION, and answered no id for it: $GH_STDOUT"
        exit 1
    fi

    print_success "Created draft $DRAFT_ID of GitHub release v$VERSION"
}

# Function to upload the pre-built GoReleaser assets to this run's draft: the
# only release of the tag, so `gh release upload` finds it by the tag.
upload_release_assets() {
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: skipping release asset upload"
        return
    fi

    print_step "Uploading release assets to the draft..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    if [[ ! -d "dist" ]]; then
        print_error "GoReleaser dist directory not found - assets were never built"
        exit 1
    fi

    collect_release_assets

    # Fail loudly if nothing was uploaded. Otherwise a run that produced no
    # matching artifacts would let the job exit 0 with an empty release - the exact
    # "green but no assets" failure mode this script is meant to prevent.
    if [[ "${#RELEASE_ASSETS[@]}" -eq 0 ]]; then
        print_error "No release assets found to upload (dist/ had no zip/SHA256SUMS/sig/manifest files)"
        exit 1
    fi

    local file filename
    for file in "${RELEASE_ASSETS[@]}"; do
        filename=$(basename "$file")
        print_status "Uploading $filename..."
        # --clobber replaces only what this run uploaded to its own draft,
        # when an attempt failed halfway.
        if ! gh_retrying "" release upload "v$VERSION" "$file" --repo "$REPOSITORY" --clobber; then
            print_error "Failed to upload $filename. GitHub said: $(gh_said)"
            exit 1
        fi
        print_status "✓ Uploaded $filename"
    done

    print_success "Uploaded ${#RELEASE_ASSETS[@]} release assets"
}

# Checks the draft against what was built, before anyone can see it: every
# asset there, whole, with the SHA-256 it was built with, and nothing else.
verify_release_assets() {
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: skipping the check of the uploaded assets"
        return
    fi

    print_step "Checking the draft's assets against what was built..."

    local draft_file="$WORK_DIR/draft.json"
    if ! gh_retrying "" api "repos/$REPOSITORY/releases/$DRAFT_ID"; then
        print_error "Could not read draft $DRAFT_ID of v$VERSION. GitHub said: $(gh_said)"
        exit 1
    fi
    printf '%s\n' "$GH_STDOUT" > "$draft_file"

    collect_release_assets
    local differences status=0
    differences="$(node "$RELEASE_HELPER" check-uploaded "$draft_file" "${RELEASE_ASSETS[@]}")" || status=$?
    if (( status != 0 )); then
        print_error "Draft $DRAFT_ID of v$VERSION is not what was built, so it is not published:"
        while IFS= read -r difference; do
            [[ -n "$difference" ]] && print_error "  - $difference"
        done <<< "$differences"
        print_error "Run the release again: the next run deletes the draft and makes it anew."
        exit 1
    fi

    print_success "Draft $DRAFT_ID holds exactly the ${#RELEASE_ASSETS[@]} assets built for v$VERSION"
}

# Publishes the draft, whole: from now on the registries may read it, and
# nothing changes it again. It becomes the repository's latest release only
# when no published release is newer (a republished older version is not).
publish_release() {
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: skipping publishing the release"
        return
    fi

    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "TEST RELEASE: draft $DRAFT_ID of v$VERSION stays a draft (it is not published)"
        print_status "Review it at: https://github.com/$REPOSITORY/releases"
        return
    fi

    print_step "Publishing GitHub release v$VERSION..."

    read_published_release "v$VERSION"
    if [[ "$PUBLISHED" == true ]]; then
        print_error "v$VERSION was published while this run made its draft. A published release is never changed: draft $DRAFT_ID stays unpublished."
        exit 1
    fi

    local latest
    list_releases
    if [[ "$RELEASES_LISTED" == true ]]; then
        latest="$(node "$RELEASE_HELPER" latest "$VERSION" "$RELEASES_FILE")"
    elif [[ -n "$REPUBLISH_FROM" ]]; then
        latest=false
    else
        latest=true
    fi

    if ! gh_retrying "" api -X PATCH "repos/$REPOSITORY/releases/$DRAFT_ID" \
        -F draft=false \
        -f make_latest="$latest"; then
        print_error "Failed to publish draft $DRAFT_ID of v$VERSION. GitHub said: $(gh_said)"
        exit 1
    fi

    read_published_release "v$VERSION"
    if [[ "$PUBLISHED" != true ]]; then
        print_error "GitHub accepted publishing v$VERSION, and does not have it published"
        exit 1
    fi

    if [[ "$latest" == true ]]; then
        print_success "Published GitHub release v$VERSION, the latest"
    else
        print_success "Published GitHub release v$VERSION (not the latest: a newer version is published)"
    fi
}

# Function to publish to terraform registry
publish_to_registry() {
    print_step "Publishing to Terraform Registry..."

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: Skipping Terraform Registry publishing"
        return
    fi

    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "TEST RELEASE: Skipping Terraform Registry publishing"
        print_status "In a real run, the Terraform Registry would automatically detect the published release"
        return
    fi

    # The Terraform Registry and OpenTofu's read a release when it is
    # published, so there is nothing to send them.
    print_status "Terraform Registry will automatically detect the new release"
    print_status "Monitor the release at: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases"
    print_status "Provider will be available at: https://registry.terraform.io/providers/oneuptime/oneuptime/$VERSION"
}

# Function to cleanup
cleanup() {
    print_step "Cleaning up temporary files..."

    cd "$PROVIDER_FRAMEWORK_DIR" 2>/dev/null || cd "$PROJECT_ROOT"

    # Remove any temporary files
    rm -f release-notes-*.md
    if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
        rm -rf "$WORK_DIR"
    fi

    # Clean up SSH key if it was created
    if [[ -n "$TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY" && -f "$HOME/.ssh/terraform_provider_deploy_key" ]]; then
        rm -f "$HOME/.ssh/terraform_provider_deploy_key"
    fi

    print_success "Cleanup completed"
}

# Function to show summary
show_summary() {
    print_step "Publishing Summary"
    echo ""
    echo "Provider Name: $PROVIDER_NAME"
    echo "Version: $VERSION"
    echo "Provider Files Location: $PROVIDER_FRAMEWORK_DIR"
    echo "GitHub Repository: https://github.com/$GITHUB_ORG/$PROVIDER_REPO"
    echo "Terraform Registry: https://registry.terraform.io/providers/oneuptime/oneuptime"
    echo ""

    local tests_line="✓ Ran go vet and go test on the provider tree"
    if [[ "$SKIP_TESTS" == true ]]; then
        tests_line="• Tests skipped (--skip-tests)"
    fi

    if [[ "$ALREADY_PUBLISHED" == true ]]; then
        print_success "v$VERSION is published already - nothing was generated, built, pushed or uploaded."
        echo "• A published release is never changed: its assets are what the registries read"
        echo "• To mend a published version, publish its provider again as a new one (--republish-from)"
        return
    fi

    if [[ "$NOTHING_TO_PUBLISH" == true ]]; then
        print_success "No provider changes detected - nothing was published."
        echo "✓ Generated Terraform provider"
        echo "• No changes vs remote (ignoring VERSION) - skipped commit, tag, release, and registry publish"
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "This was a DRY RUN. Assets were built and signed, but nothing was pushed or released:"
        if [[ -n "$REPUBLISH_FROM" ]]; then
            echo "✓ Tagged $REPUBLISH_FROM's commit as v$VERSION locally"
        else
            echo "✓ Generated Terraform provider"
            echo "✓ Synced provider tree and created local commit + tag"
        fi
        echo "$tests_line"
        echo "✓ Built and signed all release assets with GoReleaser (dist/)"
        echo "✓ Wrote the release notes"
        echo "✗ Skipped git push, tag push, GitHub release creation, asset upload, and registry publish"
        return
    fi

    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "This was a TEST RELEASE with the following actions taken:"
        echo "✓ Generated Terraform provider"
        echo "$tests_line"
        echo "✓ Built and signed all release assets with GoReleaser (before pushing anything)"
        echo "✓ Pushed code and tag to terraform-provider-oneuptime repository"
        echo "✓ Created draft GitHub release v$VERSION, uploaded its assets and checked them"
        echo "✗ Left it a draft, and skipped Terraform Registry publishing"
        echo ""
        print_status "Next steps for a real release:"
        echo "1. Review the draft release: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases"
        echo "2. If satisfied, publish the release (remove draft status)"
        echo "3. Or run the script again without --test-release flag"
        echo "4. Monitor Terraform Registry for automatic indexing"
        return
    fi

    if [[ -n "$REPUBLISH_FROM" ]]; then
        print_success "Published $REPUBLISH_FROM's provider again, as v$VERSION!"
        echo "✓ Built the provider of $REPUBLISH_FROM's commit as v$VERSION"
    elif [[ "$HEAL_MODE" == true ]]; then
        print_warning "Tag v$VERSION already existed on the remote, and its release was never published:"
        echo "✓ Built the release from the exact commit tag v$VERSION points to"
    else
        print_success "Terraform provider published successfully!"
        echo ""
        print_status "Actions completed:"
        echo "✓ Generated Terraform provider"
    fi
    echo "$tests_line"
    echo "✓ Built and signed all release assets with GoReleaser (before pushing anything)"
    if [[ "$HEAL_MODE" == true ]]; then
        echo "• The tag was on the remote already: nothing pushed"
    elif [[ -n "$REPUBLISH_FROM" ]]; then
        echo "✓ Pushed tag v$VERSION"
    else
        echo "✓ Pushed code and tag to terraform-provider-oneuptime repository"
    fi
    echo "✓ Made the release a draft, uploaded its assets, and checked them against what was built"
    echo "✓ Published GitHub release v$VERSION, whole"
    echo "✓ Terraform Registry notified"
    echo ""
    print_status "Next steps:"
    echo "1. Monitor the GitHub release: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
    echo "2. Wait for Terraform Registry to index the new version (usually takes a few minutes)"
    echo "3. Test the provider installation: terraform init"
    echo ""
    print_status "Note: To generate a new provider version, run 'npm run generate-terraform-provider' first"
}


# Main execution function
main() {
    echo ""
    print_status "OneUptime Terraform Provider Publisher"
    print_status "====================================="
    echo ""

    parse_args "$@"
    WORK_DIR="$(mktemp -d)"

    validate_prerequisites
    # A published version is left as it is, before anything is generated.
    check_published_release

    if [[ "$ALREADY_PUBLISHED" == true ]]; then
        cleanup
        show_summary
        exit 0
    fi

    find_oneuptime_commit
    generate_provider
    sync_provider_repository

    if [[ "$NOTHING_TO_PUBLISH" == true ]]; then
        cleanup
        show_summary
        exit 0
    fi

    run_provider_tests
    # Build and sign everything BEFORE any push/tag/release so a failure in
    # the build cannot leave a public tag (or release) without assets.
    build_release_assets
    push_repository_changes
    write_release_notes
    # The release is a draft until it holds every asset, checked: only then
    # is it published, and the registries read it.
    create_draft_release
    upload_release_assets
    verify_release_assets
    publish_release
    publish_to_registry
    cleanup
    show_summary
}

# Trap errors and cleanup
trap cleanup ERR

# Run main function
main "$@"
