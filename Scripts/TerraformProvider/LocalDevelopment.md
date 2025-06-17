# Local Terraform Provider Installation

This guide explains how to install the OneUptime Terraform provider locally for development and testing. The script automatically generates the provider and installs it locally.

## Prerequisites

1. **OneUptime Development Environment**:
   - Node.js and npm installed
   - OneUptime project cloned and set up

2. **Install Terraform**: Make sure Terraform is installed and available in your PATH
   ```bash
   terraform version
   ```

## Installation Methods

### Method 1: Using npm script (Recommended)

```bash
# Generate provider and install with auto-detected version
npm run install-terraform-provider-locally

# Generate provider and install with specific version
npm run install-terraform-provider-locally -- -v 1.0.0

# Force regenerate and reinstall
npm run install-terraform-provider-locally -- --force

# Skip generation (use existing provider)
npm run install-terraform-provider-locally -- --skip-generation

# Verbose output
npm run install-terraform-provider-locally -- --verbose
```

### Method 2: Direct script execution

```bash
# Basic installation (generates provider first)
./Scripts/install-terraform-provider-locally.sh

# With options
./Scripts/install-terraform-provider-locally.sh -v 1.0.0 --force --verbose

# Skip generation (use existing provider)
./Scripts/install-terraform-provider-locally.sh --skip-generation

# Show help
./Scripts/install-terraform-provider-locally.sh --help
```

## What the Script Does

1. **Validates Prerequisites**
   - Checks if Node.js, npm, and Terraform are installed
   - Verifies OneUptime project structure

2. **Generates Terraform Provider** (unless `--skip-generation` is used)
   - Runs `npm run generate-terraform-provider`
   - Creates OpenAPI specification
   - Generates Go provider code
   - Builds binaries for multiple platforms

3. **Detects Platform**
   - Automatically detects your OS (Darwin/Linux/Windows/FreeBSD)
   - Determines architecture (amd64/arm64/arm/386)

4. **Installs Provider Binary**
   - Copies the appropriate binary to Terraform's plugins directory
   - Creates the correct directory structure: `~/.terraform.d/plugins/registry.terraform.io/oneuptime/oneuptime/{version}/{platform}/`
   - Makes the binary executable (Unix systems)

5. **Creates Example Configuration**
   - Generates a sample Terraform configuration in `terraform-provider-example/`
   - Includes `main.tf`, `versions.tf`, and documentation

6. **Verifies Installation**
   - Runs `terraform init` to verify the provider loads correctly
   - Shows provider information

## Directory Structure

After installation, you'll have:

```
~/.terraform.d/plugins/
└── registry.terraform.io/
    └── oneuptime/
        └── oneuptime/
            └── {version}/
                └── {platform}/
                    └── terraform-provider-oneuptime_v{version}
```

And in your project:

```
terraform-provider-example/
├── main.tf
├── versions.tf
├── .terraform-version
└── README.md
```

## Usage Example

After installation, you can use the provider in any Terraform configuration:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 1.0.0"
    }
  }
}

provider "oneuptime" {
  api_url = "https://oneuptime.com"
  api_key = var.oneuptime_api_key
}

resource "oneuptime_monitor" "example" {
  name = "My Website Monitor"
  # Other configuration...
}
```

## Testing the Installation

1. Navigate to the example directory:
   ```bash
   cd terraform-provider-example
   ```

2. Initialize Terraform:
   ```bash
   terraform init
   ```

3. Validate the configuration:
   ```bash
   terraform validate
   ```

## Platform Support

The script supports installation on:

- **macOS**: darwin_amd64, darwin_arm64
- **Linux**: linux_amd64, linux_arm64, linux_arm, linux_386
- **Windows**: windows_amd64, windows_arm64, windows_386
- **FreeBSD**: freebsd_amd64, freebsd_arm64, freebsd_arm, freebsd_386

## Troubleshooting

### Provider not found after installation

1. Check that the binary was copied correctly:
   ```bash
   ls -la ~/.terraform.d/plugins/registry.terraform.io/oneuptime/oneuptime/
   ```

2. Verify the binary is executable (Unix systems):
   ```bash
   file ~/.terraform.d/plugins/registry.terraform.io/oneuptime/oneuptime/{version}/{platform}/terraform-provider-oneuptime_v{version}
   ```

3. Run terraform with debug logging:
   ```bash
   TF_LOG=DEBUG terraform init
   ```

### Version mismatch

The script auto-detects the version from:
1. Command line argument (`-v` flag)
2. Go module file (`go.mod`)
3. Build directory binary names
4. Defaults to "dev"

Ensure your Terraform configuration uses the same version.

### Binary not found for your platform

Check what binaries are available:
```bash
ls -la Terraform/terraform-provider-framework/builds/
```

The provider generation should create binaries for multiple platforms. If your platform is missing, you may need to build it manually:

```bash
cd Terraform/terraform-provider-framework
GOOS={your_os} GOARCH={your_arch} go build -o builds/terraform-provider-oneuptime_{your_os}_{your_arch} ./cmd
```

### Permission errors

On Unix systems, make sure you have write permissions to `~/.terraform.d/`:
```bash
mkdir -p ~/.terraform.d/plugins
chmod 755 ~/.terraform.d/plugins
```

## Development Workflow

The script provides a streamlined development workflow:

1. **Generate and install in one step**:
   ```bash
   npm run install-terraform-provider-locally
   ```

2. **Test changes**:
   ```bash
   cd terraform-provider-example
   terraform init
   terraform plan
   ```

3. **Make changes to OneUptime API and regenerate**:
   ```bash
   npm run install-terraform-provider-locally -- --force
   ```

4. **Skip generation if provider already exists**:
   ```bash
   npm run install-terraform-provider-locally -- --skip-generation
   ```

## Uninstalling

To remove the locally installed provider:

```bash
rm -rf ~/.terraform.d/plugins/registry.terraform.io/oneuptime/
```

Or remove just a specific version:

```bash
rm -rf ~/.terraform.d/plugins/registry.terraform.io/oneuptime/oneuptime/{version}/
```

## Related Scripts

- `generate-terraform-provider`: Generates the provider from OneUptime API
- `publish-terraform-provider`: Publishes the provider to Terraform Registry
- `install-terraform-provider-locally`: Installs provider locally (this script)
