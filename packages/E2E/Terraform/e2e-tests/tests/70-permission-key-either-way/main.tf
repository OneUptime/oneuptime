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

# Test: a permission written with jsonencode(), then as its key (#10300)
#
# A team's, an API key's and a custom role's permission is a permission's key.
# The API spec documented it as an object, so the provider's reference, and a
# custom role's Developer > Terraform page, said to write it with jsonencode():
# the key as a JSON string, quotes and all. Every apply of that form failed
# with "Provider produced inconsistent result after apply".
#
# Here each permission is written that way. OneUptime must be sent, and keep,
# the key itself (verify.sh), and the next plan must be empty (the runner's
# drift gate). update.tf then writes each as its key, which changes nothing:
# the same rows, the same keys (verify-update.sh), and an empty plan again.

resource "oneuptime_team" "team" {
  name        = "terraform-e2e-permission-key-team"
  description = "Team whose permission is written both ways"
}

resource "oneuptime_team_permission" "permission" {
  team_id             = oneuptime_team.team.id
  permission          = jsonencode("ReadProjectMonitor")
  is_block_permission = false
  scope               = "All"
}

resource "oneuptime_api_key" "key" {
  name        = "terraform-e2e-permission-key-api-key"
  description = "API key whose permission is written both ways"
  expires_at  = "2031-01-01T00:00:00Z"
}

resource "oneuptime_api_key_permission" "permission" {
  api_key_id          = oneuptime_api_key.key.id
  permission          = jsonencode("ReadProjectMonitor")
  is_block_permission = false
}

resource "oneuptime_custom_role" "role" {
  name        = "terraform-e2e-permission-key-role"
  description = "Custom role whose permission is written both ways"
}

resource "oneuptime_custom_role_permission" "permission" {
  custom_role_id = oneuptime_custom_role.role.id
  permission     = jsonencode("IncidentMember")
  scope          = "All"
}

output "team_id" {
  value       = oneuptime_team.team.id
  description = "ID of the team"
}

output "team_permission_id" {
  value       = oneuptime_team_permission.permission.id
  description = "ID of the team's permission"
}

output "api_key_id" {
  value       = oneuptime_api_key.key.id
  description = "ID of the API key"
}

output "api_key_permission_id" {
  value       = oneuptime_api_key_permission.permission.id
  description = "ID of the API key's permission"
}

output "custom_role_id" {
  value       = oneuptime_custom_role.role.id
  description = "ID of the custom role"
}

output "custom_role_permission_id" {
  value       = oneuptime_custom_role_permission.permission.id
  description = "ID of the custom role's permission"
}
