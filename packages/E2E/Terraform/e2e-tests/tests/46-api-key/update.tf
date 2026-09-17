# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: API key name, description and
# expires_at.
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

resource "oneuptime_api_key" "key" {
  name        = "terraform-e2e-api-key-updated"
  description = "API key updated by Terraform E2E tests"
  expires_at  = "2032-01-01T00:00:00.000Z"
}

resource "oneuptime_api_key_permission" "permission" {
  api_key_id          = oneuptime_api_key.key.id
  permission          = "ReadProjectMonitor"
  is_block_permission = false
}

output "api_key_id" {
  value       = oneuptime_api_key.key.id
  description = "ID of the API key"
}

output "api_key_permission_id" {
  value       = oneuptime_api_key_permission.permission.id
  description = "ID of the API key permission"
}

output "api_key_name" {
  value       = oneuptime_api_key.key.name
  description = "Name of the API key"
}
