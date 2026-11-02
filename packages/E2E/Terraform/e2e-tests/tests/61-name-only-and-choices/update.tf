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

# The update gives the probe a description: its generated key and its
# version stay what they were (verify-update.sh).
resource "oneuptime_probe" "name_only" {
  name        = "TF E2E name-only probe"
  description = "Runs in the e2e stack"
}

# A field's type is fixed once it is made: the update changes its options.
resource "oneuptime_incident_custom_field" "choice" {
  name              = "TF E2E customer impact"
  custom_field_type = "Dropdown"
  dropdown_options  = "None\nSome\nMost\nAll"
}

output "probe_id" {
  value = oneuptime_probe.name_only.id
}

output "probe_key" {
  value     = oneuptime_probe.name_only.key
  sensitive = true
}

output "probe_version" {
  value = oneuptime_probe.name_only.probe_version
}

output "incident_custom_field_id" {
  value = oneuptime_incident_custom_field.choice.id
}
