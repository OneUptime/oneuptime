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
  project_id  = var.project_id
  name        = "terraform-e2e-severity-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Incident severity created by Terraform E2E tests"
  color       = "#FFA500"
  order       = 99
}

output "incident_severity_id" {
  value = oneuptime_incident_severity.test.id
}
