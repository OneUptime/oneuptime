# Examples

Copy-pasteable configurations for the most common OneUptime resources. Every example is adapted from the provider's end-to-end test suite, so the attributes shown here are real and the blocks apply cleanly.

All examples assume this provider setup:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 11.0"
    }
  }
}

provider "oneuptime" {
  # api_key from ONEUPTIME_API_KEY; oneuptime_url only needed when self-hosted.
}
```

## Labels

Labels are the cheapest building block — create them first and attach them to almost anything via `labels = [...]` (an unordered set of label IDs).

```hcl
resource "oneuptime_label" "production" {
  name        = "production"
  description = "Production infrastructure"
  color       = "#FF5733"
}
```

## Monitors

### HTTP monitor with explicit checks

A `Website` monitor with full control over what is checked and when it is considered up or down. The `monitor_steps` nested attributes are explained line by line in [Monitor Steps](/docs/terraform/monitor-steps).

```hcl
resource "oneuptime_monitor_status" "operational" {
  name                 = "Operational"
  description          = "Monitor is operational"
  color                = "#2ecc71"
  priority             = 1
  is_operational_state = true
}

resource "oneuptime_monitor_status" "offline" {
  name                 = "Offline"
  description          = "Monitor is offline"
  color                = "#e74c3c"
  priority             = 3
  is_operational_state = false
}

