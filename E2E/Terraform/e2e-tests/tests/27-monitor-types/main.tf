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

# Test: Different Monitor Types
#
# This test validates creating monitors of different types:
# - Manual (no monitoring destination needed)
# - IncomingRequest (server-side monitoring)
# - Server (agent-based monitoring)
#
# Each type may have different server defaults injected

# Test Case 1: Manual Monitor
resource "oneuptime_monitor" "manual" {
  project_id   = var.project_id
  name         = "TF Manual Type ${random_id.suffix.hex}"
  description  = "Manual type monitor for testing"
  monitor_type = "Manual"
}

# Test Case 2: Incoming Request Monitor
resource "oneuptime_monitor" "incoming_request" {
  project_id   = var.project_id
  name         = "TF Incoming Request Type ${random_id.suffix.hex}"
  description  = "Incoming Request type monitor for testing"
  monitor_type = "Incoming Request"
}

# Test Case 3: Server Monitor
resource "oneuptime_monitor" "server" {
  project_id   = var.project_id
  name         = "TF Server Type ${random_id.suffix.hex}"
  description  = "Server type monitor for agent-based monitoring"
  monitor_type = "Server"
}

# Test Case 4: Multiple monitors of same type (uniqueness test)
resource "oneuptime_monitor" "manual_2" {
  project_id   = var.project_id
  name         = "TF Manual Type 2 ${random_id.suffix.hex}"
  description  = "Second manual monitor"
  monitor_type = "Manual"
}

resource "oneuptime_monitor" "manual_3" {
  project_id   = var.project_id
  name         = "TF Manual Type 3 ${random_id.suffix.hex}"
  description  = "Third manual monitor"
  monitor_type = "Manual"
}

# Outputs
output "manual_id" {
  value       = oneuptime_monitor.manual.id
  description = "Manual monitor ID"
}

output "manual_type" {
  value       = oneuptime_monitor.manual.monitor_type
  description = "Manual monitor type"
}

output "incoming_request_id" {
  value       = oneuptime_monitor.incoming_request.id
  description = "IncomingRequest monitor ID"
}

output "incoming_request_type" {
  value       = oneuptime_monitor.incoming_request.monitor_type
  description = "IncomingRequest monitor type"
}

output "incoming_request_incoming_request_secret_key" {
  value       = oneuptime_monitor.incoming_request.incoming_request_secret_key
  description = "Server-generated secret key for incoming requests"
  sensitive   = true
}

output "server_id" {
  value       = oneuptime_monitor.server.id
  description = "Server monitor ID"
}

output "server_type" {
  value       = oneuptime_monitor.server.monitor_type
  description = "Server monitor type"
}

output "server_server_monitor_secret_key" {
  value       = oneuptime_monitor.server.server_monitor_secret_key
  description = "Server-generated secret key for server monitor"
  sensitive   = true
}

output "manual_2_id" {
  value       = oneuptime_monitor.manual_2.id
  description = "Second manual monitor ID"
}

output "manual_3_id" {
  value       = oneuptime_monitor.manual_3.id
  description = "Third manual monitor ID"
}
