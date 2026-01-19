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

# Test for GitHub Issue #2228: probe_version field produces inconsistent result after apply
# The probe_version should remain as "1.0.0" and not be converted to JSON like {"_type":"Version","value":"1.0.0"}
resource "oneuptime_probe" "test" {
  project_id    = var.project_id
  key           = "terraform-e2e-probe-key-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  name          = "terraform-e2e-probe-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  probe_version = "1.0.0"
}

output "probe_id" {
  value       = oneuptime_probe.test.id
  description = "ID of the created probe"
}

output "probe_key" {
  value       = oneuptime_probe.test.key
  description = "Key of the created probe"
}

output "probe_name" {
  value       = oneuptime_probe.test.name
  description = "Name of the created probe"
}

output "probe_version" {
  value       = oneuptime_probe.test.probe_version
  description = "Version of the created probe"
}
