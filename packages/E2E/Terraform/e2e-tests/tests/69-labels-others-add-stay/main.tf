terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "random_id" "suffix" {
  byte_length = 4
}

# Test: labels someone else adds stay (OneUptime/oneuptime#10134, #10135)
#
# A configuration's labels are the labels it lists. A label a label rule or
# a person adds to the record is theirs: no plan shows it, and no apply takes
# it off.
#
#   - verify.sh adds a label to the monitor through the API, as a label rule
#     does, and the runner's drift gate then requires a clean plan;
#   - update.tf takes the configuration's label out and lists another one:
#     verify-update.sh checks the apply took off only the label taken out,
#     and that the label added outside stayed. It then takes that label off
#     again, as a person can, which is no drift either, so the import round
#     trip adopts the configuration's label only.

resource "oneuptime_label" "payments" {
  name        = "TF E2E Payments ${random_id.suffix.hex}"
  description = "A label the configuration lists, and update.tf takes out"
  color       = "#3498db"
}

resource "oneuptime_label" "checkout" {
  name        = "TF E2E Checkout ${random_id.suffix.hex}"
  description = "A label update.tf lists"
  color       = "#2ecc71"
}

resource "oneuptime_label" "added_outside" {
  name        = "TF E2E Added Outside ${random_id.suffix.hex}"
  description = "A label verify.sh adds to the monitor through the API"
  color       = "#e67e22"
}

resource "oneuptime_monitor" "labelled" {
  name         = "TF E2E Labelled Monitor ${random_id.suffix.hex}"
  description  = "A monitor someone else adds a label to"
  monitor_type = "Manual"
  labels       = [oneuptime_label.payments.id]
}

output "monitor_id" {
  value       = oneuptime_monitor.labelled.id
  description = "ID of the monitor"
}

output "label_id" {
  value       = oneuptime_label.payments.id
  description = "ID of the label the configuration lists"
}

output "checkout_label" {
  value       = oneuptime_label.checkout.id
  description = "ID of the label update.tf lists"
}

output "added_outside_label" {
  value       = oneuptime_label.added_outside.id
  description = "ID of the label verify.sh adds through the API"
}

output "monitor_labels" {
  value       = oneuptime_monitor.labelled.labels
  description = "The labels the configuration holds"
}
