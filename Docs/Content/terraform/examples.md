# Terraform Provider Examples

This document provides comprehensive examples for common OneUptime Terraform configurations.

## Basic Examples

### Simple Website Monitor

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


resource "oneuptime_monitor" "homepage" {
  name       = "Homepage Monitor"
  project_id = oneuptime_project.website.id
  
  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"
  timeout      = "30s"
  
  expected_status_codes = [200]
  
  tags = {
    service = "website"
    team    = "frontend"
  }
}
```

### API Health Check

```hcl
resource "oneuptime_monitor" "api_health" {
  name       = "API Health Check"
  project_id = oneuptime_project.website.id
  
  monitor_type = "api"
  url          = "https://api.example.com/health"
  method       = "GET"
  interval     = "2m"
  timeout      = "15s"
  
  headers = {
    "Authorization" = "Bearer ${var.api_token}"
    "Content-Type"  = "application/json"
  }
  
  expected_status_codes = [200]
  expected_response_body = "healthy"
  
  tags = {
    service     = "api"
    environment = "production"
    criticality = "high"
  }
}
```

## Advanced Monitoring Setup

### Complete Infrastructure Monitoring

```hcl
# Variables
variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "services" {
  description = "Services to monitor"
  type = map(object({
    url         = string
    type        = string
    interval    = string
    criticality = string
  }))
  default = {
    frontend = {
      url         = "https://app.example.com"
      type        = "website"
      interval    = "1m"
      criticality = "high"
    }
    api = {
      url         = "https://api.example.com/health"
      type        = "api"
      interval    = "1m"
      criticality = "critical"
    }
    docs = {
      url         = "https://docs.example.com"
      type        = "website"
      interval    = "5m"
      criticality = "medium"
    }
  }
}

# Project
resource "oneuptime_project" "infrastructure" {
  name        = "${title(var.environment)} Infrastructure"
  description = "Infrastructure monitoring for ${var.environment}"
}

# Teams
resource "oneuptime_team" "sre" {
  name       = "SRE Team"
  project_id = oneuptime_project.infrastructure.id
}

resource "oneuptime_team" "development" {
  name       = "Development Team"
  project_id = oneuptime_project.infrastructure.id
}

# Monitors for each service
resource "oneuptime_monitor" "services" {
  for_each = var.services
  
  name       = "${var.environment}-${each.key}"
  project_id = oneuptime_project.infrastructure.id
  
  monitor_type = each.value.type
  url          = each.value.url
  interval     = each.value.interval
  timeout      = "30s"
  
  expected_status_codes = [200]
  
  tags = {
    service     = each.key
    environment = var.environment
    criticality = each.value.criticality
    managed_by  = "terraform"
  }
}

# Database monitors
resource "oneuptime_monitor" "database_primary" {
  name       = "${var.environment}-database-primary"
  project_id = oneuptime_project.infrastructure.id
  
  monitor_type = "port"
  hostname     = "db-primary.internal"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"
  
  tags = {
    service     = "database"
    role        = "primary"
    environment = var.environment
    criticality = "critical"
  }
}

resource "oneuptime_monitor" "database_replica" {
  name       = "${var.environment}-database-replica"
  project_id = oneuptime_project.infrastructure.id
  
  monitor_type = "port"
  hostname     = "db-replica.internal"
  port         = 5432
  interval     = "5m"
  timeout      = "10s"
  
  tags = {
    service     = "database"
    role        = "replica"
    environment = var.environment
    criticality = "medium"
  }
}

