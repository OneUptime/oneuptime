terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "random_id" "suffix" {
  byte_length = 4
}

# Test: Alert CRUD Operations
#
# This test validates:
# 1. Creating alerts with various configurations
# 2. Server defaults for alert states and severities
# 3. Complex fields handling
# 4. Idempotency

# Create prerequisites
resource "oneuptime_alert_severity" "test_severity" {
  project_id  = var.project_id
  name        = "TF Alert Severity ${random_id.suffix.hex}"
  description = "Test severity for alert CRUD"
  color       = "#f39c12"
  order       = 100
}

resource "oneuptime_alert_state" "test_state" {
  project_id  = var.project_id
  name        = "TF Alert State ${random_id.suffix.hex}"
  description = "Test state for alert CRUD"
  color       = "#2ecc71"
  order       = 100
}

resource "oneuptime_monitor" "for_alert" {
  project_id   = var.project_id
  name         = "TF Monitor For Alert ${random_id.suffix.hex}"
  description  = "Monitor associated with alerts"
  monitor_type = "Manual"
}

# Test Case 1: Basic Alert
# Note: We do NOT specify current_alert_state_id because the server
# will set it to the default "Created" state and override any value we provide
resource "oneuptime_alert" "basic" {
  project_id        = var.project_id
  title             = "TF Basic Alert ${random_id.suffix.hex}"
  description       = "Basic alert created by Terraform E2E tests"
  alert_severity_id = oneuptime_alert_severity.test_severity.id
  monitor_id        = oneuptime_monitor.for_alert.id
}

# Test Case 2: Alert with root cause
resource "oneuptime_alert" "with_root_cause" {
  project_id        = var.project_id
  title             = "TF Root Cause Alert ${random_id.suffix.hex}"
  description       = "Alert with root cause analysis"
  alert_severity_id = oneuptime_alert_severity.test_severity.id
  monitor_id        = oneuptime_monitor.for_alert.id
  root_cause        = "Service degradation due to high memory usage"
}

# Test Case 3: Alert with labels
resource "oneuptime_label" "alert_label" {
  project_id  = var.project_id
  name        = "TF Alert Label ${random_id.suffix.hex}"
  description = "Label for alert testing"
  color       = "#1abc9c"
}

resource "oneuptime_alert" "with_labels" {
  project_id        = var.project_id
  title             = "TF Labeled Alert ${random_id.suffix.hex}"
  description       = "Alert with labels attached"
  alert_severity_id = oneuptime_alert_severity.test_severity.id
  monitor_id        = oneuptime_monitor.for_alert.id
  labels            = [oneuptime_label.alert_label.id]
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
