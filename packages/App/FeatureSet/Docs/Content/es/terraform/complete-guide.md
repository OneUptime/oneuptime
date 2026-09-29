# Complete Guide

This guide covers everything beyond the first apply: authentication patterns, how to structure a OneUptime Terraform project, resource dependencies, data sources, state management, and upgrades.

If you have never used the provider, start with the [Quick Start](/docs/terraform/quick-start).

## Provider configuration

The provider block accepts two attributes:

| Attribute | Required | Environment variable | Default |
|-----------|----------|----------------------|---------|
| `api_key` | No (falls back to env var) | `ONEUPTIME_API_KEY` | — |
| `oneuptime_url` | No | `ONEUPTIME_URL` | `https://oneuptime.com` |

If no API key is available from either the provider block or the environment, the provider fails at configure time with an explicit error — before any plan or apply work happens.

The key must be a **project API key** (Ajustes del proyecto > Claves API), with Create/Read/Update/Delete permission on the resource types your configuration manages. Master keys and user keys do not work — see [Troubleshooting](/docs/terraform/troubleshooting).

### Option 1: Environment variables (recommended)

Keep credentials out of your configuration entirely:

```bash
export ONEUPTIME_API_KEY="your-project-api-key"
# Only needed for self-hosted instances:
export ONEUPTIME_URL="https://oneuptime.example.com"
```

```hcl
provider "oneuptime" {}
```

### Option 2: Variables with a tfvars file

```hcl
variable "oneuptime_api_key" {
  description = "OneUptime project API key"
  type        = string
  sensitive   = true
}

provider "oneuptime" {
  api_key = var.oneuptime_api_key
}
```

Put the value in `terraform.tfvars` (and add that file to `.gitignore`):

```hcl
oneuptime_api_key = "your-project-api-key"
```

### Option 3: CI/CD secrets

In CI, inject the key as a masked environment variable. GitHub Actions example:

```yaml
env:
  ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
steps:
  - uses: hashicorp/setup-terraform@v3
  - run: terraform init
  - run: terraform plan -input=false
  - run: terraform apply -auto-approve -input=false
```

The same pattern works in GitLab CI (masked variables), CircleCI (contexts), and Terraform Cloud (environment variables on the workspace).

## Project structure

A layout that works well for OneUptime configurations:

```
oneuptime/
├── main.tf          # terraform {} and provider {} blocks
├── variables.tf     # input variables
├── outputs.tf       # exported IDs
├── labels.tf        # labels, teams — shared building blocks
├── monitors.tf      # monitors and monitor statuses
├── status-pages.tf  # status pages and domains
├── on-call.tf       # on-call policies and escalation rules
└── environments/
    ├── production.tfvars
    └── staging.tfvars
```

Two conventions that pay off:

- **One Terraform root per OneUptime project.** API keys are project-scoped, so a root module maps naturally to one project. For multiple projects, use separate root modules (or provider aliases with one key each).
- **Define shared building blocks (labels, teams, monitor statuses) once** in their own file and reference them by resource address everywhere else.

## Resource dependencies

Terraform infers dependencies from references. A typical graph — labels and teams feeding monitors, which feed a status page:

```hcl
resource "oneuptime_label" "payments" {
  name        = "payments"
  description = "Payment infrastructure"
  color       = "#2ecc71"
}

resource "oneuptime_team" "payments_oncall" {
  name        = "Payments On-Call"
  description = "Owns payment service availability"
}

resource "oneuptime_monitor" "checkout_api" {
  name         = "Checkout API"
  description  = "Availability of the checkout API"
  monitor_type = "API"
  labels       = [oneuptime_label.payments.id]
}

resource "oneuptime_status_page" "payments" {
  name                     = "Payments Status"
  description              = "Customer-facing payments status"
  page_title               = "Payments Status"
  page_description         = "Live status of payment processing"
  is_public_status_page    = true
  enable_email_subscribers = true
  enable_sms_subscribers   = false
  labels                   = [oneuptime_label.payments.id]
}
```

