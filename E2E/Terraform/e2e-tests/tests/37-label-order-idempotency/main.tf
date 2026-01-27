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

# Test: Label order idempotency
# This test ensures labels are treated as order-independent and do not cause drift.

resource "oneuptime_label" "first" {
  project_id  = var.project_id
  name        = "TF E2E Label First ${random_id.suffix.hex}"
  description = "First label for order idempotency"
  color       = "#3498db"
}

resource "oneuptime_label" "second" {
  project_id  = var.project_id
  name        = "TF E2E Label Second ${random_id.suffix.hex}"
  description = "Second label for order idempotency"
  color       = "#e74c3c"
}

resource "oneuptime_probe" "with_labels" {
  project_id    = var.project_id
  key           = "tf-e2e-probe-label-order-${random_id.suffix.hex}"
  name          = "TF E2E Probe Label Order ${random_id.suffix.hex}"
  description   = "Probe with labels in non-sorted order"
  probe_version = "1.0.0"

  # Intentionally non-sorted to verify order does not cause drift
  labels = [
    oneuptime_label.second.id,
    oneuptime_label.first.id,
  ]
}

output "probe_id" {
  value       = oneuptime_probe.with_labels.id
  description = "ID of the probe with labels"
}

output "label_first_id" {
  value       = oneuptime_label.first.id
  description = "ID of the first label"
}

output "label_second_id" {
  value       = oneuptime_label.second.id
  description = "ID of the second label"
}

output "probe_labels" {
  value       = oneuptime_probe.with_labels.labels
  description = "Labels attached to the probe"
}
