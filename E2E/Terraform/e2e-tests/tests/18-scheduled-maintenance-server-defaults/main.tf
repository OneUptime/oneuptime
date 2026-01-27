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

# Test: Scheduled Maintenance Event with Server-Provided Defaults
#
# This test verifies UseStateForUnknown() works for scheduled maintenance:
# - String fields: description, current_scheduled_maintenance_state_id
# - Bool fields: should_status_page_subscribers_be_notified_on_event_created
# - List fields: monitors, labels, status_pages
#
# Tests datetime fields and various Optional+Computed field types.

# Create scheduled maintenance event with minimal fields
resource "oneuptime_scheduled_maintenance_event" "test_server_defaults" {
  title      = "Scheduled Maintenance Server Defaults Test"

  # Required datetime fields - use future dates
  starts_at = "2030-01-01T00:00:00.000Z"
  ends_at   = "2030-01-01T02:00:00.000Z"

  # IMPORTANT: We intentionally DO NOT specify these Optional+Computed fields:
  # - description (string)
  # - monitors (list)
  # - labels (list)
  # - status_pages (list)
  # - current_scheduled_maintenance_state_id (string - server sets default)
  # - should_status_page_subscribers_be_notified_on_event_created (bool)
  # - should_status_page_subscribers_be_notified_when_event_changes_to_ongoing (bool)
  # - should_status_page_subscribers_be_notified_when_event_changes_to_ended (bool)
  #
  # The server will provide default values for these fields.
}

# Output to verify creation succeeded
output "scheduled_maintenance_event_id" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.id
  description = "ID of the created scheduled maintenance event"
}

# Scheduled maintenance title for API validation
output "scheduled_maintenance_event_title" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.title
  description = "Title of the scheduled maintenance event"
}

# DateTime fields for API validation
output "scheduled_maintenance_event_starts_at" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.starts_at
  description = "Start time of the scheduled maintenance"
}

output "scheduled_maintenance_event_ends_at" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.ends_at
  description = "End time of the scheduled maintenance"
}

# String field - server provides default state
output "current_state_id" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.current_scheduled_maintenance_state_id
  description = "Server-assigned default scheduled maintenance state"
}

# List fields - server may provide empty list or defaults
output "monitors" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.monitors
  description = "Server-provided monitors list"
}

output "labels" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.labels
  description = "Server-provided labels list"
}

output "status_pages" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.status_pages
  description = "Server-provided status pages list"
}

# Bool fields - server provides defaults
output "notify_on_created" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.should_status_page_subscribers_be_notified_on_event_created
  description = "Server-provided default for notification on create"
}

# Other server-computed fields
output "slug" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.slug
  description = "Server-generated slug"
}

output "created_at" {
  value       = oneuptime_scheduled_maintenance_event.test_server_defaults.created_at
  description = "Server-generated creation timestamp"
}
