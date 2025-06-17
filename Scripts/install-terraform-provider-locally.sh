#!/bin/bash

# OneUptime Terraform Provider Local Installer
# This script installs the generated Terraform provider locally on the machine
# for development and testing purposes

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
PROVIDER_FRAMEWORK_DIR="$TERRAFORM_DIR/terraform-provider-framework"
PROVIDER_NAME="oneuptime"
PROVIDER_VERSION=""
FORCE=false
VERBOSE=false
SKIP_GENERATION=false

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

print_verbose() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${CYAN}[VERBOSE]${NC} $1"
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Install the generated OneUptime Terraform provider locally for development and testing"
    echo ""
    echo "Options:"
    echo "  -v, --version VERSION     Specify provider version (default: auto-detect from go.mod)"
    echo "  -f, --force              Force reinstall even if provider exists"
    echo "  --skip-generation        Skip provider generation step"
    echo "  --verbose                Enable verbose output"
    echo "  -h, --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                       Generate provider and install with auto-detected version"
    echo "  $0 -v 1.0.0             Generate provider and install with specific version"
    echo "  $0 --force              Force regenerate and reinstall provider"
    echo "  $0 --skip-generation    Install existing provider without regenerating"
    echo "  $0 --verbose            Install with verbose output"
    echo ""
    echo "Prerequisites:"
    echo "  - Node.js and npm installed"
    echo "  - Terraform must be installed"
    echo "  - OneUptime development environment set up"
    echo ""
}

# Function to parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--version)
                PROVIDER_VERSION="$2"
                shift 2
                ;;
            -f|--force)
                FORCE=true
                shift
                ;;
            --skip-generation)
                SKIP_GENERATION=true
                shift
                ;;
            --verbose)
                VERBOSE=true
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
}

# Function to detect OS and architecture
detect_platform() {
    local os=""
    local arch=""
    
    # Detect OS
    case "$(uname -s)" in
        Darwin*)
            os="darwin"
            ;;
        Linux*)
            os="linux"
            ;;
        CYGWIN*|MINGW*|MSYS*)
            os="windows"
            ;;
        FreeBSD*)
            os="freebsd"
            ;;
        *)
            print_error "Unsupported operating system: $(uname -s)"
            exit 1
            ;;
    esac
    
    # Detect architecture
    case "$(uname -m)" in
        x86_64|amd64)
            arch="amd64"
            ;;
        arm64|aarch64)
            arch="arm64"
            ;;
        arm*)
            arch="arm"
            ;;
        386|i386)
            arch="386"
            ;;
        *)
            print_error "Unsupported architecture: $(uname -m)"
            exit 1
            ;;
    esac
    
    echo "${os}_${arch}"
}

