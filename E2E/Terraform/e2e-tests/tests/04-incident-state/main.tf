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

resource "oneuptime_incident_state" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-state-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Incident state created by Terraform E2E tests"
  color       = "#0000FF"
  order       = 99
}

output "incident_state_id" {
  value       = oneuptime_incident_state.test.id
  description = "ID of the created incident state"
}

output "incident_state_name" {
  value       = oneuptime_incident_state.test.name
  description = "Name of the created incident state"
}

output "incident_state_description" {
  value       = oneuptime_incident_state.test.description
  description = "Description of the created incident state"
}

output "incident_state_color" {
  value       = oneuptime_incident_state.test.color
  description = "Color of the created incident state"
}

output "incident_state_order" {
  value       = oneuptime_incident_state.test.order
  description = "Order of the created incident state"
}
