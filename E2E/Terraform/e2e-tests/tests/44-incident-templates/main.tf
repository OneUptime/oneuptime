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

# Test: Incident Template + Incident Note Template
#
# Covers oneuptime_incident_template (pre-filled incident, wired to an
# incident severity) and oneuptime_incident_note_template (markdown note
# template).

resource "oneuptime_incident_severity" "severity" {
  name        = "terraform-e2e-template-severity"
  description = "Severity for incident template testing"
  color       = "#E74C3C"
  order       = 98
}

resource "oneuptime_incident_template" "template" {
  template_name        = "terraform-e2e-incident-template"
  template_description = "Incident template created by Terraform E2E tests"
  title                = "terraform-e2e-templated-incident"
  description          = "Incident description pre-filled by the template"
  incident_severity_id = oneuptime_incident_severity.severity.id
}

resource "oneuptime_incident_note_template" "note_template" {
  template_name        = "terraform-e2e-note-template"
  template_description = "Note template created by Terraform E2E tests"
  note                 = "This incident is being investigated."
}

output "incident_severity_id" {
  value       = oneuptime_incident_severity.severity.id
  description = "ID of the incident severity"
}

# Output name maps to the API route /api/incident-templates (plural) so the
# runner's deletion verification hits the real endpoint.
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
