# Troubleshooting

Fast lookup for the errors people actually hit with the OneUptime Terraform provider, followed by detail on each.

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Provider produced inconsistent result after apply` | Old provider version that mishandled server-computed fields | Upgrade the provider (`terraform init -upgrade` within `~> 11.0`); report if it persists |
| `ProjectId required` on every operation | Master or user API key instead of a project API key | Create a key under **Project Settings > API Keys** and use that |
| Status/state `priority` or `order` drifts after apply | A number another state or status already holds is taken over, and the ones in the way step down one place — the same thing a drag in the dashboard does | Give each one a distinct, gapped value (e.g. `101`, `102`, `103`): a number nobody else holds is kept as written. Reorder Terraform-managed ones in Terraform, not by dragging them in the dashboard |
| `402` / payment-required errors | Plan limit reached (monitors, status pages, ...), or a setting your OneUptime plan does not include switched on | Upgrade the plan, reduce resource count, or leave the setting at its default |
| `403` / permission denied on one resource type | Project API key missing Create/Read/Update/Delete permission for that type | Edit the key's permissions in Project Settings > API Keys |
| `401` / authentication failed | Key revoked, expired, or wrong `ONEUPTIME_API_KEY` value | Generate a fresh project API key |
| Provider errors at `terraform plan` startup about a missing API key | No `api_key` attribute and no `ONEUPTIME_API_KEY` env var | Set one of them |
| `no matching version found for oneuptime/oneuptime` | Exact-version pin on a version that was never published | Use a pessimistic constraint like `~> 11.0` |
| Data source error: no match / more than one match | Name lookup found zero or multiple resources | Fix the name, or look up by `id` |
| A resource disappears from the state at `terraform plan`, and the next apply creates it again | The API key can no longer read it: a read of a record the key may not read answers `404`, as a deleted one does, and Terraform drops a resource it gets `404` for | Give the key read access to every resource it manages, then `terraform import` the dropped one instead of applying - see below |
| `references records that are not in this project` | An ID copied from another project's configuration, or one of a resource that has been deleted | Use the ID of your project's own record — see below |
| `Invalid Configuration for Read-Only Attribute` on `created_by_user_id`, another `..._by_user_id` or `archived_at` | OneUptime records who created or archived a record, and when, so the provider offers these for reading only | Remove the attribute from the configuration — see below |
| `x509: certificate signed by unknown authority` (self-hosted) | Instance serves a TLS certificate Terraform's host does not trust | Install the CA on the machine running Terraform |
| Connection refused / 404s on every API call (self-hosted) | Wrong `oneuptime_url` (path suffix, wrong port, http vs https) | Set `oneuptime_url` to the bare instance origin, e.g. `https://oneuptime.example.com` |
| Monitor JSON from the dashboard rejected | Dashboard-exported JSON pasted as Terraform configuration | Rebuild as HCL — see below |
| `monitor_steps` rejects an empty list, map, or string | `[]`, `{}`, or `""` passed as a placeholder | Omit the attribute entirely — absent means unset |

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

