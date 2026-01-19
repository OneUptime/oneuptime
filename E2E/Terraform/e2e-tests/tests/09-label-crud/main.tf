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

# Comprehensive CRUD test for label resource
# This test creates a label, then updates can be applied via variable changes
resource "oneuptime_label" "test" {
  project_id  = var.project_id
  name        = var.label_name
  description = var.label_description
  color       = var.label_color
}

output "label_id" {
  value = oneuptime_label.test.id
}

output "label_name" {
  value = oneuptime_label.test.name
}

output "label_description" {
  value = oneuptime_label.test.description
}

output "label_color" {
  value = oneuptime_label.test.color
}
