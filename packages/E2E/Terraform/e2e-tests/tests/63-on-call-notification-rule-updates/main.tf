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

# Test: an on-call policy's notification rule starts on Key updates only
# (#7971).
#
# The Dashboard's form starts a new on-call rule on who is on call now and
# when nobody is ("updatesToPost": ["OnCallNow", "NobodyOnCall"]). A rule
# made with Terraform whose notification_rule leaves updatesToPost out gets
# the same list from the server; one that says null keeps every update.
#
# The server's list is a key the configuration never wrote, so the
# provider's JSON-subset equality has to read the rule as unchanged: the
# runner's drift gate (terraform plan -detailed-exitcode) after the apply,
# and again after update.tf, is the "plan after create" check. verify.sh
# reads what the server stored.

resource "oneuptime_workspace_notification_rule" "key_updates" {
  name           = "terraform-e2e-on-call-key-updates"
  description    = "On-call rule that leaves updatesToPost out"
  event_type     = "On-Call Duty Policy"
  workspace_type = "Slack"

  notification_rule = jsonencode({
    _type                       = "OnCallDutyPolicyNotificationRule"
    filterCondition             = "All"
    filters                     = []
    shouldPostToExistingChannel = true
    existingChannelNames        = "terraform-e2e-oncall"
    shouldCreateNewChannel      = false
  })
}

resource "oneuptime_workspace_notification_rule" "every_update" {
  name           = "terraform-e2e-on-call-every-update"
  description    = "On-call rule that asks for every update with null"
  event_type     = "On-Call Duty Policy"
  workspace_type = "Slack"

  notification_rule = jsonencode({
    _type                       = "OnCallDutyPolicyNotificationRule"
    filterCondition             = "All"
    filters                     = []
    shouldPostToExistingChannel = true
    existingChannelNames        = "terraform-e2e-oncall-everything"
    shouldCreateNewChannel      = false
    updatesToPost               = null
  })
}

output "workspace_notification_rule_id" {
  value = oneuptime_workspace_notification_rule.key_updates.id
}

# Named without "_id": the runner maps every *_id output to an API path.
output "every_update_rule" {
  value = oneuptime_workspace_notification_rule.every_update.id
}
