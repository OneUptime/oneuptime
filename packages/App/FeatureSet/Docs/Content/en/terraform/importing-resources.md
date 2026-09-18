# Importing Resources

If you already run OneUptime — monitors created in the dashboard, status pages configured by hand — you do not have to recreate anything to adopt Terraform. Import brings existing resources under Terraform management without touching them.

Import works for **every OneUptime resource type that has a read endpoint**, which is all of the commonly used ones (`oneuptime_monitor`, `oneuptime_status_page`, `oneuptime_label`, `oneuptime_team`, `oneuptime_on_call_policy`, ...). A resource without a read endpoint fails import with an explicit error saying so.

## Finding a resource's ID

The import ID is the resource's ObjectID — a 24-character hex string. Two places to find it:

- **Dashboard URL.** Open the resource; the ID is the last path segment, e.g. `https://oneuptime.com/dashboard/<project-id>/monitors/68a1b2c3d4e5f6a7b8c9d0e1` → the monitor ID is `68a1b2c3d4e5f6a7b8c9d0e1`.
- **API.** List resources with your project API key; every item carries `_id`.

## Import with an import block (Terraform 1.5+, recommended)

Import blocks are declarative, reviewable in a plan, and repeatable. First write the `resource` block (it may start minimal), then the `import` block:

```hcl
resource "oneuptime_monitor" "homepage" {
  name         = "Homepage"
  description  = "Checks that the homepage responds"
  monitor_type = "Website"
}

import {
  to = oneuptime_monitor.homepage
  id = "68a1b2c3d4e5f6a7b8c9d0e1"
}
```

Then:

```bash
terraform plan
```

The plan shows `oneuptime_monitor.homepage will be imported` plus any attribute changes your configuration would make to the real resource. **Reconcile until the plan shows import with no changes** — copy the real values (name, description, type, labels) into your configuration rather than letting Terraform "correct" the live resource. Then:

```bash
terraform apply
```

After a successful apply you can delete the `import` block; it has no further effect.

### Generating configuration automatically

Terraform can draft the resource block for you:

```bash
terraform plan -generate-config-out=generated.tf
```

Write only the `import` block (no `resource` block), run the command, then review `generated.tf`, prune noisy computed attributes, and move the cleaned block into your real files.

## Import via the CLI command

The classic one-liner, available on all Terraform versions. The `resource` block must already exist in configuration:

```bash
terraform import oneuptime_monitor.homepage 68a1b2c3d4e5f6a7b8c9d0e1
```

The same pattern works for every resource type:

```bash
terraform import oneuptime_status_page.public 68a1b2c3d4e5f6a7b8c9d0e2
terraform import oneuptime_label.critical 68a1b2c3d4e5f6a7b8c9d0e3
terraform import oneuptime_team.sre 68a1b2c3d4e5f6a7b8c9d0e4
```

After each import, run `terraform plan` and reconcile the configuration until the plan is clean.

## Importing a whole project

To adopt everything in an existing project:

1. **Inventory.** List each resource type via the dashboard or API and record names and IDs. Start with building blocks (labels, teams, monitor statuses, incident severities/states), then the resources that reference them (monitors, status pages, on-call policies), then the linking resources (status page domains, escalation rules, team members).
2. **Write import blocks in bulk.** One `import {}` per resource. Terraform processes any number of them in a single plan:

```hcl
import {
  to = oneuptime_label.critical
  id = "68a1b2c3d4e5f6a7b8c9d0e3"
}

import {
  to = oneuptime_monitor.homepage
  id = "68a1b2c3d4e5f6a7b8c9d0e1"
}

import {
  to = oneuptime_monitor.checkout_api
  id = "68a1b2c3d4e5f6a7b8c9d0e5"
}
```

3. **Generate + reconcile.** Use `-generate-config-out` for the first draft, replace hardcoded cross-references with resource references (`labels = [oneuptime_label.critical.id]` instead of the raw ID) so the dependency graph is real.
4. **Verify.** `terraform plan` must end at `No changes.` before you consider the project imported.

## Caveats

- **Import does not write configuration** (unless you use `-generate-config-out`). It only creates state. The configuration is your job, and until it matches reality, `plan` will propose changes.
- **A resource without a read endpoint cannot be imported** — the provider returns an explicit error naming the resource type. Manage such resources as new creations only.
- **Sensitive server-generated values** (for example a probe's key or an incoming-request monitor's secret) are read into state during import. Protect your state accordingly.
- **Do not import a resource into two Terraform roots.** Two states both believing they own one monitor will fight each other on every apply.
- **API key scope applies.** Import reads through the same project API key — the key needs Read permission on the resource type being imported (and Update/Delete for later management).
- **`terraform destroy` deletes imported resources for real.** After import they are managed like anything else Terraform created.

## Related pages

- [Complete Guide](/docs/terraform/complete-guide) — data sources, when you only need to *reference* an existing resource
- [Troubleshooting](/docs/terraform/troubleshooting) — permission errors during import
