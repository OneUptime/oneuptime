# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf:
# - manual_basic: name and description updated
# - manual_custom: description updated
# - with_labels: label set grows from one label to two (tests set updates)
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

resource "oneuptime_monitor" "manual_basic" {
  name         = "TF E2E Manual Monitor Updated ${random_id.suffix.hex}"
  description  = "Manual monitor updated by Terraform E2E tests"
  monitor_type = "Manual"
}

resource "oneuptime_monitor" "manual_custom" {
  name         = "TF E2E Custom Monitor ${random_id.suffix.hex}"
  description  = "Custom manual monitor with updated settings"
  monitor_type = "Manual"
}

resource "oneuptime_label" "test_label" {
  name        = "TF E2E Monitor Label ${random_id.suffix.hex}"
  description = "Label for monitor testing"
  color       = "#3498db"
}

resource "oneuptime_label" "test_label_two" {
  name        = "TF E2E Monitor Label Two ${random_id.suffix.hex}"
  description = "Second label added during the update phase"
  color       = "#e67e22"
}

resource "oneuptime_monitor" "with_labels" {
  name         = "TF E2E Labeled Monitor ${random_id.suffix.hex}"
  description  = "Monitor with attached labels"
  monitor_type = "Manual"
  labels       = [oneuptime_label.test_label.id, oneuptime_label.test_label_two.id]
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

output "label_two_id" {
  value       = oneuptime_label.test_label_two.id
  description = "ID of the second test label"
}

output "monitor_slug" {
  value       = oneuptime_monitor.manual_basic.slug
  description = "Server-generated slug for the monitor"
}

output "monitor_current_status_id" {
  value       = oneuptime_monitor.manual_basic.current_monitor_status_id
  description = "Server-assigned current monitor status ID"
}
