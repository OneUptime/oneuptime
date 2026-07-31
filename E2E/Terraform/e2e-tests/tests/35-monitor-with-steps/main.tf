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

# Test: Monitor Types with Monitor Steps (typed nested syntax)
#
# This test validates creating different monitor types with proper monitor_steps:
# - Website Monitor with HTTP checks
# - API Monitor with request headers and body
# - Ping Monitor with hostname destination
# - Port Monitor with specific port
# - SSL Certificate Monitor
# - IP Monitor
#
# monitor_steps is a typed nested attribute: no jsonencode(), no
# {_type, value} envelopes and no hand-written step/criteria ids —
# the server generates ids.

# Create monitor statuses for criteria
resource "oneuptime_monitor_status" "operational" {
  name                 = "TF Operational ${random_id.suffix.hex}"
  description          = "Monitor is operational"
  color                = "#2ecc71"
  priority             = 1
  is_operational_state = true
}

resource "oneuptime_monitor_status" "degraded" {
  name                 = "TF Degraded ${random_id.suffix.hex}"
  description          = "Monitor is degraded"
  color                = "#f39c12"
  priority             = 2
  is_operational_state = false
}

resource "oneuptime_monitor_status" "offline" {
  name                 = "TF Offline ${random_id.suffix.hex}"
  description          = "Monitor is offline"
  color                = "#e74c3c"
  priority             = 3
  is_operational_state = false
}

# =============================================================================
# Test Case 1: Website Monitor with Monitor Steps
# =============================================================================
resource "oneuptime_monitor" "website" {
  name         = "TF Website Monitor ${random_id.suffix.hex}"
  description  = "Website monitor with URL destination and response criteria"
  monitor_type = "Website"

  monitor_steps = [{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Online"
        description           = "Check if website is online"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          },
          {
            check_on    = "Response Status Code"
            filter_type = "Equal To"
            value       = "200"
          }
        ]
      },
      {
        name                  = "Offline"
        description           = "Check if website is offline"
        filter_condition      = "Any"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.offline.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "False"
          }
        ]
      }
    ]
  }]

  depends_on = [oneuptime_monitor_status.operational, oneuptime_monitor_status.offline]
}

# =============================================================================
# Test Case 2: API Monitor with Headers and Body
# =============================================================================
resource "oneuptime_monitor" "api" {
  name         = "TF API Monitor ${random_id.suffix.hex}"
  description  = "API monitor with POST request, headers, and body"
  monitor_type = "API"

  monitor_steps = [{
    monitor_destination      = "https://httpbin.org/post"
    monitor_destination_type = "URL"
    request_type             = "POST"

    request_headers = {
      "Content-Type"    = "application/json"
      "Accept"          = "application/json"
      "X-Custom-Header" = "test-value"
    }

    request_body = "{\"test\": \"data\"}"

    criteria = [
      {
        name                  = "API Success"
        description           = "API returns success response"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          },
          {
            check_on    = "Response Status Code"
            filter_type = "Equal To"
            value       = "200"
          }
        ]
      }
    ]
  }]

  depends_on = [oneuptime_monitor_status.operational]
}

# =============================================================================
# Test Case 3: Ping Monitor
# =============================================================================
resource "oneuptime_monitor" "ping" {
  name         = "TF Ping Monitor ${random_id.suffix.hex}"
  description  = "Ping monitor with hostname destination"
  monitor_type = "Ping"

  monitor_steps = [{
    monitor_destination      = "google.com"
    monitor_destination_type = "Hostname"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Ping Success"
        description           = "Host responds to ping"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          }
        ]
      },
      {
        name                  = "Ping Failure"
        description           = "Host does not respond"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.offline.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "False"
          }
        ]
      }
    ]
  }]

  depends_on = [oneuptime_monitor_status.operational, oneuptime_monitor_status.offline]
}

# =============================================================================
# Test Case 4: Port Monitor
# =============================================================================
resource "oneuptime_monitor" "port" {
  name         = "TF Port Monitor ${random_id.suffix.hex}"
  description  = "Port monitor checking HTTPS port"
  monitor_type = "Port"

  monitor_steps = [{
    monitor_destination      = "google.com"
    monitor_destination_type = "Hostname"
    port                     = 443
    request_type             = "GET"

    criteria = [
      {
        name                  = "Port Open"
        description           = "Port is accepting connections"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          }
        ]
      }
    ]
  }]

  depends_on = [oneuptime_monitor_status.operational]
}

# =============================================================================
# Test Case 5: SSL Certificate Monitor
# =============================================================================
resource "oneuptime_monitor" "ssl" {
  name         = "TF SSL Certificate Monitor ${random_id.suffix.hex}"
  description  = "SSL certificate monitor checking certificate validity"
  monitor_type = "SSL Certificate"

  monitor_steps = [{
    monitor_destination      = "https://google.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Certificate Valid"
        description           = "SSL certificate is valid"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Valid Certificate"
            filter_type = "True"
          }
        ]
      },
      {
        name                  = "Certificate Expiring Soon"
        description           = "Certificate expires within 30 days"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.degraded.id

        filters = [
          {
            check_on    = "Expires In Days"
            filter_type = "Less Than"
            value       = "30"
          }
        ]
      }
    ]
  }]

  depends_on = [oneuptime_monitor_status.operational, oneuptime_monitor_status.degraded]
}

# =============================================================================
# Test Case 6: IP Monitor
# =============================================================================
resource "oneuptime_monitor" "ip" {
  name         = "TF IP Monitor ${random_id.suffix.hex}"
  description  = "IP monitor checking connectivity"
  monitor_type = "IP"

  monitor_steps = [{
    monitor_destination      = "8.8.8.8"
    monitor_destination_type = "IP"
    request_type             = "GET"

    criteria = [
      {
        name                  = "IP Reachable"
        description           = "IP address is reachable"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          }
        ]
      }
    ]
  }]

  depends_on = [oneuptime_monitor_status.operational]
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

output "website_monitor_destination" {
  value       = oneuptime_monitor.website.monitor_steps[0].monitor_destination
  description = "Website monitor step destination (typed attribute access)"
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

output "port_monitor_port" {
  value       = oneuptime_monitor.port.monitor_steps[0].port
  description = "Port monitor step port (typed attribute access)"
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

output "operational_status_id" {
  value       = oneuptime_monitor_status.operational.id
  description = "Operational status ID"
}

output "degraded_status_id" {
  value       = oneuptime_monitor_status.degraded.id
  description = "Degraded status ID"
}

output "offline_status_id" {
  value       = oneuptime_monitor_status.offline.id
  description = "Offline status ID"
}
