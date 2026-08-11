variable "service_name" {
  type        = string
  description = "Name of the service this module monitors. Used to name the label, on-call policy, and status page it creates."

  validation {
    condition     = length(trimspace(var.service_name)) > 0
    error_message = "service_name must not be empty."
  }
}

variable "monitors" {
  type = map(object({
    url                   = string
    display_name          = optional(string)
    description           = optional(string)
    expected_status_code  = optional(string, "200")
    monitoring_interval   = optional(string)
    show_on_status_page   = optional(bool, true)
    open_incident_on_down = optional(bool, true)
  }))
  description = <<-EOT
    HTTP endpoints to monitor, keyed by a short stable identifier (the key ends
    up in the Terraform address, so changing it replaces the monitor).

    Example:

        monitors = {
          homepage = { url = "https://example.com" }
          api      = { url = "https://api.example.com/health", expected_status_code = "204" }
        }
  EOT

  validation {
    condition     = length(var.monitors) > 0
    error_message = "Provide at least one monitor."
  }

  validation {
    condition     = alltrue([for m in var.monitors : startswith(m.url, "http://") || startswith(m.url, "https://")])
    error_message = "Every monitor url must start with http:// or https://."
  }
}

variable "monitoring_interval" {
  type        = string
  default     = "Every 1 minute"
  description = "Default probe interval for monitors that do not set their own monitoring_interval."
}

variable "label_color" {
  type        = string
  default     = "#4287f5"
  description = "Hex colour for the label this module creates and attaches to everything it manages."
}

# The taxonomy below is looked up rather than created. OneUptime seeds every
# project with these statuses and severities, and a module instantiated once per
# service must not add a duplicate set each time it is called. Override the names
# only if the project's taxonomy was renamed.
variable "operational_monitor_status_name" {
  type        = string
  default     = "Operational"
  description = "Name of the existing monitor status meaning healthy."
}

variable "offline_monitor_status_name" {
  type        = string
  default     = "Offline"
  description = "Name of the existing monitor status meaning down."
}

variable "incident_severity_name" {
  type        = string
  default     = "Critical Incident"
  description = "Name of the existing incident severity used for incidents this module opens."
}

variable "create_on_call_policy" {
  type        = bool
  default     = true
  description = "Create an on-call policy with a single escalation rule and attach it to incidents opened by these monitors."
}

variable "escalate_after_in_minutes" {
  type        = number
  default     = 5
  description = "Minutes an unacknowledged page waits before the escalation rule fires. Ignored when create_on_call_policy is false."

  validation {
    condition     = var.escalate_after_in_minutes > 0
    error_message = "escalate_after_in_minutes must be greater than zero."
  }
}

variable "create_status_page" {
  type        = bool
  default     = true
  description = "Create a status page listing the monitors that have show_on_status_page set."
}

variable "status_page_is_public" {
  type        = bool
  default     = false
  description = "Whether the created status page is publicly reachable. Ignored when create_status_page is false."
}

variable "auto_resolve_incidents" {
  type        = bool
  default     = true
  description = "Whether incidents opened by these monitors close themselves when the monitor recovers."
}
