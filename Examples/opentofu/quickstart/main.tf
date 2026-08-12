# Smallest useful OneUptime configuration, run with `tofu`.
#
#   export ONEUPTIME_API_KEY="<project api key>"
#   tofu init
#   tofu plan
#   tofu apply
#
# The only OpenTofu-specific thing here is the CLI you drive it with: "oneuptime/
# oneuptime" resolves against registry.opentofu.org under `tofu` and against
# registry.terraform.io under `terraform`, and the provider is published to both.

terraform {
  # OpenTofu reads the same `terraform` block Terraform does — the block name is
  # part of the language, not a reference to the Terraform CLI.
  #
  # 1.5.0 is OneUptime's documented Terraform floor. Every OpenTofu release
  # satisfies it too, since OpenTofu's version series starts at 1.6.0.
  required_version = ">= 1.5.0"

  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 11.0"
    }
  }
}

provider "oneuptime" {
  # api_key is read from ONEUPTIME_API_KEY when it is not set here. Keep it in
  # the environment rather than in a file that gets committed.
  oneuptime_url = var.oneuptime_url
}

resource "oneuptime_label" "quickstart" {
  name        = "opentofu-quickstart"
  description = "Created by the OneUptime OpenTofu quickstart."
  color       = "#4287f5"
}

resource "oneuptime_monitor" "homepage" {
  name                = "Homepage"
  description         = "Checks that ${var.website_url} responds."
  monitor_type        = "Website"
  monitoring_interval = "Every 5 minutes"
  labels              = [oneuptime_label.quickstart.id]

  monitor_steps = [{
    monitor_destination      = var.website_url
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name             = "Online"
        description      = "Responds successfully."
        filter_condition = "All"

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          }
        ]
      }
    ]
  }]
}

resource "oneuptime_status_page" "quickstart" {
  name                     = "OpenTofu Quickstart Status"
  description              = "Status page created by the OneUptime OpenTofu quickstart."
  page_title               = "Service Status"
  page_description         = "Live status of our services."
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
  labels                   = [oneuptime_label.quickstart.id]
}
