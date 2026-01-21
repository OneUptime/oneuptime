terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

# Test: Alert CRUD Operations
#
# This test validates:
# 1. Creating alerts with various configurations
# 2. Server defaults for alert states and severities
# 3. Complex fields handling
# 4. Idempotency

locals {
  timestamp = formatdate("YYYYMMDDhhmmss", timestamp())
}

# Create prerequisites
resource "oneuptime_alert_severity" "test_severity" {
  project_id  = var.project_id
  name        = "TF Alert Severity ${local.timestamp}"
  description = "Test severity for alert CRUD"
  color       = "#f39c12"
  order       = 100

  lifecycle {
    ignore_changes = [name]
  }
}

resource "oneuptime_alert_state" "test_state" {
  project_id  = var.project_id
  name        = "TF Alert State ${local.timestamp}"
  description = "Test state for alert CRUD"
  color       = "#2ecc71"
  order       = 100

  lifecycle {
    ignore_changes = [name]
  }
}

resource "oneuptime_monitor" "for_alert" {
  project_id   = var.project_id
  name         = "TF Monitor For Alert ${local.timestamp}"
  description  = "Monitor associated with alerts"
  monitor_type = "Manual"

  lifecycle {
    ignore_changes = [name]
  }
}

# Test Case 1: Basic Alert
resource "oneuptime_alert" "basic" {
  project_id              = var.project_id
  title                   = "TF Basic Alert ${local.timestamp}"
  description             = "Basic alert created by Terraform E2E tests"
  current_alert_state_id  = oneuptime_alert_state.test_state.id
  alert_severity_id       = oneuptime_alert_severity.test_severity.id
  monitor_id              = oneuptime_monitor.for_alert.id

  lifecycle {
    ignore_changes = [title]
  }
}

# Test Case 2: Alert with root cause
resource "oneuptime_alert" "with_root_cause" {
  project_id             = var.project_id
  title                  = "TF Root Cause Alert ${local.timestamp}"
  description            = "Alert with root cause analysis"
  current_alert_state_id = oneuptime_alert_state.test_state.id
  alert_severity_id      = oneuptime_alert_severity.test_severity.id
  monitor_id             = oneuptime_monitor.for_alert.id
  root_cause             = "Service degradation due to high memory usage"

  lifecycle {
    ignore_changes = [title]
  }
}

# Test Case 3: Alert with labels
resource "oneuptime_label" "alert_label" {
  project_id  = var.project_id
  name        = "TF Alert Label ${local.timestamp}"
  description = "Label for alert testing"
  color       = "#1abc9c"

  lifecycle {
    ignore_changes = [name]
  }
}

resource "oneuptime_alert" "with_labels" {
  project_id              = var.project_id
  title                   = "TF Labeled Alert ${local.timestamp}"
  description             = "Alert with labels attached"
  current_alert_state_id  = oneuptime_alert_state.test_state.id
  alert_severity_id       = oneuptime_alert_severity.test_severity.id
  monitor_id              = oneuptime_monitor.for_alert.id
  labels                  = [oneuptime_label.alert_label.id]

  lifecycle {
    ignore_changes = [title]
  }
}

# Outputs
output "basic_alert_id" {
  value       = oneuptime_alert.basic.id
  description = "Basic alert ID"
}

output "basic_alert_title" {
  value       = oneuptime_alert.basic.title
  description = "Basic alert title"
}

output "root_cause_alert_id" {
  value       = oneuptime_alert.with_root_cause.id
  description = "Alert with root cause ID"
}

output "root_cause_value" {
  value       = oneuptime_alert.with_root_cause.root_cause
  description = "Root cause value"
}

output "labeled_alert_id" {
  value       = oneuptime_alert.with_labels.id
  description = "Labeled alert ID"
}

output "severity_id" {
  value       = oneuptime_alert_severity.test_severity.id
  description = "Alert severity ID"
}

output "state_id" {
  value       = oneuptime_alert_state.test_state.id
  description = "Alert state ID"
}

output "monitor_id" {
  value       = oneuptime_monitor.for_alert.id
  description = "Monitor ID"
}

output "label_id" {
  value       = oneuptime_label.alert_label.id
  description = "Alert label ID"
}

# Server-computed fields
output "basic_alert_created_at" {
  value       = oneuptime_alert.basic.created_at
  description = "Server-generated timestamp"
}
