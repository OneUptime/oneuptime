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

# Test: Complete StatusPage with Domain Integration
#
# This test validates the complete flow of creating a status page with a custom domain:
# 1. Create a Domain resource
# 2. Create a StatusPage resource
# 3. Create a StatusPageDomain resource linking them
# 4. Verify all computed fields are populated correctly
# 5. Test idempotency
#
# This test validates fixes for:
# - Issue #2236: StatusPageDomain computed fields (fullDomain, cnameVerificationToken)
# - Issue #2232: StatusPage server defaults (downtimeMonitorStatuses)

# Step 1: Create the base domain
resource "oneuptime_domain" "primary" {
  project_id  = var.project_id
  domain      = "primary-${random_id.suffix.hex}.example.com"
  is_verified = true
}

# Step 2: Create a secondary domain for multiple domain testing
resource "oneuptime_domain" "secondary" {
  project_id  = var.project_id
  domain      = "secondary-${random_id.suffix.hex}.example.com"
  is_verified = true
}

# Step 3: Create the main status page
resource "oneuptime_status_page" "main" {
  project_id               = var.project_id
  name                     = "TF E2E Main Status Page ${random_id.suffix.hex}"
  description              = "Main status page with custom domains"
  page_title               = "System Status"
  page_description         = "Check our system status and incident history"
  is_public_status_page    = true
  enable_email_subscribers = true
  enable_sms_subscribers   = false

  # Note: downtimeMonitorStatuses will be server-injected
  # The fix for Issue #2232 ensures this doesn't cause drift
}

# Step 4: Create a secondary status page
resource "oneuptime_status_page" "secondary" {
  project_id               = var.project_id
  name                     = "TF E2E Secondary Status Page ${random_id.suffix.hex}"
  description              = "Secondary status page for testing"
  page_title               = "Secondary Status"
  page_description         = "Secondary status page"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

# Step 5: Link primary domain to main status page
resource "oneuptime_status_page_domain" "primary_main" {
  project_id     = var.project_id
  domain_id      = oneuptime_domain.primary.id
  status_page_id = oneuptime_status_page.main.id
  subdomain      = "status"

  # Note: fullDomain and cnameVerificationToken are NOT specified
  # They are computed by the server (Issue #2236 fix)
}

# Step 6: Link secondary domain to main status page (multiple domains on one page)
resource "oneuptime_status_page_domain" "secondary_main" {
  project_id     = var.project_id
  domain_id      = oneuptime_domain.secondary.id
  status_page_id = oneuptime_status_page.main.id
  subdomain      = "api-status"

  # Note: fullDomain and cnameVerificationToken are NOT specified
}

# Step 7: Link primary domain to secondary status page (one domain, multiple pages)
resource "oneuptime_status_page_domain" "primary_secondary" {
  project_id     = var.project_id
  domain_id      = oneuptime_domain.primary.id
  status_page_id = oneuptime_status_page.secondary.id
  subdomain      = "internal"

  # Note: fullDomain and cnameVerificationToken are NOT specified
}

# Outputs for verification
output "primary_domain_id" {
  value       = oneuptime_domain.primary.id
  description = "ID of the primary domain"
}

output "secondary_domain_id" {
  value       = oneuptime_domain.secondary.id
  description = "ID of the secondary domain"
}

output "main_status_page_id" {
  value       = oneuptime_status_page.main.id
  description = "ID of the main status page"
}

output "secondary_status_page_id" {
  value       = oneuptime_status_page.secondary.id
  description = "ID of the secondary status page"
}

output "primary_main_domain_id" {
  value       = oneuptime_status_page_domain.primary_main.id
  description = "ID of the primary-main status page domain"
}

output "secondary_main_domain_id" {
  value       = oneuptime_status_page_domain.secondary_main.id
  description = "ID of the secondary-main status page domain"
}

output "primary_secondary_domain_id" {
  value       = oneuptime_status_page_domain.primary_secondary.id
  description = "ID of the primary-secondary status page domain"
}

# Computed fields from StatusPageDomain (Issue #2236 fix validation)
output "primary_main_full_domain" {
  value       = oneuptime_status_page_domain.primary_main.full_domain
  description = "Computed full domain for primary-main"
}

output "secondary_main_full_domain" {
  value       = oneuptime_status_page_domain.secondary_main.full_domain
  description = "Computed full domain for secondary-main"
}

output "primary_secondary_full_domain" {
  value       = oneuptime_status_page_domain.primary_secondary.full_domain
  description = "Computed full domain for primary-secondary"
}

# Server-injected defaults from StatusPage (Issue #2232 fix validation)
output "main_downtime_monitor_statuses" {
  value       = oneuptime_status_page.main.downtime_monitor_statuses
  description = "Server-injected downtime monitor statuses for main status page"
}

output "main_slug" {
  value       = oneuptime_status_page.main.slug
  description = "Server-generated slug for main status page"
}
