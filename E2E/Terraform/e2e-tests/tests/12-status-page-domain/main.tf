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

# First, create a domain (required for status_page_domain)
# The domain must be verified before it can be used with status_page_domain
# For test domains (.example.com), DNS verification is bypassed
resource "oneuptime_domain" "test" {
  project_id  = var.project_id
  domain      = "status-page-domain-e2e-test.example.com"
  is_verified = true
}

# Then, create a status page (required for status_page_domain)
resource "oneuptime_status_page" "test" {
  project_id               = var.project_id
  name                     = "Status Page Domain E2E Test"
  description              = "Status page created by Terraform E2E tests"
  page_title               = "Terraform Test Status"
  page_description         = "This is a test status page"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

# Test status_page_domain resource
# After fix for issue #2236:
# - full_domain is computed (server generates from subdomain + domain)
# - cname_verification_token is computed (server generates a UUID)
resource "oneuptime_status_page_domain" "test" {
  project_id     = var.project_id
  domain_id      = oneuptime_domain.test.id
  status_page_id = oneuptime_status_page.test.id
  subdomain      = "status"

  # full_domain and cname_verification_token are NOT specified here
  # because they are server-generated computed fields
}

output "status_page_domain_id" {
  value = oneuptime_status_page_domain.test.id
}

output "domain_id" {
  value = oneuptime_domain.test.id
}

output "status_page_id" {
  value = oneuptime_status_page.test.id
}

# Output the computed full_domain to verify it's returned by the API
output "full_domain" {
  value       = oneuptime_status_page_domain.test.full_domain
  description = "Full domain computed by the server (should be subdomain.domain)"
}

output "subdomain" {
  value = oneuptime_status_page_domain.test.subdomain
}
