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

resource "oneuptime_monitor_status" "test" {
  project_id         = var.project_id
  name               = "terraform-e2e-status-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description        = "Monitor status created by Terraform E2E tests"
  color              = "#00FF00"
  priority           = 99
  is_operational_state = true
}

output "monitor_status_id" {
  value = oneuptime_monitor_status.test.id
}
