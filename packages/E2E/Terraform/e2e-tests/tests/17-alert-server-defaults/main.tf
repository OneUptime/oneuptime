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

# Test: Alert with Server-Provided Defaults
#
# This test verifies UseStateForUnknown() works for alert resource:
# - String fields: current_alert_state_id, description
# - Bool fields: is_owner_notified_of_alert_creation
# - List fields: labels, on_call_duty_policies
#
# Similar to incident but for the alert resource type.

# First create an alert severity (required dependency)
resource "oneuptime_alert_severity" "test" {
  name        = "TF Alert Severity ${random_id.suffix.hex}"
  description = "Severity for alert server defaults test"
  color       = "#FFA500"
  order       = 98
}

# Create alert with minimal fields - let server provide defaults
resource "oneuptime_alert" "test_server_defaults" {
  title             = "TF Alert Defaults ${random_id.suffix.hex}"
  alert_severity_id = oneuptime_alert_severity.test.id

  # IMPORTANT: We intentionally DO NOT specify these Optional+Computed fields:
  # - description (string)
  # - labels (list)
  # - on_call_duty_policies (list)
  # - current_alert_state_id (string - server sets to default state)
  #
  # The server will provide default values for these fields.
}

# Output to verify creation succeeded
output "alert_id" {
  value       = oneuptime_alert.test_server_defaults.id
  description = "ID of the created alert"
}

# Alert severity outputs for API validation
output "alert_severity_id" {
  value       = oneuptime_alert_severity.test.id
  description = "ID of the created alert severity"
}

output "alert_severity_name" {
  value       = oneuptime_alert_severity.test.name
  description = "Name of the alert severity"
}

output "alert_severity_color" {
  value       = oneuptime_alert_severity.test.color
  description = "Color of the alert severity"
}

# Alert title for API validation
output "alert_title" {
  value       = oneuptime_alert.test_server_defaults.title
  description = "Title of the created alert"
}

# String field - server provides default alert state
output "current_alert_state_id" {
  value       = oneuptime_alert.test_server_defaults.current_alert_state_id
  description = "Server-assigned default alert state"
}

# List fields - server may provide empty list or defaults
output "labels" {
  value       = oneuptime_alert.test_server_defaults.labels
  description = "Server-provided labels list"
}

output "on_call_duty_policies" {
  value       = oneuptime_alert.test_server_defaults.on_call_duty_policies
  description = "Server-provided on-call duty policies list"
}

# Other server-computed fields
output "created_at" {
  value       = oneuptime_alert.test_server_defaults.created_at
  description = "Server-generated creation timestamp"
}
