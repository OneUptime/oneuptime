# Terraform Provider

The OneUptime Terraform provider manages OneUptime resources — monitors, status pages, teams, labels, on-call policies, incidents, probes, and more — as declarative infrastructure-as-code. It works against both OneUptime Cloud and self-hosted OneUptime installations.

The provider is published on the Terraform Registry: [registry.terraform.io/providers/oneuptime/oneuptime](https://registry.terraform.io/providers/oneuptime/oneuptime), and on the OpenTofu Registry: [search.opentofu.org/provider/oneuptime/oneuptime](https://search.opentofu.org/provider/oneuptime/oneuptime/latest). **[OpenTofu](/docs/terraform/opentofu) is supported and tested** — the end-to-end suite runs against both engines on every change.

## Minimal configuration

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
  # oneuptime_url defaults to https://oneuptime.com.
  # Self-hosted users: set this to your own instance URL.
  api_key = var.oneuptime_api_key
}
```

The API key must be a **project API key** created in **Project Settings > API Keys** in the OneUptime dashboard. See the [Quick Start](/docs/terraform/quick-start) for the full walkthrough.

## Documentation

| Page | What it covers |
|------|----------------|
| [Quick Start](/docs/terraform/quick-start) | Create an API key and apply your first resources in about 10 minutes |
| [Complete Guide](/docs/terraform/complete-guide) | Authentication, project structure, dependencies, data sources, state |
| [Monitor Steps](/docs/terraform/monitor-steps) | Deep dive into the `monitor_steps` nested attributes and criteria filters |
| [Examples](/docs/terraform/examples) | Copy-pasteable configurations for every major resource type |
| [Importing Resources](/docs/terraform/importing-resources) | Bring existing OneUptime resources under Terraform management |
| [Troubleshooting](/docs/terraform/troubleshooting) | Symptom-to-fix reference for the most common errors |
| [Self-Hosted Setup](/docs/terraform/self-hosted) | Instance URLs, version selection, air-gapped mirroring, TLS |
| [Registry Usage](/docs/terraform/registry) | How provider versions are published and how to choose one |
| [OpenTofu](/docs/terraform/opentofu) | Using the provider with `tofu`, and the handful of differences that matter |

## What the provider manages

Resources follow the naming pattern `oneuptime_<snake_case_resource>`. The most commonly used resources:

| Resource | Purpose |
|----------|---------|
| `oneuptime_monitor` | Website, API, ping, port, IP, SSL certificate, server, incoming request, and manual monitors |
| `oneuptime_monitor_status` | Monitor status definitions (Operational, Degraded, Offline, ...) |
| `oneuptime_monitor_group` | Group monitors for aggregate status |
| `oneuptime_status_page` | Public and private status pages |
| `oneuptime_status_page_domain` | Custom domains for status pages |
| `oneuptime_domain` | Project-level verified domains |
| `oneuptime_label` | Labels for organizing and filtering resources |
| `oneuptime_team` | Teams |
| `oneuptime_team_member` | Team membership |
| `oneuptime_on_call_policy` | On-call duty policies |
| `oneuptime_escalation_rule` | Escalation rules attached to on-call policies |
| `oneuptime_incident` / `oneuptime_incident_severity` / `oneuptime_incident_state` | Incidents and their taxonomy |
| `oneuptime_alert` / `oneuptime_alert_severity` / `oneuptime_alert_state` | Alerts and their taxonomy |
| `oneuptime_scheduled_maintenance_event` | Scheduled maintenance windows |
| `oneuptime_probe` | Custom monitoring probes |

Every resource also has a matching **data source** with the same name (for example `data "oneuptime_label"`), which looks up an existing resource by `id` or by `name`.

The full, generated per-resource schema reference lives on the [Terraform Registry documentation tab](https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs).

## How the provider models complex configuration

OneUptime resource schemas map the OneUptime API directly:

- **Scalar attributes** are plain Terraform strings, numbers, and booleans (`name`, `description`, `monitor_type`, `is_public_status_page`, ...).
- **Entity references** are ID strings (`incident_severity_id`, `monitor_id`). Arrays of references, such as `labels`, are unordered sets of ID strings — reordering them produces no diff.
- **Complex nested configuration** — most notably a monitor's `monitor_steps` — uses typed nested attributes written directly in HCL, with per-monitor-type raw-JSON escape hatches for deep telemetry query configs. See [Monitor Steps](/docs/terraform/monitor-steps).
- **Date/time attributes** are RFC3339 strings (for example `2026-08-01T02:00:00Z`). The provider treats semantically equal timestamps as equal, so server-side normalization does not cause drift.

## Versioning

Provider versions track OneUptime platform versions.

- **OneUptime Cloud**: use `version = "~> 11.0"`.
- **Self-hosted**: use the newest published provider version that is **less than or equal to** your OneUptime platform version. Do not pin an exact patch version — not every platform patch release is published to the registry. See [Self-Hosted Setup](/docs/terraform/self-hosted).

## Support

- Bugs and feature requests: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues)
- The provider source is generated from the OneUptime OpenAPI specification in the [main OneUptime repository](https://github.com/OneUptime/oneuptime); the published provider repository is read-only.
