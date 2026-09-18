# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: internal_note and
# is_subscribed_to_all_resources.
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
  name                     = "terraform-e2e-subscriber-page"
  description              = "Status page for subscriber testing"
  is_public_status_page    = false
  enable_email_subscribers = true
  enable_sms_subscribers   = false
}

resource "oneuptime_status_page_subscriber" "subscriber" {
  status_page_id                   = oneuptime_status_page.page.id
  subscriber_email                 = "terraform-e2e-subscriber@test.oneuptime.com"
  send_you_have_subscribed_message = false
  is_subscribed_to_all_resources   = true
  internal_note                    = "Subscriber updated by Terraform E2E tests"
}

output "status_page_id" {
  value       = oneuptime_status_page.page.id
  description = "ID of the status page"
}

output "status_page_subscriber_id" {
  value       = oneuptime_status_page_subscriber.subscriber.id
  description = "ID of the subscriber"
}
