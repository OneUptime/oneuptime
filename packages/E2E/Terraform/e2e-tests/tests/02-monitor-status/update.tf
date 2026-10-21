# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: description, color.
# NOTE: priority is intentionally NOT changed here, so this phase checks the
# description and color alone. A priority can be updated (statuses are
# dragged into order in the dashboard): a number no other status holds is
# kept as written, one another status holds is taken over.
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

resource "oneuptime_monitor_status" "test" {
  name                 = "terraform-e2e-status"
  description          = "Monitor status updated by Terraform E2E tests"
  color                = "#00AA88"
  priority             = 99
  is_operational_state = true
}

output "monitor_status_id" {
  value       = oneuptime_monitor_status.test.id
  description = "ID of the created monitor status"
}

output "monitor_status_name" {
  value       = oneuptime_monitor_status.test.name
  description = "Name of the created monitor status"
}

output "monitor_status_description" {
  value       = oneuptime_monitor_status.test.description
  description = "Description of the created monitor status"
}

output "monitor_status_color" {
  value       = oneuptime_monitor_status.test.color
  description = "Color of the created monitor status"
}

output "monitor_status_priority" {
  value       = oneuptime_monitor_status.test.priority
  description = "Priority of the created monitor status"
}

output "monitor_status_is_operational_state" {
  value       = oneuptime_monitor_status.test.is_operational_state
  description = "Whether this status indicates an operational state"
}
