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

# Test: Status Page Group + Status Page Resource
#
# Covers oneuptime_status_page_group and oneuptime_status_page_resource,
# wiring a monitor onto a status page inside a group.

resource "oneuptime_status_page" "page" {
  name                     = "terraform-e2e-resource-page"
  description              = "Status page for resource testing"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

resource "oneuptime_monitor" "monitor" {
  name         = "terraform-e2e-sp-monitor"
  description  = "Monitor shown on the status page"
  monitor_type = "Manual"
}

resource "oneuptime_status_page_group" "group" {
  status_page_id = oneuptime_status_page.page.id
  name           = "terraform-e2e-sp-group"
  description    = "Group created by Terraform E2E tests"
}

resource "oneuptime_status_page_resource" "resource" {
  status_page_id       = oneuptime_status_page.page.id
  monitor_id           = oneuptime_monitor.monitor.id
  status_page_group_id = oneuptime_status_page_group.group.id
  display_name         = "terraform-e2e-sp-resource"
  display_description  = "Resource created by Terraform E2E tests"
}

output "status_page_id" {
  value       = oneuptime_status_page.page.id
  description = "ID of the status page"
}

output "monitor_id" {
  value       = oneuptime_monitor.monitor.id
  description = "ID of the monitor"
}

output "status_page_group_id" {
  value       = oneuptime_status_page_group.group.id
  description = "ID of the status page group"
}

output "status_page_resource_id" {
  value       = oneuptime_status_page_resource.resource.id
  description = "ID of the status page resource"
}

output "group_name" {
  value       = oneuptime_status_page_group.group.name
  description = "Name of the status page group"
}

output "resource_display_name" {
  value       = oneuptime_status_page_resource.resource.display_name
  description = "Display name of the status page resource"
}
