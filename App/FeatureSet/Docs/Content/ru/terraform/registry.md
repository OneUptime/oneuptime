# Registry Usage

The OneUptime provider is distributed through the public Terraform Registry at [registry.terraform.io/providers/oneuptime/oneuptime](https://registry.terraform.io/providers/oneuptime/oneuptime). This page explains what is published there and how versioning works.

## What's on the registry

- **The provider binary** for all common platforms (Linux, macOS, Windows; amd64 and arm64). `terraform init` downloads and verifies it automatically — there is nothing to install by hand.
- **Generated reference documentation** for every resource and data source — the complete attribute list per type, on the registry page's *Documentation* tab. Use it alongside these guides: this documentation explains workflows; the registry docs are the per-attribute reference.
- **The version history**, one entry per published release.

Declare the provider like any registry provider:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 11.0"
    }
  }
}
```

`terraform init` records the exact selected version and its checksums in `.terraform.lock.hcl` — commit that file, it is what makes CI runs reproducible.

## How versioning works

Provider versions **track OneUptime platform versions**: provider 11.x is generated from and tested against OneUptime 11.x. This has two practical consequences:

1. **Cloud users** always run the latest platform, so the newest provider is always correct:

```hcl
version = "~> 11.0"
```

2. **Self-hosted users** should use the newest published provider version that is **less than or equal to** their OneUptime platform version. A newer provider may reference API fields your older platform does not have.

**Version gaps are normal.** The provider is regenerated and published per meaningful change, not for every platform patch release — so do not pin exact patch versions (`= 11.0.7` may simply not exist on the registry, and `terraform init` will fail with `no matching version found`). Pessimistic constraints (`~> 11.0`) always resolve to a real published version. More on the self-hosted selection rule in [Self-Hosted Setup](/docs/terraform/self-hosted).

## Checking versions and release notes

- Registry version list: [registry.terraform.io/providers/oneuptime/oneuptime/versions](https://registry.terraform.io/providers/oneuptime/oneuptime/versions)
- Release notes: [github.com/OneUptime/terraform-provider-oneuptime/releases](https://github.com/OneUptime/terraform-provider-oneuptime/releases)
- Platform releases (which drive provider versions): [github.com/OneUptime/oneuptime/releases](https://github.com/OneUptime/oneuptime/releases)

To move to a newer version within your constraint:

```bash
terraform init -upgrade
```

This re-resolves the constraint, updates `.terraform.lock.hcl`, and prints the selected version. Follow with `terraform plan` to confirm nothing unexpected changed.

## Where the code lives

The provider is **generated from the OneUptime OpenAPI specification** in the main [OneUptime repository](https://github.com/OneUptime/oneuptime). The published provider repository is read-only build output. File issues — including documentation issues — against the main repository: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues).

## Air-gapped environments

If your Terraform hosts cannot reach the public registry, mirror the provider internally with `terraform providers mirror` — walkthrough in [Self-Hosted Setup](/docs/terraform/self-hosted).
