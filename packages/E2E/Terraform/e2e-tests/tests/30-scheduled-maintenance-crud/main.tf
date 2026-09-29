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

# Test: Scheduled Maintenance CRUD Operations
#
# This test validates:
# 1. Creating scheduled maintenance events
# 2. Different configurations
# 3. Server defaults handling
# 4. Idempotency

locals {
  # Fixed future timestamps: the provider must round-trip these without drift
  # (its semantic date equality has to treat server-normalized forms as equal).
  starts_at = "2030-06-01T10:00:00.000Z"
  ends_at   = "2030-06-01T11:00:00.000Z"
}

# Test Case 1: Basic Scheduled Maintenance
resource "oneuptime_scheduled_maintenance_event" "basic" {
  title       = "TF Basic Maintenance ${random_id.suffix.hex}"
  description = "Basic scheduled maintenance for testing"
  starts_at   = local.starts_at
  ends_at     = local.ends_at
}

# Test Case 2: Scheduled Maintenance with visibility
resource "oneuptime_scheduled_maintenance_event" "visibility" {
  title                                                       = "TF Visibility Maintenance ${random_id.suffix.hex}"
  description                                                 = "Maintenance with visibility settings"
  starts_at                                                   = local.starts_at
  ends_at                                                     = local.ends_at
  is_visible_on_status_page                                   = true
  should_status_page_subscribers_be_notified_on_event_created = false
}

# Test Case 3: Scheduled Maintenance with labels
resource "oneuptime_label" "maintenance_label" {
  name        = "TF Maintenance Label ${random_id.suffix.hex}"
  description = "Label for maintenance testing"
  color       = "#8e44ad"
}

resource "oneuptime_scheduled_maintenance_event" "with_labels" {
  title       = "TF Labeled Maintenance ${random_id.suffix.hex}"
  description = "Maintenance with labels"
  starts_at   = local.starts_at
  ends_at     = local.ends_at
  labels      = [oneuptime_label.maintenance_label.id]
}

# Outputs
output "basic_maintenance_id" {
  value       = oneuptime_scheduled_maintenance_event.basic.id
  description = "Basic maintenance ID"
}

output "basic_maintenance_title" {
  value       = oneuptime_scheduled_maintenance_event.basic.title
  description = "Basic maintenance title"
}

output "visibility_maintenance_id" {
  value       = oneuptime_scheduled_maintenance_event.visibility.id
  description = "Visibility maintenance ID"
}

output "labeled_maintenance_id" {
  value       = oneuptime_scheduled_maintenance_event.with_labels.id
  description = "Labeled maintenance ID"
}

output "label_id" {
  value       = oneuptime_label.maintenance_label.id
  description = "Maintenance label ID"
}

# Server-computed fields
output "basic_maintenance_slug" {
  value       = oneuptime_scheduled_maintenance_event.basic.slug
  description = "Server-generated slug"
}

output "basic_maintenance_created_at" {
  value       = oneuptime_scheduled_maintenance_event.basic.created_at
  description = "Server-generated creation timestamp"
}
