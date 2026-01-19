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

# Comprehensive CRUD test for incident_severity resource
resource "oneuptime_incident_severity" "test" {
  project_id  = var.project_id
  name        = var.severity_name
  description = var.severity_description
  color       = var.severity_color
  order       = var.severity_order
}

output "incident_severity_id" {
  value = oneuptime_incident_severity.test.id
}

output "incident_severity_name" {
  value = oneuptime_incident_severity.test.name
}

output "incident_severity_description" {
  value = oneuptime_incident_severity.test.description
}

output "incident_severity_color" {
  value = oneuptime_incident_severity.test.color
}

output "incident_severity_order" {
  value = oneuptime_incident_severity.test.order
}
