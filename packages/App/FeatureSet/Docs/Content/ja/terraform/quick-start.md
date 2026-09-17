# Quick Start

This guide takes you from nothing to managed OneUptime resources in about 10 minutes: create an API key, configure the provider, and apply a label, an HTTP monitor, and a status page.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) 1.5 or later
- A OneUptime account with a project ([oneuptime.com](https://oneuptime.com) or your self-hosted instance)

## Step 1: Create a project API key

The provider authenticates with a **project-scoped API key**. In the OneUptime dashboard:

1. Select your project.
2. Go to **プロジェクト設定** > **API キー**.
3. Click **Create API Key**.
4. Give it a name (for example `terraform`) and an expiry.
5. Grant permissions. Terraform needs **Create**, **Read**, **Update (Edit)**, and **Delete** on every resource type you plan to manage — for this guide: Label, Monitor, and Status Page.
6. Copy the generated key.

> **Warning:** Do not use a user key or a self-hosted master API key. Master keys are not scoped to a project, and API calls made with them fail with `ProjectId required` errors. Only project API keys work with the Terraform provider.

Export the key as an environment variable so it never lands in your Terraform files:

```bash
export ONEUPTIME_API_KEY="your-project-api-key"
```

## Step 2: Configure the provider

Create a working directory with a `main.tf`:

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
  # api_key is read from the ONEUPTIME_API_KEY environment variable.
  # oneuptime_url defaults to https://oneuptime.com — set it only if self-hosted:
  # oneuptime_url = "https://oneuptime.example.com"
}
```

Self-hosted users: set `oneuptime_url` to your instance URL and check the version guidance in [Self-Hosted Setup](/docs/terraform/self-hosted) before pinning a provider version.

## Step 3: Define your first resources

Append the following to `main.tf`. It creates a label, a website monitor for your homepage, and a private status page:

```hcl
resource "oneuptime_label" "critical" {
  name        = "critical"
  description = "Resources that page on-call when down"
  color       = "#FF5733"
}

resource "oneuptime_monitor" "homepage" {
  name         = "Homepage"
  description  = "Checks that the homepage responds"
  monitor_type = "Website"
  labels       = [oneuptime_label.critical.id]
}

resource "oneuptime_status_page" "internal" {
  name                     = "Internal Status"
  description              = "Status page for internal services"
  page_title               = "Service Status"
  page_description         = "Live status of our services"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

output "monitor_id" {
  value = oneuptime_monitor.homepage.id
}
```

A `Website` monitor created without explicit `monitor_steps` gets sensible server-side defaults. To control the URL, request type, and up/down criteria yourself, pass `monitor_steps` as JSON — that is covered in [Monitor Steps](/docs/terraform/monitor-steps).

## Step 4: Init, plan, apply

```bash
terraform init
terraform plan
terraform apply
```

Review the plan (3 resources to add) and confirm with `yes`. Apply completes in a few seconds and prints the monitor ID.

## Step 5: Verify in the dashboard

In the OneUptime dashboard:

- **モニター** — the `Homepage` monitor is listed with the `critical` label.
- **ステータスページ** — `Internal Status` appears.
- **プロジェクト設定 > ラベル** — the `critical` label exists with the color you set.

Run `terraform plan` again: it reports `No changes.` Server-computed fields (slugs, current status, default monitoring steps) do not cause drift.

## Step 6: Clean up

If this was a test drive, remove everything the configuration created:

```bash
terraform destroy
```

## Next steps

- [Complete Guide](/docs/terraform/complete-guide) — authentication options, project layout, dependencies, data sources, remote state
- [Examples](/docs/terraform/examples) — configurations for every major resource type
- [Monitor Steps](/docs/terraform/monitor-steps) — take control of what your monitors check
- [Importing Resources](/docs/terraform/importing-resources) — adopt resources you already created in the dashboard
