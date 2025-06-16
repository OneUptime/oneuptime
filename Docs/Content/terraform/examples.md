# Terraform Provider Examples

This document provides comprehensive examples for common OneUptime Terraform configurations.

## Basic Examples

### Simple Project

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use "= 7.0.123" for self-hosted
    }
  }
}

provider "oneuptime" {
  api_url = "https://oneuptime.com/api"  # Change for self-hosted
  api_key = var.oneuptime_api_key
}

# Note: Projects must be created manually in the OneUptime dashboard
# Use the project ID from your existing project
variable "project_id" {
  description = "OneUptime project ID"
  type        = string
}
```

### Basic Monitor

```hcl
resource "oneuptime_monitor" "homepage" {
  name        = "Homepage Monitor"
  description = "Monitor for the main website homepage"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}
```

### API Monitor

```hcl
resource "oneuptime_monitor" "api_health" {
  name        = "API Health Check"
  description = "Monitor for API health endpoint"
  data        = jsonencode({
    url = "https://api.example.com/health"
    method = "GET"
    interval = "2m"
    timeout = "15s"
    headers = {
      "Content-Type" = "application/json"
    }
  })
}
```

### Teams

```hcl
resource "oneuptime_team" "sre" {
  name        = "SRE Team"
  description = "Site Reliability Engineering team"
}

resource "oneuptime_team" "development" {
  name        = "Development Team"
  description = "Application development team"
}


### On-Call Duty Policy

```hcl
resource "oneuptime_on_call_duty_policy" "sre_oncall" {
  name        = "SRE On-Call Policy"
  description = "On-call policy for SRE team"
  data        = jsonencode({
    team_id = oneuptime_team.sre.id
    schedules = [
      {
        name = "Business Hours"
        timezone = "America/New_York"
        layers = [
          {
            name = "Primary SRE"
            users = ["sre1@example.com", "sre2@example.com"]
            rotation_type = "weekly"
            start_time = "09:00"
            end_time = "17:00"
            days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
          }
        ]
      }
    ]
  })
```

### Status Pages

```hcl
# Public status page
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "Public status page for customer-facing services"
  data        = jsonencode({
    domain = "status.example.com"
    is_public = true
    title = "Example.com Service Status"
    components = [
      {
        name = "Website"
        description = "Main website and application"
        monitor_id = oneuptime_monitor.homepage.id
      },
      {
        name = "API"
        description = "REST API services"
        monitor_id = oneuptime_monitor.api_health.id
      }
    ]
  })
}

```

## Multi-Environment Example

### Environment Module

```hcl
# modules/environment/main.tf
variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain" {
  description = "Domain for this environment"
  type        = string
}

variable "api_domain" {
  description = "API domain for this environment"
  type        = string
}

# Environment-specific monitors
resource "oneuptime_monitor" "app" {
  name        = "${var.environment}-application"
  description = "Application monitor for ${var.environment} environment"
  data        = jsonencode({
    url = "https://${var.domain}"
    interval = var.environment == "production" ? "1m" : "5m"
    timeout = "30s"
  })
}

resource "oneuptime_monitor" "api" {
  name        = "${var.environment}-api"
  description = "API monitor for ${var.environment} environment"
  data        = jsonencode({
    url = "https://${var.api_domain}/health"
    method = "GET"
    interval = var.environment == "production" ? "1m" : "3m"
    timeout = "15s"
  })
}

# Outputs
output "app_monitor_id" {
  value = oneuptime_monitor.app.id
}

output "api_monitor_id" {
  value = oneuptime_monitor.api.id
}
```

### Using the Environment Module

```hcl
# main.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  api_url = var.oneuptime_api_url
  api_key = var.oneuptime_api_key
}

# Note: Projects must be created manually in the OneUptime dashboard
# Use the project ID from your existing project
variable "project_id" {
  description = "OneUptime project ID"
  type        = string
}

# Development environment
module "development" {
  source = "./modules/environment"
  
  environment = "development"
  domain     = "dev.example.com"
  api_domain = "api-dev.example.com"
}

# Staging environment
module "staging" {
  source = "./modules/environment"
  
  environment = "staging"
  domain     = "staging.example.com"
  api_domain = "api-staging.example.com"
}

# Production environment
module "production" {
  source = "./modules/environment"
  
  environment = "production"
  domain     = "example.com"
  api_domain = "api.example.com"
}

# Cross-environment status page
resource "oneuptime_status_page" "all_environments" {
  name        = "All Environments Status"
  description = "Status page showing all environments"
  data        = jsonencode({
    domain = "status-internal.example.com"
    component_groups = [
      {
        name = "Production"
        components = [
          module.production.app_monitor_id,
          module.production.api_monitor_id
        ]
      },
      {
        name = "Staging"
        components = [
          module.staging.app_monitor_id,
          module.staging.api_monitor_id
        ]
      },
      {
        name = "Development"
        components = [
          module.development.app_monitor_id,
          module.development.api_monitor_id
        ]
      }
    ]
  })
}
```

## Service Catalog Example

```hcl
# Service catalog with dependencies
resource "oneuptime_service_catalog" "frontend" {
  name        = "Frontend Application"
  description = "Customer-facing web application"
  data        = jsonencode({
    service_level = "customer_facing"
    criticality = "high"
    team_id = oneuptime_team.development.id
    monitors = [oneuptime_monitor.homepage.id]
    tags = {
      language = "typescript"
      framework = "react"
      repository = "github.com/example/frontend"
    }
  })
}

resource "oneuptime_service_catalog" "api" {
  name        = "Backend API"
  description = "REST API backend service"
  data        = jsonencode({
    service_level = "internal"
    criticality = "critical"
    team_id = oneuptime_team.development.id
    monitors = [oneuptime_monitor.api_health.id]
    tags = {
      language = "nodejs"
      framework = "express"
      repository = "github.com/example/api"
    }
  })
}
```

These examples demonstrate the correct usage of the OneUptime Terraform provider resources, which use a simplified schema with `name`, `description`, and `data` fields for configuration.
