# OneUptime Terraform Provider

The OneUptime Terraform Provider allows you to manage OneUptime resources using Infrastructure as Code (IaC). This provider enables you to configure monitoring, incident management, status pages, and other OneUptime features through Terraform.

## Table of Contents

- [Installation](#installation)
- [Provider Configuration](#provider-configuration)
- [Quick Start](#quick-start)
- [Version Compatibility](#version-compatibility)
- [Available Resources](#available-resources)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Migration Guide](#migration-guide)

## Installation

### From Terraform Registry (Recommended)

The OneUptime Terraform provider is available on the [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use latest 7.x version
    }
  }
  required_version = ">= 1.0"
}
```

### Version Pinning for Self-Hosted Installations

⚠️ **Important for Self-Hosted Customers**: Always pin the Terraform provider version to match your OneUptime installation version to ensure API compatibility.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Pin to exact version matching your OneUptime installation
    }
  }
  required_version = ">= 1.0"
}
```

#### Finding Your OneUptime Version

You can find your OneUptime version in several ways:

1. **Dashboard**: Go to Settings → About in your OneUptime dashboard
2. **API**: Call `GET /api/status` endpoint
3. **Docker**: Check the image tag you're using
4. **Helm**: Check your Helm chart version

```bash
# Example: If running OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Provider Configuration

### Basic Configuration

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # Or https://oneuptime.com for cloud
  api_key       = var.oneuptime_api_key
}
```

### Environment Variables

You can configure the provider using environment variables:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

Then use the provider without explicit configuration:

```hcl
provider "oneuptime" {
  # Configuration will be read from environment variables
}
```

### Configuration Options

| Argument | Environment Variable | Description | Required |
|----------|---------------------|-------------|----------|
| `oneuptime_url` | `ONEUPTIME_URL` | OneUptime URL | Yes |
| `api_key` | `ONEUPTIME_API_KEY` | OneUptime API Key | Yes |

## Quick Start

### 1. Create API Key

First, create an API key in your OneUptime dashboard:

1. Go to **Settings** → **API Keys**
2. Click **Create API Key**
3. Give it a descriptive name (e.g., "Terraform Automation")
4. Select appropriate permissions
5. Copy the generated API key

### 2. Basic Terraform Configuration

Create a `main.tf` file:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Use your instance URL
  api_key       = var.oneuptime_api_key
}

# Note: Projects must be created manually in the OneUptime dashboard
variable "project_id" {
  description = "OneUptime project ID"
  type        = string
}

# Create a monitor
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor for website uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Create a team
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}
    value = "alerts@example.com"
  }
}
```

### 3. Initialize and Apply

```bash
# Initialize Terraform
terraform init

# Plan the changes
terraform plan

# Apply the configuration
terraform apply
```

## Version Compatibility

### Cloud Customers

For OneUptime Cloud customers, use the latest provider version:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Always use latest compatible version
    }
  }
}
```

### Self-Hosted Customers

**Critical**: Self-hosted customers must pin the provider version to match their OneUptime installation:

| OneUptime Version | Provider Version | Configuration |
|-------------------|------------------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

Example for OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Exact version match
    }
  }
}
```

## Available Resources

The OneUptime Terraform provider supports the following resources:

### Core Resources
- `oneuptime_team` - Manage teams

### Monitoring
- `oneuptime_monitor` - Create and manage monitors
- `oneuptime_probe` - Manage monitoring probes

### On-Call Management
- `oneuptime_on_call_duty_policy` - Set up on-call schedules

### Status Pages
- `oneuptime_status_page` - Create status pages

### Service Catalog
- `oneuptime_service_catalog` - Manage service catalog entries

### Service Catalog
- `oneuptime_service` - Define services
- `oneuptime_service_dependency` - Map service dependencies

### Data Sources
Note: Data sources are not currently available in the provider as no datasources are defined in the provider schema.

## Examples

### Complete Monitoring Setup

```hcl
# Variables
variable "oneuptime_api_key" {
  description = "OneUptime API Key"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime project ID (create project manually in dashboard)"
  type        = string
}

variable "oneuptime_url" {
  description = "OneUptime URL"
  type        = string
  default     = "https://oneuptime.com"
}

# Provider configuration
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# Team
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}

# Monitors
resource "oneuptime_monitor" "api" {
  name        = "API Health Check"
  description = "Monitor for API health endpoint"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}

