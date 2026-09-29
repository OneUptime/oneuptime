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

# Test: Escalation Rule wired to an On-Call Duty Policy
#
# Covers oneuptime_escalation_rule (on-call duty policy escalation rule).
# The rule is attached to a policy via on_call_duty_policy_id.

resource "oneuptime_on_call_policy" "policy" {
  name        = "terraform-e2e-escalation-policy"
  description = "On-call policy for escalation rule testing"
}

resource "oneuptime_escalation_rule" "rule" {
  on_call_duty_policy_id    = oneuptime_on_call_policy.policy.id
  name                      = "terraform-e2e-escalation-rule"
  description               = "Escalation rule created by Terraform E2E tests"
  escalate_after_in_minutes = 5
}

output "on_call_duty_policy_id" {
  value       = oneuptime_on_call_policy.policy.id
  description = "ID of the on-call policy"
}

# Output name maps to the API route /api/on-call-duty-policy-escalation-rule
# so the runner's deletion verification hits the real endpoint.
output "on_call_duty_policy_escalation_rule_id" {
  value       = oneuptime_escalation_rule.rule.id
  description = "ID of the escalation rule"
}

output "escalation_rule_name" {
  value       = oneuptime_escalation_rule.rule.name
  description = "Name of the escalation rule"
}
