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
  name               = "terraform-e2e-status-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description        = "Monitor status created by Terraform E2E tests"
  color              = "#00FF00"
  priority           = 99
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
