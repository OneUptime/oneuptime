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

# Test: data sources look an item up by id, or by any of its other plain
# arguments - each one set must match, and exactly one item may match them
# all.
#
# The records looked up are created here, so every lookup has exactly one
# answer to find; verify.sh checks each lookup found the record it was
# pointed at. The lookups read the resources' attributes, so they run after
# the resources exist, and the drift gate re-reads every one of them.

resource "oneuptime_label" "target" {
  name        = "TF E2E Lookup Label"
  description = "Found by the data sources in this test"
  color       = "#8e44ad"
}

resource "oneuptime_monitor_status" "target" {
  name        = "TF E2E Lookup Status"
  description = "Found by the data sources in this test"
  color       = "#16a085"
  # High and gapped, so it never moves another status (see 35-monitor-with-steps).
  priority             = 131
  is_operational_state = false
}

# By name - the way most lookups are written.
data "oneuptime_label" "by_name" {
  name = oneuptime_label.target.name
}

# By id.
data "oneuptime_label" "by_id" {
  id = oneuptime_label.target.id
}

# By an argument that is not the name: a number.
data "oneuptime_monitor_status" "by_priority" {
  priority = oneuptime_monitor_status.target.priority
}

# By two arguments together: both have to match.
data "oneuptime_monitor_status" "by_name_and_state" {
  name                 = oneuptime_monitor_status.target.name
  is_operational_state = false
}

# A lookup reads the whole record, not only what it was found by.
output "label_found_by_name" {
  value = data.oneuptime_label.by_name.id
}

output "label_found_by_id_name" {
  value = data.oneuptime_label.by_id.name
}

output "status_found_by_priority" {
  value = data.oneuptime_monitor_status.by_priority.id
}

output "status_found_by_name_and_state" {
  value = data.oneuptime_monitor_status.by_name_and_state.id
}

output "status_found_by_priority_color" {
  value = data.oneuptime_monitor_status.by_priority.color
}

output "label_id" {
  value = oneuptime_label.target.id
}

output "monitor_status_id" {
  value = oneuptime_monitor_status.target.id
}
