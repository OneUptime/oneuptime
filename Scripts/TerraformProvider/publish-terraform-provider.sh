#!/bin/bash

# OneUptime Terraform Provider Publisher
# This script publishes the generated Terraform provider to the Terraform Registry
# Note: Provider generation and Go module setup is handled by the TypeScript generator

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
RELEASE_ALREADY_EXISTS=false

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
    -s, --skip-tests                        Skip running tests
    -f, --force                            Force regeneration even if files exist
    --gpg-private-key KEY                   GPG private key for signing releases
    --github-token TOKEN                    GitHub token for authentication and operations
    --github-repo-deploy-key KEY            GitHub repository deploy key
    -h, --help                             Show this help message

Examples:
    $0 -v 1.0.0 --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }} --gpg-private-key \${{ secrets.GPG_PRIVATE_KEY }}
    $0 -v 1.1.0 --test-release --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }}
    $0 -v 1.0.1 --skip-tests --github-token \${{ secrets.SIMLARSEN_GITHUB_PAT }}

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

# Function to validate prerequisites
validate_prerequisites() {
    print_step "Validating prerequisites..."

    # Check if we're in the correct directory
    if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
        print_error "Not in OneUptime project root directory"
        exit 1
    fi

    # Check required tools
    local tools=("node" "npm" "go" "git" "curl" "jq")
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

    # Check environment variables for non-test-release mode
    if [[ "$TEST_RELEASE" == false ]]; then
        if [[ -z "$GITHUB_TOKEN" ]]; then
            print_error "GitHub token is required for publishing."
            print_error "Use --github-token option to provide the token."
            exit 1
        fi
        
        # Validate access to the target repository
        print_status "Validating access to target repository: $GITHUB_ORG/$PROVIDER_REPO"
        if command -v gh &> /dev/null; then
            if ! gh repo view "$GITHUB_ORG/$PROVIDER_REPO" &> /dev/null; then
                print_error "Cannot access repository $GITHUB_ORG/$PROVIDER_REPO"
                print_error "Please ensure the GitHub token has access to this repository"
                exit 1
            fi
        else
            # Fallback to API check if gh CLI is not available
            local repo_check_url="https://api.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO"
            if ! curl -s -H "Authorization: token $GITHUB_TOKEN" "$repo_check_url" | jq -e '.id' > /dev/null; then
                print_error "Cannot access repository $GITHUB_ORG/$PROVIDER_REPO"
                print_error "Please ensure the GitHub token has access to this repository"
                exit 1
            fi
        fi
        print_success "Repository access validated"
        
        if [[ -z "$GPG_PRIVATE_KEY" ]]; then
            print_warning "GPG private key not provided. Required for signing releases."
            print_warning "Use --gpg-private-key option to provide the key."
        fi
    fi

    print_success "Prerequisites validated"
}

