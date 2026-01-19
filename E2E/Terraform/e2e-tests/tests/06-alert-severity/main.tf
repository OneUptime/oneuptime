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

resource "oneuptime_alert_severity" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-alert-sev-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Alert severity created by Terraform E2E tests"
  color       = "#FF0000"
  order       = 99
}

output "alert_severity_id" {
  value       = oneuptime_alert_severity.test.id
  description = "ID of the created alert severity"
}

output "alert_severity_name" {
  value       = oneuptime_alert_severity.test.name
  description = "Name of the created alert severity"
}

output "alert_severity_description" {
  value       = oneuptime_alert_severity.test.description
  description = "Description of the created alert severity"
}

output "alert_severity_color" {
  value       = oneuptime_alert_severity.test.color
  description = "Color of the created alert severity"
}

output "alert_severity_order" {
  value       = oneuptime_alert_severity.test.order
  description = "Order of the created alert severity"
}
