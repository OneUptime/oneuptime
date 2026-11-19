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

# Update: the Text secret becomes a one-time code (TOTP) secret, its type and
# its value changed together, as OneUptime changes them. The secret keeps its
# ID: verify-update.sh checks it against the one verify.sh recorded.

resource "oneuptime_monitor_secret" "sign_in" {
  name         = "TERRAFORM_E2E_SIGN_IN"
  description  = "Monitor secret created by Terraform E2E tests"
  secret_type  = "TOTP"
  secret_value = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
}

output "monitor_secret_id" {
  value       = oneuptime_monitor_secret.sign_in.id
  description = "ID of the monitor secret"
}

output "monitor_secret_name" {
  value       = oneuptime_monitor_secret.sign_in.name
  description = "Name of the monitor secret"
}
