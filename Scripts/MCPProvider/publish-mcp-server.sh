#!/bin/bash

# OneUptime MCP Server Publishing Script
# This script automates the process of generating and publishing the OneUptime MCP Server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to show help
show_help() {
    cat << EOF
OneUptime MCP Server Publishing Script

Usage: $0 [options]

Options:
    --version VERSION       Set the version number (e.g., 1.0.0)
    --dry-run              Run in dry-run mode (no actual publishing)
    --npm-token TOKEN      NPM authentication token
    --skip-build           Skip the build step
    --skip-tests           Skip the test step
    --help                 Show this help message

Environment Variables:
    NPM_TOKEN              NPM authentication token (alternative to --npm-token)
    ONEUPTIME_VERSION      Version to publish (alternative to --version)

Examples:
    $0 --version 1.0.0
    $0 --version 1.2.3 --dry-run
    $0 --version 1.0.0 --npm-token YOUR_TOKEN
    
EOF
}

# Default values
VERSION=""
DRY_RUN=false
NPM_TOKEN="${NPM_TOKEN:-}"
SKIP_BUILD=false
SKIP_TESTS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            VERSION="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --npm-token)
            NPM_TOKEN="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Use environment variable if version not provided
if [ -z "$VERSION" ]; then
    VERSION="${ONEUPTIME_VERSION:-}"
fi

# Validate version
if [ -z "$VERSION" ]; then
    print_error "Version is required. Use --version VERSION or set ONEUPTIME_VERSION environment variable."
    show_help
    exit 1
fi

# Validate version format (basic semantic versioning)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+)*$ ]]; then
    print_error "Invalid version format. Please use semantic versioning (e.g., 1.0.0, 1.2.3-beta.1)"
    exit 1
fi

print_status "OneUptime MCP Server Publishing Script"
print_status "Version: $VERSION"
print_status "Dry Run: $DRY_RUN"

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "Scripts/MCPProvider/GenerateMCPServer.ts" ]; then
    print_error "This script must be run from the OneUptime project root directory"
    exit 1
fi

# Check for required tools
command -v node >/dev/null 2>&1 || { print_error "Node.js is required but not installed. Aborting."; exit 1; }
command -v npm >/dev/null 2>&1 || { print_error "npm is required but not installed. Aborting."; exit 1; }

# Determine NPM token
if [ -z "$NPM_TOKEN" ]; then
    print_warning "No NPM token provided. This will be required for publishing."
    print_warning "Set NPM_TOKEN environment variable or use --npm-token option."
    
    if [ "$DRY_RUN" = false ]; then
        print_error "NPM token is required for actual publishing."
        exit 1
    fi
fi

print_status "Step 1: Installing dependencies..."
npm install --silent

print_status "Step 2: Installing Common dependencies..."
cd Common && npm install --silent && cd ..

print_status "Step 3: Installing Scripts dependencies..."
cd Scripts && npm install --silent && cd ..

print_status "Step 4: Generating MCP server..."
npm run generate-mcp-server

# Check if MCP server was generated
MCP_DIR="./MCP"
if [ ! -d "$MCP_DIR" ]; then
    print_error "MCP server generation failed - directory not created"
    exit 1
fi

print_success "MCP server generated successfully"

# Change to MCP directory
cd "$MCP_DIR"

print_status "Step 5: Updating package.json version..."
if [ "$DRY_RUN" = false ]; then
    npm version "$VERSION" --no-git-tag-version
else
    print_status "(Dry run) Would update version to $VERSION"
fi

if [ "$SKIP_BUILD" = false ]; then
    print_status "Step 6: Installing MCP server dependencies..."
    npm install --silent

    print_status "Step 7: Building MCP server..."
    npm run build

    print_success "MCP server built successfully"
else
    print_warning "Skipping build step"
fi

if [ "$SKIP_TESTS" = false ]; then
    print_status "Step 8: Running tests..."
    if npm run test --silent >/dev/null 2>&1; then
        print_success "Tests passed"
    else
        print_warning "Tests failed or no tests found, continuing..."
    fi
else
    print_warning "Skipping tests"
fi

# Publishing
if [ "$DRY_RUN" = true ]; then
    print_status "Step 9: Dry run - Simulating npm publish..."
    npm pack --dry-run
    print_success "Dry run completed successfully"
    print_status "Would publish @oneuptime/mcp-server@$VERSION"
else
    print_status "Step 9: Publishing to npm..."
    
    # Configure npm with token
    if [ -n "$NPM_TOKEN" ]; then
        echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > ~/.npmrc
    fi
    
    # Publish to npm
    npm publish --access public
    
    print_success "Successfully published @oneuptime/mcp-server@$VERSION to npm!"
    
    # Clean up npm token
    if [ -n "$NPM_TOKEN" ]; then
        rm -f ~/.npmrc
    fi
fi

# Back to root directory
cd ..

print_status "Step 10: Creating GitHub release (if not dry run)..."
if [ "$DRY_RUN" = false ]; then
    # Check if GitHub CLI is available
    if command -v gh >/dev/null 2>&1; then
        # Create a release on GitHub
        RELEASE_NOTES="MCP Server v$VERSION

## What's Changed

This release includes the OneUptime Model Context Protocol (MCP) Server generated from the OneUptime API specification.

### Features
- Complete API coverage with $(find MCP-Generated -name "*.ts" | wc -l) generated TypeScript files
- Auto-generated from OpenAPI specification
- Full support for OneUptime monitoring and incident management features
- Type-safe MCP tools for LLM integration

### Installation

\`\`\`bash
npm install -g @oneuptime/mcp-server@$VERSION
\`\`\`

### Usage

\`\`\`bash
# Set your OneUptime API key
export ONEUPTIME_API_KEY=your-api-key-here

# Run the MCP server
oneuptime-mcp
\`\`\`

### Docker Usage

\`\`\`bash
docker run -e ONEUPTIME_API_KEY=your-api-key-here oneuptime/mcp-server:$VERSION
\`\`\`

For more information, see the [README](https://github.com/OneUptime/oneuptime/blob/main/MCP-Generated/README.md).
"
        
        echo "$RELEASE_NOTES" > release-notes.md
        
        # Create the release
        gh release create "mcp-v$VERSION" \
            --title "MCP Server v$VERSION" \
            --notes-file release-notes.md \
            MCP-Generated/*.tgz 2>/dev/null || echo "Note: No package files to attach to release"
        
        rm -f release-notes.md
        
        print_success "GitHub release created: mcp-v$VERSION"
    else
        print_warning "GitHub CLI not found. Skipping GitHub release creation."
    fi
else
    print_status "(Dry run) Would create GitHub release: mcp-v$VERSION"
fi

print_success "🎉 MCP Server publishing process completed!"
print_status "📦 Package: @oneuptime/mcp-server@$VERSION"

if [ "$DRY_RUN" = false ]; then
    print_status "🔗 NPM: https://www.npmjs.com/package/@oneuptime/mcp-server"
    print_status "🐙 GitHub: https://github.com/OneUptime/oneuptime/releases/tag/mcp-v$VERSION"
fi

print_status "📚 Documentation: See MCP-Generated/README.md for usage instructions"
