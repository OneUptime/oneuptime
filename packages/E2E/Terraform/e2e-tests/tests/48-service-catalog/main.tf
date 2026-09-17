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

# Test: Service Catalog
#
# Covers oneuptime_service (the service catalog / telemetry service entity).

resource "oneuptime_service" "service" {
  name          = "terraform-e2e-service"
  description   = "Service created by Terraform E2E tests"
  service_color = "#2ECC71"
}

output "service_id" {
  value       = oneuptime_service.service.id
  description = "ID of the service"
}

output "service_name" {
  value       = oneuptime_service.service.name
  description = "Name of the service"
}

output "service_color" {
  value       = oneuptime_service.service.service_color
  description = "Color of the service"
}
