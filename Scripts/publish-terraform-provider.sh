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
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$PROJECT_ROOT/Terraform"
PROVIDER_NAME="oneuptime"
PROVIDER_REPO="terraform-provider-$PROVIDER_NAME"
GITHUB_ORG="OneUptime"
VERSION=""
DRY_RUN=false
SKIP_TESTS=false
FORCE=false

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
    -v, --version VERSION   Specify the version to publish (e.g., 1.0.0)
    -d, --dry-run          Run in dry-run mode (no actual publishing)
    -s, --skip-tests       Skip running tests
    -f, --force           Force regeneration even if files exist
    -h, --help            Show this help message

Examples:
    $0 -v 1.0.0                    # Publish version 1.0.0
    $0 -v 1.1.0 --dry-run         # Test publishing version 1.1.0
    $0 -v 1.0.1 --skip-tests      # Publish without running tests

Environment Variables:
    GITHUB_TOKEN                   # Required for GitHub authentication and operations
    GPG_PRIVATE_KEY               # Required for signing releases
    TERRAFORM_REGISTRY_TOKEN      # Required for Terraform Registry publishing

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
            -d|--dry-run)
                DRY_RUN=true
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

    # Check environment variables for non-dry-run mode
    if [[ "$DRY_RUN" == false ]]; then
        if [[ -z "$GITHUB_TOKEN" ]]; then
            print_error "GITHUB_TOKEN environment variable not set. Required for publishing."
            exit 1
        fi
        
        # Validate access to the target repository
        print_status "Validating access to target repository: $GITHUB_ORG/$PROVIDER_REPO"
        if command -v gh &> /dev/null; then
            if ! gh repo view "$GITHUB_ORG/$PROVIDER_REPO" &> /dev/null; then
                print_error "Cannot access repository $GITHUB_ORG/$PROVIDER_REPO"
                print_error "Please ensure the GITHUB_TOKEN has access to this repository"
                exit 1
            fi
        else
            # Fallback to API check if gh CLI is not available
            local repo_check_url="https://api.github.com/repos/$GITHUB_ORG/$PROVIDER_REPO"
            if ! curl -s -H "Authorization: token $GITHUB_TOKEN" "$repo_check_url" | jq -e '.id' > /dev/null; then
                print_error "Cannot access repository $GITHUB_ORG/$PROVIDER_REPO"
                print_error "Please ensure the GITHUB_TOKEN has access to this repository"
                exit 1
            fi
        fi
        print_success "Repository access validated"
        
        if [[ -z "$GPG_PRIVATE_KEY" ]]; then
            print_warning "GPG_PRIVATE_KEY environment variable not set. Required for signing releases."
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

    local go_files=$(find "$TERRAFORM_DIR" -name "*.go" | wc -l)
    print_status "Generated $go_files Go files"

    if [[ "$go_files" -eq 0 ]]; then
        print_error "No Go files were generated"
        exit 1
    fi

    print_success "Terraform provider generated successfully"
}

# Function to run tests
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_warning "Skipping tests as requested"
        return
    fi

    print_step "Running tests..."

    cd "$TERRAFORM_DIR"

    # Check if there are any test files
    local test_files=$(find . -name "*_test.go" | wc -l)
    if [[ "$test_files" -eq 0 ]]; then
        print_warning "No test files found, skipping tests"
        return
    fi

    # Run Go tests
    print_status "Running Go tests..."
    if go test -v ./...; then
        print_success "All tests passed"
    else
        print_error "Tests failed"
        exit 1
    fi
}

