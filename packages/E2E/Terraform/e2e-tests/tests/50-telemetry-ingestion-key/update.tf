# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: name and description.
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

resource "oneuptime_telemetry_ingestion_key" "key" {
  name        = "terraform-e2e-ingestion-key-updated"
  description = "Telemetry ingestion key updated by Terraform E2E tests"
}

output "telemetry_ingestion_key_id" {
  value       = oneuptime_telemetry_ingestion_key.key.id
  description = "ID of the telemetry ingestion key"
}

output "telemetry_ingestion_key_name" {
  value       = oneuptime_telemetry_ingestion_key.key.name
  description = "Name of the telemetry ingestion key"
}
