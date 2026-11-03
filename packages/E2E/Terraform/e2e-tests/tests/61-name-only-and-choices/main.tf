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

# A probe made from its name alone. OneUptime generates its key and starts
# its version at 1.0.0: the configuration never holds the secret, and reads
# it back (sensitive) to install the probe with it.
resource "oneuptime_probe" "name_only" {
  name = "TF E2E name-only probe"
}

# A choice written as one of the values it takes. A value outside them is
# refused when the configuration is validated (verify.sh shows it), and an
# import plans no change.
resource "oneuptime_incident_custom_field" "choice" {
  name              = "TF E2E customer impact"
  custom_field_type = "Dropdown"
  dropdown_options  = "None\nSome\nAll"
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
