# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: name, description, color.
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

resource "oneuptime_label" "test" {
  name        = "terraform-e2e-label-updated"
  description = "Label updated by Terraform E2E tests"
  color       = "#33C1FF"
}

output "label_id" {
  value       = oneuptime_label.test.id
  description = "ID of the created label"
}

output "label_name" {
  value       = oneuptime_label.test.name
  description = "Name of the created label"
}

output "label_description" {
  value       = oneuptime_label.test.description
  description = "Description of the created label"
}

output "label_color" {
  value       = oneuptime_label.test.color
  description = "Color of the created label"
}
