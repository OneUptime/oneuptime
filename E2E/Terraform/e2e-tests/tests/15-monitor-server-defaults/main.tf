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

# Test: Monitor with Server-Provided Defaults (Issue #2226)
#
# This test verifies that the fix for GitHub issue #2226 works correctly.
# The issue was: "Provider produced inconsistent result after apply" error
# when creating a monitor - the server injects exceptionMonitor defaults
# into monitor_steps that weren't in the original request.
#
# The fix adds UseStateForUnknown() plan modifier to Optional+Computed fields,
# which tells Terraform to accept server-provided default values.
#
# Test cases:
# 1. Create monitor with minimal monitor_steps (no exceptionMonitor)
# 2. Verify no "inconsistent result" error occurs
# 3. Verify server can inject defaults into monitor_steps

resource "oneuptime_monitor" "test_server_defaults" {
  project_id   = var.project_id
  name         = "Monitor Server Defaults Test"
  description  = "Tests that server-provided defaults work correctly (Issue #2226)"
  monitor_type = "Manual"

  # IMPORTANT: We provide minimal monitor_steps without exceptionMonitor
  # The server will inject default exceptionMonitor values
  # With the fix, Terraform should accept these server-provided defaults
  # without throwing "inconsistent result after apply" error
}

# Output the ID to verify creation succeeded
output "monitor_id" {
  value       = oneuptime_monitor.test_server_defaults.id
  description = "ID of the created monitor"
}

# Monitor fields for API validation
output "monitor_name" {
  value       = oneuptime_monitor.test_server_defaults.name
  description = "Name of the created monitor"
}

output "monitor_description" {
  value       = oneuptime_monitor.test_server_defaults.description
  description = "Description of the created monitor"
}

output "monitor_monitor_type" {
  value       = oneuptime_monitor.test_server_defaults.monitor_type
  description = "Type of the created monitor"
}

# Output the server-modified monitor_steps
# This should contain the server-injected exceptionMonitor defaults
output "monitor_steps" {
  value       = oneuptime_monitor.test_server_defaults.monitor_steps
  description = "Server-modified monitor_steps (may contain injected exceptionMonitor)"
}

# Output other server-computed fields
output "slug" {
  value       = oneuptime_monitor.test_server_defaults.slug
  description = "Server-generated slug"
}

output "created_at" {
  value       = oneuptime_monitor.test_server_defaults.created_at
  description = "Server-generated creation timestamp"
}

output "current_monitor_status_id" {
  value       = oneuptime_monitor.test_server_defaults.current_monitor_status_id
  description = "Server-assigned default monitor status"
}
