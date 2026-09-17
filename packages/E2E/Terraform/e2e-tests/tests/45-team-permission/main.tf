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

# Test: Team Permission
#
# Covers oneuptime_team_permission attached to a team. Permission values are
# the Permission enum strings from Common/Types/Permission.ts (e.g.
# ReadProjectMonitor); scope is one of All, Owned, Labels.

resource "oneuptime_team" "team" {
  name        = "terraform-e2e-permission-team"
  description = "Team for permission testing"
}

resource "oneuptime_team_permission" "permission" {
  team_id             = oneuptime_team.team.id
  permission          = "ReadProjectMonitor"
  is_block_permission = false
  scope               = "All"
}

output "team_id" {
  value       = oneuptime_team.team.id
  description = "ID of the team"
}

output "team_permission_id" {
  value       = oneuptime_team_permission.permission.id
  description = "ID of the team permission"
}
