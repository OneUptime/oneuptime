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

# Test: drag-ordered lists converge (OneUptime/oneuptime#9609)
#
# Incident and alert severities (order) and monitor statuses (priority) are
# lists people drag into order in the dashboard. Each list here is numbered
# the way a configuration numbers it - for_each over a list,
# index(list, key) + 101 - so Terraform writes every row's number on its own,
# the rows of a list all at once. (Past 100, so they keep clear of the
# project's own severities and statuses.)
#
# update.tf renumbers every list in one apply: the severities reversed with
# one added in the middle, the alert severities rotated, the statuses
# rotated the other way. The runner's plan gate after each apply is the
# point of the test: when a write of a number another row held made that
# row step aside, those writes moved each other's rows and the next plan
# never came back empty. verify.sh and verify-update.sh read every row back
# from the API and check it holds exactly the number its configuration
# gives it.

locals {
  severities       = ["Sev1", "Sev2", "Sev3", "Sev4"]
  alert_severities = ["High", "Medium", "Low"]
  statuses         = ["Steady", "Slow", "Gone"]
}

resource "oneuptime_incident_severity" "severity" {
  for_each    = toset(local.severities)
  name        = "terraform-e2e-drag-ordered-${each.key}"
  description = "Incident severity Terraform numbers"
  color       = "#FFA500"
  order       = index(local.severities, each.key) + 101
}

resource "oneuptime_alert_severity" "severity" {
  for_each    = toset(local.alert_severities)
  name        = "terraform-e2e-drag-ordered-${each.key}"
  description = "Alert severity Terraform numbers"
  color       = "#FFA500"
  order       = index(local.alert_severities, each.key) + 101
}

resource "oneuptime_monitor_status" "status" {
  for_each             = toset(local.statuses)
  name                 = "terraform-e2e-drag-ordered-${each.key}"
  description          = "Monitor status Terraform numbers"
  color                = "#2ecc71"
  priority             = index(local.statuses, each.key) + 101
  is_operational_state = false
}

# Every row of the three lists, with the number its configuration gives it
# and the field it is kept in, for verify.sh to read back from the API.
output "expected_orders" {
  description = "Each row of the drag-ordered lists, and the number configured for it"
  value = concat(
    [for name, severity in oneuptime_incident_severity.severity : {
      label    = "incident severity ${name}"
      endpoint = "/api/incident-severity"
      id       = severity.id
      field    = "order"
      order    = index(local.severities, name) + 101
    }],
    [for name, severity in oneuptime_alert_severity.severity : {
      label    = "alert severity ${name}"
      endpoint = "/api/alert-severity"
      id       = severity.id
      field    = "order"
      order    = index(local.alert_severities, name) + 101
    }],
    [for name, status in oneuptime_monitor_status.status : {
      label    = "monitor status ${name}"
      endpoint = "/api/monitor-status"
      id       = status.id
      field    = "priority"
      order    = index(local.statuses, name) + 101
    }],
  )
}
