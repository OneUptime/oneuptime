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
VERSION=""
TEST_RELEASE=false
SKIP_TESTS=false
FORCE=false
DRY_RUN=false
RELEASE_ALREADY_EXISTS=false
HEAL_MODE=false
NOTHING_TO_PUBLISH=false
# Push URL with embedded credentials. Held in memory only for the push
# commands — never written to git config or a credentials file on disk.
PUSH_URL=""

# Files in the provider repo that are owned by the repo itself (the generator
# does not emit them) and must survive the deletion-aware sync. .git is never
# touched by `git rm`, so it needs no entry here.
REPO_OWNED_PATHSPECS=(
    ':(exclude).github'
    ':(exclude)CHANGELOG*'
    ':(exclude)LICENSE*'
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
    -f, --force                            Force regeneration even if files exist
    -d, --dry-run                          Build and sign all release assets but skip git push, tag push, release creation, and uploads
    --gpg-private-key KEY                   GPG private key for signing releases
    --github-token TOKEN                    GitHub token for authentication and operations
    --github-repo-deploy-key KEY            GitHub repository deploy key
    -h, --help                             Show this help message

Examples:
    $0 -v 1.0.0 --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }} --gpg-private-key \${{ secrets.GPG_PRIVATE_KEY }}
    $0 -v 1.1.0 --test-release --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }}
    $0 -v 1.0.1-test --test-release --dry-run

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

