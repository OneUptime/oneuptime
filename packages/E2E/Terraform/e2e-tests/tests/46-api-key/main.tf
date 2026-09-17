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

# Test: API Key + API Key Permission
#
# Covers oneuptime_api_key and oneuptime_api_key_permission. The permission
# value is a Permission enum string from Common/Types/Permission.ts.

resource "oneuptime_api_key" "key" {
  name        = "terraform-e2e-api-key"
  description = "API key created by Terraform E2E tests"
  # Fixed future timestamp: the provider must round-trip this without drift.
  expires_at = "2031-01-01T00:00:00.000Z"
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
