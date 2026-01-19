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

resource "oneuptime_status_page" "test" {
  project_id              = var.project_id
  name                    = "terraform-e2e-statuspage-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description             = "Status page created by Terraform E2E tests"
  page_title              = "Terraform Test Status"
  page_description        = "This is a test status page"
  is_public_status_page   = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

output "status_page_id" {
  value = oneuptime_status_page.test.id
}
