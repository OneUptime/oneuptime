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

# Test: deleting a custom role that workflows run as (#9832)
#
# OneUptime deletes a custom role that workflows run as only when the delete
# says what they run as instead. verify.sh makes a workflow over the API that
# runs as the role "deleted", as someone would in the Dashboard - no
# configuration manages it. update.tf drops the role: its delete says, from
# what its state holds, that its workflows run as the role "other" instead,
# and verify-update.sh checks the workflow does, then deletes it.
#
# "other" says its workflows run with the default permissions, so its own
# delete is never refused, whatever runs as it by then.

resource "oneuptime_custom_role" "other" {
  name                       = "terraform-e2e-workflows-other-role"
  description                = "The role the workflows move to"
  workflows_run_as_on_delete = "Default"
}

resource "oneuptime_custom_role" "deleted" {
  name                                      = "terraform-e2e-workflows-run-as-role"
  description                               = "A role workflows run as, deleted by update.tf"
  workflows_run_as_on_delete                = "CustomRole"
  workflows_run_as_custom_role_id_on_delete = oneuptime_custom_role.other.id
}

# Checked deleted by the runner after the destroy (custom_role_id -> /api/custom-role).
output "custom_role_id" {
  value       = oneuptime_custom_role.other.id
  description = "ID of the role the workflows move to"
}

# Not named *_id: verify-update.sh checks it is gone once update.tf drops it.
output "deleted_role" {
  value       = oneuptime_custom_role.deleted.id
  description = "ID of the role update.tf deletes"
}
