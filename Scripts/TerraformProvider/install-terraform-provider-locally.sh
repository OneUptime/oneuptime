#!/bin/bash

# Script to install the OneUptime Terraform Provider locally

set -e

npm run generate-terraform-provider

PROVIDER_NAME="oneuptime"
PROVIDER_VERSION="1.0.0"
PROVIDER_DIR="$HOME/.terraform.d/plugins/registry.terraform.io/oneuptime/$PROVIDER_NAME/$PROVIDER_VERSION"

echo "🚀 Installing OneUptime Terraform Provider locally..."

# Navigate to the terraform provider directory
cd "$(dirname "$0")/../../Terraform/terraform-provider-oneuptime"

# Check if the directory exists
if [ ! -d "$(pwd)" ]; then
    echo "❌ Error: Terraform provider directory not found at $(pwd)"
    echo "Please run 'npm run generate-terraform-provider' first"
    exit 1
fi

# Create plugin directory for different architectures
echo "📁 Creating plugin directories..."

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map architecture names
case $ARCH in
    x86_64)
        ARCH="amd64"
        ;;
    arm64|aarch64)
        ARCH="arm64"
        ;;
    *)
        echo "⚠️  Warning: Unsupported architecture $ARCH, defaulting to amd64"
        ARCH="amd64"
        ;;
esac

# Map OS names
case $OS in
    darwin)
        OS="darwin"
        ;;
    linux)
        OS="linux"
        ;;
    *)
        echo "⚠️  Warning: Unsupported OS $OS, defaulting to linux"
        OS="linux"
        ;;
esac

OS_ARCH="${OS}_${ARCH}"
PLUGIN_PATH="$PROVIDER_DIR/$OS_ARCH"

echo "🔧 Target platform: $OS_ARCH"
echo "📍 Plugin path: $PLUGIN_PATH"

mkdir -p "$PLUGIN_PATH"

# Build the provider
echo "🔨 Building provider..."
go build -o "terraform-provider-$PROVIDER_NAME"

# Copy to plugin directory
echo "📦 Installing provider..."
cp "terraform-provider-$PROVIDER_NAME" "$PLUGIN_PATH/"

# Make it executable
chmod +x "$PLUGIN_PATH/terraform-provider-$PROVIDER_NAME"

echo "✅ OneUptime Terraform Provider installed successfully!"
echo ""
echo "📝 You can now use it in your Terraform configuration:"
echo ""
echo "terraform {"
echo "  required_providers {"
echo "    $PROVIDER_NAME = {"
echo "      source = \"oneuptime/$PROVIDER_NAME\""
echo "      version = \"$PROVIDER_VERSION\""
echo "    }"
echo "  }"
echo "}"
echo ""
echo "provider \"$PROVIDER_NAME\" {"
echo "  host    = \"https://oneuptime.com\""
echo "  api_key = var.oneuptime_api_key"
echo "}"
echo ""
echo "🎯 Next steps:"
echo "   1. Create a Terraform configuration file"
echo "   2. Run 'terraform init'"
echo "   3. Run 'terraform plan'"
echo "   4. Run 'terraform apply'"
