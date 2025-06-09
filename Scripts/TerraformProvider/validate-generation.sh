#!/bin/bash

# Simple validation script for Terraform provider generation
# This can be run locally to test the generation process

set -e

echo "🚀 Starting Terraform Provider Generation Validation..."

# Check if required tools are available
echo "🔍 Checking dependencies..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed"
    exit 1
fi

if ! command -v go &> /dev/null; then
    echo "❌ Go is required but not installed"
    exit 1
fi

echo "✅ All dependencies found"

# Generate OpenAPI spec first
echo "📋 Generating OpenAPI specification..."
npm run generate-openapi-spec

# Check if OpenAPI spec was generated
if [ ! -f "./openapi.json" ]; then
    echo "❌ OpenAPI spec was not generated"
    exit 1
fi
echo "✅ OpenAPI spec generated"

# Generate Terraform provider
echo "🏗️ Generating Terraform provider..."
npm run generate-terraform-provider

# Validate generation
PROVIDER_DIR="./Terraform"

if [ ! -d "$PROVIDER_DIR" ]; then
    echo "❌ Provider directory was not created"
    exit 1
fi

GO_FILES=$(find "$PROVIDER_DIR" -name "*.go" | wc -l)
echo "📊 Generated $GO_FILES Go files"

if [ "$GO_FILES" -eq 0 ]; then
    echo "❌ No Go files were generated"
    exit 1
fi

# Test compilation if possible
if [ -f "$PROVIDER_DIR/go.mod" ]; then
    echo "🔨 Testing Go compilation..."
    cd "$PROVIDER_DIR"
    go mod tidy
    go build -v ./...
    echo "✅ Compilation successful"
    cd ..
else
    echo "⚠️ No go.mod found, skipping compilation test"
fi

echo "🎉 Terraform provider generation validation completed successfully!"
echo "📁 Provider generated in: $PROVIDER_DIR"
