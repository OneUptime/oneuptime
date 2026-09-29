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

# Test: On-Call Schedule + Schedule Layer
#
# Covers oneuptime_on_call_policy_schedule (the on-call duty schedule) and
# oneuptime_on_call_schedule_layer (a rotation layer inside that schedule).
#
# rotation and restriction_times are required JSON columns on the server
# (their DB defaults are not applied when the provider sends explicit nulls),
# so they are set here with the exact wrapper shape the server serializes
# back (Recurring / RestrictionTimes objects). The provider's JSON-subset
# semantic equality keeps the plan clean as long as the config is a
# structural subset of the server value.

resource "oneuptime_on_call_policy_schedule" "schedule" {
  name        = "terraform-e2e-oncall-schedule"
  description = "On-call schedule created by Terraform E2E tests"
}

resource "oneuptime_on_call_schedule_layer" "layer" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.schedule.id
  name                            = "terraform-e2e-schedule-layer"
  description                     = "Layer created by Terraform E2E tests"

  # Fixed future timestamps: the provider must round-trip these without drift.
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

# Output names map to the API routes /api/on-call-duty-policy-schedule and
# /api/on-call-duty-schedule-layer so deletion verification hits the real
# endpoints.
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
