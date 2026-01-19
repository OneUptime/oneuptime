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
  value       = oneuptime_status_page.test.id
  description = "ID of the created status page"
}

output "status_page_name" {
  value       = oneuptime_status_page.test.name
  description = "Name of the created status page"
}

output "status_page_description" {
  value       = oneuptime_status_page.test.description
  description = "Description of the created status page"
}

output "status_page_page_title" {
  value       = oneuptime_status_page.test.page_title
  description = "Page title of the created status page"
}

output "status_page_page_description" {
  value       = oneuptime_status_page.test.page_description
  description = "Page description of the created status page"
}

output "status_page_is_public_status_page" {
  value       = oneuptime_status_page.test.is_public_status_page
  description = "Whether the status page is public"
}

output "status_page_enable_email_subscribers" {
  value       = oneuptime_status_page.test.enable_email_subscribers
  description = "Whether email subscribers are enabled"
}

output "status_page_enable_sms_subscribers" {
  value       = oneuptime_status_page.test.enable_sms_subscribers
  description = "Whether SMS subscribers are enabled"
}
