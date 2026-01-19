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

# Test: Incident with Server-Provided Defaults
#
# This test verifies UseStateForUnknown() works for various column types:
# - String fields: current_incident_state_id, description, etc.
# - Bool fields: should_status_page_subscribers_be_notified_on_incident_created
# - List fields: monitors, labels, on_call_duty_policies
#
# The server injects defaults for many fields that aren't specified.

# First create an incident severity (required dependency)
resource "oneuptime_incident_severity" "test" {
  project_id  = var.project_id
  name        = "Incident Test Severity"
  description = "Severity for incident server defaults test"
  color       = "#FF0000"
  order       = 99
}

# Create incident with minimal fields - let server provide defaults
resource "oneuptime_incident" "test_server_defaults" {
  project_id           = var.project_id
  title                = "Incident Server Defaults Test"
  incident_severity_id = oneuptime_incident_severity.test.id

  # IMPORTANT: We intentionally DO NOT specify these Optional+Computed fields:
  # - description (string)
  # - monitors (list)
  # - labels (list)
  # - on_call_duty_policies (list)
  # - current_incident_state_id (string - server sets to default "created" state)
  # - should_status_page_subscribers_be_notified_on_incident_created (bool)
  #
  # The server will provide default values for these fields.
  # With UseStateForUnknown(), Terraform accepts server-provided defaults.
}

# Output to verify creation succeeded
output "incident_id" {
  value       = oneuptime_incident.test_server_defaults.id
  description = "ID of the created incident"
}

# String field - server provides default incident state
output "current_incident_state_id" {
  value       = oneuptime_incident.test_server_defaults.current_incident_state_id
  description = "Server-assigned default incident state (should be 'created' state)"
}

# List field - server may provide empty list or defaults
output "monitors" {
  value       = oneuptime_incident.test_server_defaults.monitors
  description = "Server-provided monitors list"
}

output "labels" {
  value       = oneuptime_incident.test_server_defaults.labels
  description = "Server-provided labels list"
}

# Bool field - server provides default
output "should_notify_subscribers" {
  value       = oneuptime_incident.test_server_defaults.should_status_page_subscribers_be_notified_on_incident_created
  description = "Server-provided default for subscriber notification"
}

# Other server-computed fields
output "slug" {
  value       = oneuptime_incident.test_server_defaults.slug
  description = "Server-generated slug"
}

output "created_at" {
  value       = oneuptime_incident.test_server_defaults.created_at
  description = "Server-generated creation timestamp"
}
