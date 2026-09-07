# VMware monitors

VMware monitors evaluate telemetry from the [OneUptime VMware Agent](/docs/telemetry/vmware). They identify the affected resource and use OneUptime's existing incident, alert, and on-call workflows.

## Create a monitor

1. Open **VMware**, select a source or resource, and click **Create VMware monitor**. You can also select **VMware** in **Monitors → Create Monitor**.
2. Select a source. Source and resource links fill this in automatically.
3. Pick an **Alert template**, a **Custom metric**, or an **Advanced query**. Collection health and resource measurements belong in separate monitors.
4. Review the resource scope and evaluation window. A resource identifier requires its resource type.
5. Review the monitor criteria, incident and alert actions, severity, and notification routing, then save.

## Recommended starting alerts

- **Collection unavailable:** the collector cannot read VMware, or telemetry stops arriving. This establishes a monitoring problem without assuming every VM has failed.
- **Incomplete inventory:** required VMware inventory reads are incomplete, often because of permissions or partial API errors.
- **Host unavailable:** an ESXi host reports disconnection outside maintenance.
- **Expected VM not running:** a selected VM should remain running but reports another known power state. A powered-off VM without this expectation does not page someone automatically.
- **Datastore capacity and sustained CPU/memory pressure:** resource-specific capacity or utilization thresholds. Review the defaults for your workloads.

Templates create criteria that you can adjust. Resource queries group by stable source, resource type, and resource identifier, so each affected resource has its own incident and resolution. Display-name changes do not change the incident identity.

## Missing data and maintenance

Source collection failure and absent resources are different conditions. A missing resource remains unknown until observations return or it is explicitly retired. Missing CPU or memory values do not become zero. Unknown state is not evidence that an existing incident recovered.

Use a dedicated collection monitor alongside resource alerts. Resource availability alerts observe expected-running and maintenance settings configured on the resource. When editing expectations, choose **Use collector policy** to remove the OneUptime override.

## Metric units

Native metric names begin with `oneuptime.vmware.`. CPU, memory, and datastore utilization are percentages, normally from 0 to 100; datastore capacity, used space, and free space are bytes. Power and connection states are enumerations, not utilization percentages. The metric picker explains their numeric meanings.

Hypervisor-reported healthy state does not replace a guest OS or application availability check. Combine VMware monitors with existing host, website, or API monitors for the parts of the service your users depend on.
