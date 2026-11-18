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

# The update changes the first rule's channel: the provider sends its
# notification_rule as written, still without updatesToPost. The server
# keeps the key updates the rule started on, so the rule does not turn to
# every update at its first change (verify-update.sh), and the plan after it
# shows no change.

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
    existingChannelNames        = "terraform-e2e-on-call"
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

output "every_update_rule" {
  value = oneuptime_workspace_notification_rule.every_update.id
}
