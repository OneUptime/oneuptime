# OneUptime Terraform Provider Publishing

This directory contains all scripts and documentation for generating, installing, and publishing the OneUptime Terraform provider.

## Directory Structure

```
Scripts/TerraformProvider/
├── install-terraform-provider-locally.sh    # Local installation script
├── publish-terraform-provider.sh            # Publishing script
├── GenerateProvider.ts                      # Provider generation (TypeScript)
├── FrameworkGenerator.ts                    # Framework code generation
├── GoModuleSetup.ts                         # Go module setup and builds
├── InstallTools.ts                          # Tool installation utilities
├── SpecificationConverter.ts               # OpenAPI to provider spec conversion
├── GeneratorConfig.ts                       # Configuration generation
├── ProviderSpec.ts                          # Provider specification handling
├── README.md                                # Main documentation (this file)
├── LOCAL_INSTALLATION.md                   # Local installation guide
├── test-installation.sh                    # Installation workflow demo
├── validate-generation.sh                  # Generation validation script
└── openapi.json                            # Generated OpenAPI specification
```

## Environment Variables

For publishing (not needed for dry runs):

```bash
export GITHUB_TOKEN="your-github-token"
export TERRAFORM_PROVIDER_TOKEN="your-terraform-provider-repo-token"  # For pushing to terraform-provider-oneuptime repo
export GPG_PRIVATE_KEY="your-gpg-private-key"  # Optional for signing
export GPG_FINGERPRINT="your-gpg-fingerprint"  # Optional for signing
```

## Repository Setup

The publishing process works with two repositories:

1. **Main Repository**: `OneUptime/oneuptime` - Contains the source code and generation scripts
2. **Provider Repository**: `OneUptime/terraform-provider-oneuptime` - Contains the published terraform provider

The release workflow automatically:
- Generates the terraform provider from the main repository
- Pushes the generated code to the `terraform-provider-oneuptime` repository
- Creates a release and tag in the provider repository
- Terraform Registry automatically detects the new releasement explains how to generate and publish the OneUptime Terraform provider to the Terraform Registry.

## Quick Start

### Using the Script (Recommended)

```bash
# Make the script executable (if not already)
chmod +x Scripts/TerraformProvider/publish-terraform-provider.sh

# Publish a new version (dry run first)
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0 --dry-run

# Publish for real
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0
```

### Using GitHub Actions

1. **Tag-based Release (Automatic)**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Manual Trigger**:
   - Go to GitHub Actions
   - Select "Publish Terraform Provider" workflow
   - Click "Run workflow"
   - Enter version (e.g., 1.0.0)
   - Choose dry run option if needed

## Prerequisites

### Required Tools
- **Node.js** 18+ (`node --version`)
- **npm** (`npm --version`) 
- **Go** 1.19+ (`go version`)
- **Git** (`git --version`)
- **GitHub CLI** (optional, for releases: `gh --version`)

### Required Environment Variables

For publishing (not needed for dry runs):

```bash
export GITHUB_TOKEN="your-github-token"
export GPG_PRIVATE_KEY="your-gpg-private-key"  # Optional for signing
export GPG_FINGERPRINT="your-gpg-fingerprint"  # Optional for signing
```

## Script Usage

### Basic Commands

```bash
# Generate and install provider locally
npm run install-terraform-provider-locally

# Generate provider only
npm run generate-terraform-provider

# Show publishing help
./Scripts/TerraformProvider/publish-terraform-provider.sh --help

# Dry run (recommended first)
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0 --dry-run

# Full publish
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0

# Skip tests (faster)
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0 --skip-tests

# Skip build (if already built)
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0 --skip-build

# Force regeneration
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0 --force
```

### Advanced Examples

```bash
# Complete workflow with all checks
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.2.3

# Quick publish (skip time-consuming steps)
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.2.4 --skip-tests --skip-build

# Testing new generation
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.3.0-beta.1 --dry-run --force
```

### Local Installation (Development)

For local development and testing, you can generate and install the provider locally in one step:

```bash
# Generate provider and install locally for testing
npm run install-terraform-provider-locally

# Or with specific version
npm run install-terraform-provider-locally -- -v 1.0.0

# Force regenerate and reinstall
npm run install-terraform-provider-locally -- --force

# Skip generation step (use existing provider)
npm run install-terraform-provider-locally -- --skip-generation
```

This automatically generates the provider, installs the binary to your local Terraform plugins directory, and creates an example configuration. See [LOCAL_INSTALLATION.md](./LOCAL_INSTALLATION.md) for detailed usage.

## What the Process Does

### Generation Phase (TypeScript)
Run via `npm run generate-terraform-provider` or the TypeScript GenerateProvider script:

1. **� Generates OpenAPI Specification**
   - Creates OpenAPI spec from OneUptime API

2. **🔄 Converts to Provider Code Specification**
   - Transforms OpenAPI to Terraform provider spec

3. **🔧 Installs Framework Generator Tool**
   - Downloads Terraform Plugin Framework Generator

