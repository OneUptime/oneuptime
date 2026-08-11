# Module: monitoring-and-incident-response

A basic monitoring and incident-response setup for one service: HTTP monitors, an on-call rotation that gets paged when they go down, and a status page that shows them.

Works with **both OpenTofu and Terraform**. Nothing in it is engine-specific — it lives under `Examples/opentofu/` because that is the workstream it was written for, not because `terraform` cannot run it.

## Usage

```hcl
module "storefront" {
  source = "github.com/OneUptime/terraform-provider-oneuptime//modules/monitoring-and-incident-response?ref=v11.7.4"

  service_name          = "storefront"
  status_page_is_public = true

  monitors = {
    homepage = { url = "https://example.com" }
    checkout = { url = "https://example.com/checkout" }
    api      = { url = "https://api.example.com/health", expected_status_code = "204" }
  }
}
```

Pin `ref` to a published provider tag. The provider repository is regenerated on every release, so an unpinned `source` tracks whatever was published last.

A runnable version of the above is in [`../../monitoring-and-incident-response`](../../monitoring-and-incident-response).

## What it creates

| Resource | Count | Notes |
|----------|-------|-------|
| `oneuptime_label` | 1 | Attached to everything the module manages, so a project can be filtered by service |
| `oneuptime_monitor` | one per `monitors` entry | `Website` monitors with online/offline criteria |
| `oneuptime_on_call_policy` | 0 or 1 | Skipped when `create_on_call_policy = false` |
| `oneuptime_escalation_rule` | 0 or 1 | First-responder rule on that policy |
| `oneuptime_status_page` | 0 or 1 | Skipped when `create_status_page = false` |
| `oneuptime_status_page_group` | 0 or 1 | Groups this service's monitors on the page |
| `oneuptime_status_page_resource` | one per listed monitor | Puts a monitor on the page |

When a monitor's probe fails, its offline criteria flips the monitor status, opens an incident at the configured severity, and pages the on-call policy. When it recovers, the incident auto-resolves unless `auto_resolve_incidents = false`.

## What it deliberately does not create

**Monitor statuses and incident severities.** OneUptime seeds every project with `Operational` / `Degraded` / `Offline` and `Critical Incident` / `Major Incident` / `Minor Incident`. A module instantiated once per service would add a duplicate set on every call, and monitor-status `priority` is an insert slot that shifts existing statuses — creating them per service reorders the project's taxonomy. The module looks them up by name instead.

If your project renamed them, override `operational_monitor_status_name`, `offline_monitor_status_name`, and `incident_severity_name`.

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `service_name` | `string` | — | **Required.** Names the label, on-call policy, and status page |
| `monitors` | `map(object)` | — | **Required.** Endpoints to monitor, keyed by a short stable identifier |
| `monitoring_interval` | `string` | `"Every 1 minute"` | Default probe interval |
| `label_color` | `string` | `"#4287f5"` | Hex colour for the created label |
| `operational_monitor_status_name` | `string` | `"Operational"` | Existing status meaning healthy |
| `offline_monitor_status_name` | `string` | `"Offline"` | Existing status meaning down |
| `incident_severity_name` | `string` | `"Critical Incident"` | Existing severity for opened incidents |
| `create_on_call_policy` | `bool` | `true` | Create a policy + escalation rule and page it |
| `escalate_after_in_minutes` | `number` | `5` | Unacknowledged wait before escalating |
| `create_status_page` | `bool` | `true` | Create a status page for these monitors |
| `status_page_is_public` | `bool` | `false` | Whether that page is publicly reachable |
| `auto_resolve_incidents` | `bool` | `true` | Close incidents when the monitor recovers |

Each `monitors` entry takes:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `url` | `string` | — | **Required.** Must start with `http://` or `https://` |
| `display_name` | `string` | `"<service_name> <key>"` | Monitor name in the dashboard |
| `description` | `string` | derived from `url` | Monitor description |
| `expected_status_code` | `string` | `"200"` | Status code that counts as healthy |
| `monitoring_interval` | `string` | `var.monitoring_interval` | Per-monitor interval override |
| `show_on_status_page` | `bool` | `true` | List this monitor on the status page |
| `open_incident_on_down` | `bool` | `true` | Open an incident when this monitor fails |

## Outputs

| Name | Description |
|------|-------------|
| `label_id` | ID of the created label |
| `monitor_ids` | Monitor IDs, keyed as `monitors` was |
| `monitor_slugs` | Server-generated monitor slugs, keyed as `monitors` was |
| `on_call_policy_id` | On-call policy ID, or `null` when not created |
| `escalation_rule_id` | Escalation rule ID, or `null` when not created |
| `status_page_id` | Status page ID, or `null` when not created |
| `status_page_group_id` | Status page group ID, or `null` when not created |

## Requirements

| Name | Version |
|------|---------|
| OpenTofu | >= 1.6.0 |
| Terraform | >= 1.5.0 |
| `oneuptime/oneuptime` provider | >= 11.0.0 |

The provider is published to both the [OpenTofu Registry](https://search.opentofu.org/provider/oneuptime/oneuptime/latest) and the [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime), so the bare `oneuptime/oneuptime` source address in `versions.tf` resolves under either engine with no change.

Adding a member to the on-call rotation is a separate step — the module creates the policy and escalation rule, but who gets paged is configured in the OneUptime dashboard or with `oneuptime_team_member`.
