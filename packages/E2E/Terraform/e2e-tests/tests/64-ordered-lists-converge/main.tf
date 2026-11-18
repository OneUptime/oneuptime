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

# Test: numbered lists converge (OneUptime/oneuptime#9573)
#
# A status page's groups and resources, an on-call policy's escalation rules
# and a schedule's layers are numbered by `order`. Each list here is
# numbered the way the issue's configuration numbers it - for_each over a
# list, order = index(list, key) + 1 - so Terraform writes every row's
# order on its own, the rows of a list all at once.
#
# update.tf renumbers every list in one apply: a group added in the middle
# and one taken out while the rest are renumbered, the resources rotated, an
# escalation rule added in the middle while the rest move round, the layers
# reversed. The runner's plan gate after each apply is the point of the
# test: when a write of `order` moved the rows it passed, those writes
# renumbered each other and the next plan never came back empty. verify.sh
# and verify-update.sh read every row back from the API and check it holds
# exactly the number its configuration gives it.

locals {
  groups         = ["Alpha", "Bravo", "Charlie", "Echo"]
  monitors       = ["one", "two", "three"]
  resource_order = ["one", "two", "three"]
  levels         = ["Primary", "Secondary", "Tertiary"]
  layers         = ["Day", "Night", "Weekend"]
}

resource "oneuptime_status_page" "page" {
  name                     = "terraform-e2e-ordered-page"
  description              = "Status page whose groups and resources Terraform numbers"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

resource "oneuptime_status_page_group" "group" {
  for_each       = toset(local.groups)
  status_page_id = oneuptime_status_page.page.id
  name           = "terraform-e2e-ordered-${each.key}"
  order          = index(local.groups, each.key) + 1
}

resource "oneuptime_monitor" "monitor" {
  for_each     = toset(local.monitors)
  name         = "terraform-e2e-ordered-monitor-${each.key}"
  description  = "Monitor shown on the ordered status page"
  monitor_type = "Manual"
}

resource "oneuptime_status_page_resource" "resource" {
  for_each             = toset(local.monitors)
  status_page_id       = oneuptime_status_page.page.id
  status_page_group_id = oneuptime_status_page_group.group["Alpha"].id
  monitor_id           = oneuptime_monitor.monitor[each.key].id
  display_name         = "terraform-e2e-ordered-resource-${each.key}"
  order                = index(local.resource_order, each.key) + 1
}

resource "oneuptime_on_call_policy" "policy" {
  name        = "terraform-e2e-ordered-policy"
  description = "On-call policy whose escalation rules Terraform numbers"
}

resource "oneuptime_escalation_rule" "level" {
  for_each                  = toset(local.levels)
  on_call_duty_policy_id    = oneuptime_on_call_policy.policy.id
  name                      = "terraform-e2e-ordered-${each.key}"
  escalate_after_in_minutes = 5
  order                     = index(local.levels, each.key) + 1
}

resource "oneuptime_on_call_policy_schedule" "schedule" {
  name        = "terraform-e2e-ordered-schedule"
  description = "On-call schedule whose layers Terraform numbers"
}

resource "oneuptime_on_call_schedule_layer" "layer" {
  for_each                        = toset(local.layers)
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.schedule.id
  name                            = "terraform-e2e-ordered-${each.key}"
  order                           = index(local.layers, each.key) + 1

  # Fixed future timestamps: never timestamp() in a fixture.
  starts_at     = "2030-01-01T00:00:00Z"
  hand_off_time = "2030-01-01T09:00:00Z"

  rotation = jsonencode({
    _type = "Recurring"
    value = {
      intervalType = "Day"
      intervalCount = {
        _type = "PositiveNumber"
        value = 1
      }
    }
  })

  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = {
      restictionType = "None"
    }
  })
}

# Output names map to the API routes /api/status-page,
# /api/on-call-duty-policy and /api/on-call-duty-policy-schedule so the
# runner's deletion verification hits the real endpoints. The rows of the
# lists go with them.
output "status_page_id" {
  value       = oneuptime_status_page.page.id
  description = "ID of the status page"
}

output "on_call_duty_policy_id" {
  value       = oneuptime_on_call_policy.policy.id
  description = "ID of the on-call policy"
}

output "on_call_duty_policy_schedule_id" {
  value       = oneuptime_on_call_policy_schedule.schedule.id
  description = "ID of the on-call schedule"
}

# Every row of the four lists, with the number its configuration gives it,
# for verify.sh to read back from the API.
output "expected_orders" {
  description = "Each row of the numbered lists, and the order configured for it"
  value = concat(
    [for name, group in oneuptime_status_page_group.group : {
      label    = "status page group ${name}"
      endpoint = "/api/status-page-group"
      id       = group.id
      order    = index(local.groups, name) + 1
    }],
    [for key, resource in oneuptime_status_page_resource.resource : {
      label    = "status page resource ${key}"
      endpoint = "/api/status-page-resource"
      id       = resource.id
      order    = index(local.resource_order, key) + 1
    }],
    [for name, rule in oneuptime_escalation_rule.level : {
      label    = "escalation rule ${name}"
      endpoint = "/api/on-call-duty-policy-escalation-rule"
      id       = rule.id
      order    = index(local.levels, name) + 1
    }],
    [for name, layer in oneuptime_on_call_schedule_layer.layer : {
      label    = "schedule layer ${name}"
      endpoint = "/api/on-call-duty-schedule-layer"
      id       = layer.id
      order    = index(local.layers, name) + 1
    }],
  )
}
