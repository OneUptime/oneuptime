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

# Test: a monitor secret's type changed in place (#9814)
#
# OneUptime changes a secret's type only together with a new value, which it
# reads for the new type (#9760). The secret starts as Text; update.tf makes
# it a one-time code secret with a setup key, in one change. The update must
# change it in place - the same secret, with its ID - and the plan after it
# must be clean. A plan that changes secret_type and keeps secret_value fails
# at plan time instead (tested through the provider's protocol server in
# changestogether_plan_test.go: the suite has no step for a plan that fails).

resource "oneuptime_monitor_secret" "sign_in" {
  name         = "TERRAFORM_E2E_SIGN_IN"
  description  = "Monitor secret created by Terraform E2E tests"
  secret_type  = "Text"
  secret_value = "terraform-e2e-initial-password"
}

output "monitor_secret_id" {
  value       = oneuptime_monitor_secret.sign_in.id
  description = "ID of the monitor secret"
}

output "monitor_secret_name" {
  value       = oneuptime_monitor_secret.sign_in.name
  description = "Name of the monitor secret"
}
