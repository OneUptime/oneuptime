#!/bin/bash

# Script to publish the OneUptime Terraform Provider to Terraform Registry

set -e

PROVIDER_NAME="oneuptime"
PROVIDER_VERSION="1.0.0"

echo "🚀 Publishing OneUptime Terraform Provider..."

# Navigate to the terraform provider directory
cd "$(dirname "$0")/../../Terraform/terraform-provider-oneuptime"

# Check if the directory exists
if [ ! -d "$(pwd)" ]; then
    echo "❌ Error: Terraform provider directory not found at $(pwd)"
    echo "Please run 'npm run generate-terraform-provider' first"
    exit 1
fi

echo "🔍 Validating provider..."

# Check if go.mod exists
if [ ! -f "go.mod" ]; then
    echo "❌ Error: go.mod not found"
    exit 1
fi

# Check if main.go exists
if [ ! -f "main.go" ]; then
    echo "❌ Error: main.go not found"
    exit 1
fi

echo "🧪 Running tests..."

# Run tests
go test ./... -v

echo "📦 Building provider for multiple platforms..."

# Create bin directory
mkdir -p bin

# Build for multiple platforms
GOOS=darwin GOARCH=amd64 go build -o ./bin/terraform-provider-${PROVIDER_NAME}_${PROVIDER_VERSION}_darwin_amd64
GOOS=darwin GOARCH=arm64 go build -o ./bin/terraform-provider-${PROVIDER_NAME}_${PROVIDER_VERSION}_darwin_arm64
GOOS=linux GOARCH=amd64 go build -o ./bin/terraform-provider-${PROVIDER_NAME}_${PROVIDER_VERSION}_linux_amd64
GOOS=linux GOARCH=arm64 go build -o ./bin/terraform-provider-${PROVIDER_NAME}_${PROVIDER_VERSION}_linux_arm64
GOOS=windows GOARCH=amd64 go build -o ./bin/terraform-provider-${PROVIDER_NAME}_${PROVIDER_VERSION}_windows_amd64.exe

echo "🔐 Generating checksums..."

# Generate checksums
cd bin
sha256sum * > terraform-provider-${PROVIDER_NAME}_${PROVIDER_VERSION}_SHA256SUMS
cd ..

echo "📝 Creating release notes..."

cat > RELEASE_NOTES.md << EOF
# Terraform Provider OneUptime v${PROVIDER_VERSION}

This is the initial release of the OneUptime Terraform Provider.

## Features

- Full CRUD operations for OneUptime resources
- Data sources for reading OneUptime resources
- Automatic generation from OpenAPI specification
- Support for multiple authentication methods

## Resources

$(find internal/provider -name "resource_*.go" | sed 's/.*resource_\(.*\)\.go/- oneuptime_\1/' | sort)

## Data Sources

$(find internal/provider -name "data_source_*.go" | sed 's/.*data_source_\(.*\)\.go/- oneuptime_\1/' | sort)

## Installation

\`\`\`hcl
terraform {
  required_providers {
    oneuptime = {
      source = "oneuptime/oneuptime"
      version = "${PROVIDER_VERSION}"
    }
  }
}
\`\`\`

## Usage

\`\`\`hcl
provider "oneuptime" {
  host    = "https://api.oneuptime.com"
  api_key = var.oneuptime_api_key
}
\`\`\`

For more information, see the [documentation](https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs).
EOF

echo "✅ Provider built and ready for publishing!"
echo ""
echo "📁 Build artifacts:"
echo "   - Binaries: ./bin/"
echo "   - Checksums: ./bin/terraform-provider-${PROVIDER_NAME}_${PROVIDER_VERSION}_SHA256SUMS"
echo "   - Release notes: ./RELEASE_NOTES.md"
echo ""
echo "🎯 Next steps for publishing to Terraform Registry:"
echo "   1. Create a GitHub release with tag v${PROVIDER_VERSION}"
echo "   2. Upload all files from ./bin/ as release assets"
echo "   3. Register the provider on the Terraform Registry"
echo "   4. Configure the GitHub repository for automated releases"
echo ""
echo "📖 For more information on publishing, see:"
echo "   https://www.terraform.io/docs/registry/providers/publishing.html"
