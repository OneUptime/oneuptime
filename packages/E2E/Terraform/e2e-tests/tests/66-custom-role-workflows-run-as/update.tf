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

# The role the workflow runs as is dropped: its delete sends what its state
# holds - workflows_run_as_on_delete = "CustomRole" and the other role's ID -
# so the workflow runs as "other" from now on, instead of stopping.

resource "oneuptime_custom_role" "other" {
  name                       = "terraform-e2e-workflows-other-role"
  description                = "The role the workflows move to"
  workflows_run_as_on_delete = "Default"
}

output "custom_role_id" {
  value       = oneuptime_custom_role.other.id
  description = "ID of the role the workflows move to"
}
