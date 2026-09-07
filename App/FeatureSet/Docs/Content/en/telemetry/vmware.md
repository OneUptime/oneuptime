# VMware vSphere monitoring

Connect vCenter or a standalone ESXi endpoint to see hosts, virtual machines, clusters, and datastores in OneUptime. The VMware Agent runs on your management network and sends telemetry outbound over HTTPS. VMware credentials remain on the agent machine.

## Install the agent

You need Docker with Compose, network access to the VMware HTTPS SDK API, a dedicated read-only VMware account with permissions propagated to the intended inventory, and a OneUptime telemetry ingestion key from **Project Settings → Telemetry Ingestion Keys**.

Use a management machine that remains available when the infrastructure you monitor fails. In a [OneUptime checkout](https://github.com/OneUptime/oneuptime), open the `VMwareAgent` directory:

```sh
cd VMwareAgent
cp .env.example .env
chmod 600 .env
```

Edit `.env` before starting the agent:

```dotenv
VMWARE_SOURCE_ID=prod-vcenter
VMWARE_SOURCE_NAME=Production vCenter
VMWARE_ENDPOINT=https://vcenter.example.com
VMWARE_USERNAME=oneuptime-reader@example.com
VMWARE_PASSWORD=your-vmware-password
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-project-ingestion-key
```

`VMWARE_SOURCE_ID` must remain stable and unique within the OneUptime project. Changing a display name is safe; changing the source ID creates another source. Run one deployment for each VMware endpoint.

For an internal certificate authority, place the CA chain at `certs/vmware-ca.pem` and set `VMWARE_CA_FILE=/etc/vmware-certs/vmware-ca.pem` in `.env`. The agent verifies certificate trust and hostnames. Use the correct CA certificate for your endpoint.

```sh
docker compose up -d --build
docker compose logs --tail=100 inventory collector
```

Open **VMware → Sources**. The source and resources appear automatically after collection; the sources page checks for data every 10 seconds. The source overview refreshes every 30 seconds. Collection runs every 60 seconds by default.

The bundle includes an OpenTelemetry Collector for vCenter performance metrics and a read-only inventory companion for stable identity, individual states, and native `oneuptime.vmware.*` measurements. Preserve the `inventory` volume during upgrades so the agent remembers previously discovered resources.

## Read the source and resource views

Select a source to browse **ESXi hosts**, **Virtual machines**, **Datastores**, or **Clusters**. Search by name or stable resource identifier. Open a resource to inspect its reported state, parent, last observation, utilization history, and monitoring expectations. The **Performance** tab compares host and datastore measurements over a selectable time range.

OneUptime shows collection health separately from resource health:

| State | Meaning |
| --- | --- |
| Connected | Recent telemetry and a recent successful inventory collection are available. |
| Collection failed | The collector reports a VMware API or authentication failure. |
| Partial inventory | The collector could not complete all required inventory queries. Check permissions and collection logs. |
| Collection stale | No recent collector reports arrived. Check the agent and telemetry delivery path. |
| Unknown / stale data | OneUptime cannot establish current resource state. Last-known inventory is retained, and current utilization is not shown as zero. |
| Not observed | The resource was previously discovered but is absent from the latest inventory report. Absence alone does not establish an outage or deletion. |

The current view treats observations older than three configured collection intervals as stale, with a minimum freshness window of 90 seconds. Set the monitor evaluation window longer than the collection interval; the default five-minute alert window suits the default one-minute collection interval. Historical charts can still show earlier measurements while current collection is unavailable.

## Set expectations and create alerts

A powered-off VM is often intentional. On a VM detail page, set **Expected to run** to **Yes** only for VMs that should remain running. Choose **No** when power-off is allowed, or **Use collector policy** to inherit `policy.json`. Maintenance can also inherit VMware's reported setting or be explicitly overridden. These settings require permission to edit VMware resources.

Select **Create VMware monitor** from a source or resource to preserve its scope in the monitor form. Choose a template for collection failure, host availability, an expected VM not running, datastore capacity, or sustained resource pressure. Review criteria, incident severity, notification routing, and the evaluation window before saving. See [VMware monitors](/docs/monitor/vmware-monitor).

Archived sources disappear from the active source list. Archive is not a substitute for disabling an existing monitor; monitor enable/disable settings remain separate.

## Boundaries

These views describe hypervisor inventory and VMware-reported utilization. A running VM does not establish that its application works. Use HTTP/API checks and guest host telemetry where application or operating-system health matters.

VMware administration, alarm synchronization, NSX, vSAN, guest process monitoring, and application checks are separate capabilities. Availability and metric coverage depend on endpoint capabilities and the account's visible inventory. Validate collection on your VMware version before relying on the alerts.

For agent options, persistent inventory, explicit resource retirement, and troubleshooting, see the [VMware Agent guide](https://github.com/OneUptime/oneuptime/tree/master/VMwareAgent).
