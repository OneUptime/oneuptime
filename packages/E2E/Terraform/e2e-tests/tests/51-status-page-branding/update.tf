# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: page_title, copyright_text and
# custom_css.
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

resource "oneuptime_status_page" "page" {
  name                                = "terraform-e2e-branding-page"
  description                         = "Status page for branding testing"
  page_title                          = "Terraform E2E Branding Updated"
  page_description                    = "Branding fields set by Terraform E2E tests"
  copyright_text                      = "Copyright Terraform E2E Updated"
  custom_css                          = ".status-page { background: #f5f5f5; }"
  hide_powered_by_one_uptime_branding = true
  is_public_status_page               = false
  enable_email_subscribers            = false
  enable_sms_subscribers              = false
}

output "status_page_id" {
  value       = oneuptime_status_page.page.id
  description = "ID of the status page"
}

output "status_page_page_title" {
  value       = oneuptime_status_page.page.page_title
  description = "SEO page title of the status page"
}