# Function to install dependencies
install_dependencies() {
    print_step "Installing dependencies..."

    cd "$PROJECT_ROOT"
    
    # Install root dependencies
    print_status "Installing root dependencies..."
    npm install

    # Install Common dependencies
    if [[ -d "Common" ]]; then
        print_status "Installing Common dependencies..."
        cd Common && npm install && cd ..
    fi

    # Install Scripts dependencies
    if [[ -d "Scripts" ]]; then
        print_status "Installing Scripts dependencies..."
        cd Scripts && npm install && cd ..
    fi

    print_success "Dependencies installed"
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

# Function to push code to terraform-provider-oneuptime repository
push_to_repository() {
    print_step "Pushing generated code to terraform-provider-oneuptime repository..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    # Check for authentication method
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
        
        # For GitHub API operations, we still need a token
        if [[ -z "$GITHUB_TOKEN" ]]; then
            print_error "GitHub token is required for GitHub API operations (release creation)"
            print_error "Deploy key is used for git operations, but API operations require a token"
            print_error "Use --github-token option to provide the token."
            exit 1
        fi
    elif [[ -n "$GITHUB_TOKEN" ]]; then
        print_status "Using GitHub token for authentication"
        # Set up authentication for git and GitHub API
        export GH_TOKEN="$GITHUB_TOKEN"
        git config --global credential.helper store
        echo "https://$GITHUB_TOKEN@github.com" | git credential approve
    else
        print_error "Either deploy key or GitHub token is required for GitHub authentication"
        print_error "Use --github-repo-deploy-key or --github-token option to provide authentication"
        exit 1
    fi

    # Initialize git repository if it doesn't exist
    if [[ ! -d ".git" ]]; then
        print_status "Initializing git repository..."
        git init
        git branch -M master
    fi

    # Set up remote repository
    local remote_url=""
    if [[ -n "$TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY" ]]; then
        remote_url="git@github.com:$GITHUB_ORG/$PROVIDER_REPO.git"
    else
        remote_url="https://github.com/$GITHUB_ORG/$PROVIDER_REPO.git"
    fi

    # Check if remote exists, if not add it
    if ! git remote get-url origin &> /dev/null; then
        print_status "Adding remote origin: $remote_url"
        git remote add origin "$remote_url"
    else
        # Update the remote URL in case it changed
        git remote set-url origin "$remote_url"
    fi

    # Fetch remote changes to check if repository exists and has content
    print_status "Fetching remote changes..."
    if git fetch origin master 2>/dev/null; then
        print_status "Remote repository exists and has content"
        
        # Check if we have any local commits
        if git rev-parse HEAD &>/dev/null; then
            # We have local commits, need to merge or rebase
            print_status "Merging remote changes..."
            if ! git merge origin/master --allow-unrelated-histories; then
                print_error "Failed to merge remote changes. There may be conflicts."
                print_error "Please resolve conflicts manually or use --force flag to regenerate completely."
                exit 1
            fi
        else
            # No local commits, just reset to remote
            print_status "No local commits found, resetting to remote master..."
            git reset --hard origin/master
        fi
    else
        print_status "Remote repository is empty or doesn't exist yet"
    fi

    # Configure git user if not already configured
    if [[ -z "$(git config user.name)" ]]; then
        git config user.name "OneUptime Terraform Provider Bot"
    fi
    if [[ -z "$(git config user.email)" ]]; then
        git config user.email "terraform-provider@oneuptime.com"
    fi

    # Stage all changes
    print_status "Staging generated files..."
    git add .

    # Check if there are any changes to commit
    if git diff --staged --quiet; then
        print_warning "No changes detected in generated files"
        
        # Check if we're behind the remote
        if git rev-parse origin/master &>/dev/null; then
            local local_commit=$(git rev-parse HEAD 2>/dev/null || echo "")
            local remote_commit=$(git rev-parse origin/master 2>/dev/null || echo "")
            
            if [[ "$local_commit" != "$remote_commit" && -n "$remote_commit" ]]; then
                print_status "Local repository is behind remote, but no new changes to commit"
                print_status "Repository is already up to date with generated content"
                return
            fi
        fi
        
        print_status "Repository is already up to date"
        return
    fi

    # Commit changes
    local commit_message="chore: generate provider for version v$VERSION

This commit contains the auto-generated Terraform provider code for OneUptime v$VERSION.

Generated from OneUptime API specification on $(date -u '+%Y-%m-%d %H:%M:%S UTC').

Changes include:
- Updated provider resources and data sources
- Latest API schema definitions
- Generated documentation"

    print_status "Committing changes..."
    git commit -m "$commit_message"

    # Create and push tag
    print_status "Creating tag v$VERSION..."
    # Delete existing tag if it exists
    if git tag -l | grep -q "^v$VERSION$"; then
        print_warning "Tag v$VERSION already exists locally, removing..."
        git tag -d "v$VERSION"
    fi
    
    # Check if tag exists on remote
    if git ls-remote --tags origin | grep -q "refs/tags/v$VERSION$"; then
        if [[ "$FORCE" == true ]]; then
            print_warning "Tag v$VERSION exists on remote, force mode enabled - will overwrite"
        else
            print_error "Tag v$VERSION already exists on remote repository"
            print_error "Use --force flag to overwrite, or choose a different version"
            exit 1
        fi
    fi
    
    git tag -a "v$VERSION" -m "Release v$VERSION"

    # Push to remote repository
    print_status "Pushing changes to remote repository..."
    if ! git push origin master; then
        print_error "Failed to push to remote repository"
        print_error "This might be due to conflicts or permission issues"
        exit 1
    fi

    print_status "Pushing tag v$VERSION..."
    if [[ "$FORCE" == true ]] && git ls-remote --tags origin | grep -q "refs/tags/v$VERSION$"; then
        # Force push the tag if it exists and force mode is enabled
        if ! git push -f origin "v$VERSION"; then
            print_error "Failed to force push tag v$VERSION"
            exit 1
        fi
        print_warning "Force pushed tag v$VERSION"
    else
        if ! git push origin "v$VERSION"; then
            print_error "Failed to push tag v$VERSION"
            exit 1
        fi
    fi

    print_success "Code pushed to terraform-provider-oneuptime repository"
}

# Function to create GitHub release
create_github_release() {
    print_step "Creating GitHub release..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    # Authentication is already set up in push_to_repository function

    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "TEST RELEASE: Creating draft release v$VERSION (will not be published)"
    fi

    # Check if GitHub CLI is available, if not use API directly
    local use_gh_cli=true
    if ! command -v gh &> /dev/null; then
        print_warning "GitHub CLI (gh) is not installed. Using direct API calls."
        use_gh_cli=false
    fi

    # Skip release creation if the release already exists
    local release_exists=false
    if [[ "$use_gh_cli" == true ]]; then
        if gh release view "v$VERSION" --repo "$GITHUB_ORG/$PROVIDER_REPO" >/dev/null 2>&1; then
            release_exists=true
        fi
    else
        local existing_release_response=$(curl -s \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO/releases/tags/v$VERSION")
        if echo "$existing_release_response" | jq -e '.id' >/dev/null 2>&1; then
            release_exists=true
        fi
    fi

    if [[ "$release_exists" == true ]]; then
        print_warning "GitHub release v$VERSION already exists. Skipping release creation."
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

    # Create the release
    if [[ "$TEST_RELEASE" == true ]]; then
        print_status "Creating draft release v$VERSION for test release..."
    else
        print_status "Creating GitHub release v$VERSION..."
    fi
    
    if [[ "$use_gh_cli" == true ]]; then
        # Use GitHub CLI if available - specify the target repository
        if [[ "$TEST_RELEASE" == true ]]; then
            # For test release, create a draft release without specifying the tag upfront
            # This prevents the auto-generation of untagged releases
            if gh release create "v$VERSION" \
                --repo "$GITHUB_ORG/$PROVIDER_REPO" \
                --title "v$VERSION" \
                --notes-file "$release_notes_file" \
                --draft \
                --target master; then
                print_success "Draft release created successfully for test release"
                print_status "Note: This is a draft release. You can review it at: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
            else
                print_error "Failed to create GitHub release"
                exit 1
            fi
        else
            # For actual release, create without draft flag
            if gh release create "v$VERSION" \
                --repo "$GITHUB_ORG/$PROVIDER_REPO" \
                --title "v$VERSION" \
                --notes-file "$release_notes_file" \
                --target master; then
                print_success "GitHub release created successfully"
            else
                print_error "Failed to create GitHub release"
                exit 1
            fi
        fi
    else
        # Use direct API call if GitHub CLI is not available
        local api_url="https://api.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO/releases"
        local release_body=$(cat "$release_notes_file" | jq -Rs .)
        
        local is_draft="false"
        if [[ "$TEST_RELEASE" == true ]]; then
            is_draft="true"
        fi
        
        local response=$(curl -s -X POST "$api_url" \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            -d "{
                \"tag_name\": \"v$VERSION\",
                \"name\": \"v$VERSION\",
                \"body\": $release_body,
                \"draft\": $is_draft,
                \"target_commitish\": \"master\"
            }")
        
        if echo "$response" | jq -e '.id' > /dev/null; then
            if [[ "$TEST_RELEASE" == true ]]; then
                print_success "Draft release created successfully for test release via API"
                print_status "Note: This is a draft release. You can review it at: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
            else
                print_success "GitHub release created successfully via API"
            fi
        else
            print_error "Failed to create GitHub release via API"
            echo "Response: $response"
            exit 1
        fi
    fi

    # Clean up
    rm -f "$release_notes_file"
    
    # Use existing builds from generation process and generate SHASUMS
    generate_shasums
    
    # Upload release assets
    upload_release_assets
}


# Function to publish to terraform registry
publish_to_registry() {
    print_step "Publishing to Terraform Registry..."

    if [[ "$RELEASE_ALREADY_EXISTS" == true ]]; then
        print_status "Release already existed. Skipping Terraform Registry publish step."
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


# Function to generate SHASUMS and signature files
generate_shasums() {
    print_step "Generating SHASUMS and signature files..."

    cd "$PROVIDER_FRAMEWORK_DIR/builds"

    # Check if we have binary files to work with
    if ! ls terraform-provider-oneuptime_* 1> /dev/null 2>&1; then
        print_error "No terraform provider binaries found in builds directory"
        print_error "Expected files like: terraform-provider-oneuptime_darwin_amd64"
        exit 1
    fi

    # Create zip archives for each binary following Terraform's naming convention
    print_status "Creating zip archives from binaries..."
    for binary in terraform-provider-oneuptime_*; do
        if [[ -f "$binary" ]]; then
            # Extract OS and architecture from filename
            # e.g., terraform-provider-oneuptime_darwin_amd64 -> darwin_amd64
            local os_arch=$(echo "$binary" | sed 's/terraform-provider-oneuptime_//')
            
            # Handle Windows executable extension
            if [[ "$binary" == *.exe ]]; then
                os_arch=$(echo "$os_arch" | sed 's/\.exe$//')
            fi
            
            # Create zip file with Terraform's expected naming convention
            local zip_name="terraform-provider-${PROVIDER_NAME}_${VERSION}_${os_arch}.zip"
            
            print_status "Creating $zip_name from $binary..."
            if command -v zip &> /dev/null; then
                zip -q "$zip_name" "$binary"
            else
                print_error "zip command not found. Please install zip utility."
                exit 1
            fi
            
            # Verify zip was created
            if [[ ! -f "$zip_name" ]]; then
                print_error "Failed to create $zip_name"
                exit 1
            fi
            
            print_status "✓ Created $zip_name"
        fi
    done

    # Also include the manifest file if it exists
    if [[ -f "../terraform-registry-manifest.json" ]]; then
        print_status "Adding terraform-registry-manifest.json to archives..."
        local manifest_archive="terraform-provider-${PROVIDER_NAME}_${VERSION}_manifest.json"
        cp "../terraform-registry-manifest.json" "$manifest_archive"
        print_status "✓ Created $manifest_archive"
    fi

    # Generate SHA256 sums for all zip files and manifest
    local shasums_file="terraform-provider-${PROVIDER_NAME}_${VERSION}_SHA256SUMS"
    
    print_status "Generating SHA256SUMS..."
    
    # Check if we have any zip files
    if ! ls *.zip 1> /dev/null 2>&1; then
        print_error "No zip files found after creation"
        exit 1
    fi
    
    # Generate checksums for zip files and manifest
    if command -v shasum &> /dev/null; then
        shasum -a 256 *.zip > "$shasums_file"
        if [[ -f "terraform-provider-${PROVIDER_NAME}_${VERSION}_manifest.json" ]]; then
            shasum -a 256 "terraform-provider-${PROVIDER_NAME}_${VERSION}_manifest.json" >> "$shasums_file"
        fi
    elif command -v sha256sum &> /dev/null; then
        sha256sum *.zip > "$shasums_file"
        if [[ -f "terraform-provider-${PROVIDER_NAME}_${VERSION}_manifest.json" ]]; then
            sha256sum "terraform-provider-${PROVIDER_NAME}_${VERSION}_manifest.json" >> "$shasums_file"
        fi
    else
        print_error "Neither shasum nor sha256sum command found"
        exit 1
    fi

    print_status "Generated $shasums_file with $(wc -l < "$shasums_file") entries"

    # Sign the checksums file with GPG
    print_status "Signing $shasums_file with GPG..."
    
    # List available GPG keys for debugging
    print_status "Available GPG secret keys:"
    gpg --list-secret-keys --keyid-format=long
    
    # Get the first available secret key ID
    local key_id=$(gpg --list-secret-keys --keyid-format=long | grep -E "^sec" | head -1 | sed 's/.*\/\([A-F0-9]*\).*/\1/')
    
    if [[ -z "$key_id" ]]; then
        print_error "No GPG secret key found. Please ensure GPG key is imported."
        exit 1
    fi
    
    print_status "Using GPG key: $key_id"
    
    # Create binary (non-ASCII armored) detached signature
    gpg --batch --yes --local-user "$key_id" --output "${shasums_file}.sig" --detach-sig "$shasums_file"
    if [[ $? -ne 0 ]]; then
        print_error "Failed to sign $shasums_file"
        exit 1 
    fi
    print_success "Signed $shasums_file successfully"
    

    # Show summary of created files
    print_status "Created release assets:"
    for file in *.zip *SHA256SUMS* *.sig *.json; do
        if [[ -f "$file" ]]; then
            local size=$(ls -lh "$file" | awk '{print $5}')
            print_status "  - $file ($size)"
        fi
    done

    cd "$PROVIDER_FRAMEWORK_DIR"
    print_success "SHASUMS generation completed"
}

# Function to upload release assets
upload_release_assets() {
    print_step "Uploading release assets..."

    cd "$PROVIDER_FRAMEWORK_DIR"

    local builds_dir="builds"
    
    if [[ ! -d "$builds_dir" ]]; then
        print_error "Builds directory not found. Provider generation should have created builds directory with multi-platform binaries."
        print_error "Expected directory: $PROVIDER_FRAMEWORK_DIR/builds"
        print_error "Please ensure 'npm run generate-terraform-provider' completed successfully and created the builds directory."
        print_error "If the issue persists, try running 'make release' manually in the provider directory."
        exit 1
    fi

    # Check if GitHub CLI is available
    if command -v gh &> /dev/null; then
        print_status "Uploading assets using GitHub CLI..."
        
        # Debug: List all files in builds directory
        print_status "Files available in builds directory:"
        ls -la "$builds_dir"/
        
        # Upload all zip files, SHASUMS files, signature files, and manifest files
        local files_found=false
        for file in "$builds_dir"/*.zip "$builds_dir"/*SHA256SUMS* "$builds_dir"/*.sig "$builds_dir"/*.json; do
            if [[ -f "$file" ]]; then
                files_found=true
                local filename=$(basename "$file")
                print_status "Uploading $filename..."
                if gh release upload "v$VERSION" "$file" --repo "$GITHUB_ORG/$PROVIDER_REPO" --clobber; then
                    print_status "✓ Uploaded $filename"
                else
                    print_error "Failed to upload $filename"
                    exit 1
                fi
            fi
        done
        
        if [[ "$files_found" == false ]]; then
            print_warning "No files found matching upload patterns in $builds_dir"
            print_status "Looking for: *.zip, *SHA256SUMS*, *.sig, *.json"
        fi
    else
        print_warning "GitHub CLI not available, using curl for asset upload..."
        
        # Get release ID
        local release_id=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
            "https://api.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO/releases/tags/v$VERSION" | \
            jq -r '.id')
        
        if [[ "$release_id" == "null" || -z "$release_id" ]]; then
            print_error "Could not find release ID for v$VERSION"
            exit 1
        fi
        
        # Upload each file
        local files_found=false
        for file in "$builds_dir"/*.zip "$builds_dir"/*SHA256SUMS* "$builds_dir"/*.sig "$builds_dir"/*.json; do
            if [[ -f "$file" ]]; then
                files_found=true
                local filename=$(basename "$file")
                
                # Check if asset already exists and delete it
                print_status "Checking if $filename already exists..."
                local existing_asset_id=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
                    "https://api.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO/releases/$release_id/assets" | \
                    jq -r ".[] | select(.name == \"$filename\") | .id")
                
                if [[ -n "$existing_asset_id" && "$existing_asset_id" != "null" ]]; then
                    print_status "Asset $filename already exists (ID: $existing_asset_id), deleting..."
                    local delete_response=$(curl -s -X DELETE \
                        -H "Authorization: token $GITHUB_TOKEN" \
                        "https://api.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO/releases/assets/$existing_asset_id")
                    print_status "✓ Deleted existing $filename"
                fi
                
                local upload_url="https://uploads.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO/releases/$release_id/assets?name=$filename"
                
                print_status "Uploading $filename..."
                local response=$(curl -s -X POST \
                    -H "Authorization: token $GITHUB_TOKEN" \
                    -H "Content-Type: application/octet-stream" \
                    --data-binary "@$file" \
                    "$upload_url")
                
                if echo "$response" | jq -e '.id' > /dev/null; then
                    print_status "✓ Uploaded $filename"
                else
                    print_error "Failed to upload $filename"
                    echo "Response: $response"
                    exit 1
                fi
            fi
        done
        
        if [[ "$files_found" == false ]]; then
            print_warning "No files found matching upload patterns in $builds_dir"
            print_status "Looking for: *.zip, *SHA256SUMS*, *.sig, *.json"
            print_status "Files available in builds directory:"
            ls -la "$builds_dir"/
        fi
    fi

    print_success "All release assets uploaded successfully"
}

# Function to cleanup
cleanup() {
    print_step "Cleaning up temporary files..."
    
    cd "$PROVIDER_FRAMEWORK_DIR" 2>/dev/null || cd "$PROJECT_ROOT"
    
    # Remove temporary SHASUMS files if they exist
    if [[ -d "builds" ]]; then
        # Only remove SHASUMS files, signature files, and generated zip files, keep the original binaries
        rm -f builds/*SHA256SUMS* builds/*.sig builds/*.zip builds/*manifest.json
    fi
    
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

    if [[ "$RELEASE_ALREADY_EXISTS" == true ]]; then
        print_warning "GitHub release v$VERSION already existed. Skipped release creation and registry publishing."
        echo "✓ Generated Terraform provider"
        echo "✓ Ran tests (if not skipped)"
        echo "✓ Pushed code to terraform-provider-oneuptime repository"
        echo "✗ Release creation skipped"
        echo "✗ Terraform Registry publish skipped"
        echo ""
        print_status "If you need to update the existing release, delete it first or rerun with --force."
        return
    fi
    
    if [[ "$TEST_RELEASE" == true ]]; then
        print_warning "This was a TEST RELEASE with the following actions taken:"
        echo "✓ Generated Terraform provider"
        echo "✓ Ran tests (if not skipped)"
        echo "✓ Pushed code to terraform-provider-oneuptime repository"
        echo "✓ Created draft GitHub release v$VERSION"
        echo "✓ Generated multi-platform zip archives from binaries (linux, darwin, windows, freebsd)"
        echo "✓ Generated SHA256SUMS and signature files"
        echo "✓ Uploaded release assets"
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
        echo "✓ Ran tests (if not skipped)"
        echo "✓ Pushed code to terraform-provider-oneuptime repository"
        echo "✓ Created GitHub release v$VERSION"
        echo "✓ Generated multi-platform zip archives from binaries (linux, darwin, windows, freebsd)"
        echo "✓ Generated SHA256SUMS and signature files"
        echo "✓ Uploaded release assets"
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
    install_dependencies
    generate_provider
    push_to_repository
    create_github_release
    publish_to_registry
    cleanup
    show_summary
}

# Trap errors and cleanup
trap cleanup ERR

# Run main function
main "$@"