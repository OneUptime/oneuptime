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

# Test: Status Page Announcement
#
# Covers oneuptime_status_page_announcement attached to a status page.
# Subscriber notification is explicitly disabled so the fixture has no
# external side effects (no emails queued).

resource "oneuptime_status_page" "page" {
  name                     = "terraform-e2e-announcement-page"
  description              = "Status page for announcement testing"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

resource "oneuptime_status_page_announcement" "announcement" {
  title       = "terraform-e2e-announcement"
  description = "Announcement created by Terraform E2E tests"
  # Fixed future timestamp: the provider must round-trip this without drift.
  show_announcement_at                       = "2030-03-01T00:00:00.000Z"
  status_pages                               = [oneuptime_status_page.page.id]
  should_status_page_subscribers_be_notified = false
}

output "status_page_id" {
  value       = oneuptime_status_page.page.id
  description = "ID of the status page"
}

output "status_page_announcement_id" {
  value       = oneuptime_status_page_announcement.announcement.id
  description = "ID of the announcement"
}

output "announcement_title" {
  value       = oneuptime_status_page_announcement.announcement.title
  description = "Title of the announcement"
}
