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

# The steps of main.tf resent with a change to every level: the step's
# destination, the Offline criteria's description and its templates' titles,
# and a Degraded criteria added in between. Nothing in the configuration
# names an id, so only the server can keep them - verify-update.sh checks it
# did.

data "oneuptime_monitor_status" "operational" {
  name = "Operational"
}

data "oneuptime_monitor_status" "offline" {
  name = "Offline"
}

data "oneuptime_monitor_status" "degraded" {
  name = "Degraded"
}

data "oneuptime_incident_severity" "critical" {
  name = "Critical Incident"
}

data "oneuptime_alert_severity" "high" {
  name = "High"
}

resource "oneuptime_monitor" "website" {
  name                      = "TF E2E Monitor Step Ids"
  description               = "A monitor whose step ids the server owns"
  monitor_type              = "Website"
  disable_active_monitoring = true

  monitor_steps = [{
    monitor_destination      = "https://example.org"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Offline"
        description           = "The website still does not answer"
        filter_condition      = "Any"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.offline.id
        create_incidents      = true
        create_alerts         = true

        filters = [
          { check_on = "Is Online", filter_type = "False" },
        ]

        incidents = [{
          title                 = "TF E2E website is down (updated)"
          description           = "The website did not answer the probe."
          incident_severity_id  = data.oneuptime_incident_severity.critical.id
          auto_resolve_incident = true
        }]

        alerts = [{
          title              = "TF E2E website is down (updated)"
          description        = "The website did not answer the probe."
          alert_severity_id  = data.oneuptime_alert_severity.high.id
          auto_resolve_alert = true
        }]
      },
      {
        name                  = "Degraded"
        description           = "The website answers slowly"
        filter_condition      = "All"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.degraded.id

        filters = [
          { check_on = "Response Time (in ms)", filter_type = "Greater Than", value = "5000" },
        ]
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

output "operational_status" {
  value = data.oneuptime_monitor_status.operational.id
}
