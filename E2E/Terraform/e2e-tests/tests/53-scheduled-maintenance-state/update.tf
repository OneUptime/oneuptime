# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: name, description and color.
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

resource "oneuptime_scheduled_maintenance_state" "state" {
  name        = "terraform-e2e-maintenance-state-updated"
  description = "Scheduled maintenance state updated by Terraform E2E tests"
  color       = "#16A085"
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
