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

# Test: Incident CRUD Operations
#
# This test validates:
# 1. Creating incidents with various configurations
# 2. Server defaults for incident states and severities
# 3. Complex fields like custom_fields
# 4. Idempotency

# First, create incident severity and state for testing
resource "oneuptime_incident_severity" "test_severity" {
  project_id  = var.project_id
  name        = "TF Test Severity ${random_id.suffix.hex}"
  description = "Test severity for incident CRUD"
  color       = "#e74c3c"
  order       = 100
}

resource "oneuptime_incident_state" "test_state" {
  project_id  = var.project_id
  name        = "TF Test State ${random_id.suffix.hex}"
  description = "Test state for incident CRUD"
  color       = "#3498db"
  order       = 100
}

# Test Case 1: Basic Incident
resource "oneuptime_incident" "basic" {
  project_id                  = var.project_id
  title                       = "TF Basic Incident ${random_id.suffix.hex}"
  description                 = "Basic incident created by Terraform E2E tests"
  current_incident_state_id   = oneuptime_incident_state.test_state.id
  incident_severity_id        = oneuptime_incident_severity.test_severity.id
}

# Test Case 2: Incident with root cause
resource "oneuptime_incident" "with_root_cause" {
  project_id                  = var.project_id
  title                       = "TF Incident With Root Cause ${random_id.suffix.hex}"
  description                 = "Incident with detailed root cause analysis"
  current_incident_state_id   = oneuptime_incident_state.test_state.id
  incident_severity_id        = oneuptime_incident_severity.test_severity.id
  root_cause                  = "Database connection pool exhausted due to high traffic"
}

# Test Case 3: Incident with visibility settings
resource "oneuptime_incident" "visibility_settings" {
  project_id                          = var.project_id
  title                               = "TF Visibility Incident ${random_id.suffix.hex}"
  description                         = "Incident with custom visibility"
  current_incident_state_id           = oneuptime_incident_state.test_state.id
  incident_severity_id                = oneuptime_incident_severity.test_severity.id
  is_visible_on_status_page                                      = true
  should_status_page_subscribers_be_notified_on_incident_created = false
}

# Test Case 4: Incident with labels
resource "oneuptime_label" "incident_label" {
  project_id  = var.project_id
  name        = "TF Incident Label ${random_id.suffix.hex}"
  description = "Label for incident testing"
  color       = "#9b59b6"
}

resource "oneuptime_incident" "with_labels" {
  project_id                  = var.project_id
  title                       = "TF Labeled Incident ${random_id.suffix.hex}"
  description                 = "Incident with labels attached"
  current_incident_state_id   = oneuptime_incident_state.test_state.id
  incident_severity_id        = oneuptime_incident_severity.test_severity.id
  labels                      = [oneuptime_label.incident_label.id]
}

# Outputs
output "basic_incident_id" {
  value       = oneuptime_incident.basic.id
  description = "Basic incident ID"
}

output "basic_incident_title" {
  value       = oneuptime_incident.basic.title
  description = "Basic incident title"
}

output "with_root_cause_id" {
  value       = oneuptime_incident.with_root_cause.id
  description = "Incident with root cause ID"
}

output "with_root_cause_root_cause" {
  value       = oneuptime_incident.with_root_cause.root_cause
  description = "Root cause value"
}

output "visibility_settings_id" {
  value       = oneuptime_incident.visibility_settings.id
  description = "Visibility settings incident ID"
}

output "with_labels_id" {
  value       = oneuptime_incident.with_labels.id
  description = "Labeled incident ID"
}

output "severity_id" {
  value       = oneuptime_incident_severity.test_severity.id
  description = "Test severity ID"
}

output "state_id" {
  value       = oneuptime_incident_state.test_state.id
  description = "Test state ID"
}

output "label_id" {
  value       = oneuptime_label.incident_label.id
  description = "Incident label ID"
}

# Server-computed fields
output "basic_incident_slug" {
  value       = oneuptime_incident.basic.slug
  description = "Server-generated slug"
}

output "basic_incident_created_at" {
  value       = oneuptime_incident.basic.created_at
  description = "Server-generated creation timestamp"
}