# Function to get provider version
get_provider_version() {
    if [[ -n "$PROVIDER_VERSION" ]]; then
        echo "$PROVIDER_VERSION"
        return
    fi
    
    # Try to extract version from go.mod
    if [[ -f "$PROVIDER_FRAMEWORK_DIR/go.mod" ]]; then
        local version=$(grep "^module" "$PROVIDER_FRAMEWORK_DIR/go.mod" | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' || echo "")
        if [[ -n "$version" ]]; then
            echo "${version#v}"  # Remove 'v' prefix
            return
        fi
    fi
    
    # Try to extract from builds directory
    if [[ -d "$PROVIDER_FRAMEWORK_DIR/builds" ]]; then
        local binary_file=$(ls "$PROVIDER_FRAMEWORK_DIR/builds/terraform-provider-${PROVIDER_NAME}_"* 2>/dev/null | head -1)
        if [[ -n "$binary_file" ]]; then
            local filename=$(basename "$binary_file")
            local version=$(echo "$filename" | sed "s/terraform-provider-${PROVIDER_NAME}_//" | sed 's/_.*$//')
            if [[ -n "$version" && "$version" != "$filename" ]]; then
                echo "$version"
                return
            fi
        fi
    fi
    
    # Default version
    echo "dev"
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
    local tools=("node" "npm" "terraform")
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            print_error "$tool is not installed or not in PATH"
            exit 1
        fi
    done
    
    print_verbose "Node.js version: $(node --version)"
    print_verbose "npm version: $(npm --version)"
    print_verbose "Terraform version: $(terraform version)"
    
    print_success "Prerequisites validated"
}

# Function to generate terraform provider
generate_terraform_provider() {
    if [[ "$SKIP_GENERATION" == true ]]; then
        print_status "Skipping provider generation (--skip-generation flag)"
        return
    fi
    
    print_step "Generating Terraform provider..."
    
    cd "$PROJECT_ROOT"
    
    # Check if provider exists and force flag
    if [[ -d "$PROVIDER_FRAMEWORK_DIR" && "$FORCE" != true ]]; then
        print_status "Provider already exists at $PROVIDER_FRAMEWORK_DIR"
        print_status "Use --force to regenerate or --skip-generation to skip this step"
        
        # Check if builds directory exists
        if [[ ! -d "$PROVIDER_FRAMEWORK_DIR/builds" ]]; then
            print_warning "Builds directory missing, regenerating provider..."
        else
            print_status "Skipping generation, using existing provider"
            return
        fi
    fi
    
    # Clean existing terraform directory if force is enabled
    if [[ "$FORCE" == true && -d "$TERRAFORM_DIR" ]]; then
        print_status "Force mode enabled. Cleaning existing Terraform directory..."
        rm -rf "$TERRAFORM_DIR"
    fi
    
    # Generate the provider
    print_status "Running terraform provider generation..."
    if [[ "$VERBOSE" == true ]]; then
        npm run generate-terraform-provider
    else
        print_status "This may take a few minutes..."
        npm run generate-terraform-provider > /dev/null 2>&1
    fi
    
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
    
    # Check if builds directory exists
    if [[ ! -d "$PROVIDER_FRAMEWORK_DIR/builds" ]]; then
        print_error "Provider builds directory not found at $PROVIDER_FRAMEWORK_DIR/builds"
        print_error "The generation process should create builds with provider binaries"
        exit 1
    fi
    
    print_success "Terraform provider generated successfully"
    print_verbose "Provider location: $PROVIDER_FRAMEWORK_DIR"
    print_verbose "Builds location: $PROVIDER_FRAMEWORK_DIR/builds"
}

# Function to validate provider exists (after generation)
validate_provider_exists() {
    print_step "Validating generated provider..."
    
    # Check if provider has been generated
    if [[ ! -d "$PROVIDER_FRAMEWORK_DIR" ]]; then
        print_error "Terraform provider not found at $PROVIDER_FRAMEWORK_DIR"
        print_error "Provider generation may have failed"
        exit 1
    fi
    
    # Check if builds directory exists
    if [[ ! -d "$PROVIDER_FRAMEWORK_DIR/builds" ]]; then
        print_error "Provider builds directory not found at $PROVIDER_FRAMEWORK_DIR/builds"
        print_error "Provider generation may not have completed successfully"
        exit 1
    fi
    
    # Check if there are any binaries
    if ! ls "$PROVIDER_FRAMEWORK_DIR/builds/terraform-provider-${PROVIDER_NAME}_"* 1> /dev/null 2>&1; then
        print_error "No provider binaries found in builds directory"
        print_error "Expected files like: terraform-provider-${PROVIDER_NAME}_linux_amd64"
        exit 1
    fi
    
    print_success "Provider validation completed"
}

# Function to get terraform plugins directory
get_terraform_plugins_dir() {
    # Default Terraform plugins directory based on OS
    local home_dir="$HOME"
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        home_dir="$USERPROFILE"
    fi
    
    local plugins_dir="${home_dir}/.terraform.d/plugins"
    
    # Create the directory structure for the provider
    local provider_dir="${plugins_dir}/registry.terraform.io/oneuptime/${PROVIDER_NAME}/${PROVIDER_VERSION}/$(detect_platform)"
    
    echo "$provider_dir"
}

# Function to find the correct binary for current platform
find_provider_binary() {
    local platform="$(detect_platform)"
    local builds_dir="$PROVIDER_FRAMEWORK_DIR/builds"
    
    print_verbose "Looking for binary for platform: $platform"
    
    # Look for binary with exact platform match
    local binary_pattern="terraform-provider-${PROVIDER_NAME}_${platform}"
    local binary_file=""
    
    # Check for binary with .exe extension (Windows)
    if [[ "$platform" == *"windows"* ]]; then
        binary_file=$(find "$builds_dir" -name "${binary_pattern}.exe" -type f | head -1)
    fi
    
    # Check for binary without extension
    if [[ -z "$binary_file" ]]; then
        binary_file=$(find "$builds_dir" -name "$binary_pattern" -type f | head -1)
    fi
    
    if [[ -z "$binary_file" ]]; then
        print_error "Could not find provider binary for platform: $platform"
        print_error "Available binaries in $builds_dir:"
        ls -la "$builds_dir"/ || echo "No files found"
        exit 1
    fi
    
    print_verbose "Found binary: $binary_file"
    echo "$binary_file"
}

# Function to install the provider locally
install_provider() {
    print_step "Installing OneUptime Terraform provider locally..."
    
    local provider_dir="$(get_terraform_plugins_dir)"
    local binary_file="$(find_provider_binary)"
    local binary_name="terraform-provider-${PROVIDER_NAME}_v${PROVIDER_VERSION}"
    
    print_status "Provider version: $PROVIDER_VERSION"
    print_status "Target platform: $(detect_platform)"
    print_status "Installation directory: $provider_dir"
    print_status "Binary source: $binary_file"
    
    # Add .exe extension for Windows
    if [[ "$(detect_platform)" == *"windows"* ]]; then
        binary_name="${binary_name}.exe"
    fi
    
    local target_binary="$provider_dir/$binary_name"
    
    # Check if provider already exists
    if [[ -f "$target_binary" && "$FORCE" != true ]]; then
        print_warning "Provider already installed at: $target_binary"
        print_warning "Use --force to reinstall"
        return
    fi
    
    # Create the plugins directory
    print_status "Creating plugins directory..."
    mkdir -p "$provider_dir"
    
    # Copy the binary
    print_status "Copying provider binary..."
    cp "$binary_file" "$target_binary"
    
    # Make executable (not needed for Windows)
    if [[ "$(detect_platform)" != *"windows"* ]]; then
        chmod +x "$target_binary"
    fi
    
    print_success "Provider installed successfully!"
    print_status "Binary location: $target_binary"
}

# Function to create example terraform configuration
create_example_config() {
    print_step "Creating example Terraform configuration..."
    
    local example_dir="$PROJECT_ROOT/terraform-provider-example"
    
    # Create example directory
    mkdir -p "$example_dir"
    
    # Create main.tf
    cat > "$example_dir/main.tf" << EOF
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> ${PROVIDER_VERSION}"
    }
  }
}

