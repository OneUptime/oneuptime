# Terraform Provider Installation and Usage Guide

## Installation from Terraform Registry

The OneUptime Terraform Provider is available on the official [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

### For OneUptime Cloud Users

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use latest compatible version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### For Self-Hosted OneUptime Users

⚠️ **Critical**: Self-hosted customers must pin the provider version to match their OneUptime installation exactly.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Replace with your exact OneUptime version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

## Why Version Pinning for Self-Hosted?

The OneUptime Terraform provider is automatically generated from the OneUptime API specification. Each OneUptime version may have:

- Different API endpoints
- Updated resource schemas
- New or removed features
- Changed validation rules

Using a provider version that doesn't match your OneUptime installation can result in:
- API compatibility errors
- Failed resource creation/updates
- Unexpected behavior
- Resource state drift

## Finding Your OneUptime Version

### Method 1: Dashboard
1. Log into your OneUptime dashboard
2. Go to **Settings** → **About**
3. Note the version number (e.g., "7.0.123")

### Method 2: API
```bash
curl https://your-oneuptime-instance.com/api/status | jq '.version'
```

### Method 3: Docker
```bash
docker images | grep oneuptime
# Look for the tag, e.g., oneuptime/dashboard:7.0.123
```

## Provider Registry Information

- **Registry URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Source Repository**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Documentation**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Releases**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Version Compatibility Matrix

| OneUptime Version | Provider Version | Terraform Config |
|-------------------|------------------|------------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| Latest Cloud | Latest Provider | `version = "~> 7.0"` |

## Quick Start Example

```hcl
# Configure the provider
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Adjust for self-hosted
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Adjust for self-hosted
  api_key       = var.oneuptime_api_key
}

# Create a project
resource "oneuptime_project" "example" {
  name        = "Terraform Example"
  description = "Created with Terraform"
}

# Create a website monitor
resource "oneuptime_monitor" "website" {
  name       = "Website Monitor"
  project_id = oneuptime_project.example.id
  
  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"
  
  tags = {
    managed_by = "terraform"
  }
}
```

## Installation Steps

1. **Create your Terraform configuration** with the provider block
2. **Initialize Terraform**: `terraform init`
3. **Set your API key**: Create `terraform.tfvars` with your API key
4. **Plan your deployment**: `terraform plan`
5. **Apply your configuration**: `terraform apply`

## Getting Help

- **Full Documentation**: See the [complete Terraform documentation](./README.md)
- **Self-Hosted Guide**: Check the [self-hosted configuration guide](./self-hosted.md)
- **Examples**: Browse [configuration examples](./examples.md)
- **Quick Start**: Follow the [quick start guide](./quick-start.md)

## Registry Updates

The provider is automatically published to the Terraform Registry when new OneUptime versions are released. Cloud users can use semantic versioning (`~> 7.0`) to automatically get compatible updates, while self-hosted users should pin to exact versions.
