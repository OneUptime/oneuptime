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

# Test: Probe CRUD Operations
#
# This test validates complete CRUD operations for the oneuptime_probe resource:
# 1. Create multiple probes with different configurations
# 2. Verify probe_version is properly handled (Issue #2228 fix)
# 3. Test idempotency (re-apply should show no changes)
#
# Issue #2228: probe_version field was returning as JSON object
# {"_type":"Version","value":"9.3.19"} instead of string "9.3.19"
# The fix should unwrap the Version object and store just the version string

locals {
  timestamp = formatdate("YYYYMMDDhhmmss", timestamp())
}

# Test Case 1: Basic Probe
resource "oneuptime_probe" "basic" {
  project_id    = var.project_id
  key           = "tf-e2e-probe-basic-${local.timestamp}"
  name          = "TF E2E Basic Probe ${local.timestamp}"
  description   = "Basic probe created by Terraform E2E tests"
  probe_version = "1.0.0"

  lifecycle {
    ignore_changes = [key, name]
  }
}

# Test Case 2: Probe with Different Version
resource "oneuptime_probe" "versioned" {
  project_id    = var.project_id
  key           = "tf-e2e-probe-v2-${local.timestamp}"
  name          = "TF E2E Versioned Probe ${local.timestamp}"
  description   = "Probe with specific version"
  probe_version = "2.1.0"

  lifecycle {
    ignore_changes = [key, name]
  }
}

# Test Case 3: Probe with Auto-Enable Setting
resource "oneuptime_probe" "auto_enable" {
  project_id                             = var.project_id
  key                                    = "tf-e2e-probe-auto-${local.timestamp}"
  name                                   = "TF E2E Auto-Enable Probe ${local.timestamp}"
  description                            = "Probe with auto-enable on new monitors"
  probe_version                          = "1.5.0"
  should_auto_enable_probe_on_new_monitors = true

  lifecycle {
    ignore_changes = [key, name]
  }
}

# Test Case 4: Probe with Labels
resource "oneuptime_label" "probe_label" {
  project_id  = var.project_id
  name        = "TF E2E Probe Label ${local.timestamp}"
  description = "Label for probe testing"
  color       = "#9b59b6"

  lifecycle {
    ignore_changes = [name]
  }
}

resource "oneuptime_probe" "with_labels" {
  project_id    = var.project_id
  key           = "tf-e2e-probe-labeled-${local.timestamp}"
  name          = "TF E2E Labeled Probe ${local.timestamp}"
  description   = "Probe with attached labels"
  probe_version = "1.0.0"
  labels        = [oneuptime_label.probe_label.id]

  lifecycle {
    ignore_changes = [key, name]
  }
}

# Outputs for verification
output "basic_probe_id" {
  value       = oneuptime_probe.basic.id
  description = "ID of the basic probe"
}

output "basic_probe_version" {
  value       = oneuptime_probe.basic.probe_version
  description = "Version of the basic probe - should be '1.0.0' not JSON"
}

output "versioned_probe_id" {
  value       = oneuptime_probe.versioned.id
  description = "ID of the versioned probe"
}

output "versioned_probe_version" {
  value       = oneuptime_probe.versioned.probe_version
  description = "Version of the versioned probe - should be '2.1.0' not JSON"
}

output "auto_enable_probe_id" {
  value       = oneuptime_probe.auto_enable.id
  description = "ID of the auto-enable probe"
}

output "auto_enable_probe_version" {
  value       = oneuptime_probe.auto_enable.probe_version
  description = "Version of the auto-enable probe"
}

output "labeled_probe_id" {
  value       = oneuptime_probe.with_labels.id
  description = "ID of the labeled probe"
}

output "label_id" {
  value       = oneuptime_label.probe_label.id
  description = "ID of the test label"
}