# Function to generate terraform provider
generate_provider() {
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

# Function to sync generated code into the terraform-provider-oneuptime
# repository checkout: authenticate, fetch remote state, perform a
# deletion-aware sync, and create the local commit + tag. Nothing is pushed
# here — pushing happens only after release assets are fully built and signed.
sync_provider_repository() {
    print_step "Syncing generated code into terraform-provider-oneuptime repository checkout..."

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
    print_status "Saving generated files temporarily..."
    local temp_dir=$(mktemp -d)
    cp -r . "$temp_dir/"
    rm -rf \
        "$temp_dir/.git" \
        "$temp_dir/dist" \
        "$temp_dir/builds" \
        "$temp_dir/terraform-provider-oneuptime" \
        "$temp_dir/terraform-provider-oneuptime.exe" \
        2>/dev/null || true

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

    # If the tag already exists on the remote, a previous run already published
    # this version's code. Unless --force is given we do NOT rebuild from the
    # freshly generated (potentially different) tree — we heal the release by
    # rebuilding assets from the exact commit the remote tag points to.
    if [[ "$DRY_RUN" == false ]] && git ls-remote --tags origin | grep -q "refs/tags/v$VERSION$"; then
        if [[ "$FORCE" == true ]]; then
            print_warning "Tag v$VERSION exists on remote, force mode enabled - will overwrite"
        else
            print_warning "Tag v$VERSION already exists on remote repository"
            print_status "Healing mode: release assets will be rebuilt from the exact commit the remote tag points to."
            print_status "Use --force flag to overwrite the code/tag if needed"
            HEAL_MODE=true

            rm -rf "$temp_dir"

            # Fetch the remote tag object and check out exactly the commit it
            # points to, discarding the freshly generated tree. GoReleaser
            # derives the version from the tag at HEAD.
            git tag -d "v$VERSION" 2>/dev/null || true
            if ! git fetch --depth=1 origin "refs/tags/v${VERSION}:refs/tags/v${VERSION}"; then
                print_error "Failed to fetch remote tag v$VERSION"
                exit 1
            fi
            git reset --hard "refs/tags/v$VERSION^{commit}"
            # Remove untracked leftovers from generation so GoReleaser's dirty
            # check sees a pristine tree for the tagged commit.
            git clean -fdx
            print_success "Checked out tagged commit $(git rev-parse HEAD) for v$VERSION"
            return
        fi
    fi

    # Deletion-aware sync: drop every tracked file before copying the fresh
    # generator output in, so resources/docs the generator no longer emits are
    # actually deleted from the provider repo instead of accumulating forever.
    # Repo-owned files (.github/, CHANGELOG*, LICENSE*, .gitignore) are
    # excluded and survive; .git is never touched by git rm.
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

    # Create commit with generated files
    print_status "Creating commit with generated files..."
    local commit_message="chore: generate provider for version v$VERSION

This commit contains the auto-generated Terraform provider code for OneUptime v$VERSION.

Generated from OneUptime API specification on $(date -u '+%Y-%m-%d %H:%M:%S UTC').

Changes include:
- Updated provider resources and data sources
- Latest API schema definitions
- Generated documentation"
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

    print_status "Using GPG key: $gpg_fingerprint"
    print_status "Running GoReleaser to create archives, checksums, and signatures..."

    # GoReleaser builds archives + checksums + signs in one parallelized step
    # We use --skip=publish because the release is created and assets are
    # uploaded separately, only after this build fully succeeds.
    #
    # --parallelism 1 forces GoReleaser to cross-compile one target at a time.
    # The generated provider is a single ~600K-line `package provider`, so each
    # Go compilation is memory-heavy. GoReleaser defaults parallelism to the CPU
    # count (4 on GitHub's ubuntu-latest), which compiles 4 targets at once and
    # exhausts the runner's 16GB RAM -> the host kills the runner mid-build
    # ("The runner has received a shutdown signal" / exit 143). Serializing the
    # builds keeps peak memory to a single compile and prevents the OOM.
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
    local files_built=0
    for file in "$dist_dir"/*.zip "$dist_dir"/*SHA256SUMS* "$dist_dir"/*.sig "$dist_dir"/*_manifest.json; do
        if [[ -f "$file" ]]; then
            files_built=$((files_built + 1))
        fi
    done

    if [[ "$files_built" -eq 0 ]]; then
        print_error "GoReleaser produced no release assets (dist/ had no zip/SHA256SUMS/sig/manifest files)"
        exit 1
    fi

    print_success "Built and signed $files_built release assets (not uploaded yet)"
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

    print_step "Pushing commit and tag to terraform-provider-oneuptime repository..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    print_status "Pushing changes to remote repository..."
    if ! git push "$PUSH_URL" master; then
        print_error "Failed to push to remote repository"
        print_error "This might be due to conflicts or permission issues"
        exit 1
    fi

    print_status "Pushing tag v$VERSION..."
    if [[ "$FORCE" == true ]] && git ls-remote --tags origin | grep -q "refs/tags/v$VERSION$"; then
        # Force push the tag if it exists and force mode is enabled
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

# Function to create GitHub release (gh CLI)
create_github_release() {
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: skipping GitHub release creation"
        return
    fi

    print_step "Creating GitHub release..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "TEST RELEASE: Creating draft release v$VERSION (will not be published)"
    fi

    # Skip release creation if the release already exists. A previous run may
    # have created it but failed before uploading assets — the upload step
    # that follows heals it either way (uploads use --clobber).
    if gh release view "v$VERSION" --repo "$GITHUB_ORG/$PROVIDER_REPO" >/dev/null 2>&1; then
        print_warning "GitHub release v$VERSION already exists. Skipping release creation."
        print_status "Will still upload the freshly built assets so the release ends up complete."
        RELEASE_ALREADY_EXISTS=true
        return
    fi

    # Create release notes
    local release_notes_file="release-notes-v$VERSION.md"
    cat > "$release_notes_file" << EOF
# v$VERSION

## What's Changed

This release includes the latest OneUptime Terraform provider generated from the OneUptime API specification.

### Features
- Full support for OneUptime resources and data sources
- Auto-generated from OpenAPI specification
- Supports all OneUptime monitoring and incident management features

### Resources Included
- Monitors and Monitor Groups
- Incidents and Alerts
- Status Pages
- On-Call Policies and Schedules
- Teams and Users
- Service Catalog
- Workflows
- And many more...

### Installation

\`\`\`hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> $VERSION"
    }
  }
}
\`\`\`

For detailed documentation and examples, visit: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs

**Full Changelog**: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/compare/v$(echo $VERSION | awk -F. '{print $1"."$2"."($3-1)}')...v$VERSION
EOF

    # Create the release. The tag was already pushed, so the release attaches
    # to the exact tagged commit.
    local gh_args=()
    if [[ "$TEST_RELEASE" == true ]]; then
        print_status "Creating draft release v$VERSION for test release..."
        gh_args+=(--draft)
    else
        print_status "Creating GitHub release v$VERSION..."
    fi

    if gh release create "v$VERSION" \
        --repo "$GITHUB_ORG/$PROVIDER_REPO" \
        --title "v$VERSION" \
        --notes-file "$release_notes_file" \
        "${gh_args[@]}"; then
        if [[ "$TEST_RELEASE" == true ]]; then
            print_success "Draft release created successfully for test release"
            print_status "Note: This is a draft release. You can review it at: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
        else
            print_success "GitHub release created successfully"
        fi
    else
        print_error "Failed to create GitHub release"
        exit 1
    fi

    # Clean up
    rm -f "$release_notes_file"
}

# Function to upload the pre-built GoReleaser assets to the GitHub release
upload_release_assets() {
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: skipping release asset upload"
        return
    fi

    print_step "Uploading release assets..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    local dist_dir="dist"

    if [[ ! -d "$dist_dir" ]]; then
        print_error "GoReleaser dist directory not found - assets were never built"
        exit 1
    fi

    local files_uploaded=0
    # Glob *_manifest.json (not *.json) so GoReleaser's internal artifacts.json /
    # metadata.json are not uploaded as release assets.
    for file in "$dist_dir"/*.zip "$dist_dir"/*SHA256SUMS* "$dist_dir"/*.sig "$dist_dir"/*_manifest.json; do
        if [[ -f "$file" ]]; then
            local filename=$(basename "$file")
            print_status "Uploading $filename..."
            if ! gh release upload "v$VERSION" "$file" --repo "$GITHUB_ORG/$PROVIDER_REPO" --clobber; then
                print_error "Failed to upload $filename"
                exit 1
            fi
            print_status "✓ Uploaded $filename"
            files_uploaded=$((files_uploaded + 1))
        fi
    done

    # Fail loudly if nothing was uploaded. Otherwise a run that produced no
    # matching artifacts would let the job exit 0 with an empty release - the exact
    # "green but no assets" failure mode this script is meant to prevent.
    if [[ "$files_uploaded" -eq 0 ]]; then
        print_error "No release assets found to upload (dist/ had no zip/SHA256SUMS/sig/manifest files)"
        exit 1
    fi

    print_success "Uploaded $files_uploaded release assets"
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

    cd "$PROVIDER_FRAMEWORK_DIR"

    # The Terraform Registry automatically pulls from GitHub releases
    # So we just need to ensure everything is properly tagged and released

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

    if [[ "$NOTHING_TO_PUBLISH" == true ]]; then
        print_success "No provider changes detected - nothing was published."
        echo "✓ Generated Terraform provider"
        echo "• No changes vs remote (ignoring VERSION) - skipped commit, tag, release, and registry publish"
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "This was a DRY RUN. Assets were built and signed, but nothing was pushed or released:"
        echo "✓ Generated Terraform provider"
        echo "✓ Synced provider tree and created local commit + tag"
        echo "$tests_line"
        echo "✓ Built and signed all release assets with GoReleaser (dist/)"
        echo "✗ Skipped git push, tag push, GitHub release creation, asset upload, and registry publish"
        return
    fi

    if [[ "$HEAL_MODE" == true ]]; then
        print_warning "Tag v$VERSION already existed on the remote. Healed the release from the tagged commit:"
        echo "✓ Rebuilt release assets from the exact commit tag v$VERSION points to"
        echo "$tests_line"
        if [[ "$RELEASE_ALREADY_EXISTS" == true ]]; then
            echo "• Release creation skipped (release already existed)"
        else
            echo "✓ Created GitHub release v$VERSION"
        fi
        echo "✓ Uploaded release assets (archives, checksums, signatures, manifest)"
        echo ""
        print_status "To republish from freshly generated code instead, rerun with --force."
        return
    fi

    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "This was a TEST RELEASE with the following actions taken:"
        echo "✓ Generated Terraform provider"
        echo "$tests_line"
        echo "✓ Built and signed all release assets with GoReleaser (before pushing anything)"
        echo "✓ Pushed code and tag to terraform-provider-oneuptime repository"
        echo "✓ Created draft GitHub release v$VERSION"
        echo "✓ Uploaded release assets (archives, checksums, signatures, manifest)"
        echo "✗ Skipped Terraform Registry publishing"
        echo ""
        print_status "Next steps for a real release:"
        echo "1. Review the draft release: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
        echo "2. If satisfied, publish the release (remove draft status)"
        echo "3. Or run the script again without --test-release flag"
        echo "4. Monitor Terraform Registry for automatic indexing"
    else
        print_success "Terraform provider published successfully!"
        echo ""
        print_status "Actions completed:"
        echo "✓ Generated Terraform provider"
        echo "$tests_line"
        echo "✓ Built and signed all release assets with GoReleaser (before pushing anything)"
        echo "✓ Pushed code and tag to terraform-provider-oneuptime repository"
        if [[ "$RELEASE_ALREADY_EXISTS" == true ]]; then
            echo "• Release creation skipped (release already existed); assets re-uploaded"
        else
            echo "✓ Created GitHub release v$VERSION"
        fi
        echo "✓ Uploaded release assets (archives, checksums, signatures, manifest)"
        echo "✓ Terraform Registry notified"
        echo ""
        print_status "Next steps:"
        echo "1. Monitor the GitHub release: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
        echo "2. Wait for Terraform Registry to index the new version (usually takes a few minutes)"
        echo "3. Test the provider installation: terraform init"
        echo "4. Update documentation if needed"
        echo ""
        print_status "Note: To generate a new provider version, run 'npm run generate-terraform-provider' first"
    fi
}


# Main execution function
main() {
    echo ""
    print_status "OneUptime Terraform Provider Publisher"
    print_status "====================================="
    echo ""

    parse_args "$@"

    validate_prerequisites
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
    create_github_release
    upload_release_assets
    publish_to_registry
    cleanup
    show_summary
}

# Trap errors and cleanup
trap cleanup ERR

# Run main function
main "$@"