resource "oneuptime_monitor" "website" {
  name         = "Website"
  description  = "Homepage availability and status code check"
  monitor_type = "Website"

  monitor_steps = [{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Online"
        description           = "Website responds with 200"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          },
          {
            check_on    = "Response Status Code"
            filter_type = "Equal To"
            value       = "200"
          }
        ]
      },
      {
        name                  = "Offline"
        description           = "Website is unreachable"
        filter_condition      = "Any"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.offline.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "False"
          }
        ]
      }
    ]
  }]
}
```

*(Adapted from E2E test `35-monitor-with-steps`.)*

### Ping monitor

Ping monitors take a `Hostname` (or `IP`) destination instead of a URL:

```hcl
resource "oneuptime_monitor" "ping" {
  name         = "Gateway Ping"
  description  = "ICMP reachability of the gateway host"
  monitor_type = "Ping"

  monitor_steps = [{
    monitor_destination      = "gateway.example.com"
    monitor_destination_type = "Hostname"

    criteria = [
      {
        name                  = "Reachable"
        description           = "Host responds to ping"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

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
```

*(Adapted from E2E test `35-monitor-with-steps`.)*

### Manual monitor

Manual monitors have no active checks — status is set by hand or by automation. They need no `monitor_steps` at all:

```hcl
resource "oneuptime_monitor" "third_party" {
  name                = "Payment Provider (manual)"
  description         = "Tracked manually during vendor incidents"
  monitor_type        = "Manual"
  monitoring_interval = "Every 5 minutes"
}
```

*(Adapted from E2E test `26-monitor-steps-basic`.)*

Other valid `monitor_type` values used the same way: `"API"`, `"Port"`, `"IP"`, `"SSL Certificate"`, `"Incoming Request"`, `"Server"`. Server and Incoming Request monitors expose computed secret keys (`server_monitor_secret_key`, `incoming_request_secret_key`) for their agents.

## Status page with a custom domain

Three resources cooperate: a verified project `domain`, the `status_page` itself, and a `status_page_domain` linking them. `full_domain` and `cname_verification_token` are computed by the server — do not set them.

```hcl
resource "oneuptime_domain" "company" {
  domain = "example.com"
}

resource "oneuptime_status_page" "public" {
  name                     = "Public Status"
  description              = "Customer-facing status page"
  page_title               = "System Status"
  page_description         = "Check our system status and incident history"
  is_public_status_page    = true
  enable_email_subscribers = true
  enable_sms_subscribers   = false
}

resource "oneuptime_status_page_domain" "status" {
  domain_id      = oneuptime_domain.company.id
  status_page_id = oneuptime_status_page.public.id
  subdomain      = "status"
}

output "status_domain" {
  # Computed by the server: subdomain + domain, e.g. status.example.com
  value = oneuptime_status_page_domain.status.full_domain
}
```

*(Adapted from E2E tests `25-status-page-with-domain` and `12-status-page-domain`. New domains must pass DNS verification before the status page domain goes live.)*

## Teams and members

```hcl
resource "oneuptime_team" "sre" {
  name        = "SRE"
  description = "Site reliability engineering"
}

resource "oneuptime_team_member" "alice" {
  team_id = oneuptime_team.sre.id
  user_id = "5f8a1b2c3d4e5f6a7b8c9d0e" # user's id — visible in the dashboard URL on their profile
}
```

*(Team adapted from E2E test `33-team-crud`. The referenced user must already be part of the project; membership is confirmed once the user accepts the invitation.)*

## On-call policy with escalation

An on-call policy plus an escalation rule that escalates after 5 minutes without acknowledgement:

```hcl
resource "oneuptime_on_call_policy" "primary" {
  name                                 = "Primary On-Call"
  description                          = "First line for production incidents"
  repeat_policy_if_no_one_acknowledges = true
}

resource "oneuptime_escalation_rule" "first_line" {
  on_call_duty_policy_id     = oneuptime_on_call_policy.primary.id
  name                       = "First line"
  description                = "Page the on-call engineer immediately"
  order                      = 1
  escalate_after_in_minutes  = 5
}
```

*(Policy adapted from E2E test `31-on-call-duty-policy-crud`.)*

## Scheduled maintenance

```hcl
resource "oneuptime_scheduled_maintenance_event" "db_upgrade" {
  title                     = "Database maintenance"
  description               = "Planned PostgreSQL upgrade — writes paused briefly"
  starts_at                 = "2026-08-01T02:00:00Z"
  ends_at                   = "2026-08-01T04:00:00Z"
  is_visible_on_status_page = true
}
```

*(Adapted from E2E test `30-scheduled-maintenance-crud`. Timestamps are RFC3339; equal instants in different notations do not cause drift.)*

## Incident severities and states

Customize your incident taxonomy — severities rank impact, states model the lifecycle. `order` controls display position.

```hcl
resource "oneuptime_incident_severity" "sev1" {
  name        = "SEV-1"
  description = "Full outage, all hands"
  color       = "#e74c3c"
  order       = 1
}

resource "oneuptime_incident_state" "mitigated" {
  name        = "Mitigated"
  description = "Impact contained, fix in progress"
  color       = "#f39c12"
  order       = 3
}
```

*(Adapted from E2E tests `03-incident-severity` and `04-incident-state`. `oneuptime_alert_severity` and `oneuptime_alert_state` work identically for alerts.)*

### Declaring an incident from Terraform

Incidents are normally created by monitors, but they are ordinary resources too — useful for game days:

```hcl
resource "oneuptime_incident" "drill" {
  title                     = "DR drill"
  description               = "Disaster recovery exercise"
  incident_severity_id      = oneuptime_incident_severity.sev1.id
  current_incident_state_id = oneuptime_incident_state.mitigated.id
}
```

*(Adapted from E2E test `28-incident-crud`.)*

## Probes

Custom probes run monitoring checks from your own infrastructure:

```hcl
resource "oneuptime_probe" "eu_west" {
  key           = "probe-eu-west-1"
  name          = "EU West Probe"
  description   = "Probe running in eu-west-1"
  probe_version = "1.0.0"

  should_auto_enable_probe_on_new_monitors = true
}
```

*(Adapted from E2E test `23-probe-crud`.)*

## More

- [Monitor Steps](/docs/terraform/monitor-steps) — the full `monitor_steps` schema, criteria filters, and common mistakes
- [Importing Resources](/docs/terraform/importing-resources) — adopt dashboard-created resources into these patterns
- Per-resource attribute reference: [Terraform Registry docs](https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs)
