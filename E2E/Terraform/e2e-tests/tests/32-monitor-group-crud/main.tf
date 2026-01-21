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

# Test: Monitor Group CRUD Operations

# Test Case 1: Basic Monitor Group
resource "oneuptime_monitor_group" "basic" {
  project_id  = var.project_id
  name        = "TF Basic Monitor Group ${random_id.suffix.hex}"
  description = "Basic monitor group for testing"
}

# Test Case 2: Monitor Group with labels
resource "oneuptime_label" "group_label" {
  project_id  = var.project_id
  name        = "TF Group Label ${random_id.suffix.hex}"
  description = "Label for monitor group testing"
  color       = "#27ae60"
}

resource "oneuptime_monitor_group" "with_labels" {
  project_id  = var.project_id
  name        = "TF Labeled Monitor Group ${random_id.suffix.hex}"
  description = "Monitor group with labels"
  labels      = [oneuptime_label.group_label.id]
}

# Test Case 3: Multiple monitor groups
resource "oneuptime_monitor_group" "secondary" {
  project_id  = var.project_id
  name        = "TF Secondary Monitor Group ${random_id.suffix.hex}"
  description = "Secondary monitor group"
}

# Outputs
output "basic_group_id" {
  value       = oneuptime_monitor_group.basic.id
  description = "Basic group ID"
}

output "labeled_group_id" {
  value       = oneuptime_monitor_group.with_labels.id
  description = "Labeled group ID"
}

output "secondary_group_id" {
  value       = oneuptime_monitor_group.secondary.id
  description = "Secondary group ID"
}

output "label_id" {
  value       = oneuptime_label.group_label.id
  description = "Group label ID"
}

output "basic_group_slug" {
  value       = oneuptime_monitor_group.basic.slug
  description = "Server-generated slug"
}
