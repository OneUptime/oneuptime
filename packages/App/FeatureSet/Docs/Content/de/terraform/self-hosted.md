# Self-Hosted Setup

Everything specific to using the Terraform provider against a self-hosted OneUptime installation: pointing the provider at your instance, choosing the right provider version, mirroring the provider for air-gapped networks, and TLS.

The provider itself is identical for cloud and self-hosted — same resources, same attributes. Only the URL and the version-selection rule differ.

## Point the provider at your instance

Set `oneuptime_url` to your instance's origin — scheme and host only, no `/api` suffix, no path:

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
  oneuptime_url = "https://oneuptime.example.com"
  # api_key from ONEUPTIME_API_KEY, or set explicitly:
  # api_key = var.oneuptime_api_key
}
```

Both settings are also available as environment variables, which keeps configuration portable between cloud and self-hosted roots:

```bash
export ONEUPTIME_URL="https://oneuptime.example.com"
export ONEUPTIME_API_KEY="your-project-api-key"
```

The API key is a **project API key** created in your instance's dashboard under **Projekteinstellungen > API-Schlüssel** — exactly as on cloud. Self-hosted master keys do not work and fail with `ProjectId required` (see [Troubleshooting](/docs/terraform/troubleshooting)).

## Choosing a provider version

Provider versions track OneUptime platform versions. The rule for self-hosted:

> Use the **newest published provider version that is less than or equal to your OneUptime platform version.**

- Never use a provider *newer* than your platform — it may drive API fields your installation does not have yet.
- Do **not** pin an exact patch version. Not every platform patch is published to the registry, so `= 11.0.7`-style pins routinely fail with `no matching version found`.

Express the rule as a bounded constraint. For example, if your installation runs platform release `11.2.x`:

```hcl
version = ">= 11.0, <= 11.2"
```

Terraform then selects the newest published 11.x release that does not exceed 11.2 — automatically skipping any unpublished patches. If you track platform majors loosely and stay reasonably current, `~> 11.0` is fine too.

Find your platform version in the OneUptime admin dashboard or from your Helm/Docker Compose deployment values. Published provider versions are listed at [registry.terraform.io/providers/oneuptime/oneuptime/versions](https://registry.terraform.io/providers/oneuptime/oneuptime/versions).

**Upgrade order:** upgrade the OneUptime platform first, then raise the provider constraint and run `terraform init -upgrade`.

## Air-gapped installations: mirroring the provider

If the hosts running Terraform cannot reach `registry.terraform.io`, mirror the provider into your network. On a machine with internet access:

```bash
mkdir -p /srv/terraform-mirror
cd /path/to/your/terraform/config   # a directory whose required_providers includes oneuptime
terraform providers mirror /srv/terraform-mirror
```

This downloads the provider releases matching your constraints, for all platforms, into a directory layout Terraform understands. Transfer the directory inside, serve it (plain HTTPS file server) or share it as a filesystem path, and point Terraform at it in the CLI configuration (`~/.terraformrc`):

```hcl
provider_installation {
  filesystem_mirror {
    path    = "/srv/terraform-mirror"
    include = ["registry.terraform.io/oneuptime/oneuptime"]
  }
  direct {
    exclude = ["registry.terraform.io/oneuptime/oneuptime"]
  }
}
```

`terraform init` now installs the OneUptime provider from the mirror and everything else from wherever it normally would (drop the `direct` block to force mirror-only). Re-run the `mirror` command whenever you raise your version constraint.

## TLS notes

- Terraform is a Go program: it validates your instance's certificate against the **system trust store** of the machine running Terraform. If your instance uses a certificate from a private CA, install that CA certificate on every machine (and CI runner) that runs Terraform. On Debian/Ubuntu: copy the CA to `/usr/local/share/ca-certificates/` and run `update-ca-certificates`.
- There is deliberately no "skip TLS verification" attribute. If you see `x509: certificate signed by unknown authority`, fix trust — don't try to disable it.
- Plain HTTP works for lab environments (`oneuptime_url = "http://oneuptime.lab.internal"`), but the project API key is sent with every request; use TLS for anything beyond a throwaway lab.
- If OneUptime sits behind a reverse proxy or ingress, `oneuptime_url` is the *external* origin the proxy exposes. Make sure the proxy forwards all `/api` paths unmodified.

## Related pages

- [Registry Usage](/docs/terraform/registry) — how versions are published, release notes
- [Troubleshooting](/docs/terraform/troubleshooting) — URL, TLS, and key errors in detail
- [Quick Start](/docs/terraform/quick-start) — first apply, works identically self-hosted
