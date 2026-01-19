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

resource "oneuptime_alert_state" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-alert-state-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Alert state created by Terraform E2E tests"
  color       = "#800080"
  order       = 99
}

output "alert_state_id" {
  value = oneuptime_alert_state.test.id
}
