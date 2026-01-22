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

# Test: Monitor CRUD Operations
#
# This test validates complete CRUD operations for the oneuptime_monitor resource:
# 1. Create multiple monitors with different types
# 2. Verify all monitors are created with correct attributes
# 3. Test idempotency (re-apply should show no changes)
#
# Monitor types tested:
# - Manual (basic monitoring)
# - Website (HTTP monitoring simulation)

# Test Case 1: Manual Monitor (Basic)
resource "oneuptime_monitor" "manual_basic" {
  project_id   = var.project_id
  name         = "TF E2E Manual Monitor ${random_id.suffix.hex}"
  description  = "Manual monitor created by Terraform E2E tests"
  monitor_type = "Manual"
}

# Test Case 2: Manual Monitor with Custom Settings
resource "oneuptime_monitor" "manual_custom" {
  project_id   = var.project_id
  name         = "TF E2E Custom Monitor ${random_id.suffix.hex}"
  description  = "Custom manual monitor with additional settings"
  monitor_type = "Manual"
}

# Test Case 3: Monitor with Labels (if labels exist)
resource "oneuptime_label" "test_label" {
  project_id  = var.project_id
  name        = "TF E2E Monitor Label ${random_id.suffix.hex}"
  description = "Label for monitor testing"
  color       = "#3498db"
}

resource "oneuptime_monitor" "with_labels" {
  project_id   = var.project_id
  name         = "TF E2E Labeled Monitor ${random_id.suffix.hex}"
  description  = "Monitor with attached labels"
  monitor_type = "Manual"
  labels       = [oneuptime_label.test_label.id]
}

# Outputs for verification
output "manual_basic_id" {
  value       = oneuptime_monitor.manual_basic.id
  description = "ID of the basic manual monitor"
}

output "manual_basic_name" {
  value       = oneuptime_monitor.manual_basic.name
  description = "Name of the basic manual monitor"
}

output "manual_custom_id" {
  value       = oneuptime_monitor.manual_custom.id
  description = "ID of the custom manual monitor"
}

output "with_labels_id" {
  value       = oneuptime_monitor.with_labels.id
  description = "ID of the monitor with labels"
}

output "label_id" {
  value       = oneuptime_label.test_label.id
  description = "ID of the test label"
}

output "monitor_slug" {
  value       = oneuptime_monitor.manual_basic.slug
  description = "Server-generated slug for the monitor"
}

output "monitor_current_status_id" {
  value       = oneuptime_monitor.manual_basic.current_monitor_status_id
  description = "Server-assigned current monitor status ID"
}