Because `oneuptime_monitor.checkout_api` references `oneuptime_label.payments.id`, Terraform creates the label first and destroys it last. Explicit `depends_on` is rarely needed — only add it when there is a real ordering requirement without an attribute reference.

Attributes like `labels` are **unordered sets of ID strings**: changing the order of entries produces no diff.

## Data sources

Every resource has a matching data source with the same name. Use data sources to reference resources that are *not* managed by this configuration — created in the dashboard, or owned by another Terraform root.

Look up by `name`:

```hcl
data "oneuptime_label" "critical" {
  name = "critical"
}

resource "oneuptime_monitor" "db" {
  name         = "Database Health"
  description  = "Managed here, but reuses a dashboard-created label"
  monitor_type = "Manual"
  labels       = [data.oneuptime_label.critical.id]
}
```

Or look up by `id`:

```hcl
data "oneuptime_status_page" "main" {
  id = "5f8a1b2c3d4e5f6a7b8c9d0e"
}
```

Lookup rules:

- Provide `id` **or** `name`.
- If nothing matches, the data source returns an error (fix the name, or create the resource).
- If more than one resource matches a `name`, the data source also errors — names used for lookups must be unique. Look up by `id` instead.

> **Note:** If you want to *manage* an existing resource rather than just reference it, import it instead — see [Importing Resources](/docs/terraform/importing-resources).

## State management

Terraform state for OneUptime configurations contains resource IDs and attribute values — including anything sensitive you set. Treat it accordingly:

- **Use a remote backend** for anything beyond a personal experiment, so state is shared, locked, and not sitting in a laptop directory. Any [standard backend](https://developer.hashicorp.com/terraform/language/backend) works — S3 + DynamoDB, Terraform Cloud, azurerm, GCS:

```hcl
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "oneuptime/production.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
```

- **Never edit state by hand.** Use `terraform state mv` / `terraform state rm` if you need surgery.
- **Never commit `terraform.tfstate` or `*.tfvars` with secrets** to version control.

## Timestamps and drift

Date/time attributes (for example `starts_at` / `ends_at` on `oneuptime_scheduled_maintenance_event`, or computed `created_at` fields) are RFC3339 strings. The provider compares timestamps semantically: `2026-08-01T02:00:00Z` and the server-normalized form of the same instant are treated as equal, so timestamp normalization does not produce spurious diffs.

When you generate timestamps with functions like `timestamp()` or `timeadd()`, the *generated value* changes on every run — that is a Terraform behavior, not a provider one. Either use static values or ignore changes after creation:

```hcl
resource "oneuptime_scheduled_maintenance_event" "db_upgrade" {
  title       = "Database upgrade"
  description = "Planned PostgreSQL upgrade"
  starts_at   = "2026-08-01T02:00:00Z"
  ends_at     = "2026-08-01T04:00:00Z"
}
```

## Upgrading the provider

1. Read the release notes on the [registry page](https://registry.terraform.io/providers/oneuptime/oneuptime) or [GitHub releases](https://github.com/OneUptime/terraform-provider-oneuptime/releases).
2. Raise the version constraint (for example `~> 11.0` already allows all 11.x releases; moving to a new major requires editing the constraint).
3. Run `terraform init -upgrade` to fetch the new version.
4. Run `terraform plan` and confirm the plan is empty (or contains only changes you expect) before applying.

Self-hosted installations must keep the provider version at or below the platform version — upgrade OneUptime first, then the provider. See [Self-Hosted Setup](/docs/terraform/self-hosted).

## Further reading

- [Examples](/docs/terraform/examples) — real configurations for each resource type
- [Monitor Steps](/docs/terraform/monitor-steps) — the `monitor_steps` JSON schema in depth
- [Importing Resources](/docs/terraform/importing-resources) — adopting existing resources
- [Troubleshooting](/docs/terraform/troubleshooting) — common errors and fixes
