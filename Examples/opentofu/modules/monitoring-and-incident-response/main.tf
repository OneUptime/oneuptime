# Basic monitoring and incident response for one service.
#
# What it creates: a label, one HTTP monitor per entry in var.monitors, an
# optional on-call policy with a single escalation rule, and an optional status
# page listing those monitors. A monitor that goes down flips its status, opens
# an incident at the configured severity, and pages the on-call policy.
#
# What it does NOT create: monitor statuses and incident severities. OneUptime
# seeds those per project, and a module called once per service would otherwise
# add a duplicate set on every instantiation. They are looked up by name below.

locals {
  # Only monitors that asked to appear on the status page, and only when a
  # status page is being created at all.
  status_page_monitors = var.create_status_page ? {
    for key, monitor in var.monitors : key => monitor if monitor.show_on_status_page
  } : {}

  on_call_policy_ids = var.create_on_call_policy ? [oneuptime_on_call_policy.service[0].id] : null
}

data "oneuptime_monitor_status" "operational" {
  name = var.operational_monitor_status_name
}

data "oneuptime_monitor_status" "offline" {
  name = var.offline_monitor_status_name
}

data "oneuptime_incident_severity" "incident" {
  name = var.incident_severity_name
}

resource "oneuptime_label" "service" {
  name        = var.service_name
  description = "Resources belonging to ${var.service_name}, managed by Terraform/OpenTofu."
  color       = var.label_color
}

#######################################
# Incident response
#######################################

resource "oneuptime_on_call_policy" "service" {
  count = var.create_on_call_policy ? 1 : 0

  name        = "${var.service_name} on-call"
  description = "Paged when a ${var.service_name} monitor opens an incident."
  labels      = [oneuptime_label.service.id]
}

resource "oneuptime_escalation_rule" "primary" {
  count = var.create_on_call_policy ? 1 : 0

  on_call_duty_policy_id    = oneuptime_on_call_policy.service[0].id
  name                      = "${var.service_name} primary"
  description               = "First responders for ${var.service_name}."
  escalate_after_in_minutes = var.escalate_after_in_minutes
}

#######################################
# Monitoring
#######################################

resource "oneuptime_monitor" "service" {
  for_each = var.monitors

  name                = coalesce(each.value.display_name, "${var.service_name} ${each.key}")
  description         = coalesce(each.value.description, "HTTP check for ${each.value.url}.")
  monitor_type        = "Website"
  monitoring_interval = coalesce(each.value.monitoring_interval, var.monitoring_interval)
  labels              = [oneuptime_label.service.id]

  monitor_steps = [{
    monitor_destination      = each.value.url
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Online"
        description           = "Responds with ${each.value.expected_status_code}."
        filter_condition      = "All"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.operational.id
        create_incidents      = false

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          },
          {
            check_on    = "Response Status Code"
            filter_type = "Equal To"
            value       = each.value.expected_status_code
          }
        ]
      },
      {
        name                  = "Offline"
        description           = "Unreachable, or answering with an unexpected status code."
        filter_condition      = "Any"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.offline.id
        create_incidents      = each.value.open_incident_on_down

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "False"
          },
          {
            check_on    = "Response Status Code"
            filter_type = "Not Equal To"
            value       = each.value.expected_status_code
          }
        ]

        # Omitted entirely rather than set to [] when this monitor should not
        # open incidents — the API rejects empty placeholder lists, and absent
        # is the only way to say "unset".
        incidents = each.value.open_incident_on_down ? [
          {
            title                        = "${coalesce(each.value.display_name, "${var.service_name} ${each.key}")} is down"
            description                  = "The probe could not get ${each.value.expected_status_code} from ${each.value.url}."
            incident_severity_id         = data.oneuptime_incident_severity.incident.id
            auto_resolve_incident        = var.auto_resolve_incidents
            on_call_policy_ids           = local.on_call_policy_ids
            label_ids                    = [oneuptime_label.service.id]
            show_incident_on_status_page = var.create_status_page
          }
        ] : null
      }
    ]
  }]
}

#######################################
# Status page
#######################################

resource "oneuptime_status_page" "service" {
  count = var.create_status_page ? 1 : 0

  name                     = "${var.service_name} status"
  description              = "Public health of ${var.service_name}."
  page_title               = "${var.service_name} status"
  page_description         = "Live status of ${var.service_name}."
  is_public_status_page    = var.status_page_is_public
  enable_email_subscribers = false
  enable_sms_subscribers   = false
  labels                   = [oneuptime_label.service.id]
}

resource "oneuptime_status_page_group" "service" {
  count = var.create_status_page ? 1 : 0

  status_page_id = oneuptime_status_page.service[0].id
  name           = var.service_name
  description    = "Endpoints that make up ${var.service_name}."
}

resource "oneuptime_status_page_resource" "service" {
  for_each = local.status_page_monitors

  status_page_id       = oneuptime_status_page.service[0].id
  status_page_group_id = oneuptime_status_page_group.service[0].id
  monitor_id           = oneuptime_monitor.service[each.key].id
  display_name         = coalesce(each.value.display_name, "${var.service_name} ${each.key}")
  display_description  = coalesce(each.value.description, "HTTP check for ${each.value.url}.")
}