4. **🏗️ Generates Provider Framework Code**
   - Creates Go source code for resources and data sources

5. **⚙️ Sets Up Go Module & Build**
   - Creates `go.mod` with proper dependencies
   - Creates `main.go` entry point  
   - Creates `provider.go` with basic structure
   - Sets up `.goreleaser.yml` for releases
   - Creates `terraform-registry-manifest.json`
   - Updates Go dependencies and builds provider

### Publishing Phase (Bash Script)
Run via `./Scripts/TerraformProvider/publish-terraform-provider.sh`:

1. **🔍 Validates Prerequisites**
   - Checks required tools are installed
   - Validates Go and Node.js versions
   - Verifies semantic versioning format

2. **📦 Installs Dependencies**
   - Root npm dependencies
   - Common module dependencies  
   - Scripts module dependencies

3. **🏗️ Generates Provider**
   - Runs `npm run generate-terraform-provider` (calls TypeScript generation)

4. **🧪 Runs Tests**
   - Executes Go tests if found
   - Validates provider builds correctly

5. **🔨 Builds Provider**
   - Verifies basic build from generation phase
   - Creates multi-platform builds for release
   - Validates all builds succeed

6. **🚀 Creates GitHub Release**
   - Creates GitHub release with proper tags
   - Uploads provider binaries
   - Generates release notes

8. **📋 Publishes to Registry**
   - Terraform Registry automatically detects GitHub releases
   - Provider becomes available within minutes

## Manual Process

If you prefer to run steps manually:

```bash
# 1. Generate the provider
npm run generate-terraform-provider

# 2. Set up the Go module
cd Terraform
go mod init github.com/OneUptime/terraform-provider-oneuptime
go mod tidy

# 3. Build and test
go build .
go test ./...

# 4. Create release with GoReleaser
goreleaser release --clean

# 5. Monitor Terraform Registry
# Check https://registry.terraform.io/providers/oneuptime/oneuptime
```

## Terraform Registry

After publishing, the provider will be available at:
- **Registry URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Documentation**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **GitHub Releases**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

### Using the Published Provider

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 1.0"
    }
  }
}

provider "oneuptime" {
  api_url = "https://oneuptime.com/api"
  api_key = var.oneuptime_api_key
}

# Example resource usage
resource "oneuptime_monitor" "example" {
  name        = "My Website Monitor"
  description = "Monitor my website uptime"
  # ... other configuration
}
```

## Troubleshooting

### Common Issues

1. **"Go version too old"**
   ```bash
   # Install Go 1.19+
   brew install go  # macOS
   # or download from https://golang.org/dl/
   ```

2. **"Node.js version too old"**
   ```bash
   # Install Node.js 18+
   nvm install 18  # if using nvm
   # or download from https://nodejs.org/
   ```

3. **"GitHub CLI not found"**
   ```bash
   # Install GitHub CLI
   brew install gh  # macOS
   # or download from https://cli.github.com/
   
   # Authenticate
   gh auth login
   ```

4. **"Provider generation failed"**
   ```bash
   # Check the API is running
   npm run start
   
   # Verify OpenAPI spec generation
   ls -la Terraform/openapi.json
   
   # Check for TypeScript errors
   npm run lint
   ```

5. **"Build failed"**
   ```bash
   cd Terraform
   go mod tidy
   go clean -cache
   go build -v .
   ```

### Debug Mode

Enable verbose output:

```bash
# Set debug environment
export DEBUG=1

# Run with verbose logging
./Scripts/TerraformProvider/publish-terraform-provider.sh -v 1.0.0 --dry-run
```

### Manual Verification

```bash
# Check generated files
ls -la Terraform/
find Terraform/ -name "*.go" | wc -l

# Verify Go module
cd Terraform && go list -m all

# Test build
cd Terraform && go build .

# Check GoReleaser config
cd Terraform && goreleaser check
```

## GitHub Secrets Setup

For automated publishing, configure these GitHub secrets:

1. **GITHUB_TOKEN**: Usually available by default
2. **GPG_PRIVATE_KEY**: Optional, for signing releases
3. **GPG_FINGERPRINT**: Optional, for signing releases

To add secrets:
1. Go to GitHub repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add the required secrets

## Version Management

Follow semantic versioning:
- **MAJOR.MINOR.PATCH** (e.g., 1.0.0)
- **Pre-release**: 1.0.0-alpha.1, 1.0.0-beta.1, 1.0.0-rc.1
- **Build metadata**: 1.0.0+20230615

Examples:
- `1.0.0` - Initial release
- `1.0.1` - Bug fixes
- `1.1.0` - New features (backward compatible)  
- `2.0.0` - Breaking changes
- `1.1.0-beta.1` - Beta release

## Support

For issues or questions:
- **GitHub Issues**: https://github.com/OneUptime/oneuptime/issues
- **Documentation**: https://docs.oneuptime.com
- **Community**: https://community.oneuptime.com
