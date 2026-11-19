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

# Test: a chain of renames converges in one apply (OneUptime/oneuptime#9855)
#
# Teams, labels and on-call policies each have a name of their own in a
# project: a create, or a rename, onto a name another one has is refused
# with 400 and nothing is written. update.tf renames every record here in
# a chain - each takes the name of the next one, which gives it up in the
# same apply, and the last takes a name nobody has.
#
# Terraform makes the ten renames side by side, so a rename that runs
# before the next one has given its name up is refused. The provider asks
# it again while the server says the name is taken (refusalCode
# "name_taken"), and the chain goes through. The runner applies update.tf
# once and needs a clean plan after it: without the provider asking again,
# that apply fails whenever a rename runs before its neighbour's.
# verify.sh and verify-update.sh read every name back from the API.

locals {
  teams    = ["one", "two", "three", "four"]
  labels   = ["one", "two", "three"]
  policies = ["one", "two", "three"]
}

resource "oneuptime_team" "chain" {
  for_each    = toset(local.teams)
  name        = "terraform-e2e-chain-team-${each.key}"
  description = "Team the E2E suite renames in a chain"
}

resource "oneuptime_label" "chain" {
  for_each    = toset(local.labels)
  name        = "terraform-e2e-chain-label-${each.key}"
  description = "Label the E2E suite renames in a chain"
  color       = "#4F46E5"
}

resource "oneuptime_on_call_policy" "chain" {
  for_each    = toset(local.policies)
  name        = "terraform-e2e-chain-policy-${each.key}"
  description = "On-call policy the E2E suite renames in a chain"
}

# Output names map to the API routes /api/team, /api/label and
# /api/on-call-duty-policy, so the runner's deletion verification reads the
# real records. The rest of the chains go with them.
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

# Every record of the chains, with the name its configuration gives it,
# for verify.sh to read back from the API.
output "expected_names" {
  description = "Each record of the chains, and the name configured for it"
  value = concat(
    [for key, team in oneuptime_team.chain : {
      label    = "team ${key}"
      endpoint = "/api/team"
      id       = team.id
      name     = "terraform-e2e-chain-team-${key}"
    }],
    [for key, label in oneuptime_label.chain : {
      label    = "label ${key}"
      endpoint = "/api/label"
      id       = label.id
      name     = "terraform-e2e-chain-label-${key}"
    }],
    [for key, policy in oneuptime_on_call_policy.chain : {
      label    = "on-call policy ${key}"
      endpoint = "/api/on-call-duty-policy"
      id       = policy.id
      name     = "terraform-e2e-chain-policy-${key}"
    }],
  )
}
