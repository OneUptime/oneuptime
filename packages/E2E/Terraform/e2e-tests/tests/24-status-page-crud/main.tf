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

# Test: StatusPage CRUD Operations
#
# This test validates complete CRUD operations for the oneuptime_status_page resource:
# 1. Create multiple status pages with different configurations
# 2. Verify server defaults are handled correctly (Issue #2232 fix)
# 3. Test idempotency (re-apply should show no changes)

# Test Case 1: Public Status Page
resource "oneuptime_status_page" "public" {
  name                     = "TF E2E Public Status Page ${random_id.suffix.hex}"
  description              = "Public status page created by Terraform E2E tests"
  page_title               = "Public Status"
  page_description         = "This is a public status page for testing"
  is_public_status_page    = true
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

# Test Case 2: Private Status Page
resource "oneuptime_status_page" "private" {
  name                     = "TF E2E Private Status Page ${random_id.suffix.hex}"
  description              = "Private status page for internal use"
  page_title               = "Private Status"
  page_description         = "Internal status monitoring"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

# Test Case 3: Status Page with Email Subscribers
resource "oneuptime_status_page" "with_email" {
  name                     = "TF E2E Email Subscribers Page ${random_id.suffix.hex}"
  description              = "Status page with email subscriber notifications"
  page_title               = "Email Status"
  page_description         = "Subscribe to receive email updates"
  is_public_status_page    = true
  enable_email_subscribers = true
  enable_sms_subscribers   = false
}

# Test Case 4: Status Page with Custom Branding Settings
resource "oneuptime_status_page" "branded" {
  name                                = "TF E2E Branded Status Page ${random_id.suffix.hex}"
  description                         = "Status page with custom branding"
  page_title                          = "Branded Status"
  page_description                    = "Custom branded status page"
  is_public_status_page               = true
  enable_email_subscribers            = false
  enable_sms_subscribers              = false
  hide_powered_by_one_uptime_branding = true
}

# Test Case 5: Status Page with Labels
resource "oneuptime_label" "status_page_label" {
  name        = "TF E2E Status Page Label ${random_id.suffix.hex}"
  description = "Label for status page testing"
  color       = "#e74c3c"
}

resource "oneuptime_status_page" "with_labels" {
  name                     = "TF E2E Labeled Status Page ${random_id.suffix.hex}"
  description              = "Status page with attached labels"
  page_title               = "Labeled Status"
  page_description         = "Status page with labels attached"
  is_public_status_page    = true
  enable_email_subscribers = false
  enable_sms_subscribers   = false
  labels                   = [oneuptime_label.status_page_label.id]
}

# Outputs for verification
output "public_status_page_id" {
  value       = oneuptime_status_page.public.id
  description = "ID of the public status page"
}

output "private_status_page_id" {
  value       = oneuptime_status_page.private.id
  description = "ID of the private status page"
}

output "email_status_page_id" {
  value       = oneuptime_status_page.with_email.id
  description = "ID of the email subscribers status page"
}

output "branded_status_page_id" {
  value       = oneuptime_status_page.branded.id
  description = "ID of the branded status page"
}

output "labeled_status_page_id" {
  value       = oneuptime_status_page.with_labels.id
  description = "ID of the labeled status page"
}

output "label_id" {
  value       = oneuptime_label.status_page_label.id
  description = "ID of the test label"
}

# Server-computed fields
output "public_slug" {
  value       = oneuptime_status_page.public.slug
  description = "Server-generated slug for public status page"
}

output "public_created_at" {
  value       = oneuptime_status_page.public.created_at
  description = "Creation timestamp for public status page"
}

# Server-injected defaults (Issue #2232)
output "public_downtime_monitor_statuses" {
  value       = oneuptime_status_page.public.downtime_monitor_statuses
  description = "Server-provided downtime monitor statuses"
}
