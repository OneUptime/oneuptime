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

# Comprehensive CRUD test for monitor_status resource
resource "oneuptime_monitor_status" "test" {
  name        = var.status_name
  description = var.status_description
  color       = var.status_color
  priority    = var.status_priority
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
