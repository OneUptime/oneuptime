# Update-phase config: the runner copies this over main.tf after the initial
# apply + drift gate. Changed vs main.tf: rule name, description,
# escalate_after_in_minutes.
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

resource "oneuptime_on_call_policy" "policy" {
  name        = "terraform-e2e-escalation-policy"
  description = "On-call policy for escalation rule testing"
}

resource "oneuptime_escalation_rule" "rule" {
  on_call_duty_policy_id    = oneuptime_on_call_policy.policy.id
  name                      = "terraform-e2e-escalation-rule-updated"
  description               = "Escalation rule updated by Terraform E2E tests"
  escalate_after_in_minutes = 10
}

output "on_call_duty_policy_id" {
  value       = oneuptime_on_call_policy.policy.id
  description = "ID of the on-call policy"
}

output "on_call_duty_policy_escalation_rule_id" {
  value       = oneuptime_escalation_rule.rule.id
  description = "ID of the escalation rule"
}

output "escalation_rule_name" {
  value       = oneuptime_escalation_rule.rule.name
  description = "Name of the escalation rule"
}
