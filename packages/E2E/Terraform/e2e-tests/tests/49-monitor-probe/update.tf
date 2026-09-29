# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: pairing is_enabled toggled off,
# monitor description updated.
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

resource "oneuptime_probe" "probe" {
  key                                      = "terraform-e2e-monitor-probe-key"
  name                                     = "terraform-e2e-monitor-probe"
  description                              = "Probe for monitor-probe pairing test"
  probe_version                            = "1.0.0"
  should_auto_enable_probe_on_new_monitors = false
}

resource "oneuptime_monitor" "monitor" {
  name         = "terraform-e2e-probed-monitor"
  description  = "Monitor paired with a custom probe (updated)"
  monitor_type = "Website"
}

resource "oneuptime_monitor_probe" "pairing" {
  probe_id   = oneuptime_probe.probe.id
  monitor_id = oneuptime_monitor.monitor.id
  is_enabled = false
}

output "probe_id" {
  value       = oneuptime_probe.probe.id
  description = "ID of the probe"
}

output "monitor_id" {
  value       = oneuptime_monitor.monitor.id
  description = "ID of the monitor"
}

output "monitor_probe_id" {
  value       = oneuptime_monitor_probe.pairing.id
  description = "ID of the monitor-probe pairing"
}
