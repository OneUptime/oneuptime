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

# Test: Team CRUD Operations

# Test Case 1: Basic Team
resource "oneuptime_team" "basic" {
  project_id  = var.project_id
  name        = "TF Basic Team ${random_id.suffix.hex}"
  description = "Basic team for testing"
}

# Test Case 2: Team with description
resource "oneuptime_team" "detailed" {
  project_id  = var.project_id
  name        = "TF Detailed Team ${random_id.suffix.hex}"
  description = "A detailed team with comprehensive description for testing various scenarios"
}

# Test Case 3: Multiple teams (uniqueness)
resource "oneuptime_team" "engineering" {
  project_id  = var.project_id
  name        = "TF Engineering Team ${random_id.suffix.hex}"
  description = "Engineering team"
}

resource "oneuptime_team" "operations" {
  project_id  = var.project_id
  name        = "TF Operations Team ${random_id.suffix.hex}"
  description = "Operations team"
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
