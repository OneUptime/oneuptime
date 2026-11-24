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

# Test: a chain of renames converges in one apply (OneUptime/oneuptime#9855) -
# the update
#
# Every record takes the name of the next one in its chain, which gives it
# up in this same apply, and the last takes a name nobody has:
#
#   - teams: one -> two, two -> three, three -> four, four -> five;
#   - labels: one -> two, two -> three, three -> four;
#   - on-call policies: one -> two, two -> three, three -> four.
#
# The runner's plan gate after this one apply must find nothing to do, and
# verify-update.sh reads every name back from the API.

locals {
  teams    = ["one", "two", "three", "four"]
  labels   = ["one", "two", "three"]
  policies = ["one", "two", "three"]

  # The name each record takes: the next one's.
  next = {
    one   = "two"
    two   = "three"
    three = "four"
    four  = "five"
  }
}

resource "oneuptime_team" "chain" {
  for_each    = toset(local.teams)
  name        = "terraform-e2e-chain-team-${local.next[each.key]}"
  description = "Team the E2E suite renames in a chain"
}

resource "oneuptime_label" "chain" {
  for_each    = toset(local.labels)
  name        = "terraform-e2e-chain-label-${local.next[each.key]}"
  description = "Label the E2E suite renames in a chain"
  color       = "#4F46E5"
}

resource "oneuptime_on_call_policy" "chain" {
  for_each    = toset(local.policies)
  name        = "terraform-e2e-chain-policy-${local.next[each.key]}"
  description = "On-call policy the E2E suite renames in a chain"
}

output "team_id" {
  value       = oneuptime_team.chain["one"].id
  description = "ID of the first team of the chain"
}

output "label_id" {
  value       = oneuptime_label.chain["one"].id
  description = "ID of the first label of the chain"
}

output "on_call_duty_policy_id" {
  value       = oneuptime_on_call_policy.chain["one"].id
  description = "ID of the first on-call policy of the chain"
}

output "expected_names" {
  description = "Each record of the chains, and the name configured for it"
  value = concat(
    [for key, team in oneuptime_team.chain : {
      label    = "team ${key}"
      endpoint = "/api/team"
      id       = team.id
      name     = "terraform-e2e-chain-team-${local.next[key]}"
    }],
    [for key, label in oneuptime_label.chain : {
      label    = "label ${key}"
      endpoint = "/api/label"
      id       = label.id
      name     = "terraform-e2e-chain-label-${local.next[key]}"
    }],
    [for key, policy in oneuptime_on_call_policy.chain : {
      label    = "on-call policy ${key}"
      endpoint = "/api/on-call-duty-policy"
      id       = policy.id
      name     = "terraform-e2e-chain-policy-${local.next[key]}"
    }],
  )
}
