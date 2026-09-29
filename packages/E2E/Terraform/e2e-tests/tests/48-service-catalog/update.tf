# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: description and service_color.
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

resource "oneuptime_service" "service" {
  name          = "terraform-e2e-service"
  description   = "Service updated by Terraform E2E tests"
  service_color = "#3498DB"
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
