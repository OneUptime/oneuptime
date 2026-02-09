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

# Test for oneuptime_file resource CRUD and idempotency
# This test validates that:
# 1. File resource can be created with base64 content
# 2. A second terraform plan succeeds without "Read Not Implemented" error
# 3. The resource state is preserved correctly across plan/apply cycles
#
# Bug scenario being tested:
# - First apply: CREATE succeeds, file is uploaded
# - Second plan: READ was returning "Read Not Implemented" error
# - Fix: READ now preserves existing state as a no-op
resource "oneuptime_file" "logo" {
  name      = "tf-e2e-logo-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  file_type = "image/png"
  # Small 1x1 red PNG pixel encoded as base64
  file      = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
  is_public = "true"

  lifecycle {
    ignore_changes = [name]
  }
}

resource "oneuptime_file" "favicon" {
  name      = "tf-e2e-favicon-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  file_type = "image/png"
  # Same small 1x1 PNG pixel
  file      = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
  is_public = "true"

  lifecycle {
    ignore_changes = [name]
  }
}

output "logo_id" {
  value       = oneuptime_file.logo.id
  description = "ID of the created logo file"
}

output "logo_name" {
  value       = oneuptime_file.logo.name
  description = "Name of the created logo file"
}

output "logo_file_type" {
  value       = oneuptime_file.logo.file_type
  description = "File type of the created logo file"
}

output "favicon_id" {
  value       = oneuptime_file.favicon.id
  description = "ID of the created favicon file"
}

output "favicon_name" {
  value       = oneuptime_file.favicon.name
  description = "Name of the created favicon file"
}
