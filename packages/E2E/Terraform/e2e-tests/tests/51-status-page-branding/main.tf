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

# Test: Status Page branding fields (custom CSS, SEO fields, copyright)
#
# Deepens oneuptime_status_page coverage: exercises the branding attributes
# that no other fixture touches, and updates them in the update phase.

resource "oneuptime_status_page" "page" {
  name                                = "terraform-e2e-branding-page"
  description                         = "Status page for branding testing"
  page_title                          = "Terraform E2E Branding"
  page_description                    = "Branding fields set by Terraform E2E tests"
  copyright_text                      = "Copyright Terraform E2E"
  custom_css                          = ".status-page { background: #ffffff; }"
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