- **402 Payment Required on every request** — `API keys need the Growth plan...`: on OneUptime Cloud, the project is below **Growth**, and a project's API keys - the provider's included - stop working below it. Every call the provider makes is refused, `terraform plan` too, until the project is back on Growth; then the same key works again, with nothing to change in your configuration. Upgrade in **Project Settings** > **Billing**, or manage the project in the dashboard meanwhile. See [API keys and SCIM below their plan](/docs/api-reference/api-reference#api-keys-and-scim-below-their-plan).
- **402 Payment Required** — you hit a resource limit of your OneUptime plan (for example the monitor cap on a free tier), or the configuration switches on a setting your plan does not include (a private status page, email reports, a public dashboard, an IP allowlist...), whether `terraform apply` creates the resource with it or changes it later. Terraform surfaces the API error as-is. Either upgrade the plan in Project Settings > Billing, or trim the configuration. Putting such a setting back to its default — switching the feature off — works on every plan, so a configuration that turns paid features off applies after a trial ends or the plan goes down. The same holds for the resources your plan sells that a project keeps after it goes down - SSO providers, SCIM connections, API keys, on-call schedules, and Slack and Microsoft Teams rules and summaries: below the plan (while the project is still on Growth, which the provider's own API key needs), the ones the project already has can still be read (so `terraform plan` and `import` work), deleted (so removing them from the configuration, or `terraform destroy`, applies), and switched off where they have an `is_enabled` attribute. Creating them, changing them or switching them on again still answers 402. Other resources your plan sells, such as templates, custom fields and monitor groups, still need the plan to be read, so a plan that refreshes them answers 402; they can still be deleted, for example with `terraform destroy -refresh=false`. An API key's permissions are not deleted one by one below Growth, since deleting a block permission would give the key more access: run `terraform state rm` on the permission resources, then destroy the key, and its permissions go with it.
- **403 Forbidden on specific resource types** — the project API key lacks permission for that type. Keys have per-resource-type permissions; a key that can manage Monitors cannot create Status Pages unless granted. Edit the key in **Project Settings > API Keys** and add Create/Read/Update/Delete for the missing type. Import needs Read at minimum.

## "references records that are not in this project"

Every ID a resource names — a monitor's labels, a status page group's status page, a network device's site, an escalation rule's teams — must be a record of the project your API key belongs to. An ID of another project's record and an ID that does not exist get the same answer, which names the field and the ID:

```text
This network device references records that are not in this project: Network Site "…". Please pick values from this project and try again.
```

It usually means an ID was copied from another project's configuration or state, or the record was deleted outside Terraform. Refer to the record through its resource or a data source in the same configuration (`oneuptime_label.critical.id`) instead of a literal ID, and apply again. Someone named as a user must be a member of the project.

## A resource leaves the state, and the next apply creates it again

A read by ID answers `404` both for a record that does not exist and for one the API key may not read: the API says nothing about a record it does not show you. Terraform takes a `404` at refresh for a resource deleted outside Terraform. It drops the resource from the state, and the next `terraform apply` creates it again, beside the one that is still there.

That happens when the key that manages a resource can no longer read it: its read permission was limited to labels the resource does not carry, or to the resources its teams own, or a block takes the resource away - or the resource's labels or owners changed.

**Before you plan:**

- Give the key a read permission for every resource type it manages that reaches every resource it manages: at **All** scope, or limited to labels those resources carry. A key's update and delete permissions reach only what it may read.
- Read the plan before you apply it: a resource planned for creation that you did not add is one the key can no longer read.

**When the state has lost a resource already:** give the key its read access back, then [import](/docs/terraform/importing-resources) the resource instead of applying, so Terraform adopts the one that exists rather than creating a second one. If a copy was created already, delete the one you do not want.

## "Invalid Configuration for Read-Only Attribute" on `created_by_user_id`

Who created a record — and who archived, resolved or acknowledged it — is recorded by OneUptime from the request: the person signed in, and nobody for a request made with an API key, which is how Terraform signs in. So `created_by_user_id`, and every other attribute ending in `_by_user_id`, is read-only: you can read it from a resource or a data source, but not set it. The same goes for `archived_at`: setting `is_archived` records when the resource was archived, and applying it again unchanged keeps that time. A configuration that sets one of these stops at `terraform plan` with this error. Remove the attribute from the resource block; nothing else about the resource changes.

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
- For a monitor's steps specifically: translate the exported `monitorSteps` object into the typed `monitor_steps` nested attributes (see [Monitor Steps](/docs/terraform/monitor-steps)) — drop the `{_type, value}` envelopes, convert camelCase keys to snake_case, and delete all `id` fields.
- To adopt the existing resource rather than recreate it, use [import](/docs/terraform/importing-resources) and let `terraform plan -generate-config-out` draft the HCL.

## Still stuck?

Open an issue at [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues) with the provider version (`terraform version` prints it after init), the resource block, and the exact error text. The provider is generated from the OneUptime codebase, so issues are tracked in the main repository.
