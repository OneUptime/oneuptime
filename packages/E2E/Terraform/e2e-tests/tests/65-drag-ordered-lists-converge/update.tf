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

# Update for 65-drag-ordered-lists-converge (OneUptime/oneuptime#9609):
# every list renumbered in one apply. The severities are reversed, with
# "Sev2b" added between Sev3 and Sev2; the alert severities rotate up; the
# statuses rotate down. Every existing row's number changes, so Terraform
# writes them all at once, in no set order, beside a create.

locals {
  severities       = ["Sev4", "Sev3", "Sev2b", "Sev2", "Sev1"]
  alert_severities = ["Medium", "Low", "High"]
  statuses         = ["Gone", "Steady", "Slow"]
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
