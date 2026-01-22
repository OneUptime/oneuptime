terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "random_id" "suffix" {
  byte_length = 4
}

# First, create a domain (required for status_page_domain)
# The domain must be verified before it can be used with status_page_domain
# For test domains (.example.com), DNS verification is bypassed
resource "oneuptime_domain" "test" {
  project_id  = var.project_id
  domain      = "computed-test-${random_id.suffix.hex}.example.com"
  is_verified = true
}

# Then, create a status page (required for status_page_domain)
resource "oneuptime_status_page" "test" {
  project_id               = var.project_id
  name                     = "TF Computed Fields SP ${random_id.suffix.hex}"
  description              = "Status page created by Terraform E2E tests for computed fields test"
  page_title               = "Computed Fields Test Status"
  page_description         = "This tests computed field handling"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

# Test: status_page_domain - Validates Issue #2236 fix
#
# This test verifies that computed fields work correctly:
#
# 1. full_domain:
#    - Should be computed by server from subdomain + domain
#    - User should NOT need to provide this value
#
# 2. cname_verification_token:
#    - Should be computed by server (generates UUID)
#    - Has no read permission (security - not readable via API)
#    - User should NOT need to provide this value
#
resource "oneuptime_status_page_domain" "test" {
  project_id     = var.project_id
  domain_id      = oneuptime_domain.test.id
  status_page_id = oneuptime_status_page.test.id
  subdomain      = var.subdomain

  # full_domain and cname_verification_token are NOT specified
  # They are server-generated computed fields
}

output "status_page_domain_id" {
  value       = oneuptime_status_page_domain.test.id
  description = "ID of the created status page domain"
}

output "domain_id" {
  value       = oneuptime_domain.test.id
  description = "ID of the created domain"
}

output "status_page_id" {
  value       = oneuptime_status_page.test.id
  description = "ID of the created status page"
}

# Output the computed full_domain - this should be server-generated
output "computed_full_domain" {
  value       = oneuptime_status_page_domain.test.full_domain
  description = "Full domain computed by the server (should match subdomain.domain)"
}

# Output subdomain for verification
output "subdomain" {
  value       = oneuptime_status_page_domain.test.subdomain
  description = "Subdomain used"
}

# Domain resource outputs for API validation
output "domain_name" {
  value       = oneuptime_domain.test.domain
  description = "Domain name"
}

output "domain_is_verified" {
  value       = oneuptime_domain.test.is_verified
  description = "Whether the domain is verified"
}

# Status page outputs for API validation
output "status_page_name" {
  value       = oneuptime_status_page.test.name
  description = "Name of the status page"
}

output "status_page_description" {
  value       = oneuptime_status_page.test.description
  description = "Description of the status page"
}
