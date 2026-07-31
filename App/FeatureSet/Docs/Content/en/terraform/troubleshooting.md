# Troubleshooting

Fast lookup for the errors people actually hit with the OneUptime Terraform provider, followed by detail on each.

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Provider produced inconsistent result after apply` | Old provider version that mishandled server-computed fields | Upgrade the provider (`terraform init -upgrade` within `~> 11.0`); report if it persists |
| `ProjectId required` on every operation | Master or user API key instead of a project API key | Create a key under **Project Settings > API Keys** and use that |
| `402` / payment-required errors | Plan limit reached (monitors, status pages, ...) on your OneUptime plan | Upgrade the plan or reduce resource count |
| `403` / permission denied on one resource type | Project API key missing Create/Read/Update/Delete permission for that type | Edit the key's permissions in Project Settings > API Keys |
| `401` / authentication failed | Key revoked, expired, or wrong `ONEUPTIME_API_KEY` value | Generate a fresh project API key |
| Provider errors at `terraform plan` startup about a missing API key | No `api_key` attribute and no `ONEUPTIME_API_KEY` env var | Set one of them |
| `no matching version found for oneuptime/oneuptime` | Exact-version pin on a version that was never published | Use a pessimistic constraint like `~> 11.0` |
| Data source error: no match / more than one match | Name lookup found zero or multiple resources | Fix the name, or look up by `id` |
| `x509: certificate signed by unknown authority` (self-hosted) | Instance serves a TLS certificate Terraform's host does not trust | Install the CA on the machine running Terraform |
| Connection refused / 404s on every API call (self-hosted) | Wrong `oneuptime_url` (path suffix, wrong port, http vs https) | Set `oneuptime_url` to the bare instance origin, e.g. `https://oneuptime.example.com` |
| Monitor JSON from the dashboard rejected | Dashboard-exported JSON pasted as Terraform configuration | Rebuild as HCL with `jsonencode()` — see below |
| Every apply rewrites `monitor_steps` | Random/time-based ids inside the steps JSON | Use fixed literal `id` values |

## "Provider produced inconsistent result after apply"

This error means Terraform detected the provider returning different values than it planned. Historic provider versions produced it on server-computed fields — default `monitor_steps` injected by the server, normalized timestamps, wrapped values like `probe_version`. Current 11.x providers handle all of these: server defaults are accepted without drift, timestamps are compared semantically, and label arrays are unordered sets.

**Fix:**

1. Make sure you are on a current provider: `version = "~> 11.0"` then `terraform init -upgrade`.
2. Re-run the apply.

If a current provider still produces the error, that is a provider bug worth reporting. Open an issue at [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues) and include: the provider version, the resource type, the minimal `resource` block that reproduces it, and the full error output (it names the exact attribute that flip-flopped). That attribute name is the single most useful thing you can provide.

## "ProjectId required"

OneUptime has two families of API credentials:

- **Project API keys** — created in **Project Settings > API Keys**, scoped to one project. This is what the Terraform provider requires.
- **Master keys** (self-hosted) and user-level tokens — not scoped to any project.

The provider derives the project from the key itself. A master key carries no project, so every resource call fails with `ProjectId required`. Create a project API key, grant it Create/Read/Update/Delete on the resource types you manage, and put it in `ONEUPTIME_API_KEY`.

## 402 and permission errors

- **402 Payment Required** — you hit a resource limit of your OneUptime plan (for example the monitor cap on a free tier). Terraform surfaces the API error as-is. Either upgrade the plan in Project Settings > Billing, or trim the configuration.
- **403 Forbidden on specific resource types** — the project API key lacks permission for that type. Keys have per-resource-type permissions; a key that can manage Monitors cannot create Status Pages unless granted. Edit the key in **Project Settings > API Keys** and add Create/Read/Update/Delete for the missing type. Import needs Read at minimum.

## "no matching version found" from the registry

Provider versions track OneUptime platform versions, and **not every platform patch release is published** to the registry. Exact pins like `version = "= 11.0.3"` therefore fail whenever that precise patch was skipped.

Use a pessimistic constraint and let Terraform select the newest published match:

```hcl
version = "~> 11.0"
```

Self-hosted users who must stay at or below their platform version can bound the range instead of pinning a patch — see [Self-Hosted Setup](/docs/terraform/self-hosted).

## Self-hosted: URL and TLS issues

- `oneuptime_url` must be the **origin of your instance only** — scheme and host, no `/api` suffix, no dashboard path: `https://oneuptime.example.com`. The provider appends API paths itself.
- The same value can come from the `ONEUPTIME_URL` environment variable.
- If your instance uses a private CA, Terraform (a Go program) reads the **system trust store** of the machine running it. Install the CA certificate on that machine (e.g. `/usr/local/share/ca-certificates/` + `update-ca-certificates` on Debian/Ubuntu). There is no provider attribute for skipping TLS verification — fix trust, don't disable it.
- Plain-HTTP instances work for lab setups (`oneuptime_url = "http://oneuptime.lab.internal"`), but put TLS in front of anything real: the API key travels with every request.

## Dashboard-export JSON is not Terraform configuration

The dashboard can show or export resources as JSON. That JSON is an **API payload**, not HCL, and pasting it into a `.tf` file does not work — Terraform attribute names are snake_case, values are typed differently, and most exported fields are server-computed.

What to do instead:

- Rebuild the resource as HCL, using the [Examples](/docs/terraform/examples) as templates.
- For a monitor's steps specifically: the exported `monitorSteps` object *is* the right shape for the `monitor_steps` attribute — translate it into an HCL object inside `jsonencode()` (see [Monitor Steps](/docs/terraform/monitor-steps)), keeping the camelCase keys and `{_type, value}` envelopes.
- To adopt the existing resource rather than recreate it, use [import](/docs/terraform/importing-resources) and let `terraform plan -generate-config-out` draft the HCL.

## Still stuck?

Open an issue at [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues) with the provider version (`terraform version` prints it after init), the resource block, and the exact error text. The provider is generated from the OneUptime codebase, so issues are tracked in the main repository.
