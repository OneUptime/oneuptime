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

# Comprehensive CRUD test for incident_severity resource
resource "oneuptime_incident_severity" "test" {
  name        = "TF CRUD Severity ${random_id.suffix.hex}"
  description = var.severity_description
  color       = var.severity_color
  order       = var.severity_order
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
