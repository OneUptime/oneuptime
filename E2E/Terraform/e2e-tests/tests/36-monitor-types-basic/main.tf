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

# Test: Basic Monitor Types (without explicit monitor_steps)
#
# This test validates creating different monitor types relying on server defaults:
# - Website Monitor
# - API Monitor
# - Ping Monitor
# - Port Monitor
# - SSL Certificate Monitor
# - IP Monitor

locals {
  timestamp = formatdate("YYYYMMDDhhmmss", timestamp())
}

# =============================================================================
# Test Case 1: Website Monitor
# =============================================================================
resource "oneuptime_monitor" "website" {
  project_id   = var.project_id
  name         = "TF Website Basic ${local.timestamp}"
  description  = "Basic website monitor"
  monitor_type = "Website"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Test Case 2: API Monitor
# =============================================================================
resource "oneuptime_monitor" "api" {
  project_id   = var.project_id
  name         = "TF API Basic ${local.timestamp}"
  description  = "Basic API monitor"
  monitor_type = "API"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Test Case 3: Ping Monitor
# =============================================================================
resource "oneuptime_monitor" "ping" {
  project_id   = var.project_id
  name         = "TF Ping Basic ${local.timestamp}"
  description  = "Basic ping monitor"
  monitor_type = "Ping"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Test Case 4: Port Monitor
# =============================================================================
resource "oneuptime_monitor" "port" {
  project_id   = var.project_id
  name         = "TF Port Basic ${local.timestamp}"
  description  = "Basic port monitor"
  monitor_type = "Port"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Test Case 5: SSL Certificate Monitor
# =============================================================================
resource "oneuptime_monitor" "ssl" {
  project_id   = var.project_id
  name         = "TF SSL Basic ${local.timestamp}"
  description  = "Basic SSL certificate monitor"
  monitor_type = "SSL Certificate"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Test Case 6: IP Monitor
# =============================================================================
resource "oneuptime_monitor" "ip" {
  project_id   = var.project_id
  name         = "TF IP Basic ${local.timestamp}"
  description  = "Basic IP monitor"
  monitor_type = "IP"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Test Case 7: Incoming Request Monitor (Heartbeat)
# =============================================================================
resource "oneuptime_monitor" "incoming_request" {
  project_id   = var.project_id
  name         = "TF Incoming Request Basic ${local.timestamp}"
  description  = "Basic incoming request (heartbeat) monitor"
  monitor_type = "Incoming Request"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Test Case 8: Server Monitor
# =============================================================================
resource "oneuptime_monitor" "server" {
  project_id   = var.project_id
  name         = "TF Server Basic ${local.timestamp}"
  description  = "Basic server monitor"
  monitor_type = "Server"

  lifecycle {
    ignore_changes = [name, monitor_steps]
  }
}

# =============================================================================
# Outputs
# =============================================================================
output "website_monitor_id" {
  value       = oneuptime_monitor.website.id
  description = "Website monitor ID"
}

output "website_monitor_type" {
  value       = oneuptime_monitor.website.monitor_type
  description = "Website monitor type"
}

output "api_monitor_id" {
  value       = oneuptime_monitor.api.id
  description = "API monitor ID"
}

output "api_monitor_type" {
  value       = oneuptime_monitor.api.monitor_type
  description = "API monitor type"
}

output "ping_monitor_id" {
  value       = oneuptime_monitor.ping.id
  description = "Ping monitor ID"
}

output "ping_monitor_type" {
  value       = oneuptime_monitor.ping.monitor_type
  description = "Ping monitor type"
}

output "port_monitor_id" {
  value       = oneuptime_monitor.port.id
  description = "Port monitor ID"
}

output "port_monitor_type" {
  value       = oneuptime_monitor.port.monitor_type
  description = "Port monitor type"
}

output "ssl_monitor_id" {
  value       = oneuptime_monitor.ssl.id
  description = "SSL certificate monitor ID"
}

output "ssl_monitor_type" {
  value       = oneuptime_monitor.ssl.monitor_type
  description = "SSL certificate monitor type"
}

output "ip_monitor_id" {
  value       = oneuptime_monitor.ip.id
  description = "IP monitor ID"
}

output "ip_monitor_type" {
  value       = oneuptime_monitor.ip.monitor_type
  description = "IP monitor type"
}

output "incoming_request_monitor_id" {
  value       = oneuptime_monitor.incoming_request.id
  description = "Incoming request monitor ID"
}

output "incoming_request_monitor_type" {
  value       = oneuptime_monitor.incoming_request.monitor_type
  description = "Incoming request monitor type"
}

output "server_monitor_id" {
  value       = oneuptime_monitor.server.id
  description = "Server monitor ID"
}

output "server_monitor_type" {
  value       = oneuptime_monitor.server.monitor_type
  description = "Server monitor type"
}
