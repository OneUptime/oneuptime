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

resource "oneuptime_status_page" "page" {
  name                     = "terraform-e2e-template-page"
  description              = "Status page for notification template testing"
  is_public_status_page    = false
  enable_email_subscribers = true
}

# The update rewrites the template's subject and body in place: the link
# stays the same row (verify-update.sh).
resource "oneuptime_subscriber_notification_template" "incident_created" {
  template_name        = "TF E2E incident created"
  template_description = "Sent to email subscribers when an incident is created"
  event_type           = "Subscriber Incident Created"
  notification_method  = "Email"
  email_subject        = "Incident: {{incidentTitle}}"
  template_body        = "<p>We are looking into {{incidentTitle}}.</p>"
}

resource "oneuptime_status_page_subscriber_notification_template" "link" {
  status_page_id                                  = oneuptime_status_page.page.id
  status_page_subscriber_notification_template_id = oneuptime_subscriber_notification_template.incident_created.id
}

output "status_page_id" {
  value = oneuptime_status_page.page.id
}

output "status_page_subscriber_notification_template_id" {
  value = oneuptime_subscriber_notification_template.incident_created.id
}

output "status_page_subscriber_notification_template_status_page_id" {
  value = oneuptime_status_page_subscriber_notification_template.link.id
}