resource "oneuptime_monitor" "database" {
  name       = "Database Connection"
  project_id = oneuptime_project.production.id
  
  monitor_type = "port"
  hostname     = "db.mycompany.com"
  port         = 5432
  interval     = "2m"
  
  tags = {
    service     = "database"
    environment = "production"
    criticality = "critical"
  }
}

# On-call policy
resource "oneuptime_on_call_policy" "platform_oncall" {
  name       = "Platform On-Call"
  project_id = oneuptime_project.production.id
  team_id    = oneuptime_team.platform.id
  
  schedules {
    name      = "Business Hours"
    timezone  = "America/New_York"
    
    layers {
      name = "Primary"
      users = ["user1@mycompany.com", "user2@mycompany.com"]
      rotation_type = "weekly"
      start_time = "09:00"
      end_time = "17:00"
      days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
}

# Alert policy
resource "oneuptime_alert_policy" "critical_alerts" {
  name       = "Critical System Alerts"
  project_id = oneuptime_project.production.id
  
  conditions {
    monitor_id = oneuptime_monitor.api.id
    threshold  = "down"
  }
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "webhook"
    url  = "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
  }
  
  actions {
    type           = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.platform_oncall.id
  }
}

# Status page
resource "oneuptime_status_page" "public" {
  name       = "MyCompany Status"
  project_id = oneuptime_project.production.id
  
  domain = "status.mycompany.com"
  
  components {
    name       = "API"
    monitor_id = oneuptime_monitor.api.id
  }
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
}
```

### Self-Hosted Configuration Example

```hcl
# For self-hosted OneUptime instance version 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Must match your OneUptime version exactly
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}

# Rest of your configuration...
```

## Best Practices

### 1. Version Management

**For Cloud Customers:**
- Use semantic versioning with `~>` to get compatible updates
- Review changelog before major version upgrades

**For Self-Hosted Customers:**
- Always pin to exact version matching your installation
- Update provider version when you upgrade OneUptime
- Test in non-production environment first

### 2. State Management

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Environment Separation

Use workspaces or separate state files for different environments:

```bash
# Using workspaces
terraform workspace new production
terraform workspace new staging

# Using separate directories
mkdir -p environments/{staging,production}
```

### 4. Variable Management

```hcl
# variables.tf
variable "environment" {
  description = "Environment name"
  type        = string
}

variable "monitors" {
  description = "List of monitors to create"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "Website"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. Resource Naming

Use consistent naming conventions:

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-website-monitor"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-critical-alerts"
  # ...
}
```

## Migration Guide

### From Manual Configuration

1. **Audit existing resources** in OneUptime dashboard
2. **Create Terraform configuration** for existing resources
3. **Import existing resources** to Terraform state
4. **Validate configuration** matches current state
5. **Apply changes** incrementally

Example import:

```bash
# Import existing monitor
terraform import oneuptime_monitor.website monitor-id-here

# Import existing project
terraform import oneuptime_project.main project-id-here
```

### Version Upgrades

When upgrading OneUptime (self-hosted):

1. **Backup your current state**
2. **Check provider compatibility**
3. **Update provider version** in configuration
4. **Test in staging environment**
5. **Apply to production**

```bash
# Backup state
terraform state pull > backup.tfstate

# Update provider version
# Edit terraform block in your configuration

# Plan and apply
terraform init -upgrade
terraform plan
terraform apply
```

## Support and Resources

- **Documentation**: [OneUptime Docs](https://docs.oneuptime.com)
- **Terraform Registry**: [OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Issues**: [OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **Community**: [OneUptime Community](https://community.oneuptime.com)

## Troubleshooting

### Common Issues

1. **Version Mismatch (Self-Hosted)**
   ```
   Error: API version incompatible
   ```
   **Solution**: Ensure provider version matches OneUptime installation

2. **Authentication Issues**
   ```
   Error: Invalid API key
   ```
   **Solution**: Verify API key and permissions

3. **Resource Not Found**
   ```
   Error: Resource not found
   ```
   **Solution**: Check resource IDs and ensure resource exists

### Debug Mode

Enable detailed logging:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Version Check

Verify your setup:

```bash
# Check Terraform version
terraform version

# Check provider version
terraform providers

# Validate configuration
terraform validate
```
