terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

# Test: rows that join two records, imported by what they join.
#
# No screen shows the ID of a team's member, a monitor's owner, or of the
# person, team or schedule an escalation rule pages. So each imports by the
# record it joins and who or what joins it - import-ids.txt has the runner
# import them so: a person by their email address, a team or a schedule by
# its ID. The runner's import round trip then requires a clean plan, as for
# every import.
#
# The escalation rule's people, teams and schedules use the names clients
# give them (oneuptime_escalation_rule_user, _team and _schedule); the old
# names, such as oneuptime_users_on_call_duty_escalation_rule, still work
# as deprecated aliases.

resource "random_id" "suffix" {
  byte_length = 4
}

resource "oneuptime_team" "sre" {
  name        = "TF E2E Import By Parent ${random_id.suffix.hex}"
  description = "Owns a monitor and is paged by an escalation rule"
}

resource "oneuptime_team_member" "me" {
  team_id    = oneuptime_team.sre.id
  user_email = var.test_user_email
}

resource "oneuptime_monitor" "api" {
  name         = "TF E2E Import By Parent Monitor ${random_id.suffix.hex}"
  monitor_type = "Manual"
}

# A monitor's owners: a person and a team.
resource "oneuptime_monitor_user_owner" "me" {
  monitor_id = oneuptime_monitor.api.id
  user_email = var.test_user_email
}

resource "oneuptime_monitor_team_owner" "sre" {
  monitor_id = oneuptime_monitor.api.id
  team_id    = oneuptime_team.sre.id
}

# --- On-call --------------------------------------------------------------

resource "oneuptime_on_call_policy" "primary" {
  name        = "TF E2E Import By Parent Policy ${random_id.suffix.hex}"
  description = "Pages a person, a team and a schedule"
}

resource "oneuptime_escalation_rule" "first" {
  on_call_duty_policy_id    = oneuptime_on_call_policy.primary.id
  name                      = "Page everyone"
  escalate_after_in_minutes = 10
}

resource "oneuptime_on_call_policy_schedule" "weekly" {
  name     = "TF E2E Import By Parent Rotation ${random_id.suffix.hex}"
  timezone = "UTC"
}

resource "oneuptime_on_call_schedule_layer" "weekly" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.weekly.id
  name                            = "Weekly"
  starts_at                       = "2030-01-07T09:00:00Z"
  hand_off_time                   = "2030-01-14T09:00:00Z"
}

resource "oneuptime_on_call_schedule_layer_user" "me" {
  on_call_duty_policy_schedule_id       = oneuptime_on_call_policy_schedule.weekly.id
  on_call_duty_policy_schedule_layer_id = oneuptime_on_call_schedule_layer.weekly.id
  user_email                            = var.test_user_email
}

resource "oneuptime_escalation_rule_user" "me" {
  on_call_duty_policy_id                 = oneuptime_on_call_policy.primary.id
  on_call_duty_policy_escalation_rule_id = oneuptime_escalation_rule.first.id
  user_email                             = var.test_user_email
}

resource "oneuptime_escalation_rule_team" "sre" {
  on_call_duty_policy_id                 = oneuptime_on_call_policy.primary.id
  on_call_duty_policy_escalation_rule_id = oneuptime_escalation_rule.first.id
  team_id                                = oneuptime_team.sre.id
}

resource "oneuptime_escalation_rule_schedule" "weekly" {
  on_call_duty_policy_id                 = oneuptime_on_call_policy.primary.id
  on_call_duty_policy_escalation_rule_id = oneuptime_escalation_rule.first.id
  on_call_duty_policy_schedule_id        = oneuptime_on_call_policy_schedule.weekly.id
}

# --- Outputs --------------------------------------------------------------
# Outputs named <api path>_id are checked deleted after destroy.

output "team_member_id" {
  value = oneuptime_team_member.me.id
}

output "monitor_owner_user_id" {
  value = oneuptime_monitor_user_owner.me.id
}

output "monitor_owner_team_id" {
  value = oneuptime_monitor_team_owner.sre.id
}

output "on_call_duty_schedule_layer_user_id" {
  value = oneuptime_on_call_schedule_layer_user.me.id
}

output "on_call_duty_policy_escalation_rule_user_id" {
  value = oneuptime_escalation_rule_user.me.id
}

output "on_call_duty_policy_escalation_rule_team_id" {
  value = oneuptime_escalation_rule_team.sre.id
}

output "on_call_duty_policy_escalation_rule_schedule_id" {
  value = oneuptime_escalation_rule_schedule.weekly.id
}

output "me_user" {
  value = oneuptime_team_member.me.user_id
}

output "sre_team" {
  value = oneuptime_team.sre.id
}

output "weekly_schedule" {
  value = oneuptime_on_call_policy_schedule.weekly.id
}

output "monitor" {
  value = oneuptime_monitor.api.id
}

output "rule" {
  value = oneuptime_escalation_rule.first.id
}
