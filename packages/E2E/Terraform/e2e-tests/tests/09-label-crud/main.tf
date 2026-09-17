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

# Comprehensive CRUD test for label resource
resource "oneuptime_label" "test" {
  name        = "TF CRUD Label ${random_id.suffix.hex}"
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
