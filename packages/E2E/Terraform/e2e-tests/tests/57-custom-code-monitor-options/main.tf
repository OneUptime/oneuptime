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

# Test: a Custom Code monitor's Result Value filters compare one field of the
# data its script returns - custom_code_monitor_options names the field
# (resultValuePath, the dashboard's Field Path).
#
# The provider sends each filter's options under customCodeMonitorOptions and
# reads them back into the same filter. verify.sh checks the server stored
# every path on its own filter and none on the filters without one; the
# runner's drift gate and import round-trip check what is read back matches
# this configuration exactly. update.tf changes a path, removes one and adds
# one, and verify-update.sh checks the server followed each change.

data "oneuptime_monitor_status" "operational" {
  name = "Operational"
}

data "oneuptime_monitor_status" "offline" {
  name = "Offline"
}

resource "oneuptime_monitor" "custom_code" {
  name         = "TF E2E Custom Code Field Paths"
  description  = "Result Value filters that compare one field of the returned data"
  monitor_type = "Custom JavaScript Code"
  # Probes must not run the script: this is about what is stored.
  disable_active_monitoring = true

  monitor_steps = [{
    custom_code = "return { data: { status: 'UP', checks: [{ name: 'db', latency: 12 }] } };"

    criteria = [
      {
        name                  = "Unhealthy"
        description           = "A field of the returned data is out of bounds"
        filter_condition      = "Any"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.offline.id

        filters = [
          {
            check_on                    = "Result Value"
            filter_type                 = "Not Equal To"
            value                       = "UP"
            custom_code_monitor_options = jsonencode({ resultValuePath = "status" })
          },
          {
            check_on                    = "Result Value"
            filter_type                 = "Greater Than"
            value                       = "500"
            custom_code_monitor_options = jsonencode({ resultValuePath = "checks[0].latency" })
          },
          {
            check_on    = "Error"
            filter_type = "Is Not Empty"
          },
        ]
      },
      {
        name                  = "Healthy"
        description           = "The script returned something"
        filter_condition      = "All"
        change_monitor_status = true
        monitor_status_id     = data.oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Result Value"
            filter_type = "Is Not Empty"
          },
        ]
      },
    ]
  }]
}

output "monitor_id" {
  value = oneuptime_monitor.custom_code.id
}

# Typed access into the nested filter, as a module would read it.
output "first_field_path" {
  value = jsondecode(oneuptime_monitor.custom_code.monitor_steps[0].criteria[0].filters[0].custom_code_monitor_options).resultValuePath
}
