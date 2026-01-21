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

# Test: Team CRUD Operations

locals {
  timestamp = formatdate("YYYYMMDDhhmmss", timestamp())
}

# Test Case 1: Basic Team
resource "oneuptime_team" "basic" {
  project_id  = var.project_id
  name        = "TF Basic Team ${local.timestamp}"
  description = "Basic team for testing"

  lifecycle {
    ignore_changes = [name]
  }
}

# Test Case 2: Team with description
resource "oneuptime_team" "detailed" {
  project_id  = var.project_id
  name        = "TF Detailed Team ${local.timestamp}"
  description = "A detailed team with comprehensive description for testing various scenarios"

  lifecycle {
    ignore_changes = [name]
  }
}

# Test Case 3: Multiple teams (uniqueness)
resource "oneuptime_team" "engineering" {
  project_id  = var.project_id
  name        = "TF Engineering Team ${local.timestamp}"
  description = "Engineering team"

  lifecycle {
    ignore_changes = [name]
  }
}

resource "oneuptime_team" "operations" {
  project_id  = var.project_id
  name        = "TF Operations Team ${local.timestamp}"
  description = "Operations team"

  lifecycle {
    ignore_changes = [name]
  }
}

# Outputs
output "basic_team_id" {
  value       = oneuptime_team.basic.id
  description = "Basic team ID"
}

output "detailed_team_id" {
  value       = oneuptime_team.detailed.id
  description = "Detailed team ID"
}

output "engineering_team_id" {
  value       = oneuptime_team.engineering.id
  description = "Engineering team ID"
}

output "operations_team_id" {
  value       = oneuptime_team.operations.id
  description = "Operations team ID"
}

output "basic_team_slug" {
  value       = oneuptime_team.basic.slug
  description = "Server-generated slug"
}
