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
  value = oneuptime_alert_severity.test.id
}
