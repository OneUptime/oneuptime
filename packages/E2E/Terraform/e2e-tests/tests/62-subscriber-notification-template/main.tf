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

# Test: a subscriber notification template, and a status page that sends
# with it.
#
# The template and its link to a status page share the name "Subscriber
# Notification Template" in the product. The provider made ONE resource of
# the two, the link's endpoints winning, so no template could be made with
# Terraform at all. Each model has a resource of its own now:
# oneuptime_subscriber_notification_template is the template, and
# oneuptime_status_page_subscriber_notification_template links it to a
# status page. Choices take one of their values (event_type,
# notification_method), checked at plan time.
#
# The outputs are named after each resource's API path, so the runner
# checks the right endpoint when it verifies the deletion.

resource "oneuptime_status_page" "page" {
  name                     = "terraform-e2e-template-page"
  description              = "Status page for notification template testing"
  is_public_status_page    = false
  enable_email_subscribers = true
}

resource "oneuptime_subscriber_notification_template" "incident_created" {
  template_name        = "TF E2E incident created"
  template_description = "Sent to email subscribers when an incident is created"
  event_type           = "Subscriber Incident Created"
  notification_method  = "Email"
  email_subject        = "New incident: {{incidentTitle}}"
  template_body        = "<p>{{incidentTitle}} is under investigation.</p>"
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
