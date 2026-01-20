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

# Test for probe_version READ operation idempotency
# This test validates that:
# 1. probe_version is stored correctly as "1.0.0" after create (not as wrapped JSON)
# 2. Running terraform apply again (idempotency check) doesn't detect drift
# 3. The READ operation properly unwraps {"_type":"Version","value":"1.0.0"} to "1.0.0"
#
# Bug scenario being tested:
# - First apply: CREATE succeeds, probe_version = "1.0.0" in state
# - Second apply: READ returns wrapped format {"_type":"Version","value":"1.0.0"}
# - Provider fails with "inconsistent result after apply"
resource "oneuptime_probe" "test" {
  project_id    = var.project_id
  key           = "tf-probe-idem-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  name          = "tf-probe-idempotency-test-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  probe_version = "1.0.0"

  lifecycle {
    ignore_changes = [key, name]
  }
}

output "probe_id" {
  value       = oneuptime_probe.test.id
  description = "ID of the created probe"
}

output "probe_version" {
  value       = oneuptime_probe.test.probe_version
  description = "Version of the created probe - should always be '1.0.0', never wrapped JSON"
}
