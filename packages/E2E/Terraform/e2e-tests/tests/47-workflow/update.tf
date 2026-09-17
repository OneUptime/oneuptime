# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: workflow name and description,
# variable content.
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

resource "oneuptime_workflow" "workflow" {
  name        = "terraform-e2e-workflow-updated"
  description = "Workflow updated by Terraform E2E tests"
  is_enabled  = false
}

resource "oneuptime_workflow_variable" "variable" {
  workflow_id = oneuptime_workflow.workflow.id
  name        = "terraform-e2e-variable"
  description = "Variable created by Terraform E2E tests"
  content     = "updated-value"
  is_secret   = false
}

output "workflow_id" {
  value       = oneuptime_workflow.workflow.id
  description = "ID of the workflow"
}

output "workflow_variable_id" {
  value       = oneuptime_workflow_variable.variable.id
  description = "ID of the workflow variable"
}

output "workflow_name" {
  value       = oneuptime_workflow.workflow.name
  description = "Name of the workflow"
}
