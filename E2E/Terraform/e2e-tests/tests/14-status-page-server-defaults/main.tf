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

# Test: Status Page with Server-Provided Defaults (Issue #2232)
#
# This test verifies that the fix for GitHub issue #2232 works correctly.
# The issue was: "Provider produced inconsistent result after apply" error
# when creating a status page without specifying downtime_monitor_statuses.
#
# The fix adds UseStateForUnknown() plan modifier to Optional+Computed fields,
# which tells Terraform to accept server-provided default values.
#
# Test cases:
# 1. Create status page WITHOUT specifying downtime_monitor_statuses
# 2. Verify no "inconsistent result" error occurs
# 3. Verify server provides default values for the field

resource "oneuptime_status_page" "test_server_defaults" {
  project_id               = var.project_id
  name                     = "Server Defaults Test Status Page"
  description              = "Tests that server-provided defaults work correctly (Issue #2232)"
  page_title               = "Server Defaults Test"
  page_description         = "This status page tests UseStateForUnknown plan modifier"
  is_public_status_page    = true
  enable_email_subscribers = false
  enable_sms_subscribers   = false

  # IMPORTANT: We intentionally DO NOT specify downtime_monitor_statuses here
  # The server will inject default values (all non-operational monitor statuses)
  # With the fix, Terraform should accept these server-provided defaults
  # without throwing "inconsistent result after apply" error
}

# Output the ID to verify creation succeeded
output "status_page_id" {
  value       = oneuptime_status_page.test_server_defaults.id
  description = "ID of the created status page"
}

# Output the server-provided downtime_monitor_statuses
# This should contain the default non-operational monitor statuses
output "downtime_monitor_statuses" {
  value       = oneuptime_status_page.test_server_defaults.downtime_monitor_statuses
  description = "Server-provided default downtime monitor statuses (should not be empty)"
}

# Output other server-computed fields to verify they work too
output "slug" {
  value       = oneuptime_status_page.test_server_defaults.slug
  description = "Server-generated slug"
}

output "created_at" {
  value       = oneuptime_status_page.test_server_defaults.created_at
  description = "Server-generated creation timestamp"
}
