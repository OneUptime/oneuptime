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
  project_id  = var.project_id
  name        = "terraform-e2e-label-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Label created by Terraform E2E tests"
  color       = "#FF5733"
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
