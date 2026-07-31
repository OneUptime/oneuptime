# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf:
# - basic: description and probe_version updated
# - auto_enable: should_auto_enable_probe_on_new_monitors toggled off
# - with_labels: description updated
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

# Test Case 1: Basic Probe
resource "oneuptime_probe" "basic" {
  key           = "tf-e2e-probe-basic-${random_id.suffix.hex}"
  name          = "TF E2E Basic Probe ${random_id.suffix.hex}"
  description   = "Basic probe updated by Terraform E2E tests"
  probe_version = "1.0.1"
}

# Test Case 2: Probe with Different Version
resource "oneuptime_probe" "versioned" {
  key           = "tf-e2e-probe-v2-${random_id.suffix.hex}"
  name          = "TF E2E Versioned Probe ${random_id.suffix.hex}"
  description   = "Probe with specific version"
  probe_version = "2.1.0"
}

# Test Case 3: Probe with Auto-Enable Setting
resource "oneuptime_probe" "auto_enable" {
  key                                    = "tf-e2e-probe-auto-${random_id.suffix.hex}"
  name                                   = "TF E2E Auto-Enable Probe ${random_id.suffix.hex}"
  description                            = "Probe with auto-enable on new monitors"
  probe_version                          = "1.5.0"
  should_auto_enable_probe_on_new_monitors = false
}

# Test Case 4: Probe with Labels
resource "oneuptime_label" "probe_label" {
  name        = "TF E2E Probe Label ${random_id.suffix.hex}"
  description = "Label for probe testing"
  color       = "#9b59b6"
}

resource "oneuptime_probe" "with_labels" {
  key           = "tf-e2e-probe-labeled-${random_id.suffix.hex}"
  name          = "TF E2E Labeled Probe ${random_id.suffix.hex}"
  description   = "Probe with attached labels (updated)"
  probe_version = "1.0.0"
  labels        = [oneuptime_label.probe_label.id]
}

# Outputs for verification
output "basic_probe_id" {
  value       = oneuptime_probe.basic.id
  description = "ID of the basic probe"
}

output "basic_probe_version" {
  value       = oneuptime_probe.basic.probe_version
  description = "Version of the basic probe - should be '1.0.1' not JSON"
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
