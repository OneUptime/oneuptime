# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: incident template title and
# template_description, note template note text.
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

resource "oneuptime_incident_severity" "severity" {
  name        = "terraform-e2e-template-severity"
  description = "Severity for incident template testing"
  color       = "#E74C3C"
  order       = 98
}

resource "oneuptime_incident_template" "template" {
  template_name        = "terraform-e2e-incident-template"
  template_description = "Incident template updated by Terraform E2E tests"
  title                = "terraform-e2e-templated-incident-updated"
  description          = "Incident description pre-filled by the template"
  incident_severity_id = oneuptime_incident_severity.severity.id
}

resource "oneuptime_incident_note_template" "note_template" {
  template_name        = "terraform-e2e-note-template"
  template_description = "Note template created by Terraform E2E tests"
  note                 = "This incident has been mitigated."
}

output "incident_severity_id" {
  value       = oneuptime_incident_severity.severity.id
  description = "ID of the incident severity"
}

output "incident_templates_id" {
  value       = oneuptime_incident_template.template.id
  description = "ID of the incident template"
}

output "incident_note_template_id" {
  value       = oneuptime_incident_note_template.note_template.id
  description = "ID of the incident note template"
}

output "incident_template_name" {
  value       = oneuptime_incident_template.template.template_name
  description = "Name of the incident template"
}
