# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: permission value and scope.
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

resource "oneuptime_team" "team" {
  name        = "terraform-e2e-permission-team"
  description = "Team for permission testing"
}

resource "oneuptime_team_permission" "permission" {
  team_id             = oneuptime_team.team.id
  permission          = "EditProjectMonitor"
  is_block_permission = false
  scope               = "Owned"
}

output "team_id" {
  value       = oneuptime_team.team.id
  description = "ID of the team"
}

output "team_permission_id" {
  value       = oneuptime_team_permission.permission.id
  description = "ID of the team permission"
}
