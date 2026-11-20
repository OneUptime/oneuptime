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
# The update: each permission written as its key, the way the reference and
# the Developer pages write it now. It is the same permission as the
# jsonencode() form main.tf wrote, so the update changes nothing.

resource "oneuptime_team" "team" {
  name        = "terraform-e2e-permission-key-team"
  description = "Team whose permission is written both ways"
}

resource "oneuptime_team_permission" "permission" {
  team_id             = oneuptime_team.team.id
  permission          = "ReadProjectMonitor"
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
  permission          = "ReadProjectMonitor"
  is_block_permission = false
}

resource "oneuptime_custom_role" "role" {
  name        = "terraform-e2e-permission-key-role"
  description = "Custom role whose permission is written both ways"
}

resource "oneuptime_custom_role_permission" "permission" {
  custom_role_id = oneuptime_custom_role.role.id
  permission     = "IncidentMember"
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
