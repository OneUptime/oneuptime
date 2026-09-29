# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: descriptions of all three custom
# fields, the monitor and incident field names, and the incident field's
# settings. The incident field's variable_key must survive the rename.
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

resource "oneuptime_monitor_custom_field" "monitor_field" {
  name              = "terraform-e2e-monitor-field-updated"
  description       = "Monitor custom field updated by Terraform E2E tests"
  custom_field_type = "Text"
}

resource "oneuptime_incident_custom_field" "incident_field" {
  name              = "terraform-e2e-incident-field-renamed"
  description       = "Incident custom field updated by Terraform E2E tests"
  custom_field_type = "Number"

  sort_order                          = 2
  show_on_create                      = true
  is_required_on_create               = false
  include_in_subscriber_notifications = false
}

resource "oneuptime_alert_custom_field" "alert_field" {
  name              = "terraform-e2e-alert-field"
  description       = "Alert custom field updated by Terraform E2E tests"
  custom_field_type = "Boolean"
}

output "monitor_custom_field_id" {
  value       = oneuptime_monitor_custom_field.monitor_field.id
  description = "ID of the monitor custom field"
}

output "incident_custom_field_id" {
  value       = oneuptime_incident_custom_field.incident_field.id
  description = "ID of the incident custom field"
}

output "incident_custom_field_variable_key" {
  value       = oneuptime_incident_custom_field.incident_field.variable_key
  description = "Template variable key of the incident custom field"
}

output "alert_custom_field_id" {
  value       = oneuptime_alert_custom_field.alert_field.id
  description = "ID of the alert custom field"
}
