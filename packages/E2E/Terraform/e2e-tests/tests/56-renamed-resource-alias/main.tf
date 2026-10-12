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

# Test: a renamed resource type keeps working under its old name.
#
# Type names used to cut mixed-case words apart (oneuptime_io_t_fleet); they
# keep them whole now (oneuptime_iot_fleet), and the old name stays registered
# as a deprecated alias so no configuration breaks. Here the old name creates
# a fleet, the new name creates another, and each data source - new name and
# old - finds the fleet the other resource name made. The runner's import
# round-trip covers importing under the old name.

resource "oneuptime_io_t_fleet" "old_name" {
  name        = "TF E2E Fleet Old Name"
  description = "Created under the deprecated oneuptime_io_t_fleet name"
}

resource "oneuptime_iot_fleet" "new_name" {
  name        = "TF E2E Fleet New Name"
  description = "Created under the oneuptime_iot_fleet name"
}

data "oneuptime_iot_fleet" "finds_old" {
  name = oneuptime_io_t_fleet.old_name.name
}

data "oneuptime_io_t_fleet" "finds_new" {
  name = oneuptime_iot_fleet.new_name.name
}

output "iot_fleet_id" {
  value = oneuptime_io_t_fleet.old_name.id
}

output "new_name_fleet" {
  value = oneuptime_iot_fleet.new_name.id
}

output "old_name_fleet_found_by_new_data_source" {
  value = data.oneuptime_iot_fleet.finds_old.id
}

output "new_name_fleet_found_by_old_data_source" {
  value = data.oneuptime_io_t_fleet.finds_new.id
}
