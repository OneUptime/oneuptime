# Self-Hosted OneUptime Terraform Configuration Guide

This guide is specifically for customers running self-hosted OneUptime instances. It covers version management, configuration, and best practices for using the Terraform provider with your own OneUptime deployment.

## Important Notes

⚠️ **Projects cannot be created via Terraform** - Projects must be created manually in the OneUptime dashboard first. Use the project ID in your Terraform configurations.

⚠️ **The most important rule for self-hosted customers**: Always pin your Terraform provider version to match your OneUptime installation version exactly.

## Resource Structure

All OneUptime Terraform resources follow a simplified structure:
- `name` (required) - Resource name
- `description` (optional) - Resource description  
- `data` (optional) - Complex configuration as JSON

## Critical: Version Compatibility

⚠️ **The most important rule for self-hosted customers**: Always pin your Terraform provider version to match your OneUptime installation version exactly.

### Why Version Pinning is Critical

- The Terraform provider is auto-generated from the OneUptime API
- Each OneUptime version may have different API endpoints and schemas
- Using a mismatched provider version can cause errors or unexpected behavior
- Version pinning ensures compatibility and predictable behavior

## Finding Your OneUptime Version

### Method 1: Dashboard
1. Log into your OneUptime dashboard
2. Go to **Settings** → **About**
3. Look for the version number (e.g., "7.0.123")

### Method 2: API Endpoint
```bash
curl https://your-oneuptime-instance.com/api/status
```

### Method 3: Docker Images
If you're running OneUptime with Docker:
```bash
docker images | grep oneuptime
# Look for the tag, e.g., oneuptime/dashboard:7.0.123
```

### Method 4: Helm Chart
If you're using Helm:
```bash
helm list -n oneuptime
# Check the chart version
```

### Method 5: Environment Variables
Check your configuration files for version variables:
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## Provider Configuration Templates

### Template for Version 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Replace 123 with your exact build number
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

### Template for Version 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Replace with your exact version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Complete Self-Hosted Configuration Example

Here's a complete example for a self-hosted OneUptime instance:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Must match your OneUptime version
    }
  }
  required_version = ">= 1.0"
  
  # Optional: Use remote state for team collaboration
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptime instance URL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime API Key"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

# providers.tf
provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# variables.tf
variable "project_id" {
  description = "OneUptime project ID (create manually in dashboard)"
  type        = string
}

# main.tf
# Create teams
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastructure Team"
  description = "Infrastructure and operations team"
}

resource "oneuptime_team" "development" {
  name        = "Development Team"
  description = "Application development team"  
  project_id = oneuptime_project.main.id
}

# Infrastructure monitors
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  project_id = oneuptime_project.main.id
  
  monitor_type = "port"
  hostname     = "db.internal.yourcompany.com"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"
  
  tags = {
    team        = "infrastructure"
    service     = "database"
    environment = var.environment
    criticality = "critical"
  }
}

resource "oneuptime_monitor" "application" {
  name       = "${var.environment}-application"
  project_id = oneuptime_project.main.id
  
  monitor_type = "website"
  url          = "https://app.yourcompany.com/health"
  interval     = "1m"
  timeout      = "30s"
  
  expected_status_codes = [200]
  
  tags = {
    team        = "development"
    service     = "application"
    environment = var.environment
    criticality = "high"
  }
}

# On-call policies
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "Infrastructure On-Call"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "24x7 Infrastructure"
    timezone = "America/New_York"
    
    layers {
      name          = "Primary"
      users         = ["infra1@yourcompany.com", "infra2@yourcompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Alert policies
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "Critical Infrastructure Alerts"
  project_id = oneuptime_project.main.id
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "email"
    recipients = ["infrastructure@yourcompany.com"]
  }
  
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.infrastructure_oncall.id
  }
}

# Internal status page
resource "oneuptime_status_page" "internal" {
  name       = "Internal Services Status"
  project_id = oneuptime_project.main.id
  
  domain = "status.internal.yourcompany.com"
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
  
  components {
    name       = "Application"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "Project ID"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "Status page URL"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## Environment-Specific Configuration

### Development Environment

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### Staging Environment

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"  
environment = "staging"
```

### Production Environment

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## Upgrade Process for Self-Hosted

When upgrading your OneUptime instance:

### 1. Pre-Upgrade Checklist

```bash
# Backup current Terraform state
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Note current OneUptime version
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Note current provider version
terraform providers | grep oneuptime
```

### 2. Upgrade OneUptime Instance

Follow your standard OneUptime upgrade process (Docker, Helm, etc.)

### 3. Update Terraform Provider

```hcl
# Update version in terraform block
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # New version after upgrade
    }
  }
}
```

### 4. Test and Apply

```bash
# Update provider
terraform init -upgrade

# Plan to see any changes
terraform plan

# Apply if everything looks good
terraform apply
```

## Network Configuration

### Firewall Rules

Ensure your Terraform runner can access:
- OneUptime API endpoint (usually port 443/HTTPS)
- Any internal resources being monitored

### VPN/Private Networks

If OneUptime is on a private network:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # Internal IP
  api_key       = var.oneuptime_api_key
}
```

## Security Best Practices

### 1. API Key Management

```bash
# Use environment variables
export ONEUPTIME_API_KEY="your-api-key"

# Or use a secret management system
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. Least Privilege API Keys

Create API keys with minimal required permissions:
- Monitor management
- Alert policy management
- Team management (if needed)

### 3. Network Security

```hcl
# Example with TLS verification
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
  
  # Additional security options if supported
  verify_ssl = true
  timeout    = "30s"
}
```

## Monitoring Your Terraform Automation

Create monitors for your Terraform automation:

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Terraform Runner Health"
  project_id = oneuptime_project.main.id
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## Troubleshooting Self-Hosted Issues

### Issue: Connection Refused

```
Error: connection refused
```

**Solutions**:
1. Check OneUptime instance is running
2. Verify API URL is correct
3. Check firewall/network connectivity
4. Verify TLS certificates are valid

### Issue: API Version Mismatch

```
Error: API version incompatible
```

**Solutions**:
1. Check OneUptime version: `curl https://your-instance/api/status`
2. Update provider version to match
3. Run `terraform init -upgrade`

### Issue: Self-Signed Certificates

If using self-signed certificates:

```bash
# Temporarily skip TLS verification (not recommended for production)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Better solution: Add your CA certificate to the system trust store.

## Backup and Disaster Recovery

### State Backup

```bash
# Regular state backups
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### Configuration Backup

```bash
# Backup Terraform configuration
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## Multi-Environment Management

### Using Workspaces

```bash
# Create environments
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Switch between environments
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Using Separate Directories

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
└── modules/
    └── oneuptime/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

This approach provides better isolation and easier version management per environment.
