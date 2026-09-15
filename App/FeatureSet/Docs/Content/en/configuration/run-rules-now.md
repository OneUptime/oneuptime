# Run Rules on Existing Resources

Label rules, owner rules and privacy rules run automatically when a resource is **created**. A rule you write today therefore does nothing to the monitors, incidents or hosts you already have. **Run Now** closes that gap: it applies one rule to every resource that already exists in the project.

## Which rules can be run

- **Label Rules** and **Owner Rules**, for every resource that has them: monitors, incidents, incident episodes, alerts, alert episodes, scheduled maintenance events, status pages, services, hosts, Kubernetes clusters, Docker hosts, Docker Swarm clusters, Podman hosts, Proxmox clusters, VMware vCenters, Ceph clusters, IoT fleets, serverless functions, cloud resources, RUM applications, dashboards, on-call policies, on-call schedules, incoming call policies, workflows, runbooks and network devices.
- **Privacy Rules**, for incidents, alerts, incident episodes and alert episodes.
- **Monitor Rules** on a status page. These already re-sync the page whenever a rule is saved; running one re-syncs it on demand.
- **Monitor Rules** on an SLO. These already re-sync the SLO whenever a rule is saved; running one re-syncs the SLO's monitors on demand. See [Monitors and Monitor Rules](/docs/slo/monitor-rules).

Rules that take an action rather than describe a resource — **On-Call Rules**, **Runbook Rules**, **Auto-Remediation Rules** and **Grouping Rules** — cannot be run against existing records. Running them would page people, execute runbooks or reorganize episodes for incidents that are already over.

## Run one rule

1. Open the rule list, for example **Monitors → Settings → Label Rules**.
2. Select **Run Now** on the rule's row, or select **View** and then **Run Now** on the rule's own page.
3. For an owner rule, choose whether to **notify the owners this run adds**. This is off by default, and only takes effect when the rule itself has **Notify Owners** turned on. An owner is notified once for every resource they are added to.
4. Select **Run Rule** and keep the dialog open. On a large project the dialog shows how far the run has got.

When the run finishes, the dialog reports how many resources the rule matched, how many it changed, and how many already had what the rule adds.

## Run several rules

Select rules in the table, open the bulk actions menu and choose **Run Now**. The selected rules run one after another. Owners added by a bulk run are never notified. A rule that cannot run — for example because it is disabled — is listed with the reason, and the other rules still run.

## What a run does

- **It only adds.** Labels are attached, owners are added, resources are made private. Nothing is removed and nothing is made public, so running a rule again is safe: the second run reports that everything was already applied.
- **Every resource in the project is evaluated**, including resolved incidents and alerts.
- **Existing owners are skipped**, never added twice.
- **The rule is applied the same way as on creation**, including labels and owners inherited from an incident's monitors, hosts and services. Where the resource has an activity feed, the feed records which rule changed it.
- **Disabled rules do not run.** Enable the rule first.
- **Status page monitor rules** add the monitors they match and remove the monitors they added earlier that no longer match. Monitors added to the page by hand are never touched.
- **A single run covers up to 100,000 resources.** On a larger project the run stops and says so; run the rule again to continue.

## Permissions

To run a rule you need permission to edit the rule **and** to edit the resources it changes — for example, a monitor label rule needs both the monitor label rule and the monitor edit permissions. Owner rules also need permission to add owners. A permission limited to specific labels is not enough, because a run can change every resource in the project. Team block lists apply as they do everywhere else.

## Related

- [Import and Export Label Rules](/docs/configuration/label-rule-import-export)
- [Incident Settings and Rules](/docs/incidents/settings)