# Redis monitor
resource "oneuptime_monitor" "redis" {
  name       = "${var.environment}-redis"
  project_id = oneuptime_project.infrastructure.id
  
  monitor_type = "port"
  hostname     = "redis.internal"
  port         = 6379
  interval     = "3m"
  timeout      = "10s"
  
  tags = {
    service     = "cache"
    environment = var.environment
    criticality = "high"
  }
}
```

### On-Call and Alerting

```hcl
# On-call schedules
resource "oneuptime_on_call_policy" "sre_oncall" {
  name       = "SRE On-Call"
  project_id = oneuptime_project.infrastructure.id
  team_id    = oneuptime_team.sre.id
  
  schedules {
    name     = "Business Hours"
    timezone = "America/New_York"
    
    layers {
      name          = "Primary SRE"
      users         = ["sre1@example.com", "sre2@example.com"]
      rotation_type = "weekly"
      start_time    = "09:00"
      end_time      = "17:00"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
    
    layers {
      name          = "Secondary SRE"
      users         = ["sre3@example.com", "sre4@example.com"]
      rotation_type = "weekly"
      start_time    = "09:00"
      end_time      = "17:00"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
  
  schedules {
    name     = "After Hours"
    timezone = "America/New_York"
    
    layers {
      name          = "After Hours Primary"
      users         = ["sre1@example.com", "sre2@example.com", "sre3@example.com"]
      rotation_type = "weekly"
      start_time    = "17:00"
      end_time      = "09:00"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Alert policies
resource "oneuptime_alert_policy" "critical_services" {
  name       = "Critical Service Alerts"
  project_id = oneuptime_project.infrastructure.id
  
  # Critical service conditions
  dynamic "conditions" {
    for_each = {
      for k, v in var.services : k => v
      if v.criticality == "critical"
    }
    
    content {
      monitor_id = oneuptime_monitor.services[conditions.key].id
      threshold  = "down"
    }
  }
  
  # Database conditions
  conditions {
    monitor_id = oneuptime_monitor.database_primary.id
    threshold  = "down"
  }
  
  # Immediate Slack notification
  actions {
    type = "webhook"
    url  = var.slack_webhook_url
    headers = {
      "Content-Type" = "application/json"
    }
    payload = jsonencode({
      text = "🚨 CRITICAL ALERT: {{monitor_name}} is DOWN"
      channel = "#alerts-critical"
    })
  }
  
  # Page SRE team
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.sre_oncall.id
    escalation_delay = "0m"
  }
  
  # Email backup
  actions {
    type       = "email"
    recipients = ["sre-team@example.com"]
    delay      = "2m"
  }
}

resource "oneuptime_alert_policy" "high_priority" {
  name       = "High Priority Alerts"
  project_id = oneuptime_project.infrastructure.id
  
  # High priority service conditions
  dynamic "conditions" {
    for_each = {
      for k, v in var.services : k => v
      if v.criticality == "high"
    }
    
    content {
      monitor_id = oneuptime_monitor.services[conditions.key].id
      threshold  = "down"
    }
  }
  
  conditions {
    monitor_id = oneuptime_monitor.redis.id
    threshold  = "down"
  }
  
  # Slack notification
  actions {
    type = "webhook"
    url  = var.slack_webhook_url
    payload = jsonencode({
      text = "⚠️ HIGH PRIORITY: {{monitor_name}} is DOWN"
      channel = "#alerts-high"
    })
  }
  
  # Escalate to on-call after 5 minutes
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.sre_oncall.id
    escalation_delay = "5m"
  }
}
```

### Status Pages

```hcl
# Public status page
resource "oneuptime_status_page" "public" {
  name       = "Example.com Status"
  project_id = oneuptime_project.infrastructure.id
  
  domain      = "status.example.com"
  is_public   = true
  
  # Branding
  title            = "Example.com Service Status"
  description      = "Current status of Example.com services"
  logo_url         = "https://example.com/logo.png"
  favicon_url      = "https://example.com/favicon.ico"
  
  # Theme
  primary_color   = "#1f2937"
  secondary_color = "#6b7280"
  
  # Components from monitors
  components {
    name        = "Website"
    description = "Main website and application"
    monitor_id  = oneuptime_monitor.services["frontend"].id
    order       = 1
  }
  
  components {
    name        = "API"
    description = "REST API services"
    monitor_id  = oneuptime_monitor.services["api"].id
    order       = 2
  }
  
  components {
    name        = "Database"
    description = "Primary database cluster"
    monitor_id  = oneuptime_monitor.database_primary.id
    order       = 3
  }
  
  # Component groups
  component_groups {
    name        = "Core Services"
    description = "Essential services for application functionality"
    components  = [
      oneuptime_monitor.services["frontend"].id,
      oneuptime_monitor.services["api"].id,
      oneuptime_monitor.database_primary.id
    ]
    order = 1
  }
  
  component_groups {
    name        = "Support Services"
    description = "Additional services and infrastructure"
    components  = [
      oneuptime_monitor.redis.id,
      oneuptime_monitor.database_replica.id
    ]
    order = 2
  }
}

# Internal status page
resource "oneuptime_status_page" "internal" {
  name       = "Internal Services Status"
  project_id = oneuptime_project.infrastructure.id
  
  domain    = "status.internal.example.com"
  is_public = false
  
  # All services for internal view
  dynamic "components" {
    for_each = oneuptime_monitor.services
    
    content {
      name       = title(components.key)
      monitor_id = components.value.id
      order      = index(keys(oneuptime_monitor.services), components.key) + 1
    }
  }
  
  components {
    name       = "Primary Database"
    monitor_id = oneuptime_monitor.database_primary.id
    order      = 10
  }
  
  components {
    name       = "Replica Database"
    monitor_id = oneuptime_monitor.database_replica.id
    order      = 11
  }
  
  components {
    name       = "Redis Cache"
    monitor_id = oneuptime_monitor.redis.id
    order      = 12
  }
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

variable "oneuptime_project_id" {
  description = "OneUptime project ID"
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

variable "team_emails" {
  description = "Team member emails for notifications"
  type        = list(string)
}

# Environment-specific monitors
resource "oneuptime_monitor" "app" {
  name       = "${var.environment}-application"
  project_id = var.oneuptime_project_id
  
  monitor_type = "website"
  url          = "https://${var.domain}"
  interval     = var.environment == "production" ? "1m" : "5m"
  timeout      = "30s"
  
  expected_status_codes = [200]
  
  tags = {
    environment = var.environment
    service     = "application"
    criticality = var.environment == "production" ? "critical" : "medium"
  }
}

resource "oneuptime_monitor" "api" {
  name       = "${var.environment}-api"
  project_id = var.oneuptime_project_id
  
  monitor_type = "api"
  url          = "https://${var.api_domain}/health"
  method       = "GET"
  interval     = var.environment == "production" ? "1m" : "3m"
  timeout      = "15s"
  
  expected_status_codes = [200]
  
  tags = {
    environment = var.environment
    service     = "api"
    criticality = var.environment == "production" ? "critical" : "medium"
  }
}

# Environment-specific alerting
resource "oneuptime_alert_policy" "environment_alerts" {
  name       = "${title(var.environment)} Environment Alerts"
  project_id = var.oneuptime_project_id
  
  conditions {
    monitor_id = oneuptime_monitor.app.id
    threshold  = "down"
  }
  
  conditions {
    monitor_id = oneuptime_monitor.api.id
    threshold  = "down"
  }
  
  # Production gets immediate alerts, others are delayed
  actions {
    type       = "email"
    recipients = var.team_emails
    delay      = var.environment == "production" ? "0m" : "5m"
  }
  
  # Only production gets Slack alerts
  dynamic "actions" {
    for_each = var.environment == "production" ? [1] : []
    
    content {
      type = "webhook"
      url  = var.slack_webhook_url
      payload = jsonencode({
        text = "🚨 PRODUCTION ALERT: {{monitor_name}} is DOWN"
        channel = "#alerts-production"
      })
    }
  }
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

# Main project
resource "oneuptime_project" "company" {
  name        = "Company Infrastructure"
  description = "Multi-environment infrastructure monitoring"
}

# Development environment
module "development" {
  source = "./modules/environment"
  
  environment          = "development"
  oneuptime_project_id = oneuptime_project.company.id
  domain              = "dev.example.com"
  api_domain          = "api-dev.example.com"
  team_emails         = ["dev-team@example.com"]
}

# Staging environment
module "staging" {
  source = "./modules/environment"
  
  environment          = "staging"
  oneuptime_project_id = oneuptime_project.company.id
  domain              = "staging.example.com"
  api_domain          = "api-staging.example.com"
  team_emails         = ["qa-team@example.com", "dev-team@example.com"]
}

# Production environment
module "production" {
  source = "./modules/environment"
  
  environment          = "production"
  oneuptime_project_id = oneuptime_project.company.id
  domain              = "example.com"
  api_domain          = "api.example.com"
  team_emails         = ["sre-team@example.com", "dev-team@example.com"]
}

# Cross-environment status page
resource "oneuptime_status_page" "all_environments" {
  name       = "All Environments Status"
  project_id = oneuptime_project.company.id
  
  domain = "status-internal.example.com"
  
  component_groups {
    name = "Production"
    components = [
      module.production.app_monitor_id,
      module.production.api_monitor_id
    ]
    order = 1
  }
  
  component_groups {
    name = "Staging"
    components = [
      module.staging.app_monitor_id,
      module.staging.api_monitor_id
    ]
    order = 2
  }
  
  component_groups {
    name = "Development"
    components = [
      module.development.app_monitor_id,
      module.development.api_monitor_id
    ]
    order = 3
  }
}
```

## Service Catalog Example

```hcl
# Service catalog with dependencies
resource "oneuptime_service" "frontend" {
  name        = "Frontend Application"
  project_id  = oneuptime_project.company.id
  description = "Customer-facing web application"
  
  service_level = "customer_facing"
  criticality   = "high"
  
  team_id = oneuptime_team.frontend.id
  
  monitors = [
    oneuptime_monitor.services["frontend"].id
  ]
  
  tags = {
    language = "typescript"
    framework = "react"
    repository = "github.com/example/frontend"
  }
}

resource "oneuptime_service" "api" {
  name        = "Backend API"
  project_id  = oneuptime_project.company.id
  description = "REST API backend service"
  
  service_level = "internal"
  criticality   = "critical"
  
  team_id = oneuptime_team.backend.id
  
  monitors = [
    oneuptime_monitor.services["api"].id
  ]
  
  tags = {
    language = "nodejs"
    framework = "express"
    repository = "github.com/example/api"
  }
}

resource "oneuptime_service" "database" {
  name        = "PostgreSQL Database"
  project_id  = oneuptime_project.company.id
  description = "Primary application database"
  
  service_level = "infrastructure"
  criticality   = "critical"
  
  team_id = oneuptime_team.sre.id
  
  monitors = [
    oneuptime_monitor.database_primary.id,
    oneuptime_monitor.database_replica.id
  ]
  
  tags = {
    type = "database"
    engine = "postgresql"
    version = "14"
  }
}

# Service dependencies
resource "oneuptime_service_dependency" "frontend_api" {
  service_id           = oneuptime_service.frontend.id
  depends_on_service_id = oneuptime_service.api.id
  dependency_type      = "hard"
}

resource "oneuptime_service_dependency" "api_database" {
  service_id           = oneuptime_service.api.id
  depends_on_service_id = oneuptime_service.database.id
  dependency_type      = "hard"
}
```

## Data Sources Example

```hcl
# Use existing project
data "oneuptime_project" "existing" {
  name = "Legacy Project"
}

# Use existing monitor
data "oneuptime_monitor" "legacy_api" {
  name       = "Legacy API Monitor"
  project_id = data.oneuptime_project.existing.id
}

# Create new alert policy using existing monitor
resource "oneuptime_alert_policy" "legacy_migration" {
  name       = "Legacy System Migration Alerts"
  project_id = oneuptime_project.company.id
  
  conditions {
    monitor_id = data.oneuptime_monitor.legacy_api.id
    threshold  = "down"
  }
  
  actions {
    type       = "email"
    recipients = ["migration-team@example.com"]
  }
}
```

These examples demonstrate various patterns and use cases for the OneUptime Terraform provider, from simple monitoring setups to complex multi-environment configurations with service catalogs and dependencies.
