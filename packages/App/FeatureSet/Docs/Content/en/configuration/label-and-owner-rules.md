# Label and Owner Rules

Label rules and owner rules organize your resources for you. A **label rule** attaches labels to every new resource that matches it, and an **owner rule** adds owner users and teams to it — so a new database incident is labelled _Database_ and owned by the database team without anyone having to remember.

Every product with labels and owners has both, under its **Settings** (on Incidents, Alerts and Scheduled Maintenance, under **Rules**): monitors, incidents and incident episodes, alerts and alert episodes, scheduled maintenance events, status pages, services, hosts, Kubernetes clusters, Docker hosts, Docker Swarm clusters, Podman hosts, Proxmox clusters, VMware vCenters, Ceph clusters, databases, queues, IoT fleets, serverless functions, cloud resources, RUM applications, dashboards, on-call policies, on-call schedules, incoming call policies, workflows, runbooks, network devices and SLOs. The Incidents and Alerts pages have an **Incident Rules** (or **Alert Rules**) tab and an **Episode Rules** tab.

## Creating a rule

Every label and owner rule is created the same way, in two steps.

1. **Match** — the conditions a resource must meet. Add one or more conditions; with two or more, choose **Match all** or **Match any**. A rule with no conditions matches every new resource.
2. **Labels** (or **Owners**) — what the rule adds:
   - **Labels to Add** — the labels to attach. On an owner rule, **Owners**: **Add owner** opens one list of people and teams.
   - **Name** — filled in from what you pick (_Add Production_, _Add Platform as owners_) and following your picks until you type a name of your own.
   - **More fields** — the optional **Description** and, on an owner rule, **Notify Owners**, which is on by default: the owners a rule adds get the same "you were added as an owner" notification as an owner added by hand. Turn it off to add owners silently.

A new rule has to add something: at least one label, or at least one owner. It starts enabled; to pause it without deleting it, switch **Enabled** off on its edit form. The list shows a green **Enabled** or red **Disabled** pill for each rule.

## Inheriting labels and owners

Incident, alert and scheduled maintenance rules can also hand on what the resources an event touches carry. Under **Labels to Add** (or **Owners**), the folded **Inherit Labels** (or **Inherit Owners**) section holds six switches:

- **Inherit Labels From Monitors** — every label of the incident's monitors is attached to the incident too. An alert has one monitor, so on an alert rule the switch is **Inherit Labels From Monitor**.
- **Inherit Labels From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** and **… From Services** do the same for those resources.

Owner rules have the same six for owners (**Inherit Owners From Monitors** and so on). While no switch is on, the folded section says what it is for; on a rule that inherits, it opens on its own. A rule that inherits can leave **Labels to Add** (or **Owners**) empty: it adds what it inherits. Episode rules have no inherit switches.

## Editing a rule

A rule's edit form has the same two steps and adds the **Enabled** switch. It does not insist on what the rule adds: rules saved before the form asked — through the API, Terraform, an import or the old form — may add nothing at all, and such a rule can still be renamed, switched off or deleted. The list marks a rule that adds nothing **Adds nothing** beside its status. Edit it to choose what it adds, or delete it.

## When rules run

Every enabled rule runs when a resource is created, from the dashboard or through the API, and every rule that matches adds what it adds: several matching rules add all of their labels and owners. A rule never removes anything: not labels or owners someone added by hand, and not ones it added itself. A disabled rule does nothing.

A rule you write today applies to the resources created after it. To apply it to the ones you already have, use **Run Now** — see [Run Rules on Existing Resources](/docs/configuration/run-rules-now). Label rules can also be copied between projects — see [Import and Export Label Rules](/docs/configuration/label-rule-import-export).

## Related

- [Run Rules on Existing Resources](/docs/configuration/run-rules-now)
- [Import and Export Label Rules](/docs/configuration/label-rule-import-export)
- [Incident Settings & Automation](/docs/incidents/settings)
- [SLO Label and Owner Rules](/docs/slo/label-and-owner-rules)
