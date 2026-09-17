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

# Test: Project-scoped custom field definitions
#
# Covers oneuptime_monitor_custom_field, oneuptime_incident_custom_field and
# oneuptime_alert_custom_field. custom_field_type values come from the
# CustomFieldType enum: Text, Number, Boolean, Dropdown, MultiSelectDropdown.

resource "oneuptime_monitor_custom_field" "monitor_field" {
  name              = "terraform-e2e-monitor-field"
  description       = "Monitor custom field created by Terraform E2E tests"
  custom_field_type = "Text"
}

resource "oneuptime_incident_custom_field" "incident_field" {
  name              = "terraform-e2e-incident-field"
  description       = "Incident custom field created by Terraform E2E tests"
  custom_field_type = "Number"
}

resource "oneuptime_alert_custom_field" "alert_field" {
  name              = "terraform-e2e-alert-field"
  description       = "Alert custom field created by Terraform E2E tests"
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

output "alert_custom_field_id" {
  value       = oneuptime_alert_custom_field.alert_field.id
  description = "ID of the alert custom field"
}