# Function to create GitHub release
create_github_release() {
    print_step "Creating GitHub release..."

    cd "$TERRAFORM_DIR"

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
            print_error "GITHUB_TOKEN environment variable is required for GitHub API operations (release creation)"
            print_error "Deploy key is used for git operations, but API operations require a token"
            exit 1
        fi
    elif [[ -n "$GITHUB_TOKEN" ]]; then
        print_status "Using GitHub token for authentication"
        # Set up authentication for git and GitHub API
        export GH_TOKEN="$GITHUB_TOKEN"
        git config --global credential.helper store
        echo "https://$GITHUB_TOKEN@github.com" | git credential approve
    else
        print_error "Either TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY or GITHUB_TOKEN environment variable is required for GitHub authentication"
        exit 1
    fi

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: Creating draft release v$VERSION (will not be published)"
    fi

    # Check if GitHub CLI is available, if not use API directly
    local use_gh_cli=true
    if ! command -v gh &> /dev/null; then
        print_warning "GitHub CLI (gh) is not installed. Using direct API calls."
        use_gh_cli=false
    fi

    # Create release notes
    local release_notes_file="release-notes-v$VERSION.md"
    cat > "$release_notes_file" << EOF
# OneUptime Terraform Provider v$VERSION

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
    if [[ "$DRY_RUN" == true ]]; then
        print_status "Creating draft release v$VERSION for dry run..."
    else
        print_status "Creating GitHub release v$VERSION..."
    fi
    
    if [[ "$use_gh_cli" == true ]]; then
        # Use GitHub CLI if available - specify the target repository
        if [[ "$DRY_RUN" == true ]]; then
            # For dry run, create a draft release without specifying the tag upfront
            # This prevents the auto-generation of untagged releases
            if gh release create "v$VERSION" \
                --repo "$GITHUB_ORG/$PROVIDER_REPO" \
                --title "OneUptime Terraform Provider v$VERSION" \
                --notes-file "$release_notes_file" \
                --draft \
                --target main; then
                print_success "Draft release created successfully for dry run"
                print_status "Note: This is a draft release. You can review it at: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
            else
                print_error "Failed to create GitHub release"
                exit 1
            fi
        else
            # For actual release, create without draft flag
            if gh release create "v$VERSION" \
                --repo "$GITHUB_ORG/$PROVIDER_REPO" \
                --title "OneUptime Terraform Provider v$VERSION" \
                --notes-file "$release_notes_file" \
                --target main; then
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
        
        local is_draft="true"
        if [[ "$DRY_RUN" == false ]]; then
            is_draft="false"
        fi
        
        local response=$(curl -s -X POST "$api_url" \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            -d "{
                \"tag_name\": \"v$VERSION\",
                \"name\": \"OneUptime Terraform Provider v$VERSION\",
                \"body\": $release_body,
                \"draft\": $is_draft,
                \"target_commitish\": \"main\"
            }")
        
        if echo "$response" | jq -e '.id' > /dev/null; then
            if [[ "$DRY_RUN" == true ]]; then
                print_success "Draft release created successfully for dry run via API"
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
    if [[ -n "$TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY" && -f "$HOME/.ssh/terraform_provider_deploy_key" ]]; then
        rm -f "$HOME/.ssh/terraform_provider_deploy_key"
    fi
}

# Function to publish to terraform registry
publish_to_registry() {
    print_step "Publishing to Terraform Registry..."

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: Skipping Terraform Registry publishing"
        print_status "In a real run, the Terraform Registry would automatically detect the published release"
        return
    fi

    cd "$TERRAFORM_DIR"

    # The Terraform Registry automatically pulls from GitHub releases
    # So we just need to ensure everything is properly tagged and released

    print_status "Terraform Registry will automatically detect the new release"
    print_status "Monitor the release at: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases"
    print_status "Provider will be available at: https://registry.terraform.io/providers/oneuptime/oneuptime/$VERSION"


}

# Function to cleanup
cleanup() {
    print_step "Cleaning up temporary files..."
    
    cd "$TERRAFORM_DIR"
    
    # Remove build artifacts if they exist
    if [[ -d "builds" ]]; then
        rm -rf builds
    fi
    
    # Remove any temporary files
    rm -f release-notes-*.md
    
    print_success "Cleanup completed"
}

# Function to show summary
show_summary() {
    print_step "Publishing Summary"
    echo ""
    echo "Provider Name: $PROVIDER_NAME"
    echo "Version: $VERSION"
    echo "Provider Files Location: $TERRAFORM_DIR"
    echo "GitHub Repository: https://github.com/$GITHUB_ORG/$PROVIDER_REPO"
    echo "Terraform Registry: https://registry.terraform.io/providers/oneuptime/oneuptime"
    echo ""
    
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "This was a DRY RUN with the following actions taken:"
        echo "✓ Generated Terraform provider"
        echo "✓ Ran tests (if not skipped)"
        echo "✓ Created draft GitHub release v$VERSION"
        echo "✗ Skipped Terraform Registry publishing"
        echo ""
        print_status "Next steps for a real release:"
        echo "1. Review the draft release: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
        echo "2. If satisfied, publish the release (remove draft status)"
        echo "3. Or run the script again without --dry-run flag"
        echo "4. Monitor Terraform Registry for automatic indexing"
    else
        print_success "Terraform provider published successfully!"
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
    run_tests
    create_github_release
    publish_to_registry
    cleanup
    show_summary
}

# Trap errors and cleanup
trap cleanup ERR

# Run main function
main "$@"
