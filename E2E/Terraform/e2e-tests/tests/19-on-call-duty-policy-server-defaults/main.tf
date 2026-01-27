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

# Test: On-Call Policy with Server-Provided Defaults
#
# This test verifies UseStateForUnknown() works for on-call policy:
# - String fields: description
# - Bool fields: send_incidnet_created_notification_to_all_on_call_layers
# - List fields: labels
# - Number fields: repeat_policy_if_no_one_acknowledges_no_of_times
#
# Tests various Optional+Computed field types.

# Create on-call policy with minimal fields
resource "oneuptime_on_call_policy" "test_server_defaults" {
  name       = "On-Call Policy Server Defaults Test"

  # IMPORTANT: We intentionally DO NOT specify these Optional+Computed fields:
  # - description (string)
  # - labels (list)
  # - send_incidnet_created_notification_to_all_on_call_layers (bool) [note: typo in API]
  # - repeat_policy_if_no_one_acknowledges_no_of_times (number)
  #
  # The server will provide default values for these fields.
}

# Output to verify creation succeeded
output "on_call_duty_policy_id" {
  value       = oneuptime_on_call_policy.test_server_defaults.id
  description = "ID of the created on-call policy"
}

# On-call policy name for API validation
output "on_call_duty_policy_name" {
  value       = oneuptime_on_call_policy.test_server_defaults.name
  description = "Name of the on-call policy"
}

# List field - server may provide empty list or defaults
output "labels" {
  value       = oneuptime_on_call_policy.test_server_defaults.labels
  description = "Server-provided labels list"
}

# Other server-computed fields
output "slug" {
  value       = oneuptime_on_call_policy.test_server_defaults.slug
  description = "Server-generated slug"
}

output "created_at" {
  value       = oneuptime_on_call_policy.test_server_defaults.created_at
  description = "Server-generated creation timestamp"
}
