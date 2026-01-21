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

# Test: StatusPage CRUD Operations
#
# This test validates complete CRUD operations for the oneuptime_status_page resource:
# 1. Create multiple status pages with different configurations
# 2. Verify server defaults are handled correctly (Issue #2232 fix)
# 3. Test idempotency (re-apply should show no changes)

locals {
  timestamp = formatdate("YYYYMMDDhhmmss", timestamp())
}

# Test Case 1: Public Status Page
resource "oneuptime_status_page" "public" {
  project_id               = var.project_id
  name                     = "TF E2E Public Status Page ${local.timestamp}"
  description              = "Public status page created by Terraform E2E tests"
  page_title               = "Public Status"
  page_description         = "This is a public status page for testing"
  is_public_status_page    = true
  enable_email_subscribers = false
  enable_sms_subscribers   = false

  lifecycle {
    ignore_changes = [name]
  }
}

# Test Case 2: Private Status Page
resource "oneuptime_status_page" "private" {
  project_id               = var.project_id
  name                     = "TF E2E Private Status Page ${local.timestamp}"
  description              = "Private status page for internal use"
  page_title               = "Private Status"
  page_description         = "Internal status monitoring"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false

  lifecycle {
    ignore_changes = [name]
  }
}

# Test Case 3: Status Page with Email Subscribers
resource "oneuptime_status_page" "with_email" {
  project_id               = var.project_id
  name                     = "TF E2E Email Subscribers Page ${local.timestamp}"
  description              = "Status page with email subscriber notifications"
  page_title               = "Email Status"
  page_description         = "Subscribe to receive email updates"
  is_public_status_page    = true
  enable_email_subscribers = true
  enable_sms_subscribers   = false

  lifecycle {
    ignore_changes = [name]
  }
}

# Test Case 4: Status Page with Custom Branding Settings
resource "oneuptime_status_page" "branded" {
  project_id                          = var.project_id
  name                                = "TF E2E Branded Status Page ${local.timestamp}"
  description                         = "Status page with custom branding"
  page_title                          = "Branded Status"
  page_description                    = "Custom branded status page"
  is_public_status_page               = true
  enable_email_subscribers            = false
  enable_sms_subscribers              = false
  hide_powered_by_one_uptime_branding = true

  lifecycle {
    ignore_changes = [name]
  }
}

# Test Case 5: Status Page with Labels
resource "oneuptime_label" "status_page_label" {
  project_id  = var.project_id
  name        = "TF E2E Status Page Label ${local.timestamp}"
  description = "Label for status page testing"
  color       = "#e74c3c"

  lifecycle {
    ignore_changes = [name]
  }
}

resource "oneuptime_status_page" "with_labels" {
  project_id               = var.project_id
  name                     = "TF E2E Labeled Status Page ${local.timestamp}"
  description              = "Status page with attached labels"
  page_title               = "Labeled Status"
  page_description         = "Status page with labels attached"
  is_public_status_page    = true
  enable_email_subscribers = false
  enable_sms_subscribers   = false
  labels                   = [oneuptime_label.status_page_label.id]

  lifecycle {
    ignore_changes = [name]
  }
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