provider "oneuptime" {
  # Configuration options will be documented in the provider
  # api_url = "https://oneuptime.com"
  # api_key = "your-api-key"
}

# Example usage (uncomment and modify as needed):
# resource "oneuptime_monitor" "example" {
#   name = "example-monitor"
#   # Add other required attributes
# }

# data "oneuptime_project" "example" {
#   name = "example-project"
# }
EOF
    
    # Create versions.tf for better version management
    cat > "$example_dir/versions.tf" << EOF
terraform {
  required_version = ">= 1.0"
  
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> ${PROVIDER_VERSION}"
    }
  }
}
EOF
    
    # Create .terraform-version for tfenv users
    echo "1.5.0" > "$example_dir/.terraform-version"
    
    # Create README
    cat > "$example_dir/README.md" << EOF
# OneUptime Terraform Provider Example

This directory contains an example Terraform configuration using the OneUptime provider.

## Usage

1. Initialize Terraform:
   \`\`\`bash
   terraform init
   \`\`\`

2. Plan your changes:
   \`\`\`bash
   terraform plan
   \`\`\`

3. Apply your changes:
   \`\`\`bash
   terraform apply
   \`\`\`

## Configuration

Update the provider configuration in \`main.tf\` with your OneUptime credentials and settings.

## Resources

See the provider documentation for available resources and data sources.

## Version

This example is configured for OneUptime provider version: ${PROVIDER_VERSION}
EOF
    
    print_success "Example configuration created at: $example_dir"
}

# Function to verify installation
verify_installation() {
    print_step "Verifying installation..."
    
    local example_dir="$PROJECT_ROOT/terraform-provider-example"
    
    if [[ ! -d "$example_dir" ]]; then
        print_warning "Example directory not found, skipping verification"
        return
    fi
    
    cd "$example_dir"
    
    print_status "Running terraform init to verify provider installation..."
    
    # Run terraform init
    if terraform init &> /dev/null; then
        print_success "Provider installation verified successfully!"
        print_status "Terraform can find and load the OneUptime provider"
    else
        print_warning "Provider verification failed"
        print_warning "You may need to run 'terraform init' manually in your Terraform configuration"
    fi
    
    # Show provider information
    if command -v terraform &> /dev/null; then
        print_status "Provider information:"
        terraform providers 2>/dev/null || echo "Could not get provider information"
    fi
    
    cd "$PROJECT_ROOT"
}

# Function to show summary
show_summary() {
    print_step "Installation Summary"
    echo ""
    echo "Provider Name: $PROVIDER_NAME"
    echo "Version: $PROVIDER_VERSION"
    echo "Platform: $(detect_platform)"
    echo "Installation Directory: $(get_terraform_plugins_dir)"
    echo "Example Configuration: $PROJECT_ROOT/terraform-provider-example"
    echo ""
    print_status "Next Steps:"
    echo "1. Navigate to a Terraform configuration directory or use the generated example"
    echo "2. Add the OneUptime provider to your required_providers block:"
    echo ""
    echo "   terraform {"
    echo "     required_providers {"
    echo "       oneuptime = {"
    echo "         source  = \"oneuptime/oneuptime\""
    echo "         version = \"~> $PROVIDER_VERSION\""
    echo "       }"
    echo "     }"
    echo "   }"
    echo ""
    echo "3. Configure the provider with your OneUptime credentials"
    echo "4. Run 'terraform init' to initialize"
    echo "5. Use OneUptime resources and data sources in your configuration"
    echo ""
    print_status "For local development, you can test with the example configuration:"
    echo "   cd $PROJECT_ROOT/terraform-provider-example"
    echo "   terraform init"
    echo ""
    print_status "To regenerate the provider with changes:"
    echo "   $0 --force"
    echo ""
}

# Main execution function
main() {
    echo ""
    print_status "OneUptime Terraform Provider Local Installer"
    print_status "==========================================="
    echo ""
    
    parse_args "$@"
    
    validate_prerequisites
    generate_terraform_provider
    validate_provider_exists
    
    # Get provider version after generation
    PROVIDER_VERSION="$(get_provider_version)"
    
    install_provider
    create_example_config
    verify_installation
    show_summary
}

# Run main function
main "$@"
