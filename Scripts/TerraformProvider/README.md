# OneUptime Terraform Provider Generator

## Overview

This project provides a **dynamic Terraform provider generator** that automatically creates a complete, production-ready Terraform provider from OneUptime's OpenAPI specification. The generator is written in TypeScript and produces Go code that follows Terraform provider best practices.

## 🚀 Features

### ✅ Dynamic Generation
- **Automatic resource discovery** from OpenAPI tags and endpoints
- **Schema generation** from API request/response models
- **CRUD operations** mapped from HTTP methods (POST→Create, GET→Read, PUT/PATCH→Update, DELETE→Delete)
- **Data sources** generated from GET endpoints
- **Type-safe** Go code generation

### ✅ Complete Provider Structure
- **Main provider file** with authentication configuration
- **HTTP client** with support for API key, username/password authentication
- **Resource files** for all discovered API endpoints
- **Data source files** for read-only operations
- **Documentation** auto-generated for Terraform Registry
- **Examples** and usage guides

### ✅ Build System
- **Go module** with proper dependencies
- **Makefile** for common operations
- **Build scripts** for multiple platforms
- **Installation scripts** for local development
- **Publishing scripts** for Terraform Registry

## 📁 Generated Structure

```
Terraform/terraform-provider-oneuptime/
├── main.go                          # Provider entry point
├── go.mod                           # Go module definition
├── Makefile                         # Build automation
├── README.md                        # Documentation
├── build.sh                         # Build script
├── install.sh                       # Local installation
├── test.sh                          # Test runner
├── example.tf                       # Usage example
├── internal/provider/
│   ├── provider.go                  # Main provider implementation
│   ├── client.go                    # HTTP client
│   ├── config.go                    # Configuration management
│   ├── schema.go                    # Provider schema
│   ├── resources.go                 # Resource registry
│   ├── data_sources.go              # Data source registry
│   ├── resource_*.go                # Individual resources (100+)
│   └── data_source_*.go             # Individual data sources
├── docs/
│   ├── index.md                     # Provider documentation
│   ├── resources/                   # Resource documentation
│   └── data-sources/                # Data source documentation
└── examples/
    ├── provider.tf                  # Provider configuration
    ├── resources.tf                 # Resource examples
    └── data-sources.tf              # Data source examples
```

## 🔧 Usage

### Generate the Provider

```bash
# Generate the complete Terraform provider
npm run generate-terraform-provider
```

### Build and Install Locally

```bash
# Navigate to the generated provider
cd Terraform/terraform-provider-oneuptime

# Install dependencies and build
go mod tidy
go build

# Install locally for testing
./install.sh
```

### Use in Terraform

```hcl
terraform {
  required_providers {
    oneuptime = {
      source = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url    = "https://oneuptime.com"
  api_key = var.oneuptime_api_key
}

# Create a project
resource "oneuptime_project" "example" {
  name        = "my-project"
  description = "Created with Terraform"
}

# Get project data
data "oneuptime_project_data" "example" {
  name = "my-project"
}
```

## 🏗️ Architecture

### Core Components

1. **OpenAPIParser** - Parses OpenAPI spec and extracts resource definitions
2. **ResourceGenerator** - Generates Terraform resource files with CRUD operations
3. **DataSourceGenerator** - Generates data source files for read operations
4. **ProviderGenerator** - Creates main provider file with authentication
5. **GoModuleGenerator** - Sets up Go module and dependencies
6. **DocumentationGenerator** - Creates docs and examples
7. **FileGenerator** - Handles file I/O operations
8. **StringUtils** - Utility functions for naming conversions

### Generation Flow

```
OpenAPI Spec → Parser → Resource Discovery → Code Generation → Build System
     ↓              ↓            ↓              ↓             ↓
JSON Schema → Operations → Resources/DataSources → Go Files → Terraform Provider
```

## 📋 Generated Resources

The generator automatically creates Terraform resources for all OneUptime API endpoints, including:

- **Projects** - Project management
- **Monitors** - Service monitoring
- **Alerts** - Alert management
- **Incidents** - Incident tracking
- **Status Pages** - Public status pages
- **Teams** - Team organization
- **Users** - User management
- **API Keys** - Authentication
- **Workflows** - Automation
- **And 100+ more resources**

## 🔐 Authentication

The provider supports multiple authentication methods:

```hcl
provider "oneuptime" {
  # Method 1: API Key
  host    = "https://oneuptime.com"
  api_key = var.api_key

  # Method 2: Username/Password
  host     = "https://oneuptime.com"
  username = var.username
  password = var.password
}
```

Environment variables are also supported:
- `ONEUPTIME_HOST`
- `ONEUPTIME_API_KEY`
- `ONEUPTIME_USERNAME`
- `ONEUPTIME_PASSWORD`

## 🧪 Testing

```bash
# Run unit tests
go test ./...

# Run acceptance tests
TF_ACC=1 go test ./... -v -timeout 120m

# Test with example configuration
terraform init
terraform plan
terraform apply
```

## 📦 Publishing

```bash
# Build for multiple platforms and prepare for publishing
./publish-terraform-provider.sh

# This creates:
# - Binaries for multiple OS/arch combinations
# - SHA256 checksums
# - Release notes
# - GitHub release assets
```

## 🔄 Dynamic Updates

The generator is designed to be **completely dynamic**:

- **New API endpoints** are automatically discovered and added as resources
- **Schema changes** are reflected in the generated code
- **No manual updates** required when the API evolves
- **Regenerate anytime** with a single command

## 🎯 Benefits

1. **Always Up-to-Date** - Provider automatically includes new API features
2. **Type Safety** - Generated Go code is type-safe and follows best practices
3. **Complete Coverage** - All API endpoints become Terraform resources
4. **Production Ready** - Includes error handling, logging, and documentation
5. **Standards Compliant** - Follows Terraform provider conventions
6. **Easy Maintenance** - Single source of truth (OpenAPI spec)

## 🛠️ Development

To modify the generator:

1. Edit TypeScript files in `Scripts/TerraformProvider/Core/`
2. Run `npm run generate-terraform-provider` to test changes
3. Check generated Go code in `Terraform/terraform-provider-oneuptime/`
4. Iterate and improve

### Checking the generator

The generator has its own unit tests and type check. The Terraform Provider
Generation workflow runs both on every pull request:

```bash
cd Scripts/TerraformProvider
npm test          # unit tests (jest)
npm run compile   # type check (tsc --noEmit)
```

Both need `npm install` in `packages/Common`, `Scripts` and
`Scripts/TerraformProvider`: the generator imports Common's sources and
`Scripts/OpenAPI/GenerateSpec.ts`, whose packages resolve from those folders.

`tsconfig.json` extends `packages/Common/tsconfig.json`, so the Common files
the generator imports are checked exactly as Common checks them, and the
generator's own files are held to the same strict rules. Change compiler
options in Common's tsconfig, not here; `Tests/TypeCheckConfig.test.ts` names
the few that differ and why.

## 📚 Documentation

- **Provider docs** are auto-generated for each resource and data source
- **Examples** show common usage patterns
- **README** provides setup and usage instructions
- **Terraform Registry** compatible format

This generator provides a complete, maintainable solution for creating Terraform providers from OpenAPI specifications, ensuring that your infrastructure-as-code tooling stays synchronized with your API evolution.
