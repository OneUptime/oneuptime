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

# Test: On-Call Policy CRUD Operations
#
# This test validates:
# 1. Creating on-call policies
# 2. Different configurations
# 3. Server defaults handling
# 4. Idempotency

# Test Case 1: Basic On-Call Policy
resource "oneuptime_on_call_policy" "basic" {
  name        = "TF Basic OnCall Policy ${random_id.suffix.hex}"
  description = "Basic on-call policy for testing"
}

# Test Case 2: On-Call Policy with repeat settings
resource "oneuptime_on_call_policy" "repeat" {
  name                                 = "TF Repeat OnCall Policy ${random_id.suffix.hex}"
  description                          = "On-call policy with repeat settings"
  repeat_policy_if_no_one_acknowledges = true
}

# Test Case 3: On-Call Policy with labels
resource "oneuptime_label" "oncall_label" {
  name        = "TF OnCall Label ${random_id.suffix.hex}"
  description = "Label for on-call testing"
  color       = "#16a085"
}

resource "oneuptime_on_call_policy" "with_labels" {
  name        = "TF Labeled OnCall Policy ${random_id.suffix.hex}"
  description = "On-call policy with labels"
  labels      = [oneuptime_label.oncall_label.id]
}

# Outputs
output "basic_policy_id" {
  value       = oneuptime_on_call_policy.basic.id
  description = "Basic policy ID"
}

output "basic_policy_name" {
  value       = oneuptime_on_call_policy.basic.name
  description = "Basic policy name"
}

output "repeat_policy_id" {
  value       = oneuptime_on_call_policy.repeat.id
  description = "Repeat policy ID"
}

output "labeled_policy_id" {
  value       = oneuptime_on_call_policy.with_labels.id
  description = "Labeled policy ID"
}

output "label_id" {
  value       = oneuptime_label.oncall_label.id
  description = "OnCall label ID"
}

# Server-computed fields
output "basic_policy_slug" {
  value       = oneuptime_on_call_policy.basic.slug
  description = "Server-generated slug"
}
