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

# Test: people named by email address - onboarding as code.
#
#   - the test account (test_user_email, in the project already) joins a
#     team at once; an address nobody in the project has is invited by it;
#   - both are named by address on call, as owners and in an owner rule, or
#     by the ID of the membership that invites them;
#   - oneuptime_user finds each of them by address.
#
# The invited address is new on every run (a random suffix), so runs never
# share a person and the invitation limit per address is never reached. It
# is lower case, as OneUptime keeps addresses: the import round-trip reads
# them back so and finds nothing to change.

resource "random_id" "suffix" {
  byte_length = 4
}

locals {
  newcomer = "tf-e2e-newcomer-${random_id.suffix.hex}@example.com"
}

resource "oneuptime_team" "sre" {
  name        = "TF E2E People ${random_id.suffix.hex}"
  description = "Its members are named by email address"
}

# In the project already: joins at once.
resource "oneuptime_team_member" "me" {
  team_id    = oneuptime_team.sre.id
  user_email = var.test_user_email
}

# Nobody in the project has this address: invited by it.
resource "oneuptime_team_member" "newcomer" {
  team_id    = oneuptime_team.sre.id
  user_email = local.newcomer
}

# --- On-call --------------------------------------------------------------

resource "oneuptime_on_call_policy" "primary" {
  name        = "TF E2E People Policy ${random_id.suffix.hex}"
  description = "Pages people named by address"
}

resource "oneuptime_escalation_rule" "first" {
  on_call_duty_policy_id    = oneuptime_on_call_policy.primary.id
  name                      = "Page the on-call engineer"
  escalate_after_in_minutes = 10
}

# The name oneuptime_escalation_rule_user had before: it keeps working, as a
# deprecated alias (60-import-by-parent uses the new name).
resource "oneuptime_users_on_call_duty_escalation_rule" "me" {
  on_call_duty_policy_id                 = oneuptime_on_call_policy.primary.id
  on_call_duty_policy_escalation_rule_id = oneuptime_escalation_rule.first.id
  user_email                             = var.test_user_email
}

resource "oneuptime_on_call_policy_schedule" "weekly" {
  name     = "TF E2E People Rotation ${random_id.suffix.hex}"
  timezone = "UTC"
}

resource "oneuptime_on_call_schedule_layer" "weekly" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.weekly.id
  name                            = "Weekly"
  starts_at                       = "2030-01-07T09:00:00.000Z"
  hand_off_time                   = "2030-01-14T09:00:00.000Z"
}

# The newcomer takes turns from their first day, named through the
# membership that invites them, so Terraform invites them first.
resource "oneuptime_on_call_schedule_layer_user" "newcomer" {
  on_call_duty_policy_schedule_id       = oneuptime_on_call_policy_schedule.weekly.id
  on_call_duty_policy_schedule_layer_id = oneuptime_on_call_schedule_layer.weekly.id
  user_id                               = oneuptime_team_member.newcomer.user_id
}

# --- Ownership ------------------------------------------------------------

resource "oneuptime_monitor" "api" {
  name         = "TF E2E People Monitor ${random_id.suffix.hex}"
  monitor_type = "Manual"
}

resource "oneuptime_monitor_user_owner" "api" {
  monitor_id = oneuptime_monitor.api.id
  user_email = var.test_user_email
}

resource "oneuptime_monitor_owner_rule" "api" {
  name              = "TF E2E People Owners ${random_id.suffix.hex}"
  owner_user_emails = [var.test_user_email]
}

# --- Lookups --------------------------------------------------------------

data "oneuptime_user" "me" {
  email = oneuptime_team_member.me.user_email
}

data "oneuptime_user" "newcomer" {
  email = oneuptime_team_member.newcomer.user_email
}

# --- Outputs --------------------------------------------------------------
# Outputs named <api path>_id are checked deleted after destroy.

output "team_member_id" {
  value = oneuptime_team_member.newcomer.id
}

output "on_call_duty_policy_escalation_rule_user_id" {
  value = oneuptime_users_on_call_duty_escalation_rule.me.id
}

output "on_call_duty_schedule_layer_user_id" {
  value = oneuptime_on_call_schedule_layer_user.newcomer.id
}

output "monitor_owner_user_id" {
  value = oneuptime_monitor_user_owner.api.id
}

output "monitor_owner_rule_id" {
  value = oneuptime_monitor_owner_rule.api.id
}

output "newcomer_email" {
  value = local.newcomer
}

output "newcomer_user" {
  value = oneuptime_team_member.newcomer.user_id
}

output "newcomer_joined" {
  value = oneuptime_team_member.newcomer.has_accepted_invitation
}

output "me_user" {
  value = oneuptime_team_member.me.user_id
}

output "me_joined" {
  value = oneuptime_team_member.me.has_accepted_invitation
}

output "me_found" {
  value = data.oneuptime_user.me.id
}

output "newcomer_found" {
  value = data.oneuptime_user.newcomer.id
}

output "newcomer_found_joined" {
  value = data.oneuptime_user.newcomer.has_accepted_invitation
}

output "escalation_rule_user" {
  value = oneuptime_users_on_call_duty_escalation_rule.me.user_id
}

output "layer_user" {
  value = oneuptime_on_call_schedule_layer_user.newcomer.user_id
}

output "layer_user_email" {
  value = oneuptime_on_call_schedule_layer_user.newcomer.user_email
}

output "owner_user" {
  value = oneuptime_monitor_user_owner.api.user_id
}

output "owner_rule_users" {
  value = join(",", sort(oneuptime_monitor_owner_rule.api.owner_users))
}
