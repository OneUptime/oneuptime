#!/bin/bash

# OneUptime Terraform Provider Generator and Publisher
# This script generates the Terraform provider and publishes it to the Terraform Registry

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
SKIP_BUILD=false
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
    -b, --skip-build       Skip building the provider
    -f, --force           Force regeneration even if files exist
    -h, --help            Show this help message

Examples:
    $0 -v 1.0.0                    # Publish version 1.0.0
    $0 -v 1.1.0 --dry-run         # Test publishing version 1.1.0
    $0 -v 1.0.1 --skip-tests      # Publish without running tests

Environment Variables:
    GITHUB_TOKEN                   # Required for GitHub operations
    GPG_PRIVATE_KEY               # Required for signing releases
    TERRAFORM_REGISTRY_TOKEN      # Required for Terraform Registry publishing

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
            -b|--skip-build)
                SKIP_BUILD=true
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
    local tools=("node" "npm" "go" "git")
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
            print_warning "GITHUB_TOKEN environment variable not set. Required for publishing."
        fi
        
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

# Function to setup Go module and build configuration
setup_go_module() {
    print_step "Setting up Go module and build configuration..."

    cd "$TERRAFORM_DIR"

    # Create go.mod if it doesn't exist
    if [[ ! -f "go.mod" ]]; then
        print_status "Creating go.mod file..."
        cat > go.mod << EOF
module github.com/$GITHUB_ORG/$PROVIDER_REPO

go 1.21

require (
    github.com/hashicorp/terraform-plugin-framework v1.4.2
    github.com/hashicorp/terraform-plugin-go v0.19.1
    github.com/hashicorp/terraform-plugin-log v0.9.0
    github.com/hashicorp/terraform-plugin-testing v1.5.1
)
EOF
    fi

    # Create main.go if it doesn't exist
    if [[ ! -f "main.go" ]]; then
        print_status "Creating main.go file..."
        cat > main.go << 'EOF'
package main

import (
    "context"
    "flag"
    "log"

    "github.com/hashicorp/terraform-plugin-framework/providerserver"
)

// Provider documentation generation.
//go:generate go run github.com/hashicorp/terraform-plugin-docs/cmd/tfplugindocs generate --provider-name oneuptime

var (
    // these will be set by the goreleaser configuration
    // to appropriate values for the compiled binary.
    version string = "dev"

    // goreleaser can pass other information to the main package, such as the specific commit
    // https://goreleaser.com/cookbooks/using-main.version/
)

func main() {
    var debug bool

    flag.BoolVar(&debug, "debug", false, "set to true to run the provider with support for debuggers like delve")
    flag.Parse()

    opts := providerserver.ServeOpts{
        Address: "registry.terraform.io/oneuptime/oneuptime",
        Debug:   debug,
    }

    err := providerserver.Serve(context.Background(), NewProvider(version), opts)
    if err != nil {
        log.Fatal(err.Error())
    }
}
EOF
    fi

    # Create provider.go if it doesn't exist
    if [[ ! -f "provider.go" ]]; then
        print_status "Creating provider.go file..."
        cat > provider.go << 'EOF'
package main

import (
    "context"

    "github.com/hashicorp/terraform-plugin-framework/datasource"
    "github.com/hashicorp/terraform-plugin-framework/provider"
    "github.com/hashicorp/terraform-plugin-framework/provider/schema"
    "github.com/hashicorp/terraform-plugin-framework/resource"
    "github.com/hashicorp/terraform-plugin-framework/types"
)

// Ensure the implementation satisfies the expected interfaces.
var (
    _ provider.Provider = &oneuptimeProvider{}
)

// New is a helper function to simplify provider server and testing implementation.
func NewProvider(version string) func() provider.Provider {
    return func() provider.Provider {
        return &oneuptimeProvider{
            version: version,
        }
    }
}

// oneuptimeProvider is the provider implementation.
type oneuptimeProvider struct {
    version string
}

// Metadata returns the provider type name.
func (p *oneuptimeProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
    resp.TypeName = "oneuptime"
    resp.Version = p.version
}

// Schema defines the provider-level schema for configuration data.
func (p *oneuptimeProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
    resp.Schema = schema.Schema{
        Description: "Interact with OneUptime.",
        Attributes: map[string]schema.Attribute{
            "api_url": schema.StringAttribute{
                Description: "OneUptime API URL. May also be provided via ONEUPTIME_API_URL environment variable.",
                Optional:    true,
            },
            "api_key": schema.StringAttribute{
                Description: "OneUptime API Key. May also be provided via ONEUPTIME_API_KEY environment variable.",
                Optional:    true,
                Sensitive:   true,
            },
        },
    }
}

type oneuptimeProviderModel struct {
    ApiUrl types.String `tfsdk:"api_url"`
    ApiKey types.String `tfsdk:"api_key"`
}

// Configure prepares a OneUptime API client for data sources and resources.
func (p *oneuptimeProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
    var config oneuptimeProviderModel
    diags := req.Config.Get(ctx, &config)
    resp.Diagnostics.Append(diags...)
    if resp.Diagnostics.HasError() {
        return
    }

    // If configuration values are known, set them here
    // This is where you would initialize your API client
}

// DataSources defines the data sources implemented in the provider.
func (p *oneuptimeProvider) DataSources(_ context.Context) []func() datasource.DataSource {
    return []func() datasource.DataSource{
        // Add your data sources here
    }
}

// Resources defines the resources implemented in the provider.
func (p *oneuptimeProvider) Resources(_ context.Context) []func() resource.Resource {
    return []func() resource.Resource{
        // Add your resources here
    }
}
EOF
    fi

    # Create .goreleaser.yml for releases
    if [[ ! -f ".goreleaser.yml" ]]; then
        print_status "Creating .goreleaser.yml file..."
        cat > .goreleaser.yml << EOF
version: 2

before:
  hooks:
    - go mod tidy

builds:
  - env:
      - CGO_ENABLED=0
    mod_timestamp: '{{ .CommitTimestamp }}'
    flags:
      - -trimpath
    ldflags:
      - '-s -w -X main.version={{.Version}} -X main.commit={{.Commit}}'
    goos:
      - freebsd
      - windows
      - linux
      - darwin
    goarch:
      - amd64
      - '386'
      - arm
      - arm64
    ignore:
      - goos: darwin
        goarch: '386'
    binary: '{{ .ProjectName }}_v{{ .Version }}'

archives:
  - format: zip
    name_template: '{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}'

checksum:
  extra_files:
    - glob: 'terraform-registry-manifest.json'
      name_template: '{{ .ProjectName }}_{{ .Version }}_manifest.json'
  name_template: '{{ .ProjectName }}_{{ .Version }}_SHA256SUMS'
  algorithm: sha256

signs:
  - artifacts: checksum
    args:
      - "--batch"
      - "--local-user"
      - "{{ .Env.GPG_FINGERPRINT }}"
      - "--output"
      - "\${signature}"
      - "--detach-sign"
      - "\${artifact}"

release:
  extra_files:
    - glob: 'terraform-registry-manifest.json'
  name_template: '{{ .ProjectName }}_{{ .Version }}'

changelog:
  use: github
  sort: asc
  abbrev: 0
  groups:
    - title: Features
      regexp: "^.*feat[(\\w)]*:+.*$"
      order: 0
    - title: 'Bug fixes'
      regexp: "^.*fix[(\\w)]*:+.*$"
      order: 1
    - title: Others
      order: 999
EOF
    fi

    # Create terraform-registry-manifest.json
    print_status "Creating terraform-registry-manifest.json..."
    cat > terraform-registry-manifest.json << EOF
{
    "version": 1,
    "metadata": {
        "protocol_versions": ["6.0"]
    }
}
EOF

    # Update go.mod and download dependencies
    print_status "Updating Go dependencies..."
    go mod tidy
    go mod download

    print_success "Go module setup completed"
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

# Function to build the provider
build_provider() {
    if [[ "$SKIP_BUILD" == true ]]; then
        print_warning "Skipping build as requested"
        return
    fi

    print_step "Building Terraform provider..."

    cd "$TERRAFORM_DIR"

    # Build for current platform
    print_status "Building provider for current platform..."
    if go build -v .; then
        print_success "Build successful"
    else
        print_error "Build failed"
        exit 1
    fi

    # Create builds for multiple platforms
    print_status "Building for multiple platforms..."
    
    local platforms=("linux/amd64" "linux/arm64" "darwin/amd64" "darwin/arm64" "windows/amd64")
    local build_dir="builds"
    mkdir -p "$build_dir"

    for platform in "${platforms[@]}"; do
        local os="${platform%/*}"
        local arch="${platform#*/}"
        local output="$build_dir/${PROVIDER_REPO}_${VERSION}_${os}_${arch}"
        
        if [[ "$os" == "windows" ]]; then
            output="${output}.exe"
        fi

        print_status "Building for $os/$arch..."
        if GOOS="$os" GOARCH="$arch" go build -o "$output" .; then
            print_status "✓ Built for $os/$arch"
        else
            print_error "✗ Failed to build for $os/$arch"
            exit 1
        fi
    done

    print_success "Multi-platform build completed"
}

# Function to create GitHub release
create_github_release() {
    print_step "Creating GitHub release..."

    cd "$TERRAFORM_DIR"

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: Would create GitHub release v$VERSION"
        return
    fi

    # Check if GitHub CLI is available
    if ! command -v gh &> /dev/null; then
        print_error "GitHub CLI (gh) is not installed. Please install it to create releases."
        exit 1
    fi

    # Check if we're authenticated with GitHub
    if ! gh auth status &> /dev/null; then
        print_error "Not authenticated with GitHub. Please run 'gh auth login'"
        exit 1
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
    print_status "Creating GitHub release v$VERSION..."
    if gh release create "v$VERSION" \
        --title "OneUptime Terraform Provider v$VERSION" \
        --notes-file "$release_notes_file" \
        --draft; then
        print_success "GitHub release created successfully"
    else
        print_error "Failed to create GitHub release"
        exit 1
    fi

    # Clean up
    rm -f "$release_notes_file"
}

# Function to publish to terraform registry
publish_to_registry() {
    print_step "Publishing to Terraform Registry..."

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "DRY RUN: Would publish to Terraform Registry"
        return
    fi

    cd "$TERRAFORM_DIR"

    # The Terraform Registry automatically pulls from GitHub releases
    # So we just need to ensure everything is properly tagged and released

    print_status "Terraform Registry will automatically detect the new release"
    print_status "Monitor the release at: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases"
    print_status "Provider will be available at: https://registry.terraform.io/providers/oneuptime/oneuptime/$VERSION"

    print_success "Publishing process initiated"
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
    echo "Generated Files Location: $TERRAFORM_DIR"
    echo "GitHub Repository: https://github.com/$GITHUB_ORG/$PROVIDER_REPO"
    echo "Terraform Registry: https://registry.terraform.io/providers/oneuptime/oneuptime"
    echo ""
    
    if [[ "$DRY_RUN" == true ]]; then
        print_warning "This was a DRY RUN - no actual publishing occurred"
    else
        print_success "Terraform provider published successfully!"
        echo ""
        print_status "Next steps:"
        echo "1. Monitor the GitHub release: https://github.com/$GITHUB_ORG/$PROVIDER_REPO/releases/tag/v$VERSION"
        echo "2. Wait for Terraform Registry to index the new version (usually takes a few minutes)"
        echo "3. Test the provider installation: terraform init"
        echo "4. Update documentation if needed"
    fi
}

# Main execution function
main() {
    echo ""
    print_status "OneUptime Terraform Provider Generator and Publisher"
    print_status "=================================================="
    echo ""

    parse_args "$@"

    validate_prerequisites
    install_dependencies
    generate_provider
    setup_go_module
    run_tests
    build_provider
    create_github_release
    publish_to_registry
    cleanup
    show_summary
}

# Trap errors and cleanup
trap cleanup ERR

# Run main function
main "$@"
