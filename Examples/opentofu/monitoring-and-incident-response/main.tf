# Two services, each with monitors, an on-call rotation, and a status page,
# built from the reusable module in ../modules/monitoring-and-incident-response.
#
#   export ONEUPTIME_API_KEY="<project api key>"
#   tofu init
#   tofu plan
#   tofu apply
#
# `terraform` works identically — nothing in this directory is engine-specific
# beyond the CLI you type.

terraform {
  # See ../modules/monitoring-and-incident-response/versions.tf — 1.5.0 is
  # OneUptime's Terraform floor and every OpenTofu release satisfies it.
  required_version = ">= 1.5.0"

  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 11.0"
    }
  }
}

provider "oneuptime" {
  # api_key comes from ONEUPTIME_API_KEY.
  oneuptime_url = var.oneuptime_url
}

# Customer-facing: public status page, incidents page the on-call rotation.
module "storefront" {
  source = "../modules/monitoring-and-incident-response"

  service_name              = "storefront"
  status_page_is_public     = true
  escalate_after_in_minutes = 5

  monitors = {
    homepage = {
      url                 = "https://example.com"
      display_name        = "Storefront homepage"
      monitoring_interval = "Every 1 minute"
    }

    checkout = {
      url          = "https://example.com/checkout"
      display_name = "Checkout"
    }

    api = {
      url                  = "https://api.example.com/health"
      display_name         = "Storefront API"
      expected_status_code = "204"
    }
  }
}

# Internal: monitored and alerted on, but no status page and no paging.
module "internal_tools" {
  source = "../modules/monitoring-and-incident-response"

  service_name          = "internal-tools"
  create_status_page    = false
  create_on_call_policy = false
  monitoring_interval   = "Every 5 minutes"
  label_color           = "#8e44ad"

  monitors = {
    wiki = {
      url          = "https://wiki.internal.example.com"
      display_name = "Wiki"
    }

    ci = {
      url                   = "https://ci.internal.example.com/healthz"
      display_name          = "CI"
      open_incident_on_down = false
    }
  }
}
