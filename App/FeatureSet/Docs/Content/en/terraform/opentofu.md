# OpenTofu

The OneUptime provider works with [OpenTofu](https://opentofu.org) as well as Terraform, and is published to the [OpenTofu Registry](https://search.opentofu.org/provider/oneuptime/oneuptime/latest).

This is a tested path rather than an assumption inherited from Terraform compatibility: the provider's end-to-end suite runs the same fixtures against both engines on every pull request, and a break under `tofu` fails the build.

## Using the provider with OpenTofu

Nothing in your configuration changes. Declare the provider exactly as you would for Terraform and drive it with `tofu`:

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
  # api_key is read from ONEUPTIME_API_KEY.
  # oneuptime_url defaults to https://oneuptime.com — set it only if self-hosted.
}
```

```bash
export ONEUPTIME_API_KEY="your-project-api-key"
tofu init
tofu plan
tofu apply
```

The API key must be a **project** API key, exactly as described in the [Quick Start](/docs/terraform/quick-start). Everything in the [Complete Guide](/docs/terraform/complete-guide), [Monitor Steps](/docs/terraform/monitor-steps), [Examples](/docs/terraform/examples), and [Importing Resources](/docs/terraform/importing-resources) applies unchanged — substitute `tofu` for `terraform` on the command line.

## Why the source address does not name a registry

`source = "oneuptime/oneuptime"` carries no hostname, so each engine resolves it against its own default registry: `registry.opentofu.org` under OpenTofu, `registry.terraform.io` under Terraform. The provider is published to both, so one source address covers both engines.

Writing `source = "registry.terraform.io/oneuptime/oneuptime"` pins the configuration to the Terraform Registry and makes it fail under OpenTofu in air-gapped or registry-restricted environments. Leave the hostname off.

## Differences worth knowing

| Topic | Behaviour |
|-------|-----------|
| The `terraform` block | Stays `terraform`. It is a language keyword, not a reference to the Terraform CLI, and OpenTofu reads it as-is. |
| `.tf` vs `.tofu` files | `.tf` works under both. OpenTofu additionally reads `.tofu` files and ignores any `.tf` file that has a `.tofu` sibling — an escape hatch for OpenTofu-only configuration, at the cost of Terraform compatibility. |
| `required_version` | OpenTofu's version series starts at 1.6.0, so a constraint written for Terraform (`>= 1.5.0`) is satisfied by every OpenTofu release. |
| Lock files | Both write `.terraform.lock.hcl`, but a lock file records the registry it resolved against — one engine's lock file does not satisfy the other. Commit the one your CI uses, and run `tofu init -upgrade` after switching. |
| State files | Identical format and filenames. Existing state moves between engines without conversion. |
| CLI config file | OpenTofu reads `~/.tofurc` (falling back to `~/.terraformrc`); both engines honour the `TF_CLI_CONFIG_FILE` environment variable. |
| Variables | OpenTofu reads `TF_VAR_*` as well as `TOFU_VAR_*`, so existing tooling and CI keep working. |

## Version selection

Provider versions track OneUptime platform versions, and the rule is the same under either engine:

- **OneUptime Cloud**: `version = "~> 11.0"`.
- **Self-hosted**: the newest published provider version **less than or equal to** your platform version. See [Self-Hosted Setup](/docs/terraform/self-hosted).

Do not pin an exact patch version — not every platform patch is published. The full explanation is in [Registry Usage](/docs/terraform/registry); it applies to the OpenTofu Registry too, since both registries serve the same releases.

## Examples and a reusable module

Runnable OpenTofu configurations live in [`Examples/opentofu/`](https://github.com/OneUptime/oneuptime/tree/master/Examples/opentofu) in the OneUptime repository:

| Directory | What it is |
|-----------|------------|
| `quickstart/` | Smallest useful configuration — one label, one monitor, one status page |
| `monitoring-and-incident-response/` | Two services wired up through the module below |
| `modules/monitoring-and-incident-response/` | Reusable module: monitors, an on-call rotation, and a status page |

The module gives a service HTTP monitors, an on-call policy that gets paged when they fail, and a status page listing them:

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

It is sourced from the published provider repository rather than the main OneUptime repository so `tofu init` clones a small repo instead of the whole monorepo. Pin `ref` to a published provider tag — the provider repository is regenerated on every release. The module works under Terraform too; it is engine-agnostic HCL.

It deliberately does not create monitor statuses or incident severities. OneUptime seeds those per project, and a module instantiated once per service would add a duplicate set on every call. It looks them up by name instead — override `operational_monitor_status_name`, `offline_monitor_status_name`, or `incident_severity_name` if your project renamed them.

## Air-gapped environments

`tofu providers mirror` mirrors the provider internally, the same way `terraform providers mirror` does. The walkthrough in [Self-Hosted Setup](/docs/terraform/self-hosted) applies with `tofu` substituted for `terraform`.

## Support

- Bugs and feature requests, including anything OpenTofu-specific: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues)
- The provider is generated from the OneUptime OpenAPI specification in the [main OneUptime repository](https://github.com/OneUptime/oneuptime); the published provider repository is read-only build output.
