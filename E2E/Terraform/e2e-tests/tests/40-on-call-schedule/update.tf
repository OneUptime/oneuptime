# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: schedule description, layer name and
# layer description.
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

resource "oneuptime_on_call_policy_schedule" "schedule" {
  name        = "terraform-e2e-oncall-schedule"
  description = "On-call schedule updated by Terraform E2E tests"
}

resource "oneuptime_on_call_schedule_layer" "layer" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.schedule.id
  name                            = "terraform-e2e-schedule-layer-updated"
  description                     = "Layer updated by Terraform E2E tests"

  starts_at     = "2030-01-01T00:00:00.000Z"
  hand_off_time = "2030-01-01T09:00:00.000Z"

  rotation = jsonencode({
    _type = "Recurring"
    value = {
      intervalType = "Day"
      intervalCount = {
        _type = "PositiveNumber"
        value = 1
      }
    }
  })

  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = {
      restictionType = "None"
    }
  })
}

output "on_call_duty_policy_schedule_id" {
  value       = oneuptime_on_call_policy_schedule.schedule.id
  description = "ID of the on-call schedule"
}

output "on_call_duty_schedule_layer_id" {
  value       = oneuptime_on_call_schedule_layer.layer.id
  description = "ID of the schedule layer"
}

output "schedule_name" {
  value       = oneuptime_on_call_policy_schedule.schedule.name
  description = "Name of the on-call schedule"
}

output "layer_name" {
  value       = oneuptime_on_call_schedule_layer.layer.name
  description = "Name of the schedule layer"
}
