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

# Test: StatusPageDomain Idempotency (Issue #2236 Fix Validation)
#
# This test validates that the fix for GitHub issue #2236 works correctly.
# The issue was:
# 1. full_domain and cname_verification_token were marked as Required
# 2. But these fields are server-generated (computed)
# 3. This caused "inconsistent result after apply" errors
#
# After the fix:
# - full_domain should be Computed (server-generated from subdomain + domain)
# - cname_verification_token should be Computed (server-generated UUID)
# - Running terraform apply multiple times should NOT detect drift
#
# Test Flow:
# 1. Create domain, status page, and status_page_domain
# 2. Verify the computed fields are populated
# 3. Run terraform apply again (idempotency check)
# 4. Verify no changes are detected

# First, create a domain
resource "oneuptime_domain" "test" {
  project_id  = var.project_id
  domain      = "idempotency-test-${random_id.suffix.hex}.example.com"
  is_verified = true
}

# Then, create a status page
resource "oneuptime_status_page" "test" {
  project_id               = var.project_id
  name                     = "Idempotency Test Status Page ${random_id.suffix.hex}"
  description              = "Status page for idempotency testing"
  page_title               = "Idempotency Test"
  page_description         = "Testing computed field idempotency"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

# Create status_page_domain WITHOUT specifying computed fields
# After the fix:
# - full_domain is NOT specified (it's computed)
# - cname_verification_token is NOT specified (it's computed)
resource "oneuptime_status_page_domain" "test" {
  project_id     = var.project_id
  domain_id      = oneuptime_domain.test.id
  status_page_id = oneuptime_status_page.test.id
  subdomain      = "status"

  # IMPORTANT: We do NOT specify full_domain or cname_verification_token
  # These should be computed by the server
}

# Outputs to verify the computed fields are populated
output "status_page_domain_id" {
  value       = oneuptime_status_page_domain.test.id
  description = "ID of the created status page domain"
}

output "full_domain" {
  value       = oneuptime_status_page_domain.test.full_domain
  description = "Full domain computed by the server"
}

output "subdomain" {
  value       = oneuptime_status_page_domain.test.subdomain
  description = "Subdomain of the status page domain"
}

output "domain_id" {
  value       = oneuptime_domain.test.id
  description = "ID of the created domain"
}

output "status_page_id" {
  value       = oneuptime_status_page.test.id
  description = "ID of the created status page"
}
