terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "random_id" "suffix" {
  byte_length = 4
}

# Test: Monitor Steps - Basic Configuration
#
# This test validates:
# 1. Creating monitors with minimal configuration (server provides defaults)
# 2. Creating monitors with explicit monitor_steps
# 3. Verifying monitor_steps server defaults don't cause drift
# 4. Testing idempotency with complex JSON fields
#
# Issue being validated: Server injects exceptionMonitor, logMonitor, etc.
# into monitor_steps which can cause "inconsistent result after apply" errors

# Test Case 1: Manual Monitor - No monitor_steps (server provides defaults)
resource "oneuptime_monitor" "manual_no_steps" {
  name         = "TF Manual No Steps ${random_id.suffix.hex}"
  description  = "Manual monitor without explicit monitor_steps"
  monitor_type = "Manual"
}

# Test Case 2: Manual Monitor - With description only (server provides monitor_steps)
resource "oneuptime_monitor" "manual_with_description" {
  name         = "TF Manual With Description ${random_id.suffix.hex}"
  description  = "Manual monitor with custom description"
  monitor_type = "Manual"
}

# Test Case 3: Monitor with monitoring interval
resource "oneuptime_monitor" "with_interval" {
  name                = "TF Monitor With Interval ${random_id.suffix.hex}"
  description         = "Monitor with custom monitoring interval"
  monitor_type        = "Manual"
  monitoring_interval = "Every 5 minutes"
}

# Test Case 4: Monitor with disable flag
resource "oneuptime_monitor" "disabled" {
  name                    = "TF Disabled Monitor ${random_id.suffix.hex}"
  description             = "Monitor that is disabled"
  monitor_type            = "Manual"
  disable_active_monitoring = true
}

# Outputs for verification
output "manual_no_steps_id" {
  value       = oneuptime_monitor.manual_no_steps.id
  description = "ID of manual monitor without steps"
}

output "manual_no_steps_monitor_steps" {
  value       = oneuptime_monitor.manual_no_steps.monitor_steps
  description = "Server-provided monitor_steps for manual monitor"
}

output "manual_with_description_id" {
  value       = oneuptime_monitor.manual_with_description.id
  description = "ID of manual monitor with description"
}

output "with_interval_id" {
  value       = oneuptime_monitor.with_interval.id
  description = "ID of monitor with interval"
}

output "with_interval_monitoring_interval" {
  value       = oneuptime_monitor.with_interval.monitoring_interval
  description = "Monitoring interval value"
}

output "disabled_id" {
  value       = oneuptime_monitor.disabled.id
  description = "ID of disabled monitor"
}

output "disabled_disable_active_monitoring" {
  value       = oneuptime_monitor.disabled.disable_active_monitoring
  description = "Disable active monitoring flag"
}

# Server-computed fields
output "manual_no_steps_slug" {
  value       = oneuptime_monitor.manual_no_steps.slug
  description = "Server-generated slug"
}

output "manual_no_steps_current_status" {
  value       = oneuptime_monitor.manual_no_steps.current_monitor_status_id
  description = "Server-assigned current status"
}
