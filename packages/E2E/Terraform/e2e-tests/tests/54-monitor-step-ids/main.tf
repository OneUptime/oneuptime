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

# Test: the server owns the ids inside monitor_steps.
#
# None of them are part of the provider's schema, so it sends steps,
# criteria and incident/alert templates without ids, and the server gives
# each one an id. verify.sh checks they all have one; update.tf resends the
# steps with a criteria added, and verify-update.sh checks every id the server
# gave on create survived that. A step without an id files its probe results
# where the monitor page never looks ("No check has completed yet"), and an
# incident raised from a template without one never auto-resolved.
#
# The project's own statuses and severities are looked up by name: the data
# source lookups are part of what this exercises.

data "oneuptime_monitor_status" "operational" {
  name = "Operational"
}

data "oneuptime_monitor_status" "offline" {
  name = "Offline"
}

data "oneuptime_incident_severity" "critical" {
  name = "Critical Incident"
}

data "oneuptime_alert_severity" "high" {
  name = "High"
}

resource "oneuptime_monitor" "website" {
  name         = "TF E2E Monitor Step Ids"
  description  = "A monitor whose step ids the server owns"
  monitor_type = "Website"
  # Probes must not evaluate this monitor: it is about what is stored.
  disable_active_monitoring = true

  monitor_steps = [{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Offline"
        description           = "The website does not answer"
        filter_condition      = "Any"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.offline.id
        create_incidents      = true
        create_alerts         = true

        filters = [
          { check_on = "Is Online", filter_type = "False" },
        ]

        incidents = [{
          title                 = "TF E2E website is down"
          description           = "The website did not answer the probe."
          incident_severity_id  = data.oneuptime_incident_severity.critical.id
          auto_resolve_incident = true
        }]

        alerts = [{
          title              = "TF E2E website is down"
          description        = "The website did not answer the probe."
          alert_severity_id  = data.oneuptime_alert_severity.high.id
          auto_resolve_alert = true
        }]
      },
      {
        name                  = "Online"
        description           = "The website answers"
        filter_condition      = "All"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.operational.id

        filters = [
          { check_on = "Is Online", filter_type = "True" },
        ]
      },
    ]
  }]
}

output "monitor_id" {
  value = oneuptime_monitor.website.id
}

# Not *_id: the runner checks every *_id output is gone after destroy, and
# these are the project's own statuses, which stay.
output "operational_status" {
  value = data.oneuptime_monitor_status.operational.id
}
