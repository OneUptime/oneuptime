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

# The monitor of main.tf with its field paths changed every way they can be:
# the status filter's path is changed, the latency filter's is removed, and
# the Healthy filter, which had none, gets one. verify-update.sh checks the
# server stored each change, and the runner's drift gate that the read-back
# matches this configuration.

data "oneuptime_monitor_status" "operational" {
  name = "Operational"
}

data "oneuptime_monitor_status" "offline" {
  name = "Offline"
}

resource "oneuptime_monitor" "custom_code" {
  name                      = "TF E2E Custom Code Field Paths"
  description               = "Result Value filters that compare one field of the returned data"
  monitor_type              = "Custom JavaScript Code"
  disable_active_monitoring = true

  monitor_steps = [{
    custom_code = "return { data: { health: { status: 'UP' }, checks: [{ name: 'db', latency: 12 }] } };"

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
            custom_code_monitor_options = jsonencode({ resultValuePath = "health.status" })
          },
          {
            check_on    = "Result Value"
            filter_type = "Greater Than"
            value       = "500"
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
            check_on                    = "Result Value"
            filter_type                 = "Is Not Empty"
            custom_code_monitor_options = jsonencode({ resultValuePath = "health.status" })
          },
        ]
      },
    ]
  }]
}

output "monitor_id" {
  value = oneuptime_monitor.custom_code.id
}

output "first_field_path" {
  value = jsondecode(oneuptime_monitor.custom_code.monitor_steps[0].criteria[0].filters[0].custom_code_monitor_options).resultValuePath
}
