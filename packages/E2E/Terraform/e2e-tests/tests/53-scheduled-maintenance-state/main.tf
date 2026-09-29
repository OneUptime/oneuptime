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

# Test: Scheduled Maintenance State
#
# Covers oneuptime_scheduled_maintenance_state. A high order value keeps the
# custom state clear of the project's default states (Scheduled/Ongoing/
# Completed), mirroring the incident-state fixture.

resource "oneuptime_scheduled_maintenance_state" "state" {
  name        = "terraform-e2e-maintenance-state"
  description = "Scheduled maintenance state created by Terraform E2E tests"
  color       = "#8E44AD"
  order       = 99
}

output "scheduled_maintenance_state_id" {
  value       = oneuptime_scheduled_maintenance_state.state.id
  description = "ID of the scheduled maintenance state"
}

output "scheduled_maintenance_state_name" {
  value       = oneuptime_scheduled_maintenance_state.state.name
  description = "Name of the scheduled maintenance state"
}

output "scheduled_maintenance_state_color" {
  value       = oneuptime_scheduled_maintenance_state.state.color
  description = "Color of the scheduled maintenance state"
}
