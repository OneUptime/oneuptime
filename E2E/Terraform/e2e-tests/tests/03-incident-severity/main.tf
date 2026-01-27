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

resource "oneuptime_incident_severity" "test" {
  name        = "terraform-e2e-severity-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Incident severity created by Terraform E2E tests"
  color       = "#FFA500"
  order       = 99
}

output "incident_severity_id" {
  value       = oneuptime_incident_severity.test.id
  description = "ID of the created incident severity"
}

output "incident_severity_name" {
  value       = oneuptime_incident_severity.test.name
  description = "Name of the created incident severity"
}

output "incident_severity_description" {
  value       = oneuptime_incident_severity.test.description
  description = "Description of the created incident severity"
}

output "incident_severity_color" {
  value       = oneuptime_incident_severity.test.color
  description = "Color of the created incident severity"
}

output "incident_severity_order" {
  value       = oneuptime_incident_severity.test.order
  description = "Order of the created incident severity"
}
